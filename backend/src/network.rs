use std::process::Command;
use serde::{Deserialize, Serialize};
use axum::response::{IntoResponse, Json};
use serde_json::json;

#[derive(Serialize, Debug)]
pub struct InterfaceInfo {
    pub name: String,
    pub status: String,
    pub interface_type: String,
    pub mac: String,
    pub ipv4: String,
}

#[derive(Serialize, Debug)]
pub struct NetworkStatus {
    pub ipv4: String,
    pub ipv6: Option<String>,
    pub interfaces: Vec<InterfaceInfo>,
    pub default_gateway: String,
    pub dns_servers: Vec<String>,
    pub connection_type: String,
    pub internet_connection: Option<bool>,
}

#[derive(Serialize, Debug)]
pub struct WifiNetwork {
    pub ssid: String,
    pub signal_strength: u32,
    pub security_type: String,
    pub connected: bool,
}

#[derive(Deserialize)]
pub struct AdapterRequest {
    pub name: String,
    pub enabled: bool,
}

#[derive(Deserialize)]
pub struct WifiConnectRequest {
    pub ssid: String,
    pub password: Option<String>,
    #[serde(default = "default_wifi_security")]
    pub security_type: String,
}

fn default_wifi_security() -> String {
    "WPA2-Personal".to_string()
}

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
        stdin.write_all(script.as_bytes())
            .map_err(|e| format!("Failed to write to powershell stdin: {}", e))?;
    }
    let output = child.wait_with_output()
        .map_err(|e| format!("Failed to read powershell output: {}", e))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

pub async fn get_network_status() -> Result<NetworkStatus, String> {
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        unsafe {
            get_windows_network_status()
        }
        #[cfg(target_os = "macos")]
        {
            get_macos_network_status()
        }
        #[cfg(target_os = "linux")]
        {
            get_linux_network_status()
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        {
            Ok(default_network_status())
        }
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

fn default_network_status() -> NetworkStatus {
    NetworkStatus {
        ipv4: String::new(),
        ipv6: None,
        interfaces: vec![],
        default_gateway: String::new(),
        dns_servers: vec![],
        connection_type: "unknown".to_string(),
        internet_connection: None,
    }
}

#[cfg(target_os = "windows")]
unsafe fn get_windows_network_status() -> Result<NetworkStatus, String> {
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetAdaptersAddresses, IP_ADAPTER_ADDRESSES_LH,
        GAA_FLAG_SKIP_MULTICAST, GAA_FLAG_SKIP_ANYCAST,
        IF_TYPE_IEEE80211, IF_TYPE_ETHERNET_CSMACD, IF_TYPE_SOFTWARE_LOOPBACK,
    };
    use windows_sys::Win32::NetworkManagement::Ndis::IfOperStatusUp;
    use windows_sys::Win32::Foundation::{ERROR_BUFFER_OVERFLOW, ERROR_SUCCESS};

    let mut buf_len: u32 = 0;
    let ret = GetAdaptersAddresses(
        0u32,
        0,
        std::ptr::null(),
        std::ptr::null_mut(),
        &mut buf_len,
    );

    if ret != ERROR_BUFFER_OVERFLOW && ret != ERROR_SUCCESS {
        return Ok(default_network_status());
    }

    let mut buf: Vec<u8> = vec![0u8; buf_len as usize];
    let adapters = buf.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH;

    let ret = GetAdaptersAddresses(
        0u32,
        GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_ANYCAST,
        std::ptr::null(),
        adapters,
        &mut buf_len,
    );

    if ret != ERROR_SUCCESS {
        return Ok(default_network_status());
    }

    let mut interfaces = Vec::new();
    let mut dns_servers = Vec::new();
    let mut default_gateway = String::new();
    let mut ipv4 = String::new();
    let mut ipv6: Option<String> = None;
    let mut has_wifi = false;
    let mut has_ethernet = false;
    let mut cur = adapters;
    while !cur.is_null() {
        let adapter = &*cur;

        let name = if !adapter.FriendlyName.is_null() {
            let mut len = 0;
            while *adapter.FriendlyName.add(len) != 0 { len += 1; }
            String::from_utf16_lossy(std::slice::from_raw_parts(adapter.FriendlyName, len))
        } else {
            String::new()
        };

        let type_str = if adapter.IfType == IF_TYPE_IEEE80211 {
            has_wifi = true; "wifi"
        } else if adapter.IfType == IF_TYPE_ETHERNET_CSMACD {
            has_ethernet = true; "ethernet"
        } else if adapter.IfType == IF_TYPE_SOFTWARE_LOOPBACK {
            "loopback"
        } else {
            "unknown"
        };

        let status = if adapter.OperStatus == IfOperStatusUp { "up" } else {
            "down"
        };

        let mac_len = adapter.PhysicalAddressLength.min(8) as usize;
        let mac = if mac_len > 0 {
            std::slice::from_raw_parts(adapter.PhysicalAddress.as_ptr(), mac_len)
                .iter().map(|b| format!("{:02X}", b)).collect::<Vec<_>>().join(":")
        } else {
            String::new()
        };

        let mut addr_v4 = String::new();
        let mut addr_v6: Option<String> = None;
        let mut unicast = adapter.FirstUnicastAddress;
        while !unicast.is_null() {
            let ua = &*unicast;
            let sockaddr = ua.Address.lpSockaddr;
            if !sockaddr.is_null() {
                let family = *(sockaddr as *const u16);
                if family == 2 && addr_v4.is_empty() {
                    let ipb = std::slice::from_raw_parts(sockaddr.add(4) as *const u8, 4);
                    addr_v4 = format!("{}.{}.{}.{}", ipb[0], ipb[1], ipb[2], ipb[3]);
                } else if family == 23 && addr_v6.is_none() {
                    let ipb = std::slice::from_raw_parts(sockaddr.add(8) as *const u8, 16);
                    let segs: Vec<String> = ipb.chunks(2).map(|c| format!("{:02x}{:02x}", c[0], c[1])).collect();
                    addr_v6 = Some(segs.join(":"));
                }
            }
            unicast = ua.Next;
        }

        if default_gateway.is_empty() {
            let mut gw = adapter.FirstGatewayAddress;
            while !gw.is_null() {
                let gwa = &*gw;
                let sockaddr = gwa.Address.lpSockaddr;
                if !sockaddr.is_null() && *(sockaddr as *const u16) == 2 {
                    let ipb = std::slice::from_raw_parts(sockaddr.add(4) as *const u8, 4);
                    default_gateway = format!("{}.{}.{}.{}", ipb[0], ipb[1], ipb[2], ipb[3]);
                    break;
                }
                gw = gwa.Next;
            }
        }

        let mut dns = adapter.FirstDnsServerAddress;
        while !dns.is_null() {
            let dnsa = &*dns;
            let sockaddr = dnsa.Address.lpSockaddr;
            if !sockaddr.is_null() && *(sockaddr as *const u16) == 2 {
                let ipb = std::slice::from_raw_parts(sockaddr.add(4) as *const u8, 4);
                let dns_ip = format!("{}.{}.{}.{}", ipb[0], ipb[1], ipb[2], ipb[3]);
                if !dns_servers.contains(&dns_ip) {
                    dns_servers.push(dns_ip);
                }
            }
            dns = dnsa.Next;
        }

        // Prefer up adapters for primary IP/gateway
        if status == "up" && !addr_v4.is_empty() && ipv4.is_empty() { ipv4 = addr_v4.clone(); }
        if status == "up" && addr_v6.is_some() && ipv6.is_none() { ipv6 = addr_v6.clone(); }

        interfaces.push(InterfaceInfo {
            name,
            status: status.to_string(),
            interface_type: type_str.to_string(),
            mac,
            ipv4: addr_v4,
        });

        cur = adapter.Next;
    }

    let connection_type = if has_wifi { "wifi".to_string() } else if has_ethernet { "ethernet".to_string() } else { "unknown".to_string() };
    let internet = if default_gateway.is_empty() { None } else { Some(true) };

    Ok(NetworkStatus {
        ipv4,
        ipv6,
        interfaces,
        default_gateway,
        dns_servers,
        connection_type,
        internet_connection: internet,
    })
}

#[cfg(target_os = "macos")]
fn get_macos_network_status() -> Result<NetworkStatus, String> {
    let ifconfig_out = run_cmd("ifconfig", &[]).unwrap_or_default();
    let mut interfaces = Vec::new();
    let mut ipv4 = String::new();
    let mut ipv6: Option<String> = None;

    for block in ifconfig_out.split("\n\n") {
        let lines: Vec<&str> = block.lines().collect();
        if lines.is_empty() { continue; }
        let name = lines[0].split(':').next().unwrap_or("").to_string();
        if name.is_empty() || name.starts_with(" ") { continue; }
        let joined = block;
        let status = if joined.contains("UP") { "up" } else { "down" };
        let type_str = if name.starts_with("en") { "ethernet" } else if name.starts_with("awdl") || name.starts_with("llw") { "wifi" } else if name == "lo0" { "loopback" } else { "unknown" };
        let mut addr_v4 = String::new();
        for line in &lines {
            if let Some(ip) = line.trim().strip_prefix("inet ") {
                let p = ip.split_whitespace().next().unwrap_or("");
                if addr_v4.is_empty() { addr_v4 = p.to_string(); }
            }
            if ipv6.is_none() {
                if let Some(ip) = line.trim().strip_prefix("inet6 ") {
                    let p = ip.split_whitespace().next().unwrap_or("");
                    if !p.starts_with("fe80") {
                        ipv6 = Some(p.to_string());
                    }
                }
            }
        }
        let mac = lines.iter().find_map(|l| {
            l.trim().strip_prefix("ether ").map(|s| s.split_whitespace().next().unwrap_or("").to_uppercase())
        }).unwrap_or_default();

        if !addr_v4.is_empty() && ipv4.is_empty() { ipv4 = addr_v4.clone(); }

        interfaces.push(InterfaceInfo {
            name,
            status: status.to_string(),
            interface_type: type_str.to_string(),
            mac,
            ipv4: addr_v4,
        });
    }

    let gw = run_cmd("netstat", &["-rn", "-f", "inet"]).unwrap_or_default();
    let default_gateway = gw.lines().find_map(|l| {
        if l.starts_with("default") { l.split_whitespace().nth(1).map(|s| s.to_string()) } else { None }
    }).unwrap_or_default();

    Ok(NetworkStatus {
        ipv4,
        ipv6,
        interfaces,
        default_gateway,
        dns_servers: vec![],
        connection_type: "unknown".to_string(),
        internet_connection: None,
    })
}

#[cfg(target_os = "linux")]
fn get_linux_network_status() -> Result<NetworkStatus, String> {
    let ip_out = run_cmd("ip", &["addr"]).unwrap_or_default();
    let mut interfaces = Vec::new();
    let mut ipv4 = String::new();
    let mut ipv6: Option<String> = None;
    let mut has_wifi = false;
    let mut has_ethernet = false;

    for block in ip_out.split("\n\n") {
        let block = block.trim();
        if block.is_empty() { continue; }
        let lines: Vec<&str> = block.lines().collect();
        let first = lines.first().unwrap_or(&"");
        let parts: Vec<&str> = first.splitn(2, ": ").collect();
        if parts.len() < 2 { continue; }
        let rest = parts[1];
        let name = rest.split(':').next().unwrap_or("").trim().to_string();
        let joined = block;
        let status = if joined.contains("state UP") { "up" } else { "down" };
        let type_str = if joined.contains("wlan") || joined.contains("wlp") { has_wifi = true; "wifi" }
            else if joined.contains("eth") || joined.contains("enp") || joined.contains("ens") { has_ethernet = true; "ethernet" }
            else if name == "lo" { "loopback" } else { "unknown" };
        let mut addr_v4 = String::new();
        for line in &lines {
            let trimmed = line.trim();
            if let Some(ip) = trimmed.strip_prefix("inet ") {
                let p = ip.split('/').next().unwrap_or("");
                if addr_v4.is_empty() { addr_v4 = p.to_string(); }
            }
            if ipv6.is_none() {
                if let Some(ip) = trimmed.strip_prefix("inet6 ") {
                    let p = ip.split('/').next().unwrap_or("");
                    if !p.starts_with("fe80") {
                        ipv6 = Some(p.to_string());
                    }
                }
            }
        }
        let mac = lines.iter().find_map(|l| {
            l.trim().strip_prefix("link/ether ").map(|s| s.split_whitespace().next().unwrap_or("").to_uppercase())
        }).unwrap_or_default();

        if !addr_v4.is_empty() && ipv4.is_empty() { ipv4 = addr_v4.clone(); }

        interfaces.push(InterfaceInfo {
            name,
            status: status.to_string(),
            interface_type: type_str.to_string(),
            mac,
            ipv4: addr_v4,
        });
    }

    let gw_out = run_cmd("ip", &["route"]).unwrap_or_default();
    let default_gateway = gw_out.lines().find_map(|l| {
        if l.starts_with("default via ") { l.split_whitespace().nth(2).map(|s| s.to_string()) } else { None }
    }).unwrap_or_default();

    Ok(NetworkStatus {
        ipv4,
        ipv6,
        interfaces,
        default_gateway,
        dns_servers: vec![],
        connection_type: if has_wifi { "wifi".to_string() } else if has_ethernet { "ethernet".to_string() } else { "unknown".to_string() },
        internet_connection: None,
    })
}

pub async fn scan_wifi() -> Result<Vec<WifiNetwork>, String> {
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            scan_wifi_windows()
        }
        #[cfg(not(target_os = "windows"))]
        {
            Err("Wi-Fi scanning is only supported on Windows".to_string())
        }
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

#[cfg(target_os = "windows")]
fn scan_wifi_windows() -> Result<Vec<WifiNetwork>, String> {
    let out = run_cmd("netsh", &["wlan", "show", "networks", "mode=Bssid"])?;
    let mut networks = Vec::new();
    let mut current_ssid = String::new();
    let mut current_signal = 0u32;
    let mut current_auth = String::new();
    let mut collecting = false;

    for line in out.lines() {
        let trimmed = line.trim();
        if let Some(ssid) = trimmed.strip_prefix("SSID ") {
            if let Some(idx) = ssid.find(':') {
                let name = ssid[idx+1..].trim().to_string();
                if !name.is_empty() {
                    if collecting && !current_ssid.is_empty() {
                        networks.push(WifiNetwork {
                            ssid: current_ssid.clone(),
                            signal_strength: current_signal,
                            security_type: current_auth.clone(),
                            connected: false,
                        });
                    }
                    current_ssid = name;
                    current_signal = 0;
                    current_auth = String::new();
                    collecting = true;
                }
            }
        } else if collecting {
            if let Some(auth) = trimmed.strip_prefix("Authentication") {
                if let Some(idx) = auth.find(':') {
                    current_auth = auth[idx+1..].trim().to_string();
                }
            } else if let Some(sig) = trimmed.strip_prefix("Signal") {
                if let Some(idx) = sig.find(':') {
                    let s = sig[idx+1..].trim().trim_end_matches('%');
                    current_signal = s.parse::<u32>().unwrap_or(0);
                }
            }
        }
    }

    if collecting && !current_ssid.is_empty() {
        networks.push(WifiNetwork {
            ssid: current_ssid.clone(),
            signal_strength: current_signal,
            security_type: current_auth,
            connected: false,
        });
    }

    // Check which one we're connected to
    let conn_out = run_cmd("netsh", &["wlan", "show", "interfaces"]).unwrap_or_default();
    let connected_ssid = conn_out.lines().find_map(|l| {
        let t = l.trim();
        if let Some(s) = t.strip_prefix("SSID") {
            if let Some(idx) = s.find(':') {
                let name = s[idx+1..].trim().to_string();
                if !name.is_empty() && name != "BSSID" { return Some(name); }
            }
        }
        None
    });

    for net in &mut networks {
        if let Some(ref connected) = connected_ssid {
            if net.ssid == *connected { net.connected = true; }
        }
    }

    Ok(networks)
}

pub async fn connect_wifi(ssid: String, password: Option<String>, security_type: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            connect_wifi_windows(&ssid, password.as_deref(), &security_type)
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = (ssid, password, security_type);
            Err("Wi-Fi connect is only supported on Windows".to_string())
        }
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

#[cfg(target_os = "windows")]
fn connect_wifi_windows(ssid: &str, password: Option<&str>, security_type: &str) -> Result<(), String> {
    let temp_dir = std::env::temp_dir();
    let profile_path = temp_dir.join(format!("nodedesk_wifi_{}.xml", ssid.replace(|c: char| !c.is_alphanumeric(), "_")));

    let (auth_elem, use_key) = match security_type {
        "WPA3" | "WPA3-Personal" | "WPA3SAE" => ("WPA3SAE", true),
        "WPA2" | "WPA2-Personal" | "WPA2PSK" | "WPA2-PSK" => ("WPA2PSK", true),
        _ => ("open", false),
    };

    let xml = if use_key {
        let pwd = password.ok_or_else(|| "Password required for WPA2/WPA3".to_string())?;
        format!(
            r#"<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
    <name>{}</name>
    <SSIDConfig>
        <SSID>
            <name>{}</name>
        </SSID>
    </SSIDConfig>
    <connectionType>ESS</connectionType>
    <connectionMode>auto</connectionMode>
    <MSM>
        <security>
            <authEncryption>
                <authentication>{}</authentication>
                <encryption>AES</encryption>
                <useOneX>false</useOneX>
            </authEncryption>
            <sharedKey>
                <keyType>passPhrase</keyType>
                <protected>false</protected>
                <keyMaterial>{}</keyMaterial>
            </sharedKey>
        </security>
    </MSM>
</WLANProfile>"#,
            ssid, ssid, auth_elem, pwd
        )
    } else {
        format!(
            r#"<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
    <name>{}</name>
    <SSIDConfig>
        <SSID>
            <name>{}</name>
        </SSID>
    </SSIDConfig>
    <connectionType>ESS</connectionType>
    <connectionMode>auto</connectionMode>
    <MSM>
        <security>
            <authEncryption>
                <authentication>{}</authentication>
                <encryption>none</encryption>
                <useOneX>false</useOneX>
            </authEncryption>
        </security>
    </MSM>
</WLANProfile>"#,
            ssid, ssid, auth_elem
        )
    };

    std::fs::write(&profile_path, &xml).map_err(|e| format!("Failed to write WLAN profile: {}", e))?;

    let result = run_cmd("netsh", &["wlan", "add", "profile", "filename", &profile_path.to_string_lossy()]);
    if let Err(ref e) = result {
        let _ = std::fs::remove_file(&profile_path);
        return Err(format!("Failed to add WLAN profile: {}", e));
    }

    let connect = run_cmd("netsh", &["wlan", "connect", "name", ssid]);
    let _ = std::fs::remove_file(&profile_path);

    connect.map(|_| ()).map_err(|e| format!("Failed to connect: {}", e))
}

pub async fn disconnect_wifi() -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            run_cmd("netsh", &["wlan", "disconnect"]).map(|_| ()).map_err(|e| format!("Failed to disconnect: {}", e))
        }
        #[cfg(not(target_os = "windows"))]
        {
            Err("Wi-Fi disconnect is only supported on Windows".to_string())
        }
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

pub async fn toggle_adapter(name: String, enabled: bool) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            let state_str = if enabled { "Enable" } else { "Disable" };
            // Try PowerShell first (works on more adapter types like VPN), fallback to netsh
            let script = format!("{}-NetAdapter -Name '{}' -Confirm:$false", state_str, name.replace('\'', "''"));
            let ps_result = run_powershell(&script);
            match ps_result {
                Ok(_) => Ok(()),
                Err(ps_err) => {
                    let ns_state = if enabled { "enable" } else { "disable" };
                    let out = run_cmd("netsh", &["interface", "set", "interface", "name", &name, &format!("admin={}", ns_state)]);
                    match out {
                        Ok(_) => Ok(()),
                        Err(ns_err) => {
                            let combined = format!("PowerShell: {}, netsh: {}", ps_err, ns_err);
                            if combined.contains("denied") || combined.contains("Access") {
                                Err("Administrator privileges required to toggle network adapters".to_string())
                            } else {
                                Err(combined)
                            }
                        }
                    }
                }
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = (name, enabled);
            Err("Adapter toggle is only supported on Windows".to_string())
        }
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

pub async fn flush_dns() -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            let out = run_cmd("ipconfig", &["/flushdns"]);
            match out {
                Ok(_) => Ok(()),
                Err(e) => {
                    if e.contains("denied") || e.contains("Access denied") || e.contains("admin") {
                        Err("Administrator privileges required to flush DNS".to_string())
                    } else {
                        Err(e)
                    }
                }
            }
        }
        #[cfg(target_os = "macos")]
        {
            run_cmd("dscacheutil", &["-flushcache"]).map(|_| ()).map_err(|e| {
                if e.contains("denied") || e.contains("Permission denied") {
                    "Administrator privileges required to flush DNS".to_string()
                } else { e }
            })
        }
        #[cfg(target_os = "linux")]
        {
            let result = run_cmd("resolvectl", &["flush-caches"]);
            match result {
                Ok(_) => Ok(()),
                Err(_) => {
                    run_cmd("systemd-resolve", &["--flush-caches"]).map(|_| ()).map_err(|e| {
                        if e.contains("denied") || e.contains("Permission denied") {
                            "Administrator privileges required to flush DNS".to_string()
                        } else { e }
                    })
                }
            }
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        Err("DNS flush not supported on this OS".to_string())
    }).await.map_err(|e| format!("Task join error: {}", e))?
}

// --- Axum Handlers ---

pub async fn network_status_handler() -> impl IntoResponse {
    match get_network_status().await {
        Ok(status) => Json(json!({ "success": true, "data": status })).into_response(),
        Err(e) => (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "success": false, "message": e }))).into_response(),
    }
}

pub async fn flush_dns_handler() -> impl IntoResponse {
    match flush_dns().await {
        Ok(_) => Json(json!({ "success": true })).into_response(),
        Err(e) => (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "success": false, "message": e }))).into_response(),
    }
}

pub async fn adapter_handler(Json(req): Json<AdapterRequest>) -> impl IntoResponse {
    match toggle_adapter(req.name, req.enabled).await {
        Ok(_) => Json(json!({ "success": true })).into_response(),
        Err(e) => (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "success": false, "message": e }))).into_response(),
    }
}

pub async fn wifi_scan_handler() -> impl IntoResponse {
    match scan_wifi().await {
        Ok(networks) => Json(json!({ "success": true, "data": networks })).into_response(),
        Err(e) => (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "success": false, "message": e }))).into_response(),
    }
}

pub async fn wifi_connect_handler(Json(req): Json<WifiConnectRequest>) -> impl IntoResponse {
    match connect_wifi(req.ssid, req.password, req.security_type).await {
        Ok(_) => Json(json!({ "success": true })).into_response(),
        Err(e) => (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "success": false, "message": e }))).into_response(),
    }
}

pub async fn wifi_disconnect_handler() -> impl IntoResponse {
    match disconnect_wifi().await {
        Ok(_) => Json(json!({ "success": true })).into_response(),
        Err(e) => (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "success": false, "message": e }))).into_response(),
    }
}
