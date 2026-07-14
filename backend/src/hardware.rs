use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::atomic::Ordering;
use std::time::Duration;

#[derive(Serialize, Debug)]
pub struct AudioStatus {
    pub volume: u32,
    pub muted: bool,
    pub devices: Vec<String>,
    pub default_device: String,
}

#[derive(Serialize, Debug)]
pub struct DisplayStatus {
    pub brightness: u32,
    pub night_light: bool,
}

#[derive(Serialize, Debug)]
pub struct ToggleStatus {
    pub dark_mode: bool,
    pub wifi: bool,
    pub dnd: bool,
    pub bluetooth: bool,
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
pub struct ControlCenterToggleReq {
    pub toggle: String,
    pub enabled: bool,
}

#[derive(Serialize, Debug)]
pub struct ControlCenterStatus {
    pub dark_mode: bool,
    pub wifi_on: Option<bool>,
    pub dnd_on: Option<bool>,
}

#[derive(Deserialize)]
pub struct MonitorRequest {
    pub action: String,
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

#[allow(dead_code)]
pub(crate) fn run_cmd(cmd: &str, args: &[&str]) -> Result<String, String> {
    let output = crate::new_command(cmd)
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
pub(crate) fn run_powershell(script: &str) -> Result<String, String> {
    use std::io::Write;
    use std::process::Stdio;

    let mut child = crate::new_command("powershell")
        .args(["-NoProfile", "-Command", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn powershell: {}", e))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(script.as_bytes())
            .map_err(|e| format!("Failed to write to powershell stdin: {}", e))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed to read powershell output: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

// --- Windows-Specific implementation ---

#[cfg(target_os = "windows")]
#[allow(non_camel_case_types, non_snake_case, clippy::upper_case_acronyms)]
mod win_com {
    use std::ffi::c_void;

    #[repr(C)]
    #[derive(Debug, Clone, Copy)]
    pub struct GUID {
        pub data1: u32,
        pub data2: u16,
        pub data3: u16,
        pub data4: [u8; 8],
    }

    pub const CLSID_MM_DEVICE_ENUMERATOR: GUID = GUID {
        data1: 0xbcde0395,
        data2: 0xe52f,
        data3: 0x467c,
        data4: [0x8e, 0x3d, 0xc4, 0x57, 0x92, 0x91, 0x69, 0x2e],
    };

    pub const IID_IM_DEVICE_ENUMERATOR: GUID = GUID {
        data1: 0xa95664d2,
        data2: 0x9614,
        data3: 0x4f35,
        data4: [0xa7, 0x46, 0xde, 0x8d, 0xb6, 0x36, 0x17, 0xe6],
    };

    pub const IID_IAUDIO_ENDPOINT_VOLUME: GUID = GUID {
        data1: 0x5cdf2c82,
        data2: 0x841e,
        data3: 0x4546,
        data4: [0x97, 0x22, 0x0c, 0xf7, 0x40, 0x78, 0x22, 0x9a],
    };

    #[repr(C)]
    pub struct IMMDeviceEnumerator {
        pub lpVtbl: *const IMMDeviceEnumeratorVtbl,
    }

    #[repr(C)]
    pub struct IMMDeviceEnumeratorVtbl {
        pub QueryInterface: unsafe extern "system" fn(
            this: *mut IMMDeviceEnumerator,
            iid: *const GUID,
            ppv: *mut *mut c_void,
        ) -> i32,
        pub AddRef: unsafe extern "system" fn(this: *mut IMMDeviceEnumerator) -> u32,
        pub Release: unsafe extern "system" fn(this: *mut IMMDeviceEnumerator) -> u32,
        pub EnumAudioEndpoints: unsafe extern "system" fn(
            this: *mut IMMDeviceEnumerator,
            dataFlow: u32,
            dwStateMask: u32,
            ppDevices: *mut *mut c_void,
        ) -> i32,
        pub GetDefaultAudioEndpoint: unsafe extern "system" fn(
            this: *mut IMMDeviceEnumerator,
            dataFlow: u32,
            role: u32,
            ppEndpoint: *mut *mut IMMDevice,
        ) -> i32,
    }

    #[repr(C)]
    pub struct IMMDevice {
        pub lpVtbl: *const IMMDeviceVtbl,
    }

    #[repr(C)]
    pub struct IMMDeviceVtbl {
        pub QueryInterface: unsafe extern "system" fn(
            this: *mut IMMDevice,
            iid: *const GUID,
            ppv: *mut *mut c_void,
        ) -> i32,
        pub AddRef: unsafe extern "system" fn(this: *mut IMMDevice) -> u32,
        pub Release: unsafe extern "system" fn(this: *mut IMMDevice) -> u32,
        pub Activate: unsafe extern "system" fn(
            this: *mut IMMDevice,
            iid: *const GUID,
            dwClsContext: u32,
            pActivationParams: *mut c_void,
            ppInterface: *mut *mut c_void,
        ) -> i32,
        pub OpenPropertyStore: unsafe extern "system" fn(
            this: *mut IMMDevice,
            stgmAccess: u32,
            ppProperties: *mut *mut c_void,
        ) -> i32,
        pub GetId: unsafe extern "system" fn(this: *mut IMMDevice, ppstrId: *mut *mut u16) -> i32,
        pub GetState: unsafe extern "system" fn(this: *mut IMMDevice, pdwState: *mut u32) -> i32,
    }

    #[repr(C)]
    pub struct IAudioEndpointVolume {
        pub lpVtbl: *const IAudioEndpointVolumeVtbl,
    }

    #[repr(C)]
    pub struct IAudioEndpointVolumeVtbl {
        pub QueryInterface: unsafe extern "system" fn(
            this: *mut IAudioEndpointVolume,
            iid: *const GUID,
            ppv: *mut *mut c_void,
        ) -> i32,
        pub AddRef: unsafe extern "system" fn(this: *mut IAudioEndpointVolume) -> u32,
        pub Release: unsafe extern "system" fn(this: *mut IAudioEndpointVolume) -> u32,
        pub RegisterControlChangeNotify:
            unsafe extern "system" fn(this: *mut IAudioEndpointVolume, pNotify: *mut c_void) -> i32,
        pub UnregisterControlChangeNotify:
            unsafe extern "system" fn(this: *mut IAudioEndpointVolume, pNotify: *mut c_void) -> i32,
        pub GetChannelCount: unsafe extern "system" fn(
            this: *mut IAudioEndpointVolume,
            pnChannelCount: *mut u32,
        ) -> i32,
        pub SetMasterVolumeLevel: unsafe extern "system" fn(
            this: *mut IAudioEndpointVolume,
            fLevelDB: f32,
            pguidEventContext: *const GUID,
        ) -> i32,
        pub SetMasterVolumeLevelScalar: unsafe extern "system" fn(
            this: *mut IAudioEndpointVolume,
            fLevel: f32,
            pguidEventContext: *const GUID,
        ) -> i32,
        pub GetMasterVolumeLevel:
            unsafe extern "system" fn(this: *mut IAudioEndpointVolume, pfLevelDB: *mut f32) -> i32,
        pub GetMasterVolumeLevelScalar:
            unsafe extern "system" fn(this: *mut IAudioEndpointVolume, pfLevel: *mut f32) -> i32,
        pub SetChannelVolumeLevel: unsafe extern "system" fn(
            this: *mut IAudioEndpointVolume,
            nChannel: u32,
            fLevelDB: f32,
            pguidEventContext: *const GUID,
        ) -> i32,
        pub SetChannelVolumeLevelScalar: unsafe extern "system" fn(
            this: *mut IAudioEndpointVolume,
            nChannel: u32,
            fLevel: f32,
            pguidEventContext: *const GUID,
        ) -> i32,
        pub GetChannelVolumeLevel: unsafe extern "system" fn(
            this: *mut IAudioEndpointVolume,
            nChannel: u32,
            pfLevelDB: *mut f32,
        ) -> i32,
        pub GetChannelVolumeLevelScalar: unsafe extern "system" fn(
            this: *mut IAudioEndpointVolume,
            nChannel: u32,
            pfLevel: *mut f32,
        ) -> i32,
        pub SetMute: unsafe extern "system" fn(
            this: *mut IAudioEndpointVolume,
            bMute: i32,
            pguidEventContext: *const GUID,
        ) -> i32,
        pub GetMute:
            unsafe extern "system" fn(this: *mut IAudioEndpointVolume, pbMute: *mut i32) -> i32,
    }
}

#[cfg(target_os = "windows")]
unsafe fn get_volume_interface() -> Result<*mut win_com::IAudioEndpointVolume, String> {
    use win_com::*;
    use windows_sys::Win32::System::Com::*;

    // Initialize COM on this thread
    let _ = CoInitializeEx(std::ptr::null(), COINIT_MULTITHREADED as u32);

    let mut enumerator: *mut IMMDeviceEnumerator = std::ptr::null_mut();
    let hr = CoCreateInstance(
        &CLSID_MM_DEVICE_ENUMERATOR as *const GUID as *const _,
        std::ptr::null_mut(),
        CLSCTX_ALL,
        &IID_IM_DEVICE_ENUMERATOR as *const GUID as *const _,
        &mut enumerator as *mut *mut _ as *mut _,
    );
    if hr < 0 {
        return Err(format!(
            "CoCreateInstance(MMDeviceEnumerator) failed: HRESULT 0x{:X}",
            hr
        ));
    }

    let mut device: *mut IMMDevice = std::ptr::null_mut();
    let hr = ((*(*enumerator).lpVtbl).GetDefaultAudioEndpoint)(
        enumerator,
        0, // eRender
        0, // eConsole
        &mut device,
    );
    ((*(*enumerator).lpVtbl).Release)(enumerator);

    if hr < 0 {
        return Err(format!(
            "GetDefaultAudioEndpoint failed: HRESULT 0x{:X}",
            hr
        ));
    }

    let mut volume: *mut IAudioEndpointVolume = std::ptr::null_mut();
    let hr = ((*(*device).lpVtbl).Activate)(
        device,
        &IID_IAUDIO_ENDPOINT_VOLUME as *const GUID as *const _,
        CLSCTX_ALL,
        std::ptr::null_mut(),
        &mut volume as *mut *mut _ as *mut _,
    );
    ((*(*device).lpVtbl).Release)(device);

    if hr < 0 {
        return Err(format!(
            "Activate(IAudioEndpointVolume) failed: HRESULT 0x{:X}",
            hr
        ));
    }

    Ok(volume)
}

// --- API handlers ---

pub async fn get_audio_status() -> Result<AudioStatus, String> {
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        unsafe {
            let volume_interface = match get_volume_interface() {
                Ok(vi) => vi,
                Err(e) => return Err(e),
            };

            let mut vol_scalar: f32 = 0.0;
            let hr_vol = ((*(*volume_interface).lpVtbl).GetMasterVolumeLevelScalar)(volume_interface, &mut vol_scalar);

            let mut muted_bool: i32 = 0;
            let hr_mute = ((*(*volume_interface).lpVtbl).GetMute)(volume_interface, &mut muted_bool);

            ((*(*volume_interface).lpVtbl).Release)(volume_interface);

            if hr_vol < 0 || hr_mute < 0 {
                return Err(format!("Failed to query volume/mute: HRESULT 0x{:X}, 0x{:X}", hr_vol, hr_mute));
            }

            let volume = (vol_scalar * 100.0) as u32;
            let muted = muted_bool != 0;

            // Retrieve default device ID via COM
            use windows_sys::Win32::System::Com::*;
            use win_com::*;

            let mut enumerator: *mut IMMDeviceEnumerator = std::ptr::null_mut();
            let hr = CoCreateInstance(
                &CLSID_MM_DEVICE_ENUMERATOR as *const GUID as *const _,
                std::ptr::null_mut(),
                CLSCTX_ALL,
                &IID_IM_DEVICE_ENUMERATOR as *const GUID as *const _,
                &mut enumerator as *mut *mut _ as *mut _,
            );

            let mut default_id = String::new();
            if hr >= 0 {
                let mut device: *mut IMMDevice = std::ptr::null_mut();
                let hr_device = ((*(*enumerator).lpVtbl).GetDefaultAudioEndpoint)(
                    enumerator,
                    0, // eRender
                    0, // eConsole
                    &mut device,
                );
                if hr_device >= 0 {
                    let mut pwstr_id: *mut u16 = std::ptr::null_mut();
                    let hr_id = ((*(*device).lpVtbl).GetId)(device, &mut pwstr_id);
                    if hr_id >= 0 && !pwstr_id.is_null() {
                        let mut len = 0;
                        while *pwstr_id.add(len) != 0 {
                            len += 1;
                        }
                        let slice = std::slice::from_raw_parts(pwstr_id, len);
                        default_id = String::from_utf16_lossy(slice);
                        CoTaskMemFree(pwstr_id as *mut _);
                    }
                    ((*(*device).lpVtbl).Release)(device);
                }
                ((*(*enumerator).lpVtbl).Release)(enumerator);
            }

            let script = r#"$baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryView]::Registry64); $regKey = $baseKey.OpenSubKey("SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render"); if ($regKey) { $subKeys = $regKey.GetSubKeyNames(); foreach ($sk in $subKeys) { $devKey = $regKey.OpenSubKey($sk); $state = $devKey.GetValue("DeviceState"); if ($state -eq 1) { $propKey = $devKey.OpenSubKey("Properties"); if ($propKey) { $endpoint = $propKey.GetValue("{a45c254e-df1c-4efd-8020-67d146a850e0},2"); $drv26 = $propKey.GetValue("{b3f8fa53-0004-438e-9003-51a46e139bfc},26"); $drv6 = $propKey.GetValue("{b3f8fa53-0004-438e-9003-51a46e139bfc},6"); $driver = if ($drv26) { $drv26 } else { $drv6 }; if ($endpoint -and $driver) { Write-Output "DEV:$endpoint ($driver)|$sk" } elseif ($endpoint) { Write-Output "DEV:$endpoint|$sk" } } } } }"#;

            let output = run_powershell(script).unwrap_or_default();
            let mut default_device = "Default".to_string();
            let mut devices = Vec::new();

            for line in output.lines() {
                if let Some(rest) = line.strip_prefix("DEV:") {
                    let parts: Vec<&str> = rest.split('|').collect();
                    if parts.len() >= 2 {
                        let name = parts[0].trim().to_string();
                        let id = parts[1].trim().to_string();
                        devices.push(name.clone());
                        if !default_id.is_empty() && default_id.contains(&id) {
                            default_device = name;
                        }
                    }
                }
            }

            if devices.is_empty() {
                devices.push("Default".to_string());
            } else if default_device == "Default" {
                default_device = devices[0].clone();
            }

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
        unsafe {
            let volume_interface = get_volume_interface()?;
            let scalar = (volume as f32) / 100.0;
            let hr = ((*(*volume_interface).lpVtbl).SetMasterVolumeLevelScalar)(
                volume_interface,
                scalar,
                std::ptr::null(),
            );
            ((*(*volume_interface).lpVtbl).Release)(volume_interface);
            if hr < 0 {
                return Err(format!(
                    "SetMasterVolumeLevelScalar failed: HRESULT 0x{:X}",
                    hr
                ));
            }
            Ok(())
        }
        #[cfg(target_os = "macos")]
        {
            run_cmd(
                "osascript",
                &["-e", &format!("set volume output volume {}", volume)],
            )?;
            Ok(())
        }
        #[cfg(target_os = "linux")]
        {
            if run_cmd(
                "pactl",
                &["set-sink-volume", "@DEFAULT_SINK@", &format!("{}%", volume)],
            )
            .is_ok()
            {
                Ok(())
            } else {
                run_cmd("amixer", &["set", "Master", &format!("{}%", volume)])?;
                Ok(())
            }
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        Err("Not supported on this OS".to_string())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

pub async fn set_audio_mute(muted: bool) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        unsafe {
            let volume_interface = get_volume_interface()?;
            let hr = ((*(*volume_interface).lpVtbl).SetMute)(
                volume_interface,
                if muted { 1 } else { 0 },
                std::ptr::null(),
            );
            ((*(*volume_interface).lpVtbl).Release)(volume_interface);
            if hr < 0 {
                return Err(format!("SetMute failed: HRESULT 0x{:X}", hr));
            }
            Ok(())
        }
        #[cfg(target_os = "macos")]
        {
            let val = if muted { "with" } else { "without" };
            run_cmd(
                "osascript",
                &["-e", &format!("set volume {} output muted", val)],
            )?;
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
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

pub async fn set_audio_device(_device: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        unsafe {
            use windows_sys::Win32::System::Com::*;

            // 1. Run PowerShell to find the ID corresponding to the friendly name
            let script = format!(
                r#"$target = '{}'; $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryView]::Registry64); $regKey = $baseKey.OpenSubKey("SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render"); if ($regKey) {{ $subKeys = $regKey.GetSubKeyNames(); foreach ($sk in $subKeys) {{ $devKey = $regKey.OpenSubKey($sk); $state = $devKey.GetValue("DeviceState"); if ($state -eq 1) {{ $propKey = $devKey.OpenSubKey("Properties"); if ($propKey) {{ $endpoint = $propKey.GetValue("{{a45c254e-df1c-4efd-8020-67d146a850e0}},2"); $drv26 = $propKey.GetValue("{{b3f8fa53-0004-438e-9003-51a46e139bfc}},26"); $drv6 = $propKey.GetValue("{{b3f8fa53-0004-438e-9003-51a46e139bfc}},6"); $driver = if ($drv26) {{ $drv26 }} else {{ $drv6 }}; $fullName = if ($endpoint -and $driver) {{ "$endpoint ($driver)" }} else {{ $endpoint }}; if ($fullName -eq $target) {{ Write-Output "{{0.0.0.00000000}}.$sk"; break }} }} }} }} }}"#,
                _device.replace('\'', "''")
            );

            let device_id = match run_powershell(&script) {
                Ok(out) => out.trim().to_string(),
                Err(e) => return Err(format!("Failed to resolve audio device ID: {}", e)),
            };

            if device_id.is_empty() {
                return Err(format!("Could not find active audio endpoint matching '{}'", _device));
            }

            // 2. Initialize COM on this thread
            let _ = CoInitializeEx(std::ptr::null(), COINIT_MULTITHREADED as u32);

            use com_policy_config::*;
            use windows::Win32::Media::Audio::*;

            let policy_config: IPolicyConfig = match windows::Win32::System::Com::CoCreateInstance(&PolicyConfigClient, None, windows::Win32::System::Com::CLSCTX_ALL) {
                Ok(pc) => pc,
                Err(e) => return Err(format!("CoCreateInstance(PolicyConfigClient) failed: {}", e)),
            };

            // Convert to UTF-16 wide string
            let device_id_wide: Vec<u16> = device_id.encode_utf16().chain(std::iter::once(0)).collect();
            let pcwstr_id = windows::core::PCWSTR::from_raw(device_id_wide.as_ptr());

            // Set for Console, Multimedia, Communications roles
            let hr_c = policy_config.SetDefaultEndpoint(pcwstr_id, eConsole);
            let hr_m = policy_config.SetDefaultEndpoint(pcwstr_id, eMultimedia);
            let hr_com = policy_config.SetDefaultEndpoint(pcwstr_id, eCommunications);

            if hr_c.is_err() || hr_m.is_err() || hr_com.is_err() {
                return Err(format!(
                    "SetDefaultEndpoint failed: Errors {:?}, {:?}, {:?}",
                    hr_c, hr_m, hr_com
                ));
            }

            Ok(())
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
        unsafe {
            use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
            let vk = match action.as_str() {
                "play_pause" => 0xB3,
                "next" => 0xB0,
                "prev" => 0xB1,
                "volume_up" => 0xAF,
                "volume_down" => 0xAE,
                "mute" => 0xAD,
                _ => return Err(format!("Unknown media action: {}", action)),
            };
            let mut input = INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: vk,
                        wScan: 0,
                        dwFlags: 0,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            };
            let sz = std::mem::size_of::<INPUT>() as i32;
            SendInput(1, &input, sz);
            input.Anonymous.ki.dwFlags = KEYEVENTF_KEYUP;
            SendInput(1, &input, sz);
            Ok(())
        }
        #[cfg(target_os = "macos")]
        {
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
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
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
            let brightness = std::fs::read_to_string("/sys/class/backlight/intel_backlight/brightness").ok()
                .and_then(|c| c.trim().parse::<f32>().ok())
                .and_then(|c| {
                    let max = std::fs::read_to_string("/sys/class/backlight/intel_backlight/max_brightness").ok()
                        .and_then(|m| m.trim().parse::<f32>().ok())?;
                    Some(((c / max) * 100.0) as u32)
                })
                .unwrap_or(50);
            Ok(DisplayStatus { brightness, night_light: false })
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        Ok(DisplayStatus { brightness: 50, night_light: false })
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

pub async fn set_display_brightness(brightness: u32) -> Result<(), String> {
    let brightness = brightness.min(100);
    tokio::task::spawn_blocking(move || {
        let _ = brightness;
        #[cfg(target_os = "windows")]
        {
            let script = format!("(Get-WmiObject -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods).WmiSetBrightness(1, {})", brightness);
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

pub async fn get_toggle_status() -> Result<ToggleStatus, String> {
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        unsafe {
            use windows_sys::Win32::System::Registry::*;
            use windows_sys::Win32::Foundation::ERROR_SUCCESS;

            let dark_mode = (|| {
                let subkey = "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize\0";
                let value_name = "AppsUseLightTheme\0";
                let subkey_w: Vec<u16> = subkey.encode_utf16().collect();
                let value_w: Vec<u16> = value_name.encode_utf16().collect();
                let mut hkey: HKEY = std::ptr::null_mut();
                if RegOpenKeyExW(HKEY_CURRENT_USER, subkey_w.as_ptr(), 0, KEY_READ, &mut hkey) != ERROR_SUCCESS { return false; }
                let mut value: u32 = 1;
                let mut size: u32 = 4;
                let mut typ: u32 = 0;
                let ret = RegGetValueW(hkey, std::ptr::null(), value_w.as_ptr(), 0x10, &mut typ, &mut value as *mut _ as *mut _, &mut size);
                RegCloseKey(hkey);
                ret == ERROR_SUCCESS && value == 0
            })();

            let wifi = (|| {
                use windows_sys::Win32::NetworkManagement::WiFi::*;
                let mut handle: *mut core::ffi::c_void = std::ptr::null_mut();
                let mut negotiated = 0u32;
                if WlanOpenHandle(2, std::ptr::null(), &mut negotiated, &mut handle) != 0 { return false; }
                let mut iface_list: *mut WLAN_INTERFACE_INFO_LIST = std::ptr::null_mut();
                if WlanEnumInterfaces(handle, std::ptr::null(), &mut iface_list) != 0 || iface_list.is_null() {
                    WlanCloseHandle(handle, std::ptr::null());
                    return false;
                }
                let state = (*iface_list).InterfaceInfo[0].isState;
                WlanFreeMemory(iface_list as *mut _);
                WlanCloseHandle(handle, std::ptr::null());
                state == 1
            })();

            let dnd = (|| {
                let subkey = "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings\0";
                let value_name = "NOC_GLOBAL_SETTING_TOASTS_ENABLED\0";
                let subkey_w: Vec<u16> = subkey.encode_utf16().collect();
                let value_w: Vec<u16> = value_name.encode_utf16().collect();
                let mut hkey: HKEY = std::ptr::null_mut();
                if RegOpenKeyExW(HKEY_CURRENT_USER, subkey_w.as_ptr(), 0, KEY_READ, &mut hkey) != ERROR_SUCCESS { return false; }
                let mut value: u32 = 1;
                let mut size: u32 = 4;
                let mut typ: u32 = 0;
                let ret = RegGetValueW(hkey, std::ptr::null(), value_w.as_ptr(), 0x10, &mut typ, &mut value as *mut _ as *mut _, &mut size);
                RegCloseKey(hkey);
                ret == ERROR_SUCCESS && value == 0
            })();

            Ok(ToggleStatus { dark_mode, wifi, dnd, bluetooth: false })
        }
        #[cfg(target_os = "macos")]
        {
            let dark_out = run_cmd("osascript", &["-e", "tell application \"System Events\" to tell appearance preferences to get dark mode"])
                .unwrap_or_else(|_| "false".to_string());
            let dark_mode = dark_out.trim().eq_ignore_ascii_case("true");
            // ponytail: wifi state via networksetup, dnd via defaults
            let wifi = run_cmd("networksetup", &["-getairportpower", "en0"])
                .map(|o| o.contains("On"))
                .unwrap_or(false);
            let dnd = run_cmd("defaults", &["-currentHost", "read", "com.apple.notificationcenterui", "doNotDisturb"])
                .map(|o| o.trim() == "1")
                .unwrap_or(false);
            Ok(ToggleStatus { dark_mode, wifi, dnd, bluetooth: false })
        }
        #[cfg(target_os = "linux")]
        {
            let theme_out = run_cmd("gsettings", &["get", "org.gnome.desktop.interface", "color-scheme"]).unwrap_or_default();
            let dark_mode = theme_out.contains("prefer-dark");
            // ponytail: wifi via nmcli, dnd via gnome
            let wifi = run_cmd("nmcli", &["-t", "-f", "WIFI", "general"])
                .map(|o| o.trim() == "enabled")
                .unwrap_or(false);
            let dnd = run_cmd("gsettings", &["get", "org.gnome.desktop.notifications", "show-banners"])
                .map(|o| o.trim() == "false")
                .unwrap_or(false);
            Ok(ToggleStatus { dark_mode, wifi, dnd, bluetooth: false })
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        Ok(ToggleStatus { dark_mode: false, wifi: false, dnd: false, bluetooth: false })
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

pub async fn set_toggle_dark_mode(enabled: bool) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        unsafe {
            use windows_sys::Win32::System::Registry::*;
            use windows_sys::Win32::Foundation::ERROR_SUCCESS;
            let val: u32 = if enabled { 0 } else { 1 };
            let subkey = "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize\0";
            let apps_name = "AppsUseLightTheme\0";
            let sys_name = "SystemUsesLightTheme\0";
            let subkey_w: Vec<u16> = subkey.encode_utf16().collect();
            let apps_w: Vec<u16> = apps_name.encode_utf16().collect();
            let sys_w: Vec<u16> = sys_name.encode_utf16().collect();

            let mut hkey: HKEY = std::ptr::null_mut();
            let ret = RegOpenKeyExW(HKEY_CURRENT_USER, subkey_w.as_ptr(), 0, KEY_SET_VALUE, &mut hkey);
            if ret != ERROR_SUCCESS { return Err("Failed to open theme registry key".to_string()); }

            RegSetValueExW(hkey, apps_w.as_ptr(), 0, 4, &val as *const u32 as *const u8, 4);
            RegSetValueExW(hkey, sys_w.as_ptr(), 0, 4, &val as *const u32 as *const u8, 4);
            RegCloseKey(hkey);
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

pub async fn get_control_center_status() -> Result<ControlCenterStatus, String> {
    let toggle_status = get_toggle_status().await?;
    Ok(ControlCenterStatus {
        dark_mode: toggle_status.dark_mode,
        wifi_on: Some(toggle_status.wifi),
        dnd_on: Some(toggle_status.dnd),
    })
}

pub async fn set_control_center_toggle(toggle: String, enabled: bool) -> Result<(), String> {
    match toggle.as_str() {
        "dark_mode" => set_toggle_dark_mode(enabled).await,
        "wifi" => tokio::task::spawn_blocking(move || {
            #[cfg(target_os = "windows")]
            {
                use windows_sys::Win32::NetworkManagement::WiFi::*;
                unsafe {
                    let mut handle: *mut core::ffi::c_void = std::ptr::null_mut();
                    let mut negotiated = 0u32;
                    if WlanOpenHandle(2, std::ptr::null(), &mut negotiated, &mut handle) != 0 {
                        return Err("WlanOpenHandle failed".to_string());
                    }
                    let mut iface_list: *mut WLAN_INTERFACE_INFO_LIST = std::ptr::null_mut();
                    if WlanEnumInterfaces(handle, std::ptr::null(), &mut iface_list) != 0
                        || iface_list.is_null()
                    {
                        WlanCloseHandle(handle, std::ptr::null());
                        return Err("No WLAN interfaces".to_string());
                    }
                    let guid = (*iface_list).InterfaceInfo[0].InterfaceGuid;
                    WlanFreeMemory(iface_list as *mut _);

                    if enabled {
                        WlanCloseHandle(handle, std::ptr::null());
                        Ok(())
                    } else {
                        let ret = WlanDisconnect(handle, &guid, std::ptr::null());
                        WlanCloseHandle(handle, std::ptr::null());
                        if ret != 0 {
                            Err(format!("WlanDisconnect failed: {}", ret))
                        } else {
                            Ok(())
                        }
                    }
                }
            }
            #[cfg(not(target_os = "windows"))]
            {
                let _ = enabled;
                Err("Wi-Fi toggle not supported on this OS".to_string())
            }
        })
        .await
        .map_err(|e| format!("Task join error: {}", e))?,
        "dnd" => tokio::task::spawn_blocking(move || {
            #[cfg(target_os = "windows")]
            unsafe {
                use windows_sys::Win32::Foundation::ERROR_SUCCESS;
                use windows_sys::Win32::System::Registry::*;
                let val: u32 = if enabled { 0 } else { 1 };
                let subkey =
                    "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings\0";
                let value_name = "NOC_GLOBAL_SETTING_TOASTS_ENABLED\0";
                let subkey_w: Vec<u16> = subkey.encode_utf16().collect();
                let value_w: Vec<u16> = value_name.encode_utf16().collect();

                let mut hkey: HKEY = std::ptr::null_mut();
                let ret = RegOpenKeyExW(
                    HKEY_CURRENT_USER,
                    subkey_w.as_ptr(),
                    0,
                    KEY_SET_VALUE,
                    &mut hkey,
                );
                if ret != ERROR_SUCCESS {
                    return Err("Failed to open DND registry key".to_string());
                }
                let ret = RegSetValueExW(
                    hkey,
                    value_w.as_ptr(),
                    0,
                    4,
                    &val as *const u32 as *const u8,
                    4,
                );
                RegCloseKey(hkey);
                if ret == ERROR_SUCCESS {
                    Ok(())
                } else {
                    Err("Failed to set DND registry value".to_string())
                }
            }
            #[cfg(not(target_os = "windows"))]
            Err("DND toggle not supported on this OS".to_string())
        })
        .await
        .map_err(|e| format!("Task join error: {}", e))?,
        _ => Err(format!("Unknown toggle: {}", toggle)),
    }
}

pub async fn set_display_monitor(action: &str) -> Result<(), String> {
    match action {
        "off" => set_monitor_off().await,
        _ => Err(format!("Unknown monitor action: {}", action)),
    }
}

pub async fn set_monitor_off() -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        unsafe {
            use windows_sys::Win32::UI::WindowsAndMessaging::{SendMessageW, HWND_BROADCAST};
            SendMessageW(HWND_BROADCAST, 0x0112, 0xF170, 2);
            Ok(())
        }
        #[cfg(target_os = "linux")]
        {
            run_cmd("xset", &["dpms", "force", "off"])?;
            Ok(())
        }
        #[cfg(not(any(target_os = "windows", target_os = "linux")))]
        Err("Monitor off not supported on this OS".to_string())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

// --- Axum API Route Handlers ---

pub async fn audio_status_handler() -> impl IntoResponse {
    match get_audio_status().await {
        Ok(status) => Json(json!({ "success": true, "data": status })).into_response(),
        Err(e) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "success": false, "message": e })),
        )
            .into_response(),
    }
}

pub async fn audio_volume_handler(
    State(state): State<crate::AppState>,
    Json(req): Json<VolumeRequest>,
) -> impl IntoResponse {
    let tx = state.hardware_tx.clone();
    let volume = req.volume;
    tokio::spawn(async move {
        let _ = set_audio_volume(volume).await;
        let msg =
            serde_json::json!({"event": "hardware", "data": {"type": "volume", "volume": volume}});
        let _ = tx.send(msg.to_string());
    });
    Json(json!({ "success": true })).into_response()
}

pub async fn audio_mute_handler(
    State(state): State<crate::AppState>,
    Json(req): Json<MuteRequest>,
) -> impl IntoResponse {
    let tx = state.hardware_tx.clone();
    let muted = req.muted;
    tokio::spawn(async move {
        // Detect current state first, skip if already there
        if let Ok(status) = get_audio_status().await {
            if status.muted == muted {
                let msg = serde_json::json!({"event": "hardware", "data": {"type": "mute", "muted": muted}});
                let _ = tx.send(msg.to_string());
                return;
            }
        }
        let _ = set_audio_mute(muted).await;
        let msg =
            serde_json::json!({"event": "hardware", "data": {"type": "mute", "muted": muted}});
        let _ = tx.send(msg.to_string());
    });
    Json(json!({ "success": true })).into_response()
}

pub async fn audio_device_handler(
    State(state): State<crate::AppState>,
    Json(req): Json<DeviceRequest>,
) -> impl IntoResponse {
    let tx = state.hardware_tx.clone();
    let device = req.device;
    tokio::spawn(async move {
        let _ = set_audio_device(device).await;
        let msg = serde_json::json!({"event": "hardware", "data": {"type": "device"}});
        let _ = tx.send(msg.to_string());
    });
    Json(json!({ "success": true })).into_response()
}

pub async fn audio_media_handler(
    State(state): State<crate::AppState>,
    Json(req): Json<MediaRequest>,
) -> impl IntoResponse {
    let _tx = state.hardware_tx.clone();
    let action = req.action;
    tokio::spawn(async move {
        let _ = trigger_media_key(action).await;
    });
    Json(json!({ "success": true })).into_response()
}

pub async fn display_status_handler() -> impl IntoResponse {
    match get_display_status().await {
        Ok(status) => Json(json!({ "success": true, "data": status })).into_response(),
        Err(e) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "success": false, "message": e })),
        )
            .into_response(),
    }
}

pub async fn display_brightness_handler(
    State(state): State<crate::AppState>,
    Json(req): Json<BrightnessRequest>,
) -> impl IntoResponse {
    let tx = state.hardware_tx.clone();
    let brightness = req.brightness;
    tokio::spawn(async move {
        let _ = set_display_brightness(brightness).await;
        let msg = serde_json::json!({"event": "hardware", "data": {"type": "brightness", "brightness": brightness}});
        let _ = tx.send(msg.to_string());
    });
    Json(json!({ "success": true })).into_response()
}

pub async fn toggles_status_handler() -> impl IntoResponse {
    match get_toggle_status().await {
        Ok(status) => Json(json!({ "success": true, "data": status })).into_response(),
        Err(e) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "success": false, "message": e })),
        )
            .into_response(),
    }
}

pub async fn toggle_dark_mode_handler(
    State(state): State<crate::AppState>,
    Json(req): Json<ControlCenterToggleReq>,
) -> impl IntoResponse {
    let tx = state.hardware_tx.clone();
    let enabled = req.enabled;
    tokio::spawn(async move {
        let _ = set_toggle_dark_mode(enabled).await;
        let msg = serde_json::json!({"event": "hardware", "data": {"type": "dark_mode", "enabled": enabled}});
        let _ = tx.send(msg.to_string());
    });
    Json(json!({ "success": true })).into_response()
}

pub async fn toggle_wifi_handler(
    State(state): State<crate::AppState>,
    Json(req): Json<serde_json::Value>,
) -> impl IntoResponse {
    let enabled = req
        .get("enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    // Detect current state first, skip if already there
    if let Ok(status) = get_toggle_status().await {
        if status.wifi == enabled {
            let _ = state.hardware_tx.send(serde_json::json!({"event": "hardware", "data": {"type": "wifi", "enabled": enabled}}).to_string());
            return Json(json!({ "success": true })).into_response();
        }
    }
    match set_control_center_toggle("wifi".into(), enabled).await {
        Ok(()) => {
            let _ = state.hardware_tx.send(serde_json::json!({"event": "hardware", "data": {"type": "wifi", "enabled": enabled}}).to_string());
            Json(json!({ "success": true })).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "success": false, "message": e })),
        )
            .into_response(),
    }
}

pub async fn toggle_dnd_handler(
    State(state): State<crate::AppState>,
    Json(req): Json<serde_json::Value>,
) -> impl IntoResponse {
    let enabled = req
        .get("enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    // Detect current state first, skip if already there
    if let Ok(status) = get_toggle_status().await {
        if status.dnd == enabled {
            let _ = state.hardware_tx.send(serde_json::json!({"event": "hardware", "data": {"type": "dnd", "enabled": enabled}}).to_string());
            return Json(json!({ "success": true })).into_response();
        }
    }
    match set_control_center_toggle("dnd".into(), enabled).await {
        Ok(()) => {
            let _ = state.hardware_tx.send(serde_json::json!({"event": "hardware", "data": {"type": "dnd", "enabled": enabled}}).to_string());
            Json(json!({ "success": true })).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "success": false, "message": e })),
        )
            .into_response(),
    }
}

pub async fn night_light_handler(Json(req): Json<serde_json::Value>) -> impl IntoResponse {
    let _night_light = req
        .get("night_light")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    Json(json!({ "success": true })).into_response()
}

pub async fn control_center_status_handler() -> impl IntoResponse {
    match get_control_center_status().await {
        Ok(status) => Json(json!({ "success": true, "data": status })).into_response(),
        Err(e) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "success": false, "message": e })),
        )
            .into_response(),
    }
}

pub async fn control_center_toggle_handler(
    State(state): State<crate::AppState>,
    Json(req): Json<ControlCenterToggleReq>,
) -> impl IntoResponse {
    if !matches!(req.toggle.as_str(), "dark_mode" | "wifi" | "dnd") {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "success": false,
                "message": format!("Unknown toggle: {}", req.toggle)
            })),
        )
            .into_response();
    }
    match set_control_center_toggle(req.toggle.clone(), req.enabled).await {
        Ok(()) => {
            let msg = serde_json::json!({"event": "hardware", "data": {"type": req.toggle, "enabled": req.enabled}});
            let _ = state.hardware_tx.send(msg.to_string());
            Json(json!({ "success": true })).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "success": false, "message": e })),
        )
            .into_response(),
    }
}

pub async fn display_monitor_handler(
    State(state): State<crate::AppState>,
    Json(req): Json<MonitorRequest>,
) -> impl IntoResponse {
    let _tx = state.hardware_tx.clone();
    let action = req.action;
    tokio::spawn(async move {
        let _ = set_display_monitor(&action).await;
    });
    Json(json!({ "success": true })).into_response()
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
                tracing::info!(
                    "Executing scheduled power command (force={}): {}",
                    force,
                    action_str
                );
                // ponytail: both force/non-force use EWX_FORCE — grace period impractical at OS level
                commands.execute_power_action(action);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[ignore = "requires real audio device hardware; SetDefaultEndpoint fails with 0x80004005"]
    #[tokio::test]
    async fn test_set_audio_device() {
        let status = get_audio_status().await.unwrap();
        println!("BEFORE: {}", status.default_device);

        if status.devices.len() > 1 {
            let next_device = status
                .devices
                .iter()
                .find(|&d| d != &status.default_device)
                .unwrap();
            println!("SWITCHING TO: {}", next_device);
            set_audio_device(next_device.clone()).await.unwrap();

            let status2 = get_audio_status().await.unwrap();
            println!("AFTER: {}", status2.default_device);

            assert_eq!(&status2.default_device, next_device);
        } else {
            println!("Only one device found, cannot test switching");
        }
    }
}
