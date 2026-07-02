use std::process::Command;
use std::time::Duration;
use serde::{Deserialize, Serialize};
use axum::extract::State;
use axum::response::{IntoResponse, Json};
use serde_json::json;
use std::sync::atomic::Ordering;

#[derive(Serialize)]
pub struct AudioStatus {
    pub volume: u32,
    pub muted: bool,
    pub devices: Vec<String>,
    pub default_device: String,
}

#[derive(Serialize)]
pub struct DisplayStatus {
    pub brightness: u32,
    pub night_light: bool,
}

#[derive(Serialize)]
pub struct ToggleStatus {
    pub wifi: bool,
    pub bluetooth: bool,
    pub dark_mode: bool,
    pub dnd: bool,
}

#[derive(Deserialize)]
pub struct VolumeRequest {
    pub volume: u32,
}

#[derive(Deserialize)]
pub struct MuteRequest {
    pub muted: bool,
}

#[derive(Deserialize)]
pub struct DeviceRequest {
    pub device: String,
}

#[derive(Deserialize)]
pub struct MediaRequest {
    pub action: String,
}

#[derive(Deserialize)]
pub struct BrightnessRequest {
    pub brightness: u32,
}

#[derive(Deserialize)]
pub struct NightLightRequest {
    pub night_light: bool,
}

#[derive(Deserialize)]
pub struct ToggleRequest {
    pub enabled: bool,
}

#[derive(Deserialize)]
pub struct ScheduledPowerRequest {
    pub action: String, // "shutdown" or "restart"
    pub delay_mins: u64,
    #[serde(default)]
    pub force: bool,
    #[serde(default)]
    pub confirmed: bool,
}

// --- Common command executor ---

fn run_cmd(cmd: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(cmd)
        .args(args)
        .output()
        .map_err(|e| format!("Failed to execute {}: {}", cmd, e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[cfg(target_os = "windows")]
fn run_powershell(script: &str) -> Result<String, String> {
    use std::io::Write;
    use std::process::Stdio;

    let mut child = Command::new("powershell")
        .args(["-NoProfile", "-Command", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn powershell: {}", e))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(script.as_bytes()).map_err(|e| format!("Failed to write to powershell stdin: {}", e))?;
    }

    let output = child.wait_with_output().map_err(|e| format!("Failed to read powershell output: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

// --- Windows-Specific implementation ---

#[cfg(target_os = "windows")]
const COM_AUDIO_CSHARP: &str = r#"
using System;
using System.Runtime.InteropServices;
public class Audio {
    [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioEndpointVolume {
        int RegisterControlChangeNotify(IntPtr p);
        int UnregisterControlChangeNotify(IntPtr p);
        int GetCapability(out uint m);
        int SetChannelVolumeLevel(uint c, float l, ref Guid e);
        int SetChannelVolumeLevelScalar(uint c, float l, ref Guid e);
        int GetChannelVolumeLevel(uint c, out float l);
        int GetChannelVolumeLevelScalar(uint c, out float l);
        int SetMasterVolumeLevel(float l, ref Guid e);
        int SetMasterVolumeLevelScalar(float l, ref Guid e);
        int GetMasterVolumeLevel(out float l);
        int GetMasterVolumeLevelScalar(out float l);
        int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, ref Guid e);
        int GetMute([MarshalAs(UnmanagedType.Bool)] out bool m);
    }
    [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice {
        int Activate(ref Guid iid, int dwClsCtx, IntPtr pParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
    }
    [Guid("A95664D2-9614-4F35-A74E-61986D82F6FF"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator {
        int EnumAudioEndpoints(int d, int s, out IntPtr pp);
        int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice);
    }
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumeratorCom {}

    private static IAudioEndpointVolume GetVolumeObject() {
        var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
        IMMDevice device;
        enumerator.GetDefaultAudioEndpoint(0, 1, out device);
        var iidVolume = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
        object volObj;
        device.Activate(ref iidVolume, 23, IntPtr.Zero, out volObj);
        return (IAudioEndpointVolume)volObj;
    }
    public static float GetVolume() {
        float v;
        GetVolumeObject().GetMasterVolumeLevelScalar(out v);
        return v * 100;
    }
    public static void SetVolume(float level) {
        Guid g = Guid.Empty;
        GetVolumeObject().SetMasterVolumeLevelScalar(level / 100f, ref g);
    }
    public static bool GetMute() {
        bool m;
        GetVolumeObject().GetMute(out m);
        return m;
    }
    public static void SetMute(bool mute) {
        Guid g = Guid.Empty;
        GetVolumeObject().SetMute(mute, ref g);
    }
}
"#;

// --- API handlers ---

pub async fn get_audio_status() -> Result<AudioStatus, String> {
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            let script = format!("{}\n[Audio]::GetVolume()\n[Audio]::GetMute()", COM_AUDIO_CSHARP);
            let res = run_powershell(&script)?;
            let lines: Vec<&str> = res.lines().collect();
            let volume = lines.first().and_then(|l| l.parse::<f32>().ok()).unwrap_or(50.0) as u32;
            let muted = lines.get(1).map(|l| l.trim().eq_ignore_ascii_case("true")).unwrap_or(false);

            // Get sound devices via CIM
            let devices_str = run_powershell("Get-CimInstance Win32_SoundDevice | Select-Object -ExpandProperty Name")
                .unwrap_or_default();
            let devices: Vec<String> = devices_str.lines().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
            let default_device = devices.first().cloned().unwrap_or_else(|| "Default Audio Endpoint".to_string());

            Ok(AudioStatus { volume, muted, devices, default_device })
        }

        #[cfg(target_os = "macos")]
        {
            let vol_str = run_cmd("osascript", &["-e", "output volume of (get volume settings)"])?;
            let mute_str = run_cmd("osascript", &["-e", "output muted of (get volume settings)"])?;
            let volume = vol_str.parse::<u32>().unwrap_or(50);
            let muted = mute_str.trim().eq_ignore_ascii_case("true");
            Ok(AudioStatus {
                volume,
                muted,
                devices: vec!["Default Output".to_string()],
                default_device: "Default Output".to_string(),
            })
        }

        #[cfg(target_os = "linux")]
        {
            // Try pactl first, fallback to amixer
            if let Ok(vol_out) = run_cmd("pactl", &["get-sink-volume", "@DEFAULT_SINK@"]) {
                // Parse "Volume: front-left: 32768 /  50% / -18.06 dB, front-right: 32768 /  50% / -18.06 dB"
                let volume = vol_out.split('/')
                    .nth(1)
                    .and_then(|s| s.trim().trim_end_matches('%').parse::<u32>().ok())
                    .unwrap_or(50);
                
                let mute_out = run_cmd("pactl", &["get-sink-mute", "@DEFAULT_SINK@"]).unwrap_or_default();
                let muted = mute_out.contains("yes");

                let sinks_out = run_cmd("pactl", &["list", "short", "sinks"]).unwrap_or_default();
                let devices: Vec<String> = sinks_out.lines()
                    .filter_map(|line| line.split_whitespace().nth(1).map(|s| s.to_string()))
                    .collect();
                let default_device = devices.first().cloned().unwrap_or_else(|| "Default".to_string());

                Ok(AudioStatus { volume, muted, devices, default_device })
            } else {
                let amixer_out = run_cmd("amixer", &["get", "Master"]).unwrap_or_default();
                let volume = if amixer_out.contains('%') {
                    amixer_out.split('[')
                        .nth(1)
                        .and_then(|s| s.split('%').next())
                        .and_then(|s| s.parse::<u32>().ok())
                        .unwrap_or(50)
                } else {
                    50
                };
                let muted = amixer_out.contains("[off]");
                Ok(AudioStatus {
                    volume,
                    muted,
                    devices: vec!["Master".to_string()],
                    default_device: "Master".to_string(),
                })
            }
        }

        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        Ok(AudioStatus {
            volume: 50,
            muted: false,
            devices: vec!["Default".to_string()],
            default_device: "Default".to_string(),
        })
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

pub async fn set_audio_volume(volume: u32) -> Result<(), String> {
    let volume = volume.min(100);
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            let script = format!("{}\n[Audio]::SetVolume({})", COM_AUDIO_CSHARP, volume);
            run_powershell(&script)?;
            Ok(())
        }
        #[cfg(target_os = "macos")]
        {
            run_cmd("osascript", &["-e", &format!("set volume output volume {}", volume)])?;
            Ok(())
        }
        #[cfg(target_os = "linux")]
        {
            if run_cmd("pactl", &["set-sink-volume", "@DEFAULT_SINK@", &format!("{}%", volume)]).is_ok() {
                Ok(())
            } else {
                run_cmd("amixer", &["set", "Master", &format!("{}%", volume)])?;
                Ok(())
            }
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        Err("Not supported on this OS".to_string())
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

pub async fn set_audio_mute(muted: bool) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            let script = format!("{}\n[Audio]::SetMute(${})", COM_AUDIO_CSHARP, if muted { "true" } else { "false" });
            run_powershell(&script)?;
            Ok(())
        }
        #[cfg(target_os = "macos")]
        {
            let val = if muted { "with" } else { "without" };
            run_cmd("osascript", &["-e", &format!("set volume {} output muted", val)])?;
            Ok(())
        }
        #[cfg(target_os = "linux")]
        {
            let val = if muted { "1" } else { "0" };
            if run_cmd("pactl", &["set-sink-mute", "@DEFAULT_SINK@", val]).is_ok() {
                Ok(())
            } else {
                let am_val = if muted { "mute" } else { "unmute" };
                run_cmd("amixer", &["set", "Master", am_val])?;
                Ok(())
            }
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        Err("Not supported on this OS".to_string())
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

pub async fn set_audio_device(_device: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            Err("Switching audio output device is not natively supported on Windows without third-party utilities.".to_string())
        }
        #[cfg(target_os = "macos")]
        {
            Err("Switching audio output device is not natively supported on macOS without third-party utilities.".to_string())
        }
        #[cfg(target_os = "linux")]
        {
            run_cmd("pactl", &["set-default-sink", &_device])?;
            Ok(())
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        Err("Not supported on this OS".to_string())
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

pub async fn trigger_media_key(action: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            let key = match action.as_str() {
                "play_pause" => "179",
                "next" => "176",
                "prev" => "177",
                "volume_up" => "175",
                "volume_down" => "174",
                "mute" => "173",
                _ => return Err(format!("Unknown media action: {}", action)),
            };
            let script = format!("(New-Object -ComObject Wscript.Shell).SendKeys([char]{})", key);
            run_powershell(&script)?;
            Ok(())
        }
        #[cfg(target_os = "macos")]
        {
            // AppleScript system events
            let cmd = match action.as_str() {
                "play_pause" => "tell application \"Music\" to playpause",
                "next" => "tell application \"Music\" to play next track",
                "prev" => "tell application \"Music\" to play previous track",
                _ => return Err(format!("Unsupported media action on macOS: {}", action)),
            };
            run_cmd("osascript", &["-e", cmd])?;
            Ok(())
        }
        #[cfg(target_os = "linux")]
        {
            let cmd = match action.as_str() {
                "play_pause" => "play-pause",
                "next" => "next",
                "prev" => "previous",
                _ => return Err(format!("Unsupported media action on Linux: {}", action)),
            };
            run_cmd("playerctl", &[cmd])?;
            Ok(())
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        Err("Not supported on this OS".to_string())
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

pub async fn get_display_status() -> Result<DisplayStatus, String> {
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            let bright_out = run_powershell("(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness).CurrentBrightness")
                .unwrap_or_else(|_| "50".to_string());
            let brightness = bright_out.trim().parse::<u32>().unwrap_or(50);
            Ok(DisplayStatus { brightness, night_light: false })
        }
        #[cfg(target_os = "macos")]
        {
            // Try to read brightness using command line, or return 50
            Ok(DisplayStatus { brightness: 50, night_light: false })
        }
        #[cfg(target_os = "linux")]
        {
            // Try /sys/class/backlight
            if let Ok(curr) = run_cmd("cat", &["/sys/class/backlight/intel_backlight/brightness"]) {
                let max = run_cmd("cat", &["/sys/class/backlight/intel_backlight/max_brightness"]).unwrap_or_else(|_| "100".to_string());
                let c = curr.parse::<f32>().unwrap_or(50.0);
                let m = max.parse::<f32>().unwrap_or(100.0);
                let brightness = ((c / m) * 100.0) as u32;
                Ok(DisplayStatus { brightness, night_light: false })
            } else {
                Ok(DisplayStatus { brightness: 50, night_light: false })
            }
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        Ok(DisplayStatus { brightness: 50, night_light: false })
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

pub async fn set_display_brightness(brightness: u32) -> Result<(), String> {
    let brightness = brightness.min(100);
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            let script = format!("(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods).WmiSetBrightness(1, {})", brightness);
            run_powershell(&script)?;
            Ok(())
        }
        #[cfg(target_os = "macos")]
        {
            // Toggling brightness on macOS natively is not easily available without third-party tools, return error
            Err("Setting display brightness is not natively supported on macOS without external utilities.".to_string())
        }
        #[cfg(target_os = "linux")]
        {
            run_cmd("xbacklight", &["-set", &brightness.to_string()])?;
            Ok(())
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        Err("Not supported on this OS".to_string())
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

pub async fn set_display_night_light(_enabled: bool) -> Result<(), String> {
    // Night light is highly platform-dependent and fragile to set via simple CLI, return unsupported
    Err("Night Light toggle is not supported natively on this OS configuration.".to_string())
}

pub async fn get_toggle_status() -> Result<ToggleStatus, String> {
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            // Dark Mode check
            let dark_out = run_powershell("(Get-ItemProperty -Path HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize -ErrorAction SilentlyContinue).AppsUseLightTheme")
                .unwrap_or_else(|_| "1".to_string());
            let dark_mode = dark_out.trim() == "0";

            // Wi-Fi check
            let wifi_out = run_powershell("Get-NetAdapter -Name *WiFi* -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Status")
                .unwrap_or_default();
            let wifi = wifi_out.trim().eq_ignore_ascii_case("Up") || wifi_out.trim().eq_ignore_ascii_case("Disconnected");

            // Bluetooth check
            let bt_out = run_powershell("(Get-Service -Name bthserv -ErrorAction SilentlyContinue).Status")
                .unwrap_or_default();
            let bluetooth = bt_out.trim().eq_ignore_ascii_case("Running");

            // DND check
            let dnd_out = run_powershell("(Get-ItemProperty -Path HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings -ErrorAction SilentlyContinue).NOC_GLOBAL_SETTING_TOASTS_ENABLED")
                .unwrap_or_else(|_| "1".to_string());
            let dnd = dnd_out.trim() == "0";

            Ok(ToggleStatus { wifi, bluetooth, dark_mode, dnd })
        }
        #[cfg(target_os = "macos")]
        {
            let dark_out = run_cmd("osascript", &["-e", "tell application \"System Events\" to tell appearance preferences to get dark mode"])
                .unwrap_or_else(|_| "false".to_string());
            let dark_mode = dark_out.trim().eq_ignore_ascii_case("true");

            let wifi_out = run_cmd("networksetup", &["-getairportpower", "en0"]).unwrap_or_default();
            let wifi = wifi_out.contains("On");

            Ok(ToggleStatus {
                wifi,
                bluetooth: false,
                dark_mode,
                dnd: false,
            })
        }
        #[cfg(target_os = "linux")]
        {
            let nm_out = run_cmd("nmcli", &["radio", "wifi"]).unwrap_or_default();
            let wifi = nm_out.contains("enabled");

            let bt_out = run_cmd("bluetoothctl", &["show"]).unwrap_or_default();
            let bluetooth = bt_out.contains("Powered: yes");

            let theme_out = run_cmd("gsettings", &["get", "org.gnome.desktop.interface", "color-scheme"]).unwrap_or_default();
            let dark_mode = theme_out.contains("prefer-dark");

            Ok(ToggleStatus {
                wifi,
                bluetooth,
                dark_mode,
                dnd: false,
            })
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        Ok(ToggleStatus { wifi: false, bluetooth: false, dark_mode: false, dnd: false })
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

pub async fn set_toggle_wifi(enabled: bool) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            let state = if enabled { "enabled" } else { "disabled" };
            run_cmd("netsh", &["interface", "set", "interface", "name=Wi-Fi", &format!("admin={}", state)])?;
            Ok(())
        }
        #[cfg(target_os = "macos")]
        {
            let state = if enabled { "on" } else { "off" };
            run_cmd("networksetup", &["-setairportpower", "en0", state])?;
            Ok(())
        }
        #[cfg(target_os = "linux")]
        {
            let state = if enabled { "on" } else { "off" };
            run_cmd("nmcli", &["radio", "wifi", state])?;
            Ok(())
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        Err("Not supported on this OS".to_string())
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

pub async fn set_toggle_bluetooth(enabled: bool) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            let script = if enabled {
                "Start-Service -Name bthserv"
            } else {
                "Stop-Service -Name bthserv -Force"
            };
            run_powershell(script)?;
            Ok(())
        }
        #[cfg(target_os = "macos")]
        {
            let state = if enabled { "1" } else { "0" };
            run_cmd("blueutil", &["--power", state])?;
            Ok(())
        }
        #[cfg(target_os = "linux")]
        {
            let state = if enabled { "power on" } else { "power off" };
            run_cmd("bluetoothctl", &[state])?;
            Ok(())
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        Err("Not supported on this OS".to_string())
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

pub async fn set_toggle_dark_mode(enabled: bool) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            let val = if enabled { "0" } else { "1" };
            let script = format!(
                "Set-ItemProperty -Path HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize -Name AppsUseLightTheme -Value {}; Set-ItemProperty -Path HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize -Name SystemUsesLightTheme -Value {}",
                val, val
            );
            run_powershell(&script)?;
            Ok(())
        }
        #[cfg(target_os = "macos")]
        {
            let state = if enabled { "true" } else { "false" };
            let script = format!("tell application \"System Events\" to tell appearance preferences to set dark mode to {}", state);
            run_cmd("osascript", &["-e", &script])?;
            Ok(())
        }
        #[cfg(target_os = "linux")]
        {
            let val = if enabled { "prefer-dark" } else { "prefer-light" };
            run_cmd("gsettings", &["set", "org.gnome.desktop.interface", "color-scheme", val])?;
            Ok(())
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        Err("Not supported on this OS".to_string())
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

pub async fn set_toggle_dnd(enabled: bool) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            let val = if enabled { "0" } else { "1" };
            let script = format!(
                "Set-ItemProperty -Path HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings -Name NOC_GLOBAL_SETTING_TOASTS_ENABLED -Value {}",
                val
            );
            run_powershell(&script)?;
            Ok(())
        }
        #[cfg(target_os = "macos")]
        {
            Err("Toggling Do Not Disturb is not natively supported on macOS via command line.".to_string())
        }
        #[cfg(target_os = "linux")]
        {
            let state = if enabled { "false" } else { "true" };
            run_cmd("gsettings", &["set", "org.gnome.desktop.notifications", "show-banners", state])?;
            Ok(())
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        Err("Not supported on this OS".to_string())
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

// --- Axum API Route Handlers ---

pub async fn audio_status_handler() -> impl IntoResponse {
    match get_audio_status().await {
        Ok(status) => Json(json!({ "success": true, "data": status })).into_response(),
        Err(e) => (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "success": false, "message": e }))).into_response(),
    }
}

pub async fn audio_volume_handler(Json(req): Json<VolumeRequest>) -> impl IntoResponse {
    match set_audio_volume(req.volume).await {
        Ok(_) => Json(json!({ "success": true })).into_response(),
        Err(e) => (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "success": false, "message": e }))).into_response(),
    }
}

pub async fn audio_mute_handler(Json(req): Json<MuteRequest>) -> impl IntoResponse {
    match set_audio_mute(req.muted).await {
        Ok(_) => Json(json!({ "success": true })).into_response(),
        Err(e) => (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "success": false, "message": e }))).into_response(),
    }
}

pub async fn audio_device_handler(Json(req): Json<DeviceRequest>) -> impl IntoResponse {
    match set_audio_device(req.device).await {
        Ok(_) => Json(json!({ "success": true })).into_response(),
        Err(e) => (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "success": false, "message": e }))).into_response(),
    }
}

pub async fn audio_media_handler(Json(req): Json<MediaRequest>) -> impl IntoResponse {
    match trigger_media_key(req.action).await {
        Ok(_) => Json(json!({ "success": true })).into_response(),
        Err(e) => (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "success": false, "message": e }))).into_response(),
    }
}

pub async fn display_status_handler() -> impl IntoResponse {
    match get_display_status().await {
        Ok(status) => Json(json!({ "success": true, "data": status })).into_response(),
        Err(e) => (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "success": false, "message": e }))).into_response(),
    }
}

pub async fn display_brightness_handler(Json(req): Json<BrightnessRequest>) -> impl IntoResponse {
    match set_display_brightness(req.brightness).await {
        Ok(_) => Json(json!({ "success": true })).into_response(),
        Err(e) => (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "success": false, "message": e }))).into_response(),
    }
}

pub async fn display_night_light_handler(Json(req): Json<NightLightRequest>) -> impl IntoResponse {
    match set_display_night_light(req.night_light).await {
        Ok(_) => Json(json!({ "success": true })).into_response(),
        Err(e) => (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "success": false, "message": e }))).into_response(),
    }
}

pub async fn toggles_status_handler() -> impl IntoResponse {
    match get_toggle_status().await {
        Ok(status) => Json(json!({ "success": true, "data": status })).into_response(),
        Err(e) => (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "success": false, "message": e }))).into_response(),
    }
}

pub async fn toggle_wifi_handler(Json(req): Json<ToggleRequest>) -> impl IntoResponse {
    match set_toggle_wifi(req.enabled).await {
        Ok(_) => Json(json!({ "success": true })).into_response(),
        Err(e) => (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "success": false, "message": e }))).into_response(),
    }
}

pub async fn toggle_bluetooth_handler(Json(req): Json<ToggleRequest>) -> impl IntoResponse {
    match set_toggle_bluetooth(req.enabled).await {
        Ok(_) => Json(json!({ "success": true })).into_response(),
        Err(e) => (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "success": false, "message": e }))).into_response(),
    }
}

pub async fn toggle_dark_mode_handler(Json(req): Json<ToggleRequest>) -> impl IntoResponse {
    match set_toggle_dark_mode(req.enabled).await {
        Ok(_) => Json(json!({ "success": true })).into_response(),
        Err(e) => (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "success": false, "message": e }))).into_response(),
    }
}

pub async fn toggle_dnd_handler(Json(req): Json<ToggleRequest>) -> impl IntoResponse {
    match set_toggle_dnd(req.enabled).await {
        Ok(_) => Json(json!({ "success": true })).into_response(),
        Err(e) => (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "success": false, "message": e }))).into_response(),
    }
}

// --- Scheduled power handler ---

pub async fn schedule_power_handler(
    State(state): State<crate::AppState>,
    Json(req): Json<ScheduledPowerRequest>,
) -> impl IntoResponse {
    let action = match req.action.as_str() {
        "shutdown" => crate::power::PowerAction::Shutdown,
        "restart" => crate::power::PowerAction::Restart,
        _ => return (axum::http::StatusCode::BAD_REQUEST, Json(json!({ "success": false, "message": "Invalid scheduled action. Use 'shutdown' or 'restart'" }))).into_response(),
    };

    let active = state.power_state.active_uploads.load(Ordering::Relaxed);
    if active > 0 && !req.confirmed {
        return Json(json!({
            "success": true,
            "message": format!("{} active file transfer(s) in progress. Send confirmed=true to proceed.", active),
            "active_transfers": active
        })).into_response();
    }

    let mut pending = state.power_state.pending.lock().await;
    if pending.is_some() {
        return (axum::http::StatusCode::BAD_REQUEST, Json(json!({ "success": false, "message": "A power command is already pending. Cancel it first." }))).into_response();
    }

    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();
    let action_str = format!("{:?}", action);
    let delay_secs = req.delay_mins * 60;

    *pending = Some(crate::power::PendingCommand {
        action,
        requested_at: std::time::Instant::now(),
        cancel_tx,
    });
    drop(pending);

    let state_clone = state.clone();
    let commands = state.power_state.system_commands.clone();
    let force = req.force;
    tokio::spawn(async move {
        let cancelled = tokio::time::timeout(Duration::from_secs(delay_secs), cancel_rx).await;

        match cancelled {
            Ok(Ok(())) => {
                tracing::info!("Scheduled power command cancelled: {}", action_str);
            }
            _ => {
                tracing::info!("Executing scheduled power command (force={}): {}", force, action_str);
                // Override execution logic if force is requested
                #[cfg(target_os = "windows")]
                if force {
                    let flag = match action {
                        crate::power::PowerAction::Shutdown => "/s",
                        crate::power::PowerAction::Restart => "/r",
                        _ => "/s",
                    };
                    let _ = Command::new("shutdown").args([flag, "/f", "/t", "1"]).spawn();
                } else {
                    commands.execute_power_action(action);
                }

                #[cfg(not(target_os = "windows"))]
                {
                    commands.execute_power_action(action);
                }
            }
        }

        let mut pending = state_clone.power_state.pending.lock().await;
        *pending = None;
    });

    Json(json!({
        "success": true,
        "message": format!("{:?} scheduled in {} minute(s). Use Cancel to abort.", action, req.delay_mins)
    })).into_response()
}
