use std::ffi::c_void;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json};
use serde::Serialize;
use serde_json::json;
use std::sync::Mutex;

use crate::AppState;

#[derive(Debug, Serialize, Clone)]
pub struct WindowInfo {
    pub hwnd: isize,
    pub title: String,
}

// --- Windows implementation ---

#[cfg(target_os = "windows")]
static WINDOW_BUF: Mutex<Vec<WindowInfo>> = Mutex::new(Vec::new());

#[cfg(target_os = "windows")]
unsafe extern "system" fn enum_window_callback(hwnd: *mut c_void, _lparam: isize) -> i32 {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetWindowTextW, IsWindowVisible};
    let mut buf = [0u16; 512];
    let len = GetWindowTextW(hwnd, buf.as_mut_ptr(), 512);
    if len > 0 && IsWindowVisible(hwnd) != 0 {
        let title = String::from_utf16_lossy(&buf[..len as usize]);
        if let Ok(mut list) = WINDOW_BUF.lock() {
            list.push(WindowInfo {
                hwnd: hwnd as isize,
                title,
            });
        }
    }
    1
}

#[cfg(target_os = "windows")]
fn list_windows() -> Vec<WindowInfo> {
    use windows_sys::Win32::UI::WindowsAndMessaging::EnumWindows;
    {
        let mut buf = WINDOW_BUF.lock().unwrap();
        buf.clear();
    }
    unsafe {
        EnumWindows(Some(enum_window_callback), 0);
    }
    let mut result = WINDOW_BUF.lock().unwrap().clone();
    result.sort_by_key(|a| a.title.to_lowercase());
    result
}

#[cfg(target_os = "windows")]
fn focus_window(hwnd: isize) -> Result<(), String> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        keybd_event, KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::SetForegroundWindow;
    // ponytail: Alt-key focus-stealing prevention hack
    unsafe {
        keybd_event(0x12u8, 0, KEYEVENTF_EXTENDEDKEY, 0);
        keybd_event(0x12u8, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0);
        if SetForegroundWindow(hwnd as *mut c_void) == 0 {
            return Err("SetForegroundWindow failed".to_string());
        }
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn close_window(hwnd: isize) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{SendMessageW, WM_CLOSE};
    unsafe {
        SendMessageW(hwnd as *mut c_void, WM_CLOSE, 0, 0);
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn minimize_window(hwnd: isize) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_MINIMIZE};
    unsafe {
        ShowWindow(hwnd as *mut c_void, SW_MINIMIZE);
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn restore_window(hwnd: isize) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_RESTORE};
    unsafe {
        ShowWindow(hwnd as *mut c_void, SW_RESTORE);
    }
    Ok(())
}

// --- Non-Windows stubs ---

#[cfg(not(target_os = "windows"))]
fn list_windows() -> Vec<WindowInfo> {
    vec![]
}

#[cfg(not(target_os = "windows"))]
fn focus_window(_hwnd: isize) -> Result<(), String> {
    Err("Not supported".to_string())
}

#[cfg(not(target_os = "windows"))]
fn close_window(_hwnd: isize) -> Result<(), String> {
    Err("Not supported".to_string())
}

#[cfg(not(target_os = "windows"))]
fn minimize_window(_hwnd: isize) -> Result<(), String> {
    Err("Not supported".to_string())
}

#[cfg(not(target_os = "windows"))]
fn restore_window(_hwnd: isize) -> Result<(), String> {
    Err("Not supported".to_string())
}

// --- Handlers ---

pub async fn list_handler(State(_state): State<AppState>) -> Json<serde_json::Value> {
    let windows = tokio::task::spawn_blocking(list_windows)
        .await
        .unwrap_or_default();
    Json(json!({"success": true, "windows": windows}))
}

#[derive(serde::Deserialize)]
pub struct WindowTarget {
    pub hwnd: isize,
}

pub async fn focus_handler(
    State(_state): State<AppState>,
    Json(body): Json<WindowTarget>,
) -> impl IntoResponse {
    match focus_window(body.hwnd) {
        Ok(()) => Json(json!({"success": true})).into_response(),
        Err(e) => {
            (StatusCode::BAD_REQUEST, Json(json!({"success": false, "message": e}))).into_response()
        }
    }
}

pub async fn close_handler(
    State(_state): State<AppState>,
    Json(body): Json<WindowTarget>,
) -> impl IntoResponse {
    match close_window(body.hwnd) {
        Ok(()) => Json(json!({"success": true})).into_response(),
        Err(e) => {
            (StatusCode::BAD_REQUEST, Json(json!({"success": false, "message": e}))).into_response()
        }
    }
}

pub async fn minimize_handler(
    State(_state): State<AppState>,
    Json(body): Json<WindowTarget>,
) -> impl IntoResponse {
    match minimize_window(body.hwnd) {
        Ok(()) => Json(json!({"success": true})).into_response(),
        Err(e) => {
            (StatusCode::BAD_REQUEST, Json(json!({"success": false, "message": e}))).into_response()
        }
    }
}

pub async fn restore_handler(
    State(_state): State<AppState>,
    Json(body): Json<WindowTarget>,
) -> impl IntoResponse {
    match restore_window(body.hwnd) {
        Ok(()) => Json(json!({"success": true})).into_response(),
        Err(e) => {
            (StatusCode::BAD_REQUEST, Json(json!({"success": false, "message": e}))).into_response()
        }
    }
}
