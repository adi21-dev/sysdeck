use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::IntoResponse;
use serde_json::json;
use tokio::sync::broadcast;

use crate::db::TelemetrySnapshot;
use crate::tunnel::{TunnelEvent, TunnelStatus};
use crate::AppState;

pub async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| {
        handle_socket(
            socket,
            state.telemetry_tx,
            state.system_tx,
            state.tunnel_state.tx.clone(),
            state.clipboard_tx,
            state.tunnel_state.clone(),
        )
    })
}

async fn handle_socket(
    mut socket: WebSocket,
    telemetry_tx: broadcast::Sender<Arc<TelemetrySnapshot>>,
    system_tx: broadcast::Sender<String>,
    tunnel_tx: broadcast::Sender<Arc<TunnelEvent>>,
    clipboard_tx: broadcast::Sender<String>,
    tunnel_state: Arc<crate::tunnel::TunnelState>,
) {
    tracing::info!("WebSocket connected");

    {
        let status = tunnel_state.status.read().await;
        let url = tunnel_state.url.read().await.clone();
        let error = match &*status {
            TunnelStatus::Failed(e) => Some(e.clone()),
            _ => None,
        };
        let msg = json!({
            "event": "tunnel_status",
            "status": status.to_string(),
            "url": url,
            "error": error,
        });
        let _ = socket.send(Message::Text(msg.to_string())).await;
    }

    let mut telemetry_rx = telemetry_tx.subscribe();
    let mut system_rx = system_tx.subscribe();
    let mut tunnel_rx = tunnel_tx.subscribe();
    let mut clipboard_rx = clipboard_tx.subscribe();

    loop {
        tokio::select! {
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
            snapshot = telemetry_rx.recv() => {
                match snapshot {
                    Ok(snapshot) => {
                        let msg = json!({
                            "event": "telemetry",
                            "data": *snapshot,
                        });
                        if socket.send(Message::Text(msg.to_string())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!("WS client lagged by {} messages", n);
                        continue;
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
            event = system_rx.recv() => {
                match event {
                    Ok(msg) => {
                        if socket.send(Message::Text(msg)).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
            event = tunnel_rx.recv() => {
                match event {
                    Ok(event) => {
                        let msg = serde_json::to_string(&*event).unwrap_or_default();
                        if socket.send(Message::Text(msg)).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
            event = clipboard_rx.recv() => {
                match event {
                    Ok(text) => {
                        let msg = json!({
                            "event": "clipboard",
                            "data": {"text": text},
                        });
                        if socket.send(Message::Text(msg.to_string())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }
    tracing::info!("WebSocket disconnected");
}
