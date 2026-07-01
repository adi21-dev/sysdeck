use std::sync::Arc;
use std::time::Duration;

use sysinfo::{Components, Disks, Networks, System};
use tokio::sync::{broadcast, mpsc, Mutex};

use crate::db::{self, TelemetrySnapshot};

pub fn start_engine(
    tx: broadcast::Sender<Arc<TelemetrySnapshot>>,
    db: Arc<Mutex<rusqlite::Connection>>,
) {
    let (internal_tx, mut internal_rx) = mpsc::channel::<TelemetrySnapshot>(8);

    std::thread::spawn(move || {
        let mut system = System::new();
        let mut networks = Networks::new_with_refreshed_list();
        let mut components = Components::new_with_refreshed_list();
        let mut disks = Disks::new_with_refreshed_list();
        let mut tick_1s = 0u64;

        loop {
            std::thread::sleep(Duration::from_secs(1));
            tick_1s += 1;

            system.refresh_cpu_usage();
            system.refresh_memory();
            networks.refresh();

            let cpu_usage = system.global_cpu_info().cpu_usage();
            let ram_used = system.used_memory();
            let ram_total = system.total_memory();

            let net_rx_bps: u64 = networks.values().map(|n| n.received()).sum();
            let net_tx_bps: u64 = networks.values().map(|n| n.transmitted()).sum();

            if tick_1s.is_multiple_of(5) {
                components.refresh();
            }
            let temperature = components
                .iter()
                .find(|c| !c.label().to_lowercase().contains("fan"))
                .map(|c| c.temperature());

            if tick_1s.is_multiple_of(10) {
                disks.refresh();
            }
            let disk_total: u64 = disks.iter().map(|d| d.total_space()).sum();
            let disk_available: u64 = disks.iter().map(|d| d.available_space()).sum();
            let disk_used = disk_total.saturating_sub(disk_available);

            let (battery_percent, battery_charging) = if tick_1s.is_multiple_of(30) {
                get_battery_status()
            } else {
                (None, None)
            };

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

            if internal_tx.blocking_send(snapshot).is_err() {
                break;
            }
        }
    });

    tokio::spawn(async move {
        let mut tick = 0u64;
        while let Some(snapshot) = internal_rx.recv().await {
            tick += 1;
            let _ = tx.send(Arc::new(snapshot.clone()));

            if tick.is_multiple_of(60) {
                let db = db.clone();
                let snap = snapshot;
                tokio::task::spawn_blocking(move || {
                    let conn = db.blocking_lock();
                    if let Err(e) = db::insert_telemetry(&conn, &snap) {
                        tracing::error!("Failed to persist telemetry: {}", e);
                    }
                })
                .await
                .ok();
            }
        }
    });
}

// --- Battery ---

#[cfg(windows)]
#[repr(C)]
struct SYSTEM_POWER_STATUS {
    ac_line_status: u8,
    battery_flag: u8,
    battery_life_percent: u8,
    system_status_flag: u8,
    battery_life_time: u32,
    battery_full_life_time: u32,
}

#[cfg(windows)]
extern "system" {
    fn GetSystemPowerStatus(lpSystemPowerStatus: *mut SYSTEM_POWER_STATUS) -> i32;
}

fn get_battery_status() -> (Option<f32>, Option<bool>) {
    #[cfg(windows)]
    {
        let mut status = SYSTEM_POWER_STATUS {
            ac_line_status: 0,
            battery_flag: 0,
            battery_life_percent: 0,
            system_status_flag: 0,
            battery_life_time: 0,
            battery_full_life_time: 0,
        };
        unsafe {
            if GetSystemPowerStatus(&mut status) != 0 {
                let percent = if status.battery_life_percent <= 100 {
                    Some(status.battery_life_percent as f32)
                } else {
                    None
                };
                let charging = Some(status.ac_line_status == 1);
                return (percent, charging);
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        return get_battery_status_linux();
    }

    #[cfg(target_os = "macos")]
    {
        if let Some((p, c)) = get_battery_status_macos() {
            return (p, c);
        }
    }

    (None, None)
}

#[cfg(target_os = "linux")]
fn get_battery_status_linux() -> (Option<f32>, Option<bool>) {
    for i in 0..4 {
        let dir = format!("/sys/class/power_supply/BAT{i}");
        if !std::path::Path::new(&dir).exists() {
            continue;
        }

        let capacity = std::fs::read_to_string(format!("{dir}/capacity"))
            .ok()
            .and_then(|s| s.trim().parse::<f32>().ok());

        let charging = std::fs::read_to_string(format!("{dir}/status"))
            .ok()
            .map(|s| matches!(s.trim(), "Charging" | "Full"));

        return (capacity, charging);
    }
    (None, None)
}

#[cfg(target_os = "macos")]
fn get_battery_status_macos() -> Option<(Option<f32>, Option<bool>)> {
    let out = std::process::Command::new("pmset")
        .args(["-g", "batt"])
        .output()
        .ok()?;
    let text = std::str::from_utf8(&out.stdout).ok()?;

    // pmset -g batt output lines:
    //   -InternalBattery-0 (id=...)  72%; discharging; 3:42 remaining  present: true
    //   -InternalBattery-0 (id=...)  100%; charged; 0:00  present: true

    let line = text.lines().find(|l| l.contains("InternalBattery"))?;

    let percent = line
        .split(';')
        .next()?
        .trim()
        .trim_end_matches('%')
        .parse::<f32>()
        .ok();

    let charging = if line.contains("charged") || line.contains("charg") {
        Some(true)
    } else if line.contains("discharg") {
        Some(false)
    } else {
        None
    };

    Some((percent, charging))
}
