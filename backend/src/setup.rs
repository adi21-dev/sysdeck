use std::collections::HashMap;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{Html, IntoResponse, Json, Redirect, Response};
use axum::Form;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth;
use crate::db;
use crate::AppState;

// --- Setup State ---

pub struct SetupFlow {
    pub password_hash: String,
    pub totp_secret: Vec<u8>,
    pub recovery_codes: Vec<String>,
    pub recovery_code_hashes: Vec<String>,
    pub step: &'static str,
}

pub struct SetupManager {
    inner: std::sync::Mutex<HashMap<String, SetupFlow>>,
}

impl Default for SetupManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SetupManager {
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

impl Clone for SetupFlow {
    fn clone(&self) -> Self {
        Self {
            password_hash: self.password_hash.clone(),
            totp_secret: self.totp_secret.clone(),
            recovery_codes: self.recovery_codes.clone(),
            recovery_code_hashes: self.recovery_code_hashes.clone(),
            step: self.step,
        }
    }
}

// --- Form Inputs ---

#[derive(Deserialize)]
pub struct SetupForm {
    pub action: String,
    pub password: Option<String>,
    pub password_confirm: Option<String>,
    pub totp_code: Option<String>,
    pub state_token: Option<String>,
    pub relay_optin: Option<String>,
}

// --- Handlers ---

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

pub async fn setup_get_handler(State(state): State<AppState>) -> Response {
    // Check if setup is already complete
    {
        let conn = state.db.lock().await;
        if db::is_setup_complete(&conn).unwrap_or(false) {
            return Redirect::to("/").into_response();
        }
    }
    show_step1().into_response()
}

pub async fn setup_handler(State(state): State<AppState>, Form(form): Form<SetupForm>) -> Response {
    // Check if setup is already complete
    {
        let conn = state.db.lock().await;
        if db::is_setup_complete(&conn).unwrap_or(false) {
            return Redirect::to("/").into_response();
        }
    }

    match form.action.as_str() {
        "password" => handle_password_step(state, form).await,
        "verify_totp" => handle_totp_step(state, form).await,
        "confirm_codes" => handle_confirm_step(state, form).await,
        "finish" => handle_finish_step(state, form).await,
        _ => show_step1().into_response(),
    }
}

async fn handle_password_step(state: AppState, form: SetupForm) -> Response {
    let password = match form.password {
        Some(p) => p,
        None => return show_step1_with_error("Password is required").into_response(),
    };
    let confirm = match form.password_confirm {
        Some(c) => c,
        None => return show_step1_with_error("Password confirmation is required").into_response(),
    };

    if password != confirm {
        return show_step1_with_error("Passwords do not match").into_response();
    }

    if password.len() < 8 {
        return show_step1_with_error("Password must be at least 8 characters").into_response();
    }

    if let Err(e) = auth::check_password_strength(&password) {
        return show_step1_with_error(&e).into_response();
    }

    let password_hash = match auth::hash_password(&password) {
        Ok(h) => h,
        Err(e) => return show_step1_with_error(&e).into_response(),
    };

    let totp_secret = auth::generate_totp_secret();
    let qr_data_uri = auth::generate_totp_qr_data_uri(&totp_secret);
    let totp_b32 = auth::totp_secret_to_b32(&totp_secret);

    let flow = SetupFlow {
        password_hash,
        totp_secret,
        recovery_codes: Vec::new(),
        recovery_code_hashes: Vec::new(),
        step: "verify_totp",
    };

    let token = state.setup_manager.create(flow);

    show_step2(&qr_data_uri, &totp_b32, &token).into_response()
}

async fn handle_totp_step(state: AppState, form: SetupForm) -> Response {
    let token = match form.state_token {
        Some(ref t) => t.clone(),
        None => {
            return show_step1_with_error("Session expired. Please start again.").into_response()
        }
    };

    let flow = match state.setup_manager.remove(&token) {
        Some(f) => f,
        None => {
            return show_step1_with_error("Session expired. Please start again.").into_response()
        }
    };

    let code = match form.totp_code {
        Some(c) => c,
        None => {
            let qr = auth::generate_totp_qr_data_uri(&flow.totp_secret);
            let b32 = auth::totp_secret_to_b32(&flow.totp_secret);
            return show_step2_with_error(&qr, &b32, &token, "TOTP code is required")
                .into_response();
        }
    };

    if !auth::verify_totp_code(&flow.totp_secret, &code) {
        let qr = auth::generate_totp_qr_data_uri(&flow.totp_secret);
        let b32 = auth::totp_secret_to_b32(&flow.totp_secret);
        let new_token = state.setup_manager.create(flow);
        return show_step2_with_error(&qr, &b32, &new_token, "Invalid TOTP code. Try again.")
            .into_response();
    }

    // Generate recovery codes
    let plain_codes = auth::generate_recovery_codes();
    let code_hashes = match auth::hash_recovery_codes(&plain_codes) {
        Ok(h) => h,
        Err(e) => return show_step1_with_error(&e).into_response(),
    };

    let flow = SetupFlow {
        password_hash: flow.password_hash,
        totp_secret: flow.totp_secret,
        recovery_codes: plain_codes.clone(),
        recovery_code_hashes: code_hashes,
        step: "confirm_codes",
    };

    let new_token = state.setup_manager.create(flow);
    show_step3(&plain_codes, &new_token).into_response()
}

async fn handle_confirm_step(state: AppState, form: SetupForm) -> Response {
    let token = match form.state_token {
        Some(ref t) => t.clone(),
        None => {
            return show_step1_with_error("Session expired. Please start again.").into_response()
        }
    };

    let _flow = match state.setup_manager.get(&token) {
        Some(f) => f,
        None => {
            return show_step1_with_error("Session expired. Please start again.").into_response()
        }
    };

    show_step4(&token).into_response()
}

async fn handle_finish_step(state: AppState, form: SetupForm) -> Response {
    let token = match form.state_token {
        Some(ref t) => t.clone(),
        None => {
            return show_step1_with_error("Session expired. Please start again.").into_response()
        }
    };

    let flow = match state.setup_manager.remove(&token) {
        Some(f) => f,
        None => {
            return show_step1_with_error("Session expired. Please start again.").into_response()
        }
    };

    let relay_optin = form.relay_optin.unwrap_or_default() == "on";

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    let totp_b32 = auth::totp_secret_to_b32(&flow.totp_secret);

    let conn = state.db.lock().await;

    // Insert user
    if let Err(e) = conn.execute(
        "INSERT INTO users (password_hash, totp_secret, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![flow.password_hash, totp_b32, now, now],
    ) {
        return (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to create user: {}", e)).into_response();
    }

    // Insert recovery code hashes
    for hash in &flow.recovery_code_hashes {
        if let Err(e) = conn.execute(
            "INSERT INTO recovery_codes (code_hash, used, created_at) VALUES (?1, 0, ?2)",
            rusqlite::params![hash, now],
        ) {
            tracing::error!("Failed to insert recovery code: {}", e);
        }
    }

    // Save relay opt-in setting
    let _ = conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('relay_optin', ?1)",
        rusqlite::params![if relay_optin { "true" } else { "false" }],
    );

    // Audit log
    let _ = db::insert_audit_log(
        &conn,
        "setup_complete",
        Some("Initial setup completed"),
        None,
    );

    let _ = db::wal_checkpoint(&conn);
    drop(conn);

    Html(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Setup Complete - NodeDesk</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #0f0f0f; color: #e0e0e0; }
        .card { text-align: center; padding: 2.5rem 3rem; border-radius: 12px; background: #1a1a1a; box-shadow: 0 4px 24px rgba(0,0,0,0.4); border: 1px solid #2a2a2a; max-width: 480px; }
        h1 { font-size: 1.5rem; margin-bottom: 1rem; color: #22c55e; }
        p { color: #aaa; margin-bottom: 1.5rem; line-height: 1.5; }
        .btn { display: inline-block; padding: 0.75rem 2rem; border-radius: 8px; background: #22c55e; color: #000; text-decoration: none; font-weight: 600; border: none; cursor: pointer; font-size: 1rem; }
    </style>
</head>
<body>
    <div class="card">
        <h1>&#10003; Setup Complete</h1>
        <p>Your NodeDesk Agent is now configured and ready to use.</p>
        <a href="/login" class="btn">Go to Login</a>
    </div>
</body>
</html>"#,
    )
        .into_response()
}

// --- HTML Templates ---

fn show_step1() -> Html<&'static str> {
    Html(PASSWORD_FORM)
}

fn show_step1_with_error(error: &str) -> Html<String> {
    Html(PASSWORD_FORM.replace("<!--ERROR_PLACEHOLDER-->", &format!(
        "<div style=\"background: #3b1818; border: 1px solid #f43f5e; color: #f43f5e; padding: 0.75rem; border-radius: 8px; margin-bottom: 1rem; font-size: 0.9rem;\">{}</div>",
        error
    )))
}

fn show_step2(qr_data_uri: &str, secret_b32: &str, token: &str) -> Html<String> {
    Html(
        TOTP_FORM
            .replace("{QR_DATA_URI}", qr_data_uri)
            .replace("{SECRET_B32}", secret_b32)
            .replace("{STATE_TOKEN}", token),
    )
}

fn show_step2_with_error(
    qr_data_uri: &str,
    secret_b32: &str,
    token: &str,
    error: &str,
) -> Html<String> {
    Html(TOTP_FORM
        .replace("{QR_DATA_URI}", qr_data_uri)
        .replace("{SECRET_B32}", secret_b32)
        .replace("{STATE_TOKEN}", token)
        .replace("<!--ERROR_PLACEHOLDER-->", &format!(
            "<div style=\"background: #3b1818; border: 1px solid #f43f5e; color: #f43f5e; padding: 0.75rem; border-radius: 8px; margin-bottom: 1rem; font-size: 0.9rem;\">{}</div>",
            error
        )))
}

fn show_step3(codes: &[String], token: &str) -> Html<String> {
    let codes_html: String = codes
        .iter()
        .map(|c| format!("<code>{}</code>", c))
        .collect::<Vec<_>>()
        .join("\n            ");
    Html(
        RECOVERY_CODES_FORM
            .replace("{RECOVERY_CODES}", &codes_html)
            .replace("{STATE_TOKEN}", token),
    )
}

fn show_step4(token: &str) -> Html<String> {
    Html(RELAY_FORM.replace("{STATE_TOKEN}", token))
}

// --- Embedded HTML ---

const PASSWORD_FORM: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Setup Step 1 - NodeDesk</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #0f0f0f; color: #e0e0e0; }
        .card { padding: 2.5rem 3rem; border-radius: 12px; background: #1a1a1a; box-shadow: 0 4px 24px rgba(0,0,0,0.4); border: 1px solid #2a2a2a; max-width: 480px; width: 100%; }
        h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
        .desc { color: #888; margin-bottom: 1.5rem; font-size: 0.9rem; line-height: 1.5; }
        label { display: block; margin-bottom: 0.5rem; color: #ccc; font-size: 0.85rem; font-weight: 500; }
        input[type="password"] { width: 100%; padding: 0.75rem; border-radius: 8px; border: 1px solid #333; background: #252525; color: #e0e0e0; font-size: 1rem; margin-bottom: 1rem; }
        input[type="password"]:focus { outline: none; border-color: #22c55e; }
        .btn { width: 100%; padding: 0.75rem; border-radius: 8px; background: #22c55e; color: #000; font-weight: 600; border: none; cursor: pointer; font-size: 1rem; }
        .btn:hover { background: #1da34b; }
        .strength-note { color: #666; font-size: 0.8rem; margin-bottom: 1rem; }
    </style>
</head>
<body>
    <div class="card">
        <h1>Create Password</h1>
        <p class="desc">Choose a strong password to secure your NodeDesk Agent. You will need this password along with a TOTP code to log in.</p>
        <!--ERROR_PLACEHOLDER-->
        <form method="post" action="/setup">
            <input type="hidden" name="action" value="password">
            <label for="password">Password</label>
            <input type="password" id="password" name="password" placeholder="Enter a strong password" required minlength="8">
            <label for="password_confirm">Confirm Password</label>
            <input type="password" id="password_confirm" name="password_confirm" placeholder="Confirm your password" required minlength="8">
            <p class="strength-note">Use at least 8 characters with a mix of letters, numbers, and symbols.</p>
            <button type="submit" class="btn">Continue</button>
        </form>
    </div>
</body>
</html>"#;

const TOTP_FORM: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Setup Step 2 - NodeDesk</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #0f0f0f; color: #e0e0e0; }
        .card { padding: 2.5rem 3rem; border-radius: 12px; background: #1a1a1a; box-shadow: 0 4px 24px rgba(0,0,0,0.4); border: 1px solid #2a2a2a; max-width: 480px; width: 100%; }
        h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
        .desc { color: #888; margin-bottom: 1.5rem; font-size: 0.9rem; line-height: 1.5; }
        .qr-container { text-align: center; margin-bottom: 1.5rem; }
        .secret { text-align: center; margin-bottom: 1.5rem; }
        .secret code { font-size: 0.85rem; color: #22c55e; background: #252525; padding: 0.5rem 1rem; border-radius: 6px; display: inline-block; letter-spacing: 2px; }
        label { display: block; margin-bottom: 0.5rem; color: #ccc; font-size: 0.85rem; font-weight: 500; }
        input[type="text"] { width: 100%; padding: 0.75rem; border-radius: 8px; border: 1px solid #333; background: #252525; color: #e0e0e0; font-size: 1rem; margin-bottom: 1rem; text-align: center; letter-spacing: 4px; }
        input[type="text"]:focus { outline: none; border-color: #22c55e; }
        .btn { width: 100%; padding: 0.75rem; border-radius: 8px; background: #22c55e; color: #000; font-weight: 600; border: none; cursor: pointer; font-size: 1rem; }
        .btn:hover { background: #1da34b; }
        .skip { display: block; text-align: center; margin-top: 1rem; color: #666; font-size: 0.85rem; }
        .step-indicator { text-align: center; margin-bottom: 1.5rem; color: #555; font-size: 0.85rem; }
    </style>
</head>
<body>
    <div class="card">
        <p class="step-indicator">Step 2 of 4</p>
        <h1>Set Up TOTP</h1>
        <p class="desc">Scan the QR code below with your authenticator app (Google Authenticator, Authy, etc.). You can also enter the secret key manually.</p>
        <!--ERROR_PLACEHOLDER-->
        <div class="qr-container">
            <img src="{QR_DATA_URI}" alt="TOTP QR Code" style="width:200px;height:200px;border-radius:8px;background:#fff;padding:8px;">
        </div>
        <div class="secret">
            <code>{SECRET_B32}</code>
        </div>
        <form method="post" action="/setup">
            <input type="hidden" name="action" value="verify_totp">
            <input type="hidden" name="state_token" value="{STATE_TOKEN}">
            <label for="totp_code">Verify by entering the 6-digit code from your app</label>
            <input type="text" id="totp_code" name="totp_code" placeholder="000000" required maxlength="6" pattern="[0-9]{6}">
            <button type="submit" class="btn">Verify &amp; Continue</button>
        </form>
    </div>
</body>
</html>"#;

const RECOVERY_CODES_FORM: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Setup Step 3 - NodeDesk</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #0f0f0f; color: #e0e0e0; }
        .card { padding: 2.5rem 3rem; border-radius: 12px; background: #1a1a1a; box-shadow: 0 4px 24px rgba(0,0,0,0.4); border: 1px solid #2a2a2a; max-width: 520px; width: 100%; }
        h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
        .desc { color: #888; margin-bottom: 1.5rem; font-size: 0.9rem; line-height: 1.5; }
        .codes { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1.5rem; }
        .codes code { font-family: 'Courier New', monospace; font-size: 1rem; background: #252525; padding: 0.65rem 1rem; border-radius: 6px; color: #22c55e; letter-spacing: 2px; border: 1px solid #333; }
        .warning { background: #3b2d0e; border: 1px solid #f59e0b; color: #fbbf24; padding: 0.75rem; border-radius: 8px; margin-bottom: 1.5rem; font-size: 0.85rem; line-height: 1.5; }
        .btn { width: 100%; padding: 0.75rem; border-radius: 8px; background: #22c55e; color: #000; font-weight: 600; border: none; cursor: pointer; font-size: 1rem; }
        .btn:hover { background: #1da34b; }
        .step-indicator { text-align: center; margin-bottom: 1.5rem; color: #555; font-size: 0.85rem; }
    </style>
</head>
<body>
    <div class="card">
        <p class="step-indicator">Step 3 of 4</p>
        <h1>Recovery Codes</h1>
        <p class="desc">Save these recovery codes in a secure place. Each code can be used once to access your account if you lose your authenticator device.</p>
        <div class="warning">&#9888; Store these codes somewhere safe. You will not be able to see them again.</div>
        <div class="codes">
            {RECOVERY_CODES}
        </div>
        <form method="post" action="/setup">
            <input type="hidden" name="action" value="confirm_codes">
            <input type="hidden" name="state_token" value="{STATE_TOKEN}">
            <button type="submit" class="btn">I've Saved These Codes</button>
        </form>
    </div>
</body>
</html>"#;

const RELAY_FORM: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Setup Step 4 - NodeDesk</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #0f0f0f; color: #e0e0e0; }
        .card { padding: 2.5rem 3rem; border-radius: 12px; background: #1a1a1a; box-shadow: 0 4px 24px rgba(0,0,0,0.4); border: 1px solid #2a2a2a; max-width: 480px; width: 100%; }
        h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
        .desc { color: #888; margin-bottom: 1.5rem; font-size: 0.9rem; line-height: 1.5; }
        .toggle-group { display: flex; align-items: center; justify-content: space-between; padding: 1rem; background: #252525; border-radius: 8px; border: 1px solid #333; margin-bottom: 2rem; }
        .toggle-group .label { color: #e0e0e0; font-size: 0.95rem; }
        .toggle-group .sub { color: #666; font-size: 0.8rem; margin-top: 0.25rem; }
        .switch { position: relative; display: inline-block; width: 48px; height: 26px; flex-shrink: 0; }
        .switch input { opacity: 0; width: 0; height: 0; }
        .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background: #444; border-radius: 26px; transition: 0.2s; }
        .slider:before { position: absolute; content: ""; height: 20px; width: 20px; left: 3px; bottom: 3px; background: #fff; border-radius: 50%; transition: 0.2s; }
        input:checked + .slider { background: #22c55e; }
        input:checked + .slider:before { transform: translateX(22px); }
        .btn { width: 100%; padding: 0.75rem; border-radius: 8px; background: #22c55e; color: #000; font-weight: 600; border: none; cursor: pointer; font-size: 1rem; }
        .btn:hover { background: #1da34b; }
        .step-indicator { text-align: center; margin-bottom: 1.5rem; color: #555; font-size: 0.85rem; }
    </style>
</head>
<body>
    <div class="card">
        <p class="step-indicator">Step 4 of 4</p>
        <h1>Relay Opt-In</h1>
        <p class="desc">Allow NodeDesk to connect via relay (Cloudflare Tunnel) for remote access outside your local network.</p>
        <form method="post" action="/setup">
            <input type="hidden" name="action" value="finish">
            <input type="hidden" name="state_token" value="{STATE_TOKEN}">
            <div class="toggle-group">
                <div>
                    <div class="label">Enable Remote Relay</div>
                    <div class="sub">Access your agent from anywhere</div>
                </div>
                <label class="switch">
                    <input type="checkbox" name="relay_optin" checked>
                    <span class="slider"></span>
                </label>
            </div>
            <button type="submit" class="btn">Finish Setup</button>
        </form>
    </div>
</body>
</html>"#;

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
