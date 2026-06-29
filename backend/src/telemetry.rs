use std::sync::Arc;
use std::time::Duration;
use sysinfo::{Components, Disks, Networks, System};
use tokio::sync::{broadcast, Mutex};

use crate::db::{self, TelemetrySnapshot};

pub fn start_engine(
    tx: broadcast::Sender<Arc<TelemetrySnapshot>>,
    db: Arc<Mutex<rusqlite::Connection>>,
) {
    tokio::spawn(async move {
        let mut system = System::new();
        let mut networks = Networks::new_with_refreshed_list();
        let mut components = Components::new_with_refreshed_list();
        let mut disks = Disks::new_with_refreshed_list();

        let mut tick_1s = 0u64;

        let mut interval = tokio::time::interval(Duration::from_secs(1));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            interval.tick().await;
            tick_1s += 1;

            // Refresh 1s-tier data
            system.refresh_cpu_usage();
            system.refresh_memory();
            networks.refresh();

            let cpu_usage = system.global_cpu_info().cpu_usage();
            let ram_used = system.used_memory();
            let ram_total = system.total_memory();

            // Network diff since last refresh (1s)
            let net_rx_bps: u64 = networks.iter().map(|(_, n)| n.received()).sum();
            let net_tx_bps: u64 = networks.iter().map(|(_, n)| n.transmitted()).sum();

            // Refresh 5s-tier data (temperatures)
            let temperature = if tick_1s % 5 == 0 {
                components.refresh();
                components
                    .iter()
                    .find(|c| !c.label().to_lowercase().contains("fan"))
                    .map(|c| c.temperature())
            } else {
                components
                    .iter()
                    .find(|c| !c.label().to_lowercase().contains("fan"))
                    .map(|c| c.temperature())
            };

            // Refresh 10s-tier data (disks)
            if tick_1s % 10 == 0 {
                disks.refresh();
            }
            let disk_total: u64 = disks.iter().map(|d| d.total_space()).sum();
            let disk_available: u64 = disks.iter().map(|d| d.available_space()).sum();
            let disk_used = disk_total.saturating_sub(disk_available);

            // No battery API in sysinfo 0.30.13 — reserved for future use
            let battery_percent: Option<f32> = None;
            let battery_charging: Option<bool> = None;

            let timestamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as i64;

            let snapshot = TelemetrySnapshot {
                timestamp,
                cpu_usage,
                ram_used,
                ram_total,
                net_rx_bps,
                net_tx_bps,
                temperature,
                disk_used,
                disk_total,
                battery_percent,
                battery_charging,
            };

            // Persist to DB every 60 ticks (1 minute)
            if tick_1s % 60 == 0 {
                let db_lock = db.lock().await;
                if let Err(e) = db::insert_telemetry(&db_lock, &snapshot) {
                    tracing::error!("Failed to persist telemetry: {}", e);
                }
            }

            // Broadcast to WebSocket clients (every 1s)
            let _ = tx.send(Arc::new(snapshot));
        }
    });
}
