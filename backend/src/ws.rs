use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::IntoResponse;
use tokio::sync::broadcast;

use crate::db::TelemetrySnapshot;
use crate::AppState;

pub async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state.telemetry_tx))
}

async fn handle_socket(mut socket: WebSocket, tx: broadcast::Sender<Arc<TelemetrySnapshot>>) {
    let mut rx = tx.subscribe();

    loop {
        match rx.recv().await {
            Ok(snapshot) => {
                let json = serde_json::to_string(&*snapshot).unwrap();
                if socket.send(Message::Text(json)).await.is_err() {
                    break;
                }
            }
            Err(broadcast::error::RecvError::Lagged(n)) => {
                tracing::warn!("WebSocket client lagged by {} messages", n);
                continue;
            }
            Err(broadcast::error::RecvError::Closed) => break,
        }
    }
}
