use std::collections::HashMap;

use crate::auth;
use crate::db;
use crate::AppState;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json, Response};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// --- Setup State ---

#[derive(Clone)]
pub struct SetupFlow {
    pub password_hash: String,
    pub totp_secret: Vec<u8>,
    pub recovery_codes: Vec<String>,
    pub recovery_code_hashes: Vec<String>,
    pub relay_opt_in: bool,
    pub step: &'static str,
}

pub struct SetupManager {
    inner: std::sync::Mutex<HashMap<String, SetupFlow>>,
}

impl SetupManager {
    #[allow(clippy::new_without_default)]
    pub fn new() -> Self {
        Self {
            inner: std::sync::Mutex::new(HashMap::new()),
        }
    }

    pub fn create(&self, flow: SetupFlow) -> String {
        let token = Uuid::new_v4().to_string();
        let mut map = self.inner.lock().unwrap();
        map.insert(token.clone(), flow);
        token
    }

    pub fn get(&self, token: &str) -> Option<SetupFlow> {
        let map = self.inner.lock().unwrap();
        map.get(token).cloned()
    }

    pub fn remove(&self, token: &str) -> Option<SetupFlow> {
        let mut map = self.inner.lock().unwrap();
        map.remove(token)
    }
}

// --- JSON API types ---

#[derive(Deserialize)]
pub struct PasswordRequest {
    pub password: String,
}

#[derive(Deserialize)]
pub struct TotpCodeRequest {
    pub code: String,
}

#[derive(Deserialize)]
pub struct ProgressQuery {
    pub token: String,
}

#[derive(Serialize)]
pub(crate) struct SetupStatus {
    is_setup_complete: bool,
}

pub(crate) async fn setup_status_handler(State(state): State<AppState>) -> Json<SetupStatus> {
    let is_setup_complete = {
        let conn = state.db.lock().await;
        db::is_setup_complete(&conn).unwrap_or(false)
    };
    Json(SetupStatus { is_setup_complete })
}

// --- JSON API Handlers ---

pub async fn api_password_handler(
    State(state): State<AppState>,
    Json(body): Json<PasswordRequest>,
) -> Response {
    if body.password.len() < 8 {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"success": false, "error": "Password must be at least 8 characters"}))).into_response();
    }
    if let Err(e) = auth::check_password_strength(&body.password) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"success": false, "error": e})),
        )
            .into_response();
    }
    let password_hash = match auth::hash_password(&body.password) {
        Ok(h) => h,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"success": false, "error": e})),
            )
                .into_response()
        }
    };
    let totp_secret = auth::generate_totp_secret();
    let flow = SetupFlow {
        password_hash,
        totp_secret,
        recovery_codes: Vec::new(),
        recovery_code_hashes: Vec::new(),
        relay_opt_in: false,
        step: "verify_totp",
    };
    let token = state.setup_manager.create(flow);
    Json(serde_json::json!({"success": true, "token": token})).into_response()
}

pub async fn api_totp_handler(
    State(state): State<AppState>,
    Query(query): Query<ProgressQuery>,
) -> Response {
    let flow = match state.setup_manager.get(&query.token) {
        Some(f) => f,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"success": false, "error": "Invalid or expired token"})),
            )
                .into_response()
        }
    };
    let qr_svg = auth::generate_totp_qr_data_uri(&flow.totp_secret);
    let secret = auth::totp_secret_to_b32(&flow.totp_secret);
    Json(serde_json::json!({"success": true, "qr_svg": qr_svg, "secret": secret})).into_response()
}

pub async fn api_verify_totp_handler(
    State(state): State<AppState>,
    Query(query): Query<ProgressQuery>,
    Json(body): Json<TotpCodeRequest>,
) -> Response {
    let flow = match state.setup_manager.remove(&query.token) {
        Some(f) => f,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"success": false, "error": "Invalid or expired token"})),
            )
                .into_response()
        }
    };
    if !auth::verify_totp_code(&flow.totp_secret, &body.code) {
        let new_token = state.setup_manager.create(flow);
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"success": false, "error": "Invalid TOTP code", "token": new_token}))).into_response();
    }
    let plain_codes = auth::generate_recovery_codes();
    let code_hashes = match auth::hash_recovery_codes(&plain_codes) {
        Ok(h) => h,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"success": false, "error": e})),
            )
                .into_response()
        }
    };
    let flow = SetupFlow {
        password_hash: flow.password_hash,
        totp_secret: flow.totp_secret,
        recovery_codes: plain_codes.clone(),
        recovery_code_hashes: code_hashes,
        relay_opt_in: false,
        step: "confirm_codes",
    };
    let new_token = state.setup_manager.create(flow);
    Json(serde_json::json!({"success": true, "codes": plain_codes, "token": new_token}))
        .into_response()
}

pub async fn api_recovery_codes_handler(
    Query(query): Query<ProgressQuery>,
    State(state): State<AppState>,
) -> Response {
    let flow = match state.setup_manager.get(&query.token) {
        Some(f) => f,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"success": false, "error": "Invalid or expired token"})),
            )
                .into_response()
        }
    };
    Json(serde_json::json!({"success": true, "codes": flow.recovery_codes})).into_response()
}

#[derive(Deserialize)]
pub struct RelayRequest {
    pub enabled: bool,
}

pub async fn api_relay_handler(
    State(state): State<AppState>,
    Query(query): Query<ProgressQuery>,
    Json(body): Json<RelayRequest>,
) -> Response {
    let flow = match state.setup_manager.remove(&query.token) {
        Some(f) => f,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"success": false, "error": "Invalid or expired token"})),
            )
                .into_response()
        }
    };
    let flow = SetupFlow {
        password_hash: flow.password_hash,
        totp_secret: flow.totp_secret,
        recovery_codes: flow.recovery_codes,
        recovery_code_hashes: flow.recovery_code_hashes,
        relay_opt_in: body.enabled,
        step: "finish",
    };
    let new_token = state.setup_manager.create(flow);
    Json(serde_json::json!({"success": true, "token": new_token})).into_response()
}

pub async fn api_finish_handler(
    State(state): State<AppState>,
    Query(query): Query<ProgressQuery>,
) -> Response {
    let flow = match state.setup_manager.remove(&query.token) {
        Some(f) => f,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"success": false, "error": "Invalid or expired token"})),
            )
                .into_response()
        }
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    let totp_b32 = auth::totp_secret_to_b32(&flow.totp_secret);
    let conn = state.db.lock().await;
    let _ = conn.execute("DELETE FROM sessions", []);
    let _ = conn.execute("DELETE FROM recovery_codes", []);
    let _ = conn.execute("DELETE FROM users", []);
    if let Err(e) = conn.execute(
        "INSERT INTO users (id, password_hash, totp_secret, created_at, updated_at) VALUES (1, ?1, ?2, ?3, ?4)",
        rusqlite::params![flow.password_hash, totp_b32, now, now],
    ) {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"success": false, "error": format!("Failed to create user: {}", e)}))).into_response();
    }
    for hash in &flow.recovery_code_hashes {
        let _ = conn.execute(
            "INSERT INTO recovery_codes (code_hash, used, created_at) VALUES (?1, 0, ?2)",
            rusqlite::params![hash, now],
        );
    }
    let _ = db::set_setting(
        &conn,
        "relay_opt_in",
        if flow.relay_opt_in { "true" } else { "false" },
    );
    state.lockout.clear_failures(1);
    let _ = db::insert_audit_log(
        &conn,
        "setup_complete",
        Some("Initial setup completed"),
        None,
    );
    let _ = db::wal_checkpoint(&conn);
    drop(conn);
    Json(serde_json::json!({"success": true})).into_response()
}

pub async fn api_progress_handler(
    Query(query): Query<ProgressQuery>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let flow = state.setup_manager.get(&query.token);
    match flow {
        Some(f) => {
            let step_num = match f.step {
                "verify_totp" => 2,
                "confirm_codes" => 3,
                "relay_opt_in" | "finish" => 4,
                _ => 1,
            };
            Json(serde_json::json!({"success": true, "current_step": step_num}))
        }
        None => Json(serde_json::json!({"success": false, "error": "Invalid token"})),
    }
}

// --- Setup token for headless/remote setup ---

pub async fn check_token_handler(
    _state: State<AppState>,
    headers: axum::http::HeaderMap,
) -> Json<serde_json::Value> {
    let is_tunneled = headers.contains_key("cf-connecting-ip") || headers.contains_key("cf-ray");
    Json(serde_json::json!({"token_required": is_tunneled}))
}

#[derive(Deserialize)]
pub struct VerifyTokenRequest {
    pub token: String,
}

pub async fn verify_setup_token_handler(
    State(state): State<AppState>,
    Json(body): Json<VerifyTokenRequest>,
) -> Json<serde_json::Value> {
    let valid = body.token == *state.setup_token;
    Json(serde_json::json!({"success": valid}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_setup_manager_create_and_get() {
        let manager = SetupManager::new();
        let flow = SetupFlow {
            password_hash: "hash".to_string(),
            totp_secret: vec![1, 2, 3],
            recovery_codes: vec!["code1".to_string()],
            recovery_code_hashes: vec!["hash1".to_string()],
            relay_opt_in: false,
            step: "verify_totp",
        };
        let token = manager.create(flow.clone());
        let retrieved = manager.get(&token);
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().password_hash, flow.password_hash);
    }

    #[test]
    fn test_setup_manager_get_nonexistent() {
        let manager = SetupManager::new();
        assert!(manager.get("nonexistent").is_none());
    }

    #[test]
    fn test_setup_manager_remove() {
        let manager = SetupManager::new();
        let flow = SetupFlow {
            password_hash: "hash".to_string(),
            totp_secret: vec![1, 2, 3],
            recovery_codes: vec![],
            recovery_code_hashes: vec![],
            relay_opt_in: false,
            step: "password",
        };
        let token = manager.create(flow);
        let removed = manager.remove(&token);
        assert!(removed.is_some());
        assert!(manager.get(&token).is_none());
    }

    #[test]
    fn test_setup_manager_remove_nonexistent() {
        let manager = SetupManager::new();
        assert!(manager.remove("nonexistent").is_none());
    }

    #[test]
    fn test_setup_flow_clone() {
        let flow = SetupFlow {
            password_hash: "hash".to_string(),
            totp_secret: vec![1, 2, 3],
            recovery_codes: vec!["rc1".to_string()],
            recovery_code_hashes: vec!["rch1".to_string()],
            relay_opt_in: false,
            step: "verify_totp",
        };
        let cloned = flow.clone();
        assert_eq!(flow.password_hash, cloned.password_hash);
        assert_eq!(flow.totp_secret, cloned.totp_secret);
        assert_eq!(flow.recovery_codes, cloned.recovery_codes);
        assert_eq!(flow.recovery_code_hashes, cloned.recovery_code_hashes);
        assert_eq!(flow.step, cloned.step);
    }
}
