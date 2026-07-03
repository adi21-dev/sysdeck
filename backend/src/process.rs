use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sysinfo::System;

use crate::AppState;

#[derive(Serialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub cpu: f32,
    pub memory_mb: u64,
}

pub async fn list_handler(State(_state): State<AppState>) -> Json<serde_json::Value> {
    let processes = tokio::task::spawn_blocking(|| {
        let mut sys = System::new();
        sys.refresh_processes();
        let mut procs: Vec<_> = sys
            .processes()
            .values()
            .map(|p| ProcessInfo {
                pid: p.pid().as_u32(),
                name: p.name().to_string(),
                cpu: p.cpu_usage(),
                memory_mb: p.memory() / 1_000_000,
            })
            .collect();
        procs.sort_by(|a, b| b.cpu.partial_cmp(&a.cpu).unwrap());
        procs.truncate(15);
        procs
    })
    .await
    .unwrap_or_default();

    Json(json!({"success": true, "processes": processes}))
}

#[derive(Deserialize)]
pub struct KillBody {
    pub pid: u32,
}

pub async fn kill_handler(Json(body): Json<KillBody>) -> impl IntoResponse {
    #[cfg(target_os = "windows")]
    {
        let pid = body.pid;
        match crate::new_command("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .output()
        {
            Ok(out) if out.status.success() => Json(json!({"success": true})).into_response(),
            Ok(out) => {
                let msg = String::from_utf8_lossy(&out.stderr).to_string();
                (
                    StatusCode::BAD_REQUEST,
                    Json(json!({"success": false, "message": msg.trim()})),
                )
                    .into_response()
            }
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"success": false, "message": e.to_string()})),
            )
                .into_response(),
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = body;
        (
            StatusCode::NOT_IMPLEMENTED,
            Json(json!({"success": false, "message": "Not supported"})),
        )
            .into_response()
    }
}
