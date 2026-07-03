use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::AppState;

#[derive(Serialize)]
pub struct SessionInfo {
    pub session_id: u32,
    pub username: String,
    pub state: String,
}

#[cfg(target_os = "windows")]
#[allow(non_upper_case_globals)]
fn list_sessions_impl() -> Vec<SessionInfo> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::System::RemoteDesktop::{
        WTSActive, WTSDisconnected, WTSEnumerateSessionsW, WTSFreeMemory,
        WTSQuerySessionInformationW, WTSUserName, WTS_CURRENT_SERVER_HANDLE,
    };

    let mut sessions_ptr: *mut windows_sys::Win32::System::RemoteDesktop::WTS_SESSION_INFOW =
        std::ptr::null_mut();
    let mut count: u32 = 0;

    let ok = unsafe {
        WTSEnumerateSessionsW(
            WTS_CURRENT_SERVER_HANDLE,
            0,
            1,
            &mut sessions_ptr,
            &mut count,
        )
    };

    if ok == 0 || sessions_ptr.is_null() {
        return vec![];
    }

    let sessions_slice = unsafe { std::slice::from_raw_parts(sessions_ptr, count as usize) };

    let mut result = Vec::with_capacity(count as usize);

    for s in sessions_slice {
        // Get username
        let mut user_buf: *mut u16 = std::ptr::null_mut();
        let mut user_bytes: u32 = 0;
        let username = unsafe {
            if WTSQuerySessionInformationW(
                WTS_CURRENT_SERVER_HANDLE,
                s.SessionId,
                WTSUserName,
                &mut user_buf,
                &mut user_bytes,
            ) != 0
                && !user_buf.is_null()
            {
                let len = (user_bytes / 2) as usize;
                let slice = std::slice::from_raw_parts(user_buf, len);
                // Strip null terminator
                let effective_len = slice.iter().position(|&c| c == 0).unwrap_or(len);
                OsString::from_wide(&slice[..effective_len])
                    .to_string_lossy()
                    .into_owned()
            } else {
                String::new()
            }
        };
        if !user_buf.is_null() {
            unsafe { WTSFreeMemory(user_buf as *mut _) };
        }

        let state = match s.State {
            WTSActive => "Active".to_string(),
            WTSDisconnected => "Disconnected".to_string(),
            _ => format!("{:?}", s.State),
        };

        result.push(SessionInfo {
            session_id: s.SessionId,
            username,
            state,
        });
    }

    if !sessions_ptr.is_null() {
        unsafe { WTSFreeMemory(sessions_ptr as *mut _) };
    }

    result
}

#[cfg(not(target_os = "windows"))]
fn list_sessions_impl() -> Vec<SessionInfo> {
    vec![]
}

#[cfg(target_os = "windows")]
fn session_action(session_id: u32, action: &str) -> Result<(), String> {
    use windows_sys::Win32::System::RemoteDesktop::{
        WTSDisconnectSession, WTSLogoffSession, WTS_CURRENT_SERVER_HANDLE,
    };
    unsafe {
        match action {
            "logoff" => {
                if WTSLogoffSession(WTS_CURRENT_SERVER_HANDLE, session_id, 0) == 0 {
                    return Err("Logoff failed".to_string());
                }
            }
            "disconnect" => {
                if WTSDisconnectSession(WTS_CURRENT_SERVER_HANDLE, session_id, 0) == 0 {
                    return Err("Disconnect failed".to_string());
                }
            }
            _ => return Err("Unknown action".to_string()),
        }
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn session_action(_session_id: u32, _action: &str) -> Result<(), String> {
    Err("Not supported".to_string())
}

pub async fn list_handler(State(_state): State<AppState>) -> Json<serde_json::Value> {
    let sessions = tokio::task::spawn_blocking(list_sessions_impl)
        .await
        .unwrap_or_default();
    Json(json!({"success": true, "sessions": sessions}))
}

#[derive(Deserialize)]
pub struct SessionActionBody {
    pub session_id: u32,
    pub action: String,
}

pub async fn action_handler(
    State(_state): State<AppState>,
    Json(body): Json<SessionActionBody>,
) -> impl IntoResponse {
    match session_action(body.session_id, &body.action) {
        Ok(()) => Json(json!({"success": true})).into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(json!({"success": false, "message": e})),
        )
            .into_response(),
    }
}
