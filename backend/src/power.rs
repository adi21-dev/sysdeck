use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
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
    Hibernate,
    SignOut,
    Lock,
    SwitchUser,
}

// --- SystemCommands trait for testable OS interactions ---

pub trait SystemCommands: Send + Sync {
    fn execute_power_action(&self, action: PowerAction);
}

pub struct RealOs;

impl SystemCommands for RealOs {
    fn execute_power_action(&self, action: PowerAction) {
        match action {
            PowerAction::Shutdown => {
                let _ = std::process::Command::new("shutdown")
                    .args(["/s", "/t", "1"])
                    .spawn();
            }
            PowerAction::Restart => {
                let _ = std::process::Command::new("shutdown")
                    .args(["/r", "/t", "1"])
                    .spawn();
            }
            PowerAction::Sleep => {
                let _ = std::process::Command::new("rundll32.exe")
                    .args(["powrprof.dll,SetSuspendState", "0", "1", "0"])
                    .spawn();
            }
            PowerAction::Hibernate => {
                let _ = std::process::Command::new("rundll32.exe")
                    .args(["powrprof.dll,SetSuspendState", "1", "1", "0"])
                    .spawn();
            }
            PowerAction::SignOut => {
                let _ = std::process::Command::new("shutdown").args(["/l"]).spawn();
            }
            PowerAction::Lock => {
                let _ = std::process::Command::new("rundll32.exe")
                    .args(["user32.dll,LockWorkStation"])
                    .spawn();
            }
            PowerAction::SwitchUser => {
                let _ = std::process::Command::new("rundll32.exe")
                    .args(["user32.dll,LockWorkStation"])
                    .spawn();
            }
        }
    }
}

// ponytail: test-only mock, always visible for integration tests
pub struct MockOs {
    pub last_action: std::sync::Mutex<Option<PowerAction>>,
}

impl MockOs {
    #[allow(clippy::new_without_default)]
    pub fn new() -> Self {
        Self {
            last_action: std::sync::Mutex::new(None),
        }
    }
}

impl SystemCommands for MockOs {
    fn execute_power_action(&self, action: PowerAction) {
        *self.last_action.lock().unwrap() = Some(action);
    }
}

pub struct PendingCommand {
    pub action: PowerAction,
    pub requested_at: Instant,
    pub cancel_tx: oneshot::Sender<()>,
}

pub struct PowerState {
    pub pending: Mutex<Option<PendingCommand>>,
    pub active_uploads: AtomicU32,
    pub system_commands: Arc<dyn SystemCommands>,
}

impl PowerState {
    #[allow(clippy::new_without_default)]
    pub fn new() -> Self {
        Self {
            pending: Mutex::new(None),
            active_uploads: AtomicU32::new(0),
            system_commands: Arc::new(RealOs),
        }
    }

    pub fn with_commands(commands: Arc<dyn SystemCommands>) -> Self {
        Self {
            pending: Mutex::new(None),
            active_uploads: AtomicU32::new(0),
            system_commands: commands,
        }
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
    action: String,
    #[serde(default)]
    confirmed: bool,
}

#[derive(Serialize)]
struct PowerStatusResponse {
    has_pending: bool,
    action: Option<String>,
    remaining_secs: Option<u64>,
}

pub(crate) async fn execute_handler(
    State(state): State<crate::AppState>,
    Json(req): Json<PowerRequest>,
) -> impl IntoResponse {
    let action = match req.action.as_str() {
        "shutdown" => PowerAction::Shutdown,
        "restart" => PowerAction::Restart,
        "sleep" => PowerAction::Sleep,
        "hibernate" => PowerAction::Hibernate,
        "signout" => PowerAction::SignOut,
        "lock" => PowerAction::Lock,
        "switchuser" => PowerAction::SwitchUser,
        _ => {
            return Json(PowerResponse {
                success: false,
                message: format!("Unknown action: {}", req.action),
                active_transfers: None,
            })
            .into_response()
        }
    };
    let confirmed = req.confirmed;
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
    let commands = state.power_state.system_commands.clone();
    tokio::spawn(async move {
        let cancelled = tokio::time::timeout(Duration::from_secs(5), cancel_rx).await;

        match cancelled {
            Ok(Ok(())) => {
                tracing::info!("Power command cancelled: {}", action_str);
            }
            _ => {
                tracing::info!("Executing power command: {}", action_str);
                commands.execute_power_action(action);
            }
        }

        let mut pending = state_clone.power_state.pending.lock().await;
        *pending = None;
    });

    Json(PowerResponse {
        success: true,
        message: format!("{:?} will execute in 5 seconds.", action),
        active_transfers: None,
    })
    .into_response()
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
