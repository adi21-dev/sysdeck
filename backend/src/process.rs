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
    unsafe {
        use windows_sys::Win32::System::Threading::{
            OpenProcess, TerminateProcess, PROCESS_TERMINATE,
        };
        let handle = OpenProcess(PROCESS_TERMINATE, 0, body.pid);
        if handle.is_null() {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"success": false, "message": "Process not found" })),
            )
                .into_response();
        }
        let ret = TerminateProcess(handle, 1);
        let _ = windows_sys::Win32::Foundation::CloseHandle(handle);
        if ret != 0 {
            Json(json!({"success": true})).into_response()
        } else {
            (
                StatusCode::BAD_REQUEST,
                Json(json!({"success": false, "message": "Failed to terminate process" })),
            )
                .into_response()
        }
    }
}
