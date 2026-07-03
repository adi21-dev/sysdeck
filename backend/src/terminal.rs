use std::collections::HashSet;
use std::io::{Read, Write};
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::response::{IntoResponse, Json};
use portable_pty::{CommandBuilder, PtySize};
use serde_json::json;
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::AppState;

pub struct TerminalState {
    pub ids: Mutex<HashSet<String>>,
}

impl Default for TerminalState {
    fn default() -> Self {
        Self {
            ids: Mutex::new(HashSet::new()),
        }
    }
}

pub async fn create_handler(State(state): State<AppState>) -> Json<serde_json::Value> {
    let id = Uuid::new_v4().to_string();
    let mut ids = state.terminal_state.ids.lock().await;
    ids.insert(id.clone());
    Json(json!({"success": true, "id": id}))
}

pub async fn ws_terminal_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_terminal_ws(socket, state, id))
}

async fn handle_terminal_ws(mut socket: WebSocket, state: AppState, id: String) {
    // Validate session ID exists
    {
        let mut ids = state.terminal_state.ids.lock().await;
        if !ids.remove(&id) {
            let _ = socket
                .send(Message::Text("Terminal session not found".into()))
                .await;
            return;
        }
    }

    // Spawn PTY here (after WS is connected, so no output race)
    let pty_system = portable_pty::native_pty_system();
    let pair = match pty_system.openpty(PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    }) {
        Ok(p) => p,
        Err(_) => {
            let _ = socket
                .send(Message::Text("Failed to open PTY".into()))
                .await;
            return;
        }
    };

    let cmd = CommandBuilder::new("powershell");
    let mut child = match pair.slave.spawn_command(cmd) {
        Ok(c) => c,
        Err(_) => {
            let _ = socket
                .send(Message::Text("Failed to spawn shell".into()))
                .await;
            return;
        }
    };

    let master = pair.master;
    let reader = match master.try_clone_reader() {
        Ok(r) => r,
        Err(_) => {
            let _ = socket
                .send(Message::Text("Failed to get reader".into()))
                .await;
            return;
        }
    };
    let writer = match master.take_writer() {
        Ok(w) => w,
        Err(_) => {
            let _ = socket
                .send(Message::Text("Failed to get writer".into()))
                .await;
            return;
        }
    };

    let (output_tx, mut output_rx) = tokio::sync::mpsc::unbounded_channel::<String>();

    // Blocking reader: PTY -> mpsc channel
    tokio::task::spawn_blocking(move || {
        let mut buf = [0u8; 4096];
        let mut reader = reader;
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    if output_tx.send(data).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    // Wrap writer in a mutex for async access
    let writer = Arc::new(tokio::sync::Mutex::new(writer));
    let master = Arc::new(tokio::sync::Mutex::new(master));

    loop {
        tokio::select! {
            // Outbound: PTY output -> WebSocket client
            Some(data) = output_rx.recv() => {
                let payload = json!({"event": "terminal_output", "data": data});
                if socket.send(Message::Text(payload.to_string())).await.is_err() {
                    break;
                }
            }
            // Inbound: WebSocket client -> PTY stdin/resize
            ws_msg = socket.recv() => {
                match ws_msg {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
                            match parsed.get("event").and_then(|v| v.as_str()) {
                                Some("terminal_stdin") => {
                                    if let Some(data) = parsed.get("data").and_then(|v| v.as_str()) {
                                        let mut w = writer.lock().await;
                                        let _ = w.write_all(data.as_bytes());
                                        let _ = w.flush();
                                    }
                                }
                                Some("terminal_resize") => {
                                    let cols = parsed.get("cols").and_then(|v| v.as_u64()).unwrap_or(80) as u16;
                                    let rows = parsed.get("rows").and_then(|v| v.as_u64()).unwrap_or(24) as u16;
                                    let m = master.lock().await;
                                    let _ = m.resize(PtySize {
                                        rows,
                                        cols,
                                        pixel_width: 0,
                                        pixel_height: 0,
                                    });
                                }
                                _ => {}
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }

    // WS disconnected: drop everything (reader task notices mpsc close, PTY handle close kills child)
    drop(writer);
    drop(master);
    let _ = child.wait();
}
