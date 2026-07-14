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

#[allow(non_upper_case_globals)]
fn list_sessions_impl() -> Vec<SessionInfo> {
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
                let len = (user_bytes as usize) / 2;
                let slice = std::slice::from_raw_parts(user_buf, len);
                let s = String::from_utf16_lossy(slice);
                WTSFreeMemory(user_buf as *mut _);
                s
            } else {
                String::new()
            }
        };

        let state = match s.State {
            WTSActive => "Active",
            WTSDisconnected => "Disconnected",
            _ => "Other",
        };

        result.push(SessionInfo {
            session_id: s.SessionId,
            username,
            state: state.to_string(),
        });
    }

    unsafe {
        WTSFreeMemory(sessions_ptr as *mut _);
    }

    result
}

pub async fn list_handler(State(_state): State<AppState>) -> Json<serde_json::Value> {
    let sessions = tokio::task::spawn_blocking(list_sessions_impl)
        .await
        .unwrap_or_default();
    Json(json!({"success": true, "sessions": sessions}))
}

#[derive(Deserialize)]
pub struct SessionAction {
    pub session_id: u32,
    pub action: String,
}

pub async fn action_handler(Json(body): Json<SessionAction>) -> impl IntoResponse {
    use windows_sys::Win32::System::RemoteDesktop::{
        WTSDisconnectSession, WTSLogoffSession, WTS_CURRENT_SERVER_HANDLE,
    };

    let result = match body.action.as_str() {
        "disconnect" => unsafe {
            WTSDisconnectSession(WTS_CURRENT_SERVER_HANDLE, body.session_id, 0)
        },
        "logoff" => unsafe { WTSLogoffSession(WTS_CURRENT_SERVER_HANDLE, body.session_id, 0) },
        _ => return Json(json!({"success": false, "message": "Unknown action"})).into_response(),
    };

    if result != 0 {
        Json(json!({"success": true})).into_response()
    } else {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"success": false, "message": "Failed to perform action"})),
        )
            .into_response()
    }
}
