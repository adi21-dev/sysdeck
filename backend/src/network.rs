use axum::response::{IntoResponse, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tracing;

use crate::hardware::run_cmd;

#[link(name = "dnsapi")]
extern "system" {
    fn DnsFlushResolverCache() -> i32;
}

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

pub async fn get_network_status() -> Result<NetworkStatus, String> {
    tokio::task::spawn_blocking(move || unsafe { get_windows_network_status() })
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

unsafe fn get_windows_network_status() -> Result<NetworkStatus, String> {
    use windows_sys::Win32::Foundation::{ERROR_BUFFER_OVERFLOW, ERROR_SUCCESS};
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetAdaptersAddresses, GAA_FLAG_SKIP_ANYCAST, GAA_FLAG_SKIP_MULTICAST,
        IF_TYPE_ETHERNET_CSMACD, IF_TYPE_IEEE80211, IF_TYPE_SOFTWARE_LOOPBACK,
        IP_ADAPTER_ADDRESSES_LH,
    };
    use windows_sys::Win32::NetworkManagement::Ndis::IfOperStatusUp;

    let mut buf_len: u32 = 0;
    let ret = GetAdaptersAddresses(
        0u32,
        0,
        std::ptr::null(),
        std::ptr::null_mut(),
        &mut buf_len,
    );

    if ret != ERROR_BUFFER_OVERFLOW && ret != ERROR_SUCCESS {
        return Err("GetAdaptersAddresses (size check) failed".to_string());
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
        return Err(format!("GetAdaptersAddresses failed: {}", ret));
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
            while *adapter.FriendlyName.add(len) != 0 {
                len += 1;
            }
            String::from_utf16_lossy(std::slice::from_raw_parts(adapter.FriendlyName, len))
        } else {
            String::new()
        };

        let type_str = if adapter.IfType == IF_TYPE_IEEE80211 {
            has_wifi = true;
            "wifi"
        } else if adapter.IfType == IF_TYPE_ETHERNET_CSMACD {
            has_ethernet = true;
            "ethernet"
        } else if adapter.IfType == IF_TYPE_SOFTWARE_LOOPBACK {
            "loopback"
        } else {
            "unknown"
        };

        let status = if adapter.OperStatus == IfOperStatusUp {
            "up"
        } else {
            "down"
        };

        let mac_len = adapter.PhysicalAddressLength.min(8) as usize;
        let mac = if mac_len > 0 {
            std::slice::from_raw_parts(adapter.PhysicalAddress.as_ptr(), mac_len)
                .iter()
                .map(|b| format!("{:02X}", b))
                .collect::<Vec<_>>()
                .join(":")
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
                    let segs: Vec<String> = ipb
                        .chunks(2)
                        .map(|c| format!("{:02x}{:02x}", c[0], c[1]))
                        .collect();
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
        if status == "up" && !addr_v4.is_empty() && ipv4.is_empty() {
            ipv4 = addr_v4.clone();
        }
        if status == "up" && addr_v6.is_some() && ipv6.is_none() {
            ipv6 = addr_v6.clone();
        }

        interfaces.push(InterfaceInfo {
            name,
            status: status.to_string(),
            interface_type: type_str.to_string(),
            mac,
            ipv4: addr_v4,
        });

        cur = adapter.Next;
    }

    let connection_type = if has_wifi {
        "wifi".to_string()
    } else if has_ethernet {
        "ethernet".to_string()
    } else {
        "unknown".to_string()
    };
    let internet = if default_gateway.is_empty() {
        None
    } else {
        Some(true)
    };

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

pub async fn scan_wifi() -> Result<Vec<WifiNetwork>, String> {
    tokio::task::spawn_blocking(scan_wifi_windows)
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

fn scan_wifi_windows() -> Result<Vec<WifiNetwork>, String> {
    use windows_sys::Win32::NetworkManagement::WiFi::*;
    unsafe {
        let mut handle: *mut core::ffi::c_void = std::ptr::null_mut();
        let mut negotiated: u32 = 0;
        let ret = WlanOpenHandle(2, std::ptr::null(), &mut negotiated, &mut handle);
        if ret != 0 {
            return Err("WlanOpenHandle failed".to_string());
        }

        let mut iface_list: *mut WLAN_INTERFACE_INFO_LIST = std::ptr::null_mut();
        if WlanEnumInterfaces(handle, std::ptr::null(), &mut iface_list) != 0
            || iface_list.is_null()
        {
            WlanCloseHandle(handle, std::ptr::null());
            return Err("No WLAN interfaces found".to_string());
        }

        let iface = &*iface_list;
        if iface.dwNumberOfItems == 0 {
            WlanFreeMemory(iface_list as *mut _);
            WlanCloseHandle(handle, std::ptr::null());
            return Err("No WLAN interfaces".to_string());
        }
        let guid = iface.InterfaceInfo[0].InterfaceGuid;

        WlanScan(
            handle,
            &guid,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
        );
        std::thread::sleep(std::time::Duration::from_millis(1500));

        let mut avail_list: *mut WLAN_AVAILABLE_NETWORK_LIST = std::ptr::null_mut();
        let ret = WlanGetAvailableNetworkList(handle, &guid, 0, std::ptr::null(), &mut avail_list);
        WlanFreeMemory(iface_list as *mut _);

        if ret != 0 || avail_list.is_null() {
            WlanCloseHandle(handle, std::ptr::null());
            return Err("Failed to get available networks".to_string());
        }

        let list = &*avail_list;
        let mut networks = Vec::with_capacity(list.dwNumberOfItems as usize);
        for i in 0..list.dwNumberOfItems as usize {
            let net = &list.Network[i];
            let ssid_len = net.dot11Ssid.uSSIDLength.min(32) as usize;
            if ssid_len == 0 {
                continue;
            }
            let ssid = String::from_utf8_lossy(&net.dot11Ssid.ucSSID[..ssid_len]).to_string();
            if ssid.is_empty() {
                continue;
            }

            let auth_str = match net.dot11DefaultAuthAlgorithm {
                DOT11_AUTH_ALGO_80211_SHARED_KEY => "WPA",
                DOT11_AUTH_ALGO_WPA => "WPA",
                DOT11_AUTH_ALGO_WPA_PSK => "WPA-PSK",
                DOT11_AUTH_ALGO_RSNA => "WPA2",
                DOT11_AUTH_ALGO_RSNA_PSK => "WPA2-PSK",
                _ => "Open",
            };

            networks.push(WifiNetwork {
                ssid,
                signal_strength: net.wlanSignalQuality,
                security_type: auth_str.to_string(),
                connected: (net.dwFlags & 1) != 0,
            });
        }

        WlanFreeMemory(avail_list as *mut _);
        WlanCloseHandle(handle, std::ptr::null());
        Ok(networks)
    }
}

pub async fn connect_wifi(
    ssid: String,
    password: Option<String>,
    security_type: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        connect_wifi_windows(&ssid, password.as_deref(), &security_type)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

fn connect_wifi_windows(
    ssid: &str,
    password: Option<&str>,
    security_type: &str,
) -> Result<(), String> {
    use windows_sys::Win32::NetworkManagement::WiFi::*;
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

    unsafe {
        let mut handle: *mut core::ffi::c_void = std::ptr::null_mut();
        let mut negotiated: u32 = 0;
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

        // Add profile via WlanSetProfile (no file write or netsh needed)
        let xml_wide: Vec<u16> = xml.encode_utf16().chain(std::iter::once(0)).collect();
        let mut reason: u32 = 0;
        let ret = WlanSetProfile(
            handle,
            &guid,
            0,
            xml_wide.as_ptr(),
            std::ptr::null(),
            1,
            std::ptr::null(),
            &mut reason,
        );
        if ret != 0 {
            WlanCloseHandle(handle, std::ptr::null());
            return Err(format!("WlanSetProfile failed: error {}", ret));
        }

        // Connect using profile name
        let profile_wide: Vec<u16> = ssid.encode_utf16().chain(std::iter::once(0)).collect();
        let params = WLAN_CONNECTION_PARAMETERS {
            wlanConnectionMode: 1, // wlan_connection_mode_profile
            strProfile: profile_wide.as_ptr() as *mut u16,
            pDot11Ssid: std::ptr::null_mut(),
            pDesiredBssidList: std::ptr::null_mut(),
            dot11BssType: 0, // dot11_BSS_type_any
            dwFlags: 0,
        };
        let ret = WlanConnect(handle, &guid, &params, std::ptr::null());
        WlanCloseHandle(handle, std::ptr::null());
        if ret != 0 {
            Err(format!("WlanConnect failed: error {}", ret))
        } else {
            Ok(())
        }
    }
}

pub async fn disconnect_wifi() -> Result<(), String> {
    tokio::task::spawn_blocking(disconnect_wifi_windows)
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

fn disconnect_wifi_windows() -> Result<(), String> {
    use windows_sys::Win32::NetworkManagement::WiFi::*;
    unsafe {
        let mut handle: *mut core::ffi::c_void = std::ptr::null_mut();
        let mut negotiated: u32 = 0;
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
        let ret = WlanDisconnect(handle, &guid, std::ptr::null());
        WlanCloseHandle(handle, std::ptr::null());
        if ret != 0 {
            Err(format!("WlanDisconnect failed: {}", ret))
        } else {
            Ok(())
        }
    }
}

pub async fn toggle_adapter(name: String, enabled: bool) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let ns_state = if enabled { "enable" } else { "disable" };
        let out = run_cmd(
            "netsh",
            &[
                "interface",
                "set",
                "interface",
                "name=",
                &name,
                "admin=",
                ns_state,
            ],
        );
        match out {
            Ok(_) => Ok(()),
            Err(e) => {
                if e.contains("denied") || e.contains("Access") {
                    Err("Administrator privileges required to toggle network adapters".to_string())
                } else {
                    Err(e)
                }
            }
        }
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

pub async fn flush_dns() -> Result<(), String> {
    tokio::task::spawn_blocking(move || unsafe {
        if DnsFlushResolverCache() != 0 {
            Ok(())
        } else {
            Err("Failed to flush DNS cache".to_string())
        }
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

// --- Axum Handlers ---

pub async fn network_status_handler() -> impl IntoResponse {
    match get_network_status().await {
        Ok(status) => Json(json!({ "success": true, "data": status })).into_response(),
        Err(e) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "success": false, "message": e })),
        )
            .into_response(),
    }
}

pub async fn flush_dns_handler() -> impl IntoResponse {
    tracing::info!("DNS flush requested");
    match flush_dns().await {
        Ok(_) => Json(json!({ "success": true })).into_response(),
        Err(e) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "success": false, "message": e })),
        )
            .into_response(),
    }
}

pub async fn adapter_handler(Json(req): Json<AdapterRequest>) -> impl IntoResponse {
    tracing::info!(adapter = %req.name, enabled = req.enabled, "Adapter toggle requested");
    match toggle_adapter(req.name, req.enabled).await {
        Ok(_) => Json(json!({ "success": true })).into_response(),
        Err(e) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "success": false, "message": e })),
        )
            .into_response(),
    }
}

pub async fn wifi_scan_handler() -> impl IntoResponse {
    match scan_wifi().await {
        Ok(networks) => Json(json!({ "success": true, "data": networks })).into_response(),
        Err(e) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "success": false, "message": e })),
        )
            .into_response(),
    }
}

pub async fn wifi_connect_handler(Json(req): Json<WifiConnectRequest>) -> impl IntoResponse {
    tracing::info!(ssid = %req.ssid, "WiFi connect requested");
    match connect_wifi(req.ssid, req.password, req.security_type).await {
        Ok(_) => Json(json!({ "success": true })).into_response(),
        Err(e) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "success": false, "message": e })),
        )
            .into_response(),
    }
}

pub async fn wifi_disconnect_handler() -> impl IntoResponse {
    tracing::info!("WiFi disconnect requested");
    match disconnect_wifi().await {
        Ok(_) => Json(json!({ "success": true })).into_response(),
        Err(e) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "success": false, "message": e })),
        )
            .into_response(),
    }
}
