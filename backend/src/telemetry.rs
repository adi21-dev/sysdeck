use std::sync::Arc;
use std::time::Duration;

use sysinfo::{Components, Disks, Networks, System};
use tokio::sync::{broadcast, mpsc, Mutex};
use tracing;

use crate::db::{self, TelemetrySnapshot};

#[cfg(windows)]
fn raw_to_celsius(v: f64) -> Option<f32> {
    let values = [v, v - 273.15, v / 10.0, v / 10.0 - 273.15];
    let result = values
        .into_iter()
        .find(|&c| (0.0..=100.0).contains(&c))
        .map(|c| ((c * 10.0).round() / 10.0) as f32);
    if result.is_none() {
        tracing::debug!(raw = v, ?values, "unconvertible thermal value");
    }
    result
}

#[cfg(windows)]
fn extract_zones(text: &str) -> Vec<(&str, f32)> {
    text.lines()
        .filter_map(|l| {
            let (label, val_str) = l.split_once('=')?;
            let v: f64 = val_str.trim().parse().ok()?;
            let c = raw_to_celsius(v)?;
            Some((label, c))
        })
        .collect()
}

#[cfg(windows)]
fn pick_zones(values: &[(&str, f32)]) -> (Option<f32>, Option<f32>) {
    let gpu = values
        .iter()
        .find(|(l, _)| l.to_lowercase().contains("gpu") || l.to_lowercase().contains("gfx"))
        .or_else(|| values.get(1))
        .map(|(_, c)| *c);
    let cpu = values
        .iter()
        .find(|(l, _)| !l.to_lowercase().contains("gpu") && !l.to_lowercase().contains("gfx"))
        .or_else(|| values.first())
        .map(|(_, c)| *c);
    (cpu, gpu)
}

#[cfg(windows)]
fn get_wmi_temperatures() -> (Option<f32>, Option<f32>) {
    // ponytail: try both WMI sources, merge results — one may have GPU the other doesn't
    let queries = [
        ("Win32_ThermalZoneInformation", "Get-CimInstance Win32_PerfFormattedData_Counters_ThermalZoneInformation | ForEach-Object { \"$($_.Name)=$($_.Temperature)\" }"),
        ("MSAcpi_ThermalZoneTemperature", "Get-CimInstance -Namespace Root/WMI -ClassName MSAcpi_ThermalZoneTemperature | ForEach-Object { \"$($_.InstanceName)=$($_.CurrentTemperature)\" }"),
        // ponytail: nvidia-smi is the most reliable GPU temp source on laptops with NVIDIA GPUs
        ("nvidia-smi", "$t = & nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader 2>$null; if ($t) { \"GPU=$t\" }"),
    ];
    let mut cpu = None;
    let mut gpu = None;
    for (source, cmd) in &queries {
        tracing::debug!(source, "querying WMI thermal zones");
        let output = match std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", cmd])
            .output()
        {
            Ok(o) => o,
            Err(e) => {
                tracing::warn!(source, error = %e, "PowerShell command failed");
                continue;
            }
        };
        let text = match std::str::from_utf8(&output.stdout) {
            Ok(t) => t,
            Err(e) => {
                tracing::debug!(source, error = %e, "non-UTF8 stdout");
                continue;
            }
        };
        let values = extract_zones(text);
        tracing::debug!(source, count = values.len(), raw = %text.lines().filter(|l| !l.is_empty()).collect::<Vec<_>>().join(" | "), "WMI thermal zones parsed");
        if values.is_empty() {
            continue;
        }
        let (src_cpu, src_gpu) = pick_zones(&values);
        cpu = cpu.or(src_cpu);
        gpu = gpu.or(src_gpu);
        tracing::info!(source, src_cpu, src_gpu, "WMI zone readings");
    }
    if cpu.is_none() && gpu.is_none() {
        tracing::warn!("all WMI temperature sources returned no data");
    }
    (cpu, gpu)
}

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
        let mut last_battery = (None, None);
        #[cfg(windows)]
        let mut last_wmi_temps: (Option<f32>, Option<f32>) = (None, None);

        loop {
            std::thread::sleep(Duration::from_secs(1));

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

            let mut temperature_cpu = components
                .iter()
                .find(|c| {
                    let l = c.label().to_lowercase();
                    (l.contains("cpu") || l.contains("package") || l.contains("core"))
                        && !l.contains("gpu")
                })
                .or_else(|| {
                    components.iter().find(|c| {
                        let l = c.label().to_lowercase();
                        !l.contains("fan") && !l.contains("gpu")
                    })
                })
                .map(|c| {
                    tracing::debug!(label = %c.label(), temp = c.temperature(), "sysinfo component");
                    c.temperature()
                });

            let mut temperature_gpu = components
                .iter()
                .find(|c| {
                    let l = c.label().to_lowercase();
                    l.contains("gpu") || l.contains("gfx")
                })
                .map(|c| {
                    tracing::debug!(label = %c.label(), temp = c.temperature(), "sysinfo GPU component");
                    c.temperature()
                });

            // ponytail: sysinfo rarely finds GPU sensors on Windows; WMI fills gaps
            #[cfg(windows)]
            {
                if tick_1s.is_multiple_of(30) {
                    last_wmi_temps = get_wmi_temperatures();
                }
                let before_cpu = temperature_cpu;
                let before_gpu = temperature_gpu;
                temperature_cpu = temperature_cpu.or(last_wmi_temps.0);
                temperature_gpu = temperature_gpu.or(last_wmi_temps.1);
                if (before_cpu != temperature_cpu || before_gpu != temperature_gpu)
                    && tick_1s.is_multiple_of(30)
                {
                    tracing::debug!(
                        before_cpu,
                        before_gpu,
                        cpu = temperature_cpu,
                        gpu = temperature_gpu,
                        "WMI filled temperature gaps"
                    );
                }
            }

            if tick_1s.is_multiple_of(10) {
                disks.refresh();
            }
            let disk_total: u64 = disks.iter().map(|d| d.total_space()).sum();
            let disk_available: u64 = disks.iter().map(|d| d.available_space()).sum();
            let disk_used = disk_total.saturating_sub(disk_available);

            // ponytail: cache last battery value to avoid flickering between 30s polls
            let (battery_percent, battery_charging) = if tick_1s.is_multiple_of(30) {
                let v = get_battery_status();
                last_battery = v;
                v
            } else {
                last_battery
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
                temperature_cpu,
                temperature_gpu,
                disk_used,
                disk_total,
                battery_percent,
                battery_charging,
            };

            if internal_tx.blocking_send(snapshot).is_err() {
                break;
            }

            tick_1s += 1;
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
