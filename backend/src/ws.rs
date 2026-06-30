use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::IntoResponse;
use serde_json::json;
use tokio::sync::broadcast;

use crate::db::TelemetrySnapshot;
use crate::tunnel::TunnelEvent;
use crate::AppState;

pub async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state.telemetry_tx, state.tunnel_state.tx.clone()))
}

async fn handle_socket(
    mut socket: WebSocket,
    telemetry_tx: broadcast::Sender<Arc<TelemetrySnapshot>>,
    tunnel_tx: broadcast::Sender<Arc<TunnelEvent>>,
) {
    let mut telemetry_rx = telemetry_tx.subscribe();
    let mut tunnel_rx = tunnel_tx.subscribe();

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
        }
    }
}
