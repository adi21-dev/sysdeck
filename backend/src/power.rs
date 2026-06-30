use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

use axum::extract::State;
use axum::response::{IntoResponse, Json};
use serde::{Deserialize, Serialize};
use tokio::sync::{oneshot, Mutex};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PowerAction {
    Shutdown,
    Restart,
    Sleep,
}

pub struct PendingCommand {
    pub action: PowerAction,
    pub requested_at: Instant,
    pub cancel_tx: oneshot::Sender<()>,
}

pub struct PowerState {
    pub pending: Mutex<Option<PendingCommand>>,
    pub active_uploads: AtomicU32,
}

impl PowerState {
    pub fn new() -> Self {
        Self {
            pending: Mutex::new(None),
            active_uploads: AtomicU32::new(0),
        }
    }
}

impl Default for PowerState {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Serialize)]
struct PowerResponse {
    success: bool,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    active_transfers: Option<u32>,
}

#[derive(Deserialize)]
pub(crate) struct PowerRequest {
    #[serde(default)]
    confirmed: bool,
}

#[derive(Serialize)]
struct PowerStatusResponse {
    has_pending: bool,
    action: Option<String>,
    remaining_secs: Option<u64>,
}

pub(crate) async fn shutdown_handler(
    State(state): State<crate::AppState>,
    Json(req): Json<PowerRequest>,
) -> impl IntoResponse {
    power_action_handler(state, PowerAction::Shutdown, req.confirmed).await
}

pub(crate) async fn restart_handler(
    State(state): State<crate::AppState>,
    Json(req): Json<PowerRequest>,
) -> impl IntoResponse {
    power_action_handler(state, PowerAction::Restart, req.confirmed).await
}

pub(crate) async fn sleep_handler(
    State(state): State<crate::AppState>,
    Json(req): Json<PowerRequest>,
) -> impl IntoResponse {
    power_action_handler(state, PowerAction::Sleep, req.confirmed).await
}

async fn power_action_handler(
    state: crate::AppState,
    action: PowerAction,
    confirmed: bool,
) -> impl IntoResponse {
    let active = state.power_state.active_uploads.load(Ordering::Relaxed);

    if active > 0 && !confirmed {
        return Json(PowerResponse {
            success: true,
            message: format!(
                "{} active file transfer(s) in progress. Send confirmed=true to proceed.",
                active
            ),
            active_transfers: Some(active),
        })
        .into_response();
    }

    let mut pending = state.power_state.pending.lock().await;
    if pending.is_some() {
        return Json(PowerResponse {
            success: false,
            message: "A power command is already pending. Cancel it first.".to_string(),
            active_transfers: None,
        })
        .into_response();
    }

    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    let action_str = format!("{:?}", action);

    *pending = Some(PendingCommand {
        action,
        requested_at: Instant::now(),
        cancel_tx,
    });
    drop(pending);

    let state_clone = state.clone();
    tokio::spawn(async move {
        let cancelled = tokio::time::timeout(Duration::from_secs(5), cancel_rx).await;

        match cancelled {
            Ok(Ok(())) => {
                tracing::info!("Power command cancelled: {}", action_str);
            }
            _ => {
                tracing::info!("Executing power command: {}", action_str);
                execute_power_action(action);
            }
        }

        let mut pending = state_clone.power_state.pending.lock().await;
        *pending = None;
    });

    Json(PowerResponse {
        success: true,
        message: format!(
            "{:?} will execute in 5 seconds. Use /api/power/cancel to abort.",
            action
        ),
        active_transfers: None,
    })
    .into_response()
}

fn execute_power_action(action: PowerAction) {
    match action {
        PowerAction::Shutdown => {
            let _ = std::process::Command::new("shutdown")
                .args(["/s", "/t", "5"])
                .spawn();
        }
        PowerAction::Restart => {
            let _ = std::process::Command::new("shutdown")
                .args(["/r", "/t", "5"])
                .spawn();
        }
        PowerAction::Sleep => {
            let _ = std::process::Command::new("rundll32.exe")
                .args(["powrprof.dll,SetSuspendState", "0", "1", "0"])
                .spawn();
        }
    }
}

pub async fn cancel_power_handler(State(state): State<crate::AppState>) -> impl IntoResponse {
    let mut pending = state.power_state.pending.lock().await;
    if let Some(cmd) = pending.take() {
        let _ = cmd.cancel_tx.send(());
        Json(PowerResponse {
            success: true,
            message: "Power command cancelled.".to_string(),
            active_transfers: None,
        })
        .into_response()
    } else {
        Json(PowerResponse {
            success: false,
            message: "No pending power command.".to_string(),
            active_transfers: None,
        })
        .into_response()
    }
}

pub(crate) async fn power_status_handler(
    State(state): State<crate::AppState>,
) -> impl IntoResponse {
    let pending = state.power_state.pending.lock().await;
    match pending.as_ref() {
        Some(cmd) => {
            let elapsed = cmd.requested_at.elapsed().as_secs();
            let remaining = 5_u64.saturating_sub(elapsed);
            Json(PowerStatusResponse {
                has_pending: true,
                action: Some(format!("{:?}", cmd.action)),
                remaining_secs: Some(remaining),
            })
            .into_response()
        }
        None => Json(PowerStatusResponse {
            has_pending: false,
            action: None,
            remaining_secs: None,
        })
        .into_response(),
    }
}
