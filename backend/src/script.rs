use std::collections::HashMap;
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::response::{IntoResponse, Json};
use serde::{Deserialize, Serialize};
use tokio::io::AsyncBufReadExt;
use tokio::process::Command;
use tokio::sync::broadcast;
use tokio::sync::Mutex;
use uuid::Uuid;

const MAX_OUTPUT_SIZE: usize = 1_000_000;
const SCRIPT_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Debug, Clone, Serialize)]
pub struct ScriptOutput {
    pub stream: String,
    pub data: String,
}

#[derive(Serialize)]
pub struct ScriptResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub truncated: bool,
}

pub struct ScriptHandle {
    pub output_tx: broadcast::Sender<ScriptOutput>,
}

pub struct ScriptState {
    pub running: Mutex<HashMap<String, ScriptHandle>>,
}

impl ScriptState {
    pub fn new() -> Self {
        Self {
            running: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for ScriptState {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Deserialize)]
pub struct ExecuteRequest {
    pub script_type: String,
    pub content: String,
}

#[derive(Serialize)]
pub struct ExecuteResponse {
    pub success: bool,
    pub id: String,
    pub message: String,
}

pub(crate) async fn execute_handler(
    State(state): State<crate::AppState>,
    Json(req): Json<ExecuteRequest>,
) -> impl IntoResponse {
    let id = Uuid::new_v4().to_string();
    let (output_tx, _) = broadcast::channel::<ScriptOutput>(1024);

    {
        let mut running = state.script_state.running.lock().await;
        running.insert(
            id.clone(),
            ScriptHandle {
                output_tx: output_tx.clone(),
            },
        );
    }

    let state_clone = state.clone();
    let id_clone = id.clone();
    tokio::spawn(async move {
        let result = run_script(&req.script_type, &req.content, output_tx.clone()).await;

        let _ = output_tx.send(ScriptOutput {
            stream: "system".to_string(),
            data: serde_json::to_string(&result).unwrap_or_default(),
        });

        let mut running = state_clone.script_state.running.lock().await;
        running.remove(&id_clone);
    });

    Json(ExecuteResponse {
        success: true,
        id,
        message: "Script started".to_string(),
    })
}

async fn run_script(
    script_type: &str,
    content: &str,
    output_tx: broadcast::Sender<ScriptOutput>,
) -> ScriptResult {
    let child = if script_type.eq_ignore_ascii_case("powershell") {
        Command::new("powershell")
            .args(["-NoProfile", "-Command", content])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
    } else {
        Command::new("cmd")
            .args(["/C", content])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
    };

    let mut child = match child {
        Ok(c) => c,
        Err(e) => {
            return ScriptResult {
                exit_code: -1,
                stdout: String::new(),
                stderr: format!("Failed to spawn process: {}", e),
                truncated: false,
            }
        }
    };

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let stdout_task = stdout.map(|stdout| {
        let tx = output_tx.clone();
        tokio::spawn(async move { read_stream(stdout, "stdout", tx).await })
    });

    let stderr_task = stderr.map(|stderr| {
        let tx = output_tx.clone();
        tokio::spawn(async move { read_stream(stderr, "stderr", tx).await })
    });

    let status = tokio::time::timeout(SCRIPT_TIMEOUT, child.wait()).await;

    let (stdout_output, stdout_truncated) = match stdout_task {
        Some(h) => h.await.unwrap_or_default(),
        None => (String::new(), false),
    };

    let (stderr_output, stderr_truncated) = match stderr_task {
        Some(h) => h.await.unwrap_or_default(),
        None => (String::new(), false),
    };

    match status {
        Ok(Ok(status)) => {
            let exit_code = status.code().unwrap_or(-1);
            let _ = output_tx.send(ScriptOutput {
                stream: "system".to_string(),
                data: format!("\n[Process exited with code {}]\n", exit_code),
            });
            ScriptResult {
                exit_code,
                stdout: stdout_output,
                stderr: stderr_output,
                truncated: stdout_truncated || stderr_truncated,
            }
        }
        Ok(Err(e)) => ScriptResult {
            exit_code: -1,
            stdout: stdout_output,
            stderr: format!("Process error: {}", e),
            truncated: stdout_truncated || stderr_truncated,
        },
        Err(_) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            let _ = output_tx.send(ScriptOutput {
                stream: "system".to_string(),
                data: "\n[Process killed after 5 minute timeout]\n".to_string(),
            });
            ScriptResult {
                exit_code: -1,
                stdout: stdout_output,
                stderr: stderr_output,
                truncated: stdout_truncated || stderr_truncated,
            }
        }
    }
}

async fn read_stream<R: tokio::io::AsyncRead + Unpin + Send + 'static>(
    stream: R,
    stream_name: &'static str,
    output_tx: broadcast::Sender<ScriptOutput>,
) -> (String, bool) {
    let mut reader = tokio::io::BufReader::new(stream);
    let mut line = String::new();
    let mut total = 0usize;
    let mut truncated = false;
    let mut output = String::new();

    while reader.read_line(&mut line).await.unwrap_or(0) > 0 {
        total += line.len();
        if total <= MAX_OUTPUT_SIZE {
            output.push_str(&line);
            let _ = output_tx.send(ScriptOutput {
                stream: stream_name.to_string(),
                data: line.clone(),
            });
        } else if !truncated {
            truncated = true;
            let _ = output_tx.send(ScriptOutput {
                stream: stream_name.to_string(),
                data: "\n[Output truncated at 1MB]\n".to_string(),
            });
        }
        line.clear();
    }

    (output, truncated)
}

pub(crate) async fn ws_script_handler(
    State(state): State<crate::AppState>,
    Path(id): Path<String>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_script_ws(socket, state, id))
}

async fn handle_script_ws(mut socket: WebSocket, state: crate::AppState, id: String) {
    let rx = {
        let running = state.script_state.running.lock().await;
        running.get(&id).map(|handle| handle.output_tx.subscribe())
    };

    let mut rx = match rx {
        Some(r) => r,
        None => {
            let _ = socket
                .send(Message::Text(
                    "Script not found or already completed".into(),
                ))
                .await;
            return;
        }
    };

    loop {
        match rx.recv().await {
            Ok(output) => {
                let msg = serde_json::to_string(&output).unwrap_or_default();
                if socket.send(Message::Text(msg)).await.is_err() {
                    break;
                }
            }
            Err(broadcast::error::RecvError::Closed) => {
                let _ = socket
                    .send(Message::Text(r#"{"event":"done"}"#.into()))
                    .await;
                break;
            }
            Err(broadcast::error::RecvError::Lagged(_)) => continue,
        }
    }
}
