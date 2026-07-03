use axum::extract::State;
use axum::response::Json;
use serde::Serialize;
use serde_json::json;

use crate::AppState;

#[derive(Serialize)]
pub struct DiskInfo {
    pub mount: String,
    pub total_gb: u64,
    pub used_gb: u64,
    pub free_gb: u64,
    pub percent_used: f32,
}

pub async fn list_handler(State(_state): State<AppState>) -> Json<serde_json::Value> {
    let disks = tokio::task::spawn_blocking(|| {
        let mut sys_disks = sysinfo::Disks::new_with_refreshed_list();
        sys_disks.refresh();
        sys_disks
            .iter()
            .map(|d| {
                let total = d.total_space();
                let available = d.available_space();
                let used = total.saturating_sub(available);
                let pct = if total > 0 {
                    used as f32 / total as f32 * 100.0
                } else {
                    0.0
                };
                DiskInfo {
                    mount: d.mount_point().to_string_lossy().to_string(),
                    total_gb: total / 1_000_000_000,
                    used_gb: used / 1_000_000_000,
                    free_gb: available / 1_000_000_000,
                    percent_used: (pct * 10.0).round() / 10.0,
                }
            })
            .collect::<Vec<_>>()
    })
    .await
    .unwrap_or_default();

    Json(json!({"success": true, "disks": disks}))
}
