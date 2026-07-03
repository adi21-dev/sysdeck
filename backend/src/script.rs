use tracing;

use std::collections::HashMap;
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Json, Response};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::io::AsyncBufReadExt;
use tokio::process::Command;
use tokio::sync::broadcast;
use tokio::sync::Mutex;
use uuid::Uuid;

fn kill_process_tree(pid: Option<u32>) {
    let Some(pid) = pid else { return };
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/T", "/F", "/PID", &pid.to_string()])
            .spawn()
            .map(|mut c| {
                let _ = c.wait();
            });
    }
    #[cfg(unix)]
    {
        let _ = std::process::Command::new("pkill")
            .args(["-P", &pid.to_string()])
            .spawn();
        let _ = std::process::Command::new("kill")
            .args(["-9", &pid.to_string()])
            .spawn();
    }
}

use crate::auth;
use crate::db;

const MAX_OUTPUT_SIZE: usize = 1_000_000;
const SCRIPT_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Debug, Clone, Serialize)]
pub struct ScriptOutput {
    pub stream: String,
    pub data: String,
    pub seq: usize,
}

#[derive(Serialize)]
pub struct ScriptResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub truncated: bool,
}

#[derive(Clone)]
pub struct ScriptHandle {
    pub output_tx: broadcast::Sender<ScriptOutput>,
    pub history: std::sync::Arc<tokio::sync::Mutex<Vec<ScriptOutput>>>,
    pub completed: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

pub struct ScriptState {
    pub running: Mutex<HashMap<String, ScriptHandle>>,
}

impl ScriptState {
    #[allow(clippy::new_without_default)]
    pub fn new() -> Self {
        Self {
            running: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Deserialize)]
pub struct ExecuteRequest {
    pub script_type: String,
    pub content: String,
    #[serde(default)]
    pub mode: String,
}

pub(crate) async fn execute_handler(
    State(state): State<crate::AppState>,
    headers: HeaderMap,
    Json(req): Json<ExecuteRequest>,
) -> Response {
    // Auth: accept X-Api-Key (webhook) or JWT cookie (UI)
    let api_key = headers
        .get("X-Api-Key")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    match api_key {
        Some(ref key) => {
            let conn = state.db.lock().await;
            let stored = db::get_setting(&conn, "webhook_api_key").unwrap_or_default();
            drop(conn);
            if key != &stored {
                return (
                    StatusCode::UNAUTHORIZED,
                    Json(json!({"success": false, "message": "Invalid API key"})),
                )
                    .into_response();
            }
        }
        None => {
            let cookie_str = headers
                .get(header::COOKIE)
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());
            let authenticated = match cookie_str {
                Some(ref c) => match auth::parse_cookie(c, "token") {
                    Some(t) => {
                        let conn = state.db.lock().await;
                        let valid = auth::check_access_token(t, &state.jwt_key, &conn);
                        drop(conn);
                        valid
                    }
                    None => false,
                },
                None => false,
            };
            if !authenticated {
                return (
                    StatusCode::UNAUTHORIZED,
                    Json(json!({"success": false, "message": "Unauthorized"})),
                )
                    .into_response();
            }
        }
    }

    let id = Uuid::new_v4().to_string();
    let (output_tx, _) = broadcast::channel::<ScriptOutput>(10000);
    let ip = auth::client_ip_from_headers(&headers);

    tracing::info!("script_execute: type={}, mode={}", req.script_type, req.mode);

    {
        let conn = state.db.lock().await;
        let _ = db::insert_audit_log(
            &conn,
            "script_executed",
            Some(&format!("{} script started", req.script_type)),
            Some(&ip),
        );
    }

    let history = std::sync::Arc::new(tokio::sync::Mutex::new(Vec::new()));
    let completed = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

    if req.mode == "wait" {
        let result = run_script(&req.script_type, &req.content, output_tx, None).await;
        tracing::info!("script_complete: id={}, exit_code={}", id, result.exit_code);
        return Json(json!({
            "success": true,
            "id": id,
            "result": {
                "exit_code": result.exit_code,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "truncated": result.truncated,
            }
        }))
        .into_response();
    }

    {
        let mut running = state.script_state.running.lock().await;
        running.insert(
            id.clone(),
            ScriptHandle {
                output_tx: output_tx.clone(),
                history: history.clone(),
                completed: completed.clone(),
            },
        );
    }

    let state_clone = state.clone();
    let id_clone = id.clone();
    let history_clone = history.clone();
    let completed_clone = completed.clone();
    tokio::spawn(async move {
        let _result = run_script(
            &req.script_type,
            &req.content,
            output_tx.clone(),
            Some(history_clone),
        )
        .await;

        completed_clone.store(true, std::sync::atomic::Ordering::SeqCst);
        tracing::info!("script_complete: id={}", id_clone);

        tokio::time::sleep(Duration::from_secs(15)).await;

        let mut running = state_clone.script_state.running.lock().await;
        running.remove(&id_clone);
    });

    Json(json!({"success": true, "id": id, "message": "Script started"})).into_response()
}

async fn run_script(
    script_type: &str,
    content: &str,
    output_tx: broadcast::Sender<ScriptOutput>,
    history: Option<std::sync::Arc<tokio::sync::Mutex<Vec<ScriptOutput>>>>,
) -> ScriptResult {
    let child = if script_type.eq_ignore_ascii_case("powershell") {
        let ps_content = format!(
            "$OutputEncoding = [System.Text.Encoding]::UTF8; {}",
            content
        );
        Command::new("powershell")
            .args(["-NoProfile", "-Command", &ps_content])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
    } else {
        let content = content.replace("\r\n", " & ").replace('\n', " & ");
        Command::new("cmd")
            .args(["/C", &content])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
    };

    let mut child = match child {
        Ok(c) => {
            tracing::debug!("script_process_started: type={}", script_type);
            c
        }
        Err(e) => {
            tracing::warn!("script_spawn_failed: type={}, error={}", script_type, e);
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
        let hist = history.clone();
        tokio::spawn(async move { read_stream(stdout, "stdout", tx, hist).await })
    });

    let stderr_task = stderr.map(|stderr| {
        let tx = output_tx.clone();
        let hist = history.clone();
        tokio::spawn(async move { read_stream(stderr, "stderr", tx, hist).await })
    });

    let status = tokio::time::timeout(SCRIPT_TIMEOUT, child.wait()).await;

    let (stdout_output, stdout_truncated) = match stdout_task {
        Some(h) => match h.await {
            Ok(r) => r,
            Err(e) => {
                tracing::error!("script_stdout_task_join_error: {}", e);
                (String::new(), false)
            }
        },
        None => (String::new(), false),
    };

    let (stderr_output, stderr_truncated) = match stderr_task {
        Some(h) => match h.await {
            Ok(r) => r,
            Err(e) => {
                tracing::error!("script_stderr_task_join_error: {}", e);
                (String::new(), false)
            }
        },
        None => (String::new(), false),
    };

    match status {
        Ok(Ok(status)) => {
            let exit_code = status.code().unwrap_or(-1);
            let mut seq = 0;
            if let Some(ref hist) = history {
                let mut h = hist.lock().await;
                seq = h.len();
                let msg = ScriptOutput {
                    stream: "system".to_string(),
                    data: format!("\n[Process exited with code {}]\n", exit_code),
                    seq,
                };
                h.push(msg.clone());
                let _ = output_tx.send(msg);
            } else {
                let _ = output_tx.send(ScriptOutput {
                    stream: "system".to_string(),
                    data: format!("\n[Process exited with code {}]\n", exit_code),
                    seq,
                });
            }
            ScriptResult {
                exit_code,
                stdout: stdout_output,
                stderr: stderr_output,
                truncated: stdout_truncated || stderr_truncated,
            }
        }
        Ok(Err(e)) => {
            tracing::warn!("script_process_error: type={}, error={}", script_type, e);
            ScriptResult {
                exit_code: -1,
                stdout: stdout_output,
                stderr: format!("Process error: {}", e),
                truncated: stdout_truncated || stderr_truncated,
            }
        }
        Err(_) => {
            tracing::warn!("script_timeout: type={}", script_type);
            kill_process_tree(child.id());
            let _ = child.wait().await;
            let mut seq = 0;
            if let Some(ref hist) = history {
                let mut h = hist.lock().await;
                seq = h.len();
                let msg = ScriptOutput {
                    stream: "system".to_string(),
                    data: "\n[Process tree killed after 5 minute timeout]\n".to_string(),
                    seq,
                };
                h.push(msg.clone());
                let _ = output_tx.send(msg);
            } else {
                let _ = output_tx.send(ScriptOutput {
                    stream: "system".to_string(),
                    data: "\n[Process tree killed after 5 minute timeout]\n".to_string(),
                    seq,
                });
            }
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
    history: Option<std::sync::Arc<tokio::sync::Mutex<Vec<ScriptOutput>>>>,
) -> (String, bool) {
    let mut reader = tokio::io::BufReader::new(stream);
    let mut buf = Vec::new();
    let mut total = 0usize;
    let mut truncated = false;
    let mut output = String::new();

    while reader.read_until(b'\n', &mut buf).await.unwrap_or_else(|e| {
        tracing::error!("script_read_error: stream={}, error={}", stream_name, e);
        0
    }) > 0 {
        // strip trailing \r\n
        while buf
            .last()
            .map(|&b| b == b'\n' || b == b'\r')
            .unwrap_or(false)
        {
            buf.pop();
        }

        let line = String::from_utf8_lossy(&buf).to_string();

        total += line.len();
        if total <= MAX_OUTPUT_SIZE {
            output.push_str(&line);
            output.push('\n');
            let mut seq = 0;
            if let Some(ref hist) = history {
                let mut h = hist.lock().await;
                seq = h.len();
                let msg = ScriptOutput {
                    stream: stream_name.to_string(),
                    data: line,
                    seq,
                };
                h.push(msg.clone());
                let _ = output_tx.send(msg);
            } else {
                let _ = output_tx.send(ScriptOutput {
                    stream: stream_name.to_string(),
                    data: line,
                    seq,
                });
            }
        } else if !truncated {
            truncated = true;
            tracing::warn!("script_output_truncated: stream={}", stream_name);
            let mut seq = 0;
            if let Some(ref hist) = history {
                let mut h = hist.lock().await;
                seq = h.len();
                let msg = ScriptOutput {
                    stream: stream_name.to_string(),
                    data: "\n[Output truncated at 1MB]\n".to_string(),
                    seq,
                };
                h.push(msg.clone());
                let _ = output_tx.send(msg);
            } else {
                let _ = output_tx.send(ScriptOutput {
                    stream: stream_name.to_string(),
                    data: "\n[Output truncated at 1MB]\n".to_string(),
                    seq,
                });
            }
        }
        buf.clear();
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
    let handle = {
        let running = state.script_state.running.lock().await;
        running.get(&id).cloned()
    };

    let handle = match handle {
        Some(h) => h,
        None => {
            let _ = socket
                .send(Message::Text(
                    "Script not found or already completed".into(),
                ))
                .await;
            return;
        }
    };

    let mut rx = handle.output_tx.subscribe();

    // 1. Send all historical messages to catch up
    let hist_messages = {
        let hist = handle.history.lock().await;
        hist.clone()
    };

    for msg in hist_messages {
        let serialized = serde_json::to_string(&msg).unwrap_or_default();
        if socket.send(Message::Text(serialized)).await.is_err() {
            return;
        }
    }

    // 2. If the script is already completed, send done event and close immediately
    if handle.completed.load(std::sync::atomic::Ordering::SeqCst) {
        let _ = socket
            .send(Message::Text(r#"{"event":"done"}"#.into()))
            .await;
        return;
    }

    // 3. Keep track of next expected sequence number to prevent double delivery
    let mut next_seq = {
        let hist = handle.history.lock().await;
        hist.len()
    };

    // 4. Enter real-time forwarding loop
    loop {
        match rx.recv().await {
            Ok(output) => {
                // If sequence number is already sent, skip it
                if output.seq < next_seq {
                    continue;
                }
                next_seq = output.seq + 1;

                let msg = serde_json::to_string(&output).unwrap_or_default();
                if socket.send(Message::Text(msg)).await.is_err() {
                    break;
                }
                // ponytail: system message = process exited/killed, close WS immediately
                if output.stream == "system" {
                    let _ = socket
                        .send(Message::Text(r#"{"event":"done"}"#.into()))
                        .await;
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
