use std::ffi::c_void;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json};
use serde::Serialize;
use serde_json::json;

use crate::AppState;

#[derive(Debug, Serialize, Clone)]
pub struct WindowInfo {
    pub hwnd: isize,
    pub title: String,
    pub exe_path: String,
}

unsafe fn get_window_exe_path(hwnd: *mut c_void) -> String {
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;
    let mut pid: u32 = 0;
    GetWindowThreadProcessId(hwnd, &mut pid);
    if pid == 0 {
        return String::new();
    }
    let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
    if handle.is_null() {
        return String::new();
    }
    let mut buf = [0u16; 1024];
    let mut size = 1024u32;
    let ret = QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut size);
    let _ = windows_sys::Win32::Foundation::CloseHandle(handle);
    if ret == 0 {
        return String::new();
    }
    String::from_utf16_lossy(&buf[..size as usize])
}

unsafe extern "system" fn enum_window_callback(hwnd: *mut c_void, lparam: isize) -> i32 {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetWindowTextW, IsWindowVisible};
    let mut buf = [0u16; 512];
    let len = GetWindowTextW(hwnd, buf.as_mut_ptr(), 512);
    if len > 0 && IsWindowVisible(hwnd) != 0 {
        let title = String::from_utf16_lossy(&buf[..len as usize]);
        let exe_path = get_window_exe_path(hwnd);
        let list = &mut *(lparam as *mut Vec<WindowInfo>);
        list.push(WindowInfo {
            hwnd: hwnd as isize,
            title,
            exe_path,
        });
    }
    1
}

pub fn list_windows() -> Vec<WindowInfo> {
    use windows_sys::Win32::UI::WindowsAndMessaging::EnumWindows;
    let mut result: Vec<WindowInfo> = Vec::new();
    unsafe {
        EnumWindows(
            Some(enum_window_callback),
            &mut result as *mut Vec<WindowInfo> as isize,
        );
    }
    result.sort_by_key(|a| a.title.to_lowercase());
    result
}

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

fn close_window(hwnd: isize) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{SendMessageW, WM_CLOSE};
    unsafe {
        SendMessageW(hwnd as *mut c_void, WM_CLOSE, 0, 0);
    }
    Ok(())
}

fn minimize_window(hwnd: isize) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_MINIMIZE};
    unsafe {
        ShowWindow(hwnd as *mut c_void, SW_MINIMIZE);
    }
    Ok(())
}

fn restore_window(hwnd: isize) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_RESTORE};
    unsafe {
        ShowWindow(hwnd as *mut c_void, SW_RESTORE);
    }
    Ok(())
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
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(json!({"success": false, "message": e})),
        )
            .into_response(),
    }
}

pub async fn close_handler(
    State(_state): State<AppState>,
    Json(body): Json<WindowTarget>,
) -> impl IntoResponse {
    match close_window(body.hwnd) {
        Ok(()) => Json(json!({"success": true})).into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(json!({"success": false, "message": e})),
        )
            .into_response(),
    }
}

pub async fn minimize_handler(
    State(_state): State<AppState>,
    Json(body): Json<WindowTarget>,
) -> impl IntoResponse {
    match minimize_window(body.hwnd) {
        Ok(()) => Json(json!({"success": true})).into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(json!({"success": false, "message": e})),
        )
            .into_response(),
    }
}

pub async fn restore_handler(
    State(_state): State<AppState>,
    Json(body): Json<WindowTarget>,
) -> impl IntoResponse {
    match restore_window(body.hwnd) {
        Ok(()) => Json(json!({"success": true})).into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(json!({"success": false, "message": e})),
        )
            .into_response(),
    }
}
