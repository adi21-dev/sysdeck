use std::collections::HashMap;
use std::net::SocketAddr;
use std::num::NonZeroU32;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use axum::body::Body;
use axum::extract::Request;
use axum::extract::State;
use axum::http::{header, HeaderValue, StatusCode};
use axum::middleware;
use axum::response::{IntoResponse, Redirect, Response};
use axum::{Form, Json};
use data_encoding::{BASE32_NOPAD, BASE64, HEXLOWER};
use governor::clock::DefaultClock;
use governor::state::keyed::DefaultKeyedStateStore;
use governor::{Quota, RateLimiter};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use totp_rs::{Algorithm, Secret, TOTP};
use tracing;
use uuid::Uuid;

use crate::db;
use crate::AppState;

// --- Constants ---

const JWT_EXPIRY_SECS: i64 = 900;
const REFRESH_TOKEN_EXPIRY_SECS: i64 = 7 * 24 * 3600;
const LOCKOUT_THRESHOLD: u32 = 5;
const LOCKOUT_DURATION: Duration = Duration::from_secs(15 * 60);
const RATE_LIMIT_REQUESTS: u32 = 60;

// --- JWT Key Management (OS Keychain via keyring crate, with file fallback) ---

const KEYRING_SERVICE: &str = "SysDeck";
const KEYRING_USER: &str = "jwt-signing-key";
const SECRETS_FILE: &str = ".secrets";
const FALLBACK_DIR_ENV: &str = "SYSDECK_DATA_DIR";

/// Determine where to store secrets for the fallback file.
fn fallback_secrets_dir() -> PathBuf {
    if let Ok(dir) = std::env::var(FALLBACK_DIR_ENV) {
        return PathBuf::from(dir);
    }
    #[cfg(target_os = "linux")]
    {
        let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
        base.join("SysDeck")
    }
    #[cfg(not(target_os = "linux"))]
    {
        crate::get_data_dir()
    }
}

fn secrets_file_path() -> PathBuf {
    fallback_secrets_dir().join(SECRETS_FILE)
}

/// Derive a 32-byte key from the Linux machine-id. Returns None on non-Linux
/// (fallback should only be used when keyring is unavailable, which happens
/// on headless Linux without D-Bus).
fn derive_machine_id_key() -> Result<[u8; 32], String> {
    for path in &["/etc/machine-id", "/var/lib/dbus/machine-id"] {
        if let Ok(id) = std::fs::read_to_string(path) {
            let hash = Sha256::digest(id.trim().as_bytes());
            let mut key = [0u8; 32];
            key.copy_from_slice(&hash);
            return Ok(key);
        }
    }
    Err("No machine-id found at /etc/machine-id or /var/lib/dbus/machine-id".to_string())
}

/// AES-256-GCM encrypt plaintext, returning `[12-byte nonce][ciphertext]`.
fn encrypt_aes_gcm(key: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| format!("Invalid AES key: {}", e))?;
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| format!("Encryption failed: {}", e))?;
    let mut out = Vec::with_capacity(12 + ciphertext.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// Decrypt data produced by `encrypt_aes_gcm`.
fn decrypt_aes_gcm(key: &[u8; 32], data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() < 12 {
        return Err("Invalid encrypted data: too short".to_string());
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| format!("Invalid AES key: {}", e))?;
    let (nonce_bytes, ciphertext) = data.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("Decryption failed: {}", e))
}

/// Load or create the JWT signing key.
///
/// 1. Try OS keychain via `keyring` crate.
/// 2. If keyring is unavailable (headless Linux), fall back to machine-id derived
///    AES-256-GCM key stored in `~/.local/share/SysDeck/.secrets`.
pub fn load_or_create_jwt_key() -> Result<Vec<u8>, String> {
    // --- Attempt 1: keyring ---
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        match entry.get_password() {
            Ok(b64) => {
                return BASE64
                    .decode(b64.as_bytes())
                    .map_err(|e| format!("Failed to decode JWT key: {}", e));
            }
            Err(keyring::Error::NoEntry) => {
                let key: [u8; 32] = rand::thread_rng().gen();
                let b64 = BASE64.encode(&key);
                if entry.set_password(&b64).is_ok() {
                    return Ok(key.to_vec());
                }
                // keyring exists but can't write — fall through
            }
            Err(_) => {} // keyring unavailable — fall through
        }
    }

    // --- Attempt 2: machine-id encrypted file (headless Linux fallback) ---
    let enc_key = derive_machine_id_key()?;
    let path = secrets_file_path();

    if path.exists() {
        let data =
            std::fs::read(&path).map_err(|e| format!("Failed to read secrets file: {}", e))?;
        return decrypt_aes_gcm(&enc_key, &data);
    }

    let jwt_key: [u8; 32] = rand::thread_rng().gen();
    let encrypted = encrypt_aes_gcm(&enc_key, &jwt_key)?;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create secrets directory: {}", e))?;
    }
    std::fs::write(&path, &encrypted)
        .map_err(|e| format!("Failed to write secrets file: {}", e))?;

    Ok(jwt_key.to_vec())
}

// --- Password Hashing ---

pub fn hash_password(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut rand::rngs::OsRng);
    let hash = Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| format!("Password hashing failed: {}", e))?
        .to_string();
    Ok(hash)
}

pub fn verify_password(password: &str, hash: &str) -> Result<bool, String> {
    let parsed = PasswordHash::new(hash).map_err(|e| format!("Invalid hash: {}", e))?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok())
}

// --- Password Strength ---

pub fn check_password_strength(password: &str) -> Result<(), String> {
    let estimate = zxcvbn::zxcvbn(password, &[]);
    let score: u8 = estimate.score().into();
    if score < 3 {
        return Err("Password too weak (score < 3/4)".to_string());
    }
    Ok(())
}

// --- TOTP ---

pub fn generate_totp_secret() -> Vec<u8> {
    Secret::generate_secret().to_bytes().unwrap()
}

pub fn create_totp(secret: Vec<u8>) -> TOTP {
    TOTP::new(
        Algorithm::SHA1,
        6,
        1,
        30,
        secret,
        Some("SysDeck".to_string()),
        "SysDeck".to_string(),
    )
    .expect("Failed to create TOTP")
}

pub fn generate_totp_qr_data_uri(secret: &[u8]) -> String {
    let totp = create_totp(secret.to_vec());
    let url = totp.get_url();
    let code = qrcode::QrCode::new(url).unwrap();
    let svg = code
        .render::<qrcode::render::svg::Color>()
        .min_dimensions(3, 3)
        .build();
    let b64 = BASE64.encode(svg.as_bytes());
    format!("data:image/svg+xml;base64,{}", b64)
}

pub fn totp_secret_to_b32(secret: &[u8]) -> String {
    BASE32_NOPAD.encode(secret)
}

pub fn totp_secret_from_b32(encoded: &str) -> Result<Vec<u8>, String> {
    BASE32_NOPAD
        .decode(encoded.as_bytes())
        .map_err(|e| format!("Invalid base32: {}", e))
}

pub fn verify_totp_code(secret: &[u8], code: &str) -> bool {
    create_totp(secret.to_vec())
        .check_current(code)
        .unwrap_or(false)
}

// --- Recovery Codes ---

pub fn generate_recovery_codes() -> Vec<String> {
    let mut rng = rand::thread_rng();
    (0..10)
        .map(|_| {
            let bytes: Vec<u8> = (0..8).map(|_| rng.gen()).collect();
            BASE32_NOPAD.encode(&bytes).to_lowercase()
        })
        .collect()
}

pub fn hash_recovery_codes(codes: &[String]) -> Result<Vec<String>, String> {
    codes.iter().map(|code| hash_password(code)).collect()
}

// --- JWT ---

#[derive(Debug, Serialize, Deserialize)]
pub struct JwtClaims {
    pub sub: String,
    pub exp: usize,
    pub iat: usize,
    pub jti: String,
    pub token_version: i64,
}

pub fn create_jwt(jti: &str, key: &[u8], token_version: i64) -> Result<String, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as usize;
    let exp = now + JWT_EXPIRY_SECS as usize;

    let claims = JwtClaims {
        sub: "1".to_string(),
        exp,
        iat: now,
        jti: jti.to_string(),
        token_version,
    };

    encode(&Header::default(), &claims, &EncodingKey::from_secret(key))
        .map_err(|e| format!("JWT encode error: {}", e))
}

pub fn verify_jwt(token: &str, key: &[u8]) -> Result<JwtClaims, String> {
    let mut validation = Validation::new(jsonwebtoken::Algorithm::HS256);
    validation.validate_exp = true;
    validation.leeway = 60;

    decode::<JwtClaims>(token, &DecodingKey::from_secret(key), &validation)
        .map(|data| data.claims)
        .map_err(|e| format!("JWT decode error: {}", e))
}

// --- Session Management ---

pub fn generate_refresh_token() -> (String, String) {
    let raw = Uuid::new_v4().to_string();
    let hash = HEXLOWER.encode(&Sha256::digest(raw.as_bytes()));
    (raw, hash)
}

pub fn hash_refresh_token(raw: &str) -> String {
    HEXLOWER.encode(&Sha256::digest(raw.as_bytes()))
}

pub fn create_session(
    conn: &rusqlite::Connection,
    user_id: i64,
    refresh_token_hash: &str,
) -> Result<String, String> {
    let jti = Uuid::new_v4().to_string();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    let expires = now + REFRESH_TOKEN_EXPIRY_SECS;

    conn.execute(
        "INSERT INTO sessions (user_id, token_jti, refresh_token_hash, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![user_id, jti, refresh_token_hash, now, expires],
    )
    .map_err(|e| format!("Failed to create session: {}", e))?;

    Ok(jti)
}

pub fn verify_session(conn: &rusqlite::Connection, jti: &str) -> Result<bool, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sessions WHERE token_jti = ?1 AND expires_at > ?2",
            rusqlite::params![jti, now],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to query session: {}", e))?;

    Ok(count > 0)
}

pub fn verify_refresh_token(
    conn: &rusqlite::Connection,
    hash: &str,
) -> Result<Option<String>, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    let result = conn.query_row(
        "SELECT token_jti FROM sessions WHERE refresh_token_hash = ?1 AND expires_at > ?2 LIMIT 1",
        rusqlite::params![hash, now],
        |row| row.get::<_, String>(0),
    );
    match result {
        Ok(jti) => Ok(Some(jti)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("Failed to query refresh token: {}", e)),
    }
}

pub fn rotate_refresh_token(
    conn: &rusqlite::Connection,
    jti: &str,
    new_hash: &str,
) -> Result<(), String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    let expires = now + REFRESH_TOKEN_EXPIRY_SECS;

    conn.execute(
        "UPDATE sessions SET refresh_token_hash = ?1, expires_at = ?2 WHERE token_jti = ?3",
        rusqlite::params![new_hash, expires, jti],
    )
    .map_err(|e| format!("Failed to rotate refresh token: {}", e))?;
    Ok(())
}

pub fn get_token_version(conn: &rusqlite::Connection, user_id: i64) -> Result<i64, String> {
    conn.query_row(
        "SELECT token_version FROM users WHERE id = ?1",
        rusqlite::params![user_id],
        |row| row.get::<_, i64>(0),
    )
    .map_err(|e| format!("Failed to get token_version: {}", e))
}

pub fn revoke_all_sessions(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute("DELETE FROM sessions", [])
        .map_err(|e| format!("Failed to revoke sessions: {}", e))?;
    Ok(())
}

pub fn revoke_session(conn: &rusqlite::Connection, jti: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM sessions WHERE token_jti = ?1",
        rusqlite::params![jti],
    )
    .map_err(|e| format!("Failed to revoke session: {}", e))?;
    Ok(())
}

#[derive(Serialize)]
pub struct SessionInfo {
    pub jti: String,
    pub created_at: i64,
    pub expires_at: i64,
}

pub fn list_sessions(
    conn: &rusqlite::Connection,
    user_id: i64,
) -> Result<Vec<SessionInfo>, String> {
    let mut stmt = conn.prepare(
        "SELECT token_jti, created_at, expires_at FROM sessions WHERE user_id = ?1 ORDER BY created_at DESC"
    ).map_err(|e| format!("Failed to prepare session list: {}", e))?;

    let sessions = stmt
        .query_map(rusqlite::params![user_id], |row| {
            Ok(SessionInfo {
                jti: row.get(0)?,
                created_at: row.get(1)?,
                expires_at: row.get(2)?,
            })
        })
        .map_err(|e| format!("Failed to query sessions: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(sessions)
}

// --- Account Lockout ---

#[derive(Debug, Clone)]
struct LockoutInfo {
    failed_attempts: u32,
    locked_until: Option<Instant>,
}

pub struct LockoutState {
    inner: std::sync::Mutex<HashMap<i64, LockoutInfo>>,
}

impl LockoutState {
    #[allow(clippy::new_without_default)]
    pub fn new() -> Self {
        Self {
            inner: std::sync::Mutex::new(HashMap::new()),
        }
    }

    pub fn check_locked(&self, user_id: i64) -> bool {
        let mut map = self.inner.lock().unwrap();
        if let Some(info) = map.get(&user_id) {
            if let Some(until) = info.locked_until {
                if Instant::now() < until {
                    return true;
                }
                map.remove(&user_id);
            }
        }
        false
    }

    pub fn record_failure(&self, user_id: i64) -> u32 {
        let mut map = self.inner.lock().unwrap();
        let info = map.entry(user_id).or_insert(LockoutInfo {
            failed_attempts: 0,
            locked_until: None,
        });
        info.failed_attempts += 1;
        if info.failed_attempts >= LOCKOUT_THRESHOLD {
            info.locked_until = Some(Instant::now() + LOCKOUT_DURATION);
        }
        info.failed_attempts
    }

    pub fn clear_failures(&self, user_id: i64) {
        let mut map = self.inner.lock().unwrap();
        map.remove(&user_id);
    }
}

// --- Rate Limiter ---

pub type IpRateLimiter = RateLimiter<SocketAddr, DefaultKeyedStateStore<SocketAddr>, DefaultClock>;

pub fn create_rate_limiter() -> Arc<IpRateLimiter> {
    Arc::new(RateLimiter::keyed(
        Quota::per_second(NonZeroU32::new(RATE_LIMIT_REQUESTS).unwrap())
            .allow_burst(NonZeroU32::new(5).unwrap()),
    ))
}

// --- Login Handler ---

#[derive(Deserialize)]
pub struct LoginForm {
    pub password: String,
    pub totp_code: String,
}

#[derive(Serialize)]
pub struct LoginResponse {
    pub success: bool,
    pub message: String,
}

pub(crate) fn client_ip_from_headers(headers: &axum::http::HeaderMap) -> String {
    if let Some(val) = headers.get("X-Forwarded-For") {
        if let Ok(s) = val.to_str() {
            if let Some(ip) = s.split(',').next() {
                return ip.trim().to_string();
            }
        }
    }
    "127.0.0.1".to_string()
}

fn login_err(code: StatusCode, msg: &str) -> Response {
    (
        code,
        Json(LoginResponse {
            success: false,
            message: msg.to_string(),
        }),
    )
        .into_response()
}

pub async fn login_handler(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Form(form): Form<LoginForm>,
) -> Response {
    let user_id = 1i64;
    let ip = client_ip_from_headers(&headers);

    if state.lockout.check_locked(user_id) {
        tracing::warn!(
            ip,
            reason = "account_locked",
            "Login attempt on locked account"
        );
        let conn = state.db.lock().await;
        let _ = db::insert_audit_log(&conn, "login_locked", Some("Account locked"), Some(&ip));
        drop(conn);
        return login_err(
            StatusCode::TOO_MANY_REQUESTS,
            "Account locked. Try again in 15 minutes.",
        );
    }

    let (password_valid, totp_secret) = {
        let conn = state.db.lock().await;
        let result: Result<(String, String), _> = conn.query_row(
            "SELECT password_hash, totp_secret FROM users WHERE id = 1",
            [],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        );
        drop(conn);

        match result {
            Ok((hash, secret_b32)) => {
                let pw_ok = verify_password(&form.password, &hash).unwrap_or(false);
                (pw_ok, secret_b32)
            }
            Err(_) => return login_err(StatusCode::UNAUTHORIZED, "Invalid credentials"),
        }
    };

    if !password_valid {
        let attempts = state.lockout.record_failure(user_id);
        tracing::warn!(ip, attempts, reason = "invalid_password", "Login failed");
        let conn = state.db.lock().await;
        let _ = db::insert_audit_log(&conn, "login_failed", Some("Invalid password"), Some(&ip));
        drop(conn);
        let msg = if attempts >= LOCKOUT_THRESHOLD {
            "Account locked due to too many failed attempts. Try again in 15 minutes."
        } else {
            "Invalid credentials"
        };
        return login_err(StatusCode::UNAUTHORIZED, msg);
    }

    let secret_bytes = match totp_secret_from_b32(&totp_secret) {
        Ok(b) => b,
        Err(_) => {
            return login_err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Server configuration error",
            )
        }
    };

    if !verify_totp_code(&secret_bytes, &form.totp_code) {
        let attempts = state.lockout.record_failure(user_id);
        tracing::warn!(ip, attempts, reason = "invalid_totp", "Login failed");
        let conn = state.db.lock().await;
        let _ = db::insert_audit_log(&conn, "login_failed", Some("Invalid TOTP code"), Some(&ip));
        drop(conn);
        let msg = if attempts >= LOCKOUT_THRESHOLD {
            "Account locked due to too many failed attempts. Try again in 15 minutes."
        } else {
            "Invalid credentials"
        };
        return login_err(StatusCode::UNAUTHORIZED, msg);
    }

    state.lockout.clear_failures(user_id);

    let token_version = {
        let conn = state.db.lock().await;
        let tv = get_token_version(&conn, user_id);
        drop(conn);
        match tv {
            Ok(v) => v,
            Err(e) => return login_err(StatusCode::INTERNAL_SERVER_ERROR, &e),
        }
    };

    let (raw_refresh, hashed_refresh) = generate_refresh_token();
    let jti = {
        let conn = state.db.lock().await;
        let result = create_session(&conn, user_id, &hashed_refresh);
        drop(conn);
        match result {
            Ok(j) => j,
            Err(e) => {
                return login_err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &format!("Session creation failed: {}", e),
                )
            }
        }
    };

    let token = match create_jwt(&jti, &state.jwt_key, token_version) {
        Ok(t) => t,
        Err(e) => {
            return login_err(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("Token creation failed: {}", e),
            )
        }
    };

    {
        let conn = state.db.lock().await;
        let _ = db::insert_audit_log(&conn, "login_success", Some("Login successful"), Some(&ip));
        let _ = db::wal_checkpoint(&conn);
    }
    tracing::info!(ip, "Login successful");

    let is_secure = headers.contains_key("cf-connecting-ip") || headers.contains_key("cf-ray");
    let secure_flag = if is_secure { "; Secure" } else { "" };
    let access_cookie = format!(
        "token={}; HttpOnly; SameSite=Lax; Max-Age={}; Path=/{secure_flag}",
        token, JWT_EXPIRY_SECS,
    );
    let refresh_cookie = format!(
        "refresh_token={}; HttpOnly; SameSite=Strict; Max-Age={}; Path=/api/auth/refresh{secure_flag}",
        raw_refresh, REFRESH_TOKEN_EXPIRY_SECS,
    );

    let body = serde_json::to_string(&LoginResponse {
        success: true,
        message: "Login successful".to_string(),
    })
    .unwrap();

    Response::builder()
        .status(StatusCode::OK)
        .header(header::SET_COOKIE, &access_cookie)
        .header(header::SET_COOKIE, &refresh_cookie)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body))
        .unwrap()
}

// --- Auth Check Handler ---

#[derive(Serialize)]
pub struct AuthCheckResponse {
    authenticated: bool,
}

pub(crate) fn check_access_token(
    token_str: &str,
    jwt_key: &[u8],
    conn: &rusqlite::Connection,
) -> bool {
    match verify_jwt(token_str, jwt_key) {
        Ok(claims) => {
            let session_ok = verify_session(conn, &claims.jti).unwrap_or(false);
            if !session_ok {
                return false;
            }
            let tv = get_token_version(conn, 1).unwrap_or(0);
            tv == claims.token_version
        }
        Err(_) => false,
    }
}

pub async fn auth_check_handler(
    State(state): State<AppState>,
    req: axum::extract::Request,
) -> impl IntoResponse {
    let cookie_str = req
        .headers()
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let authenticated = match cookie_str {
        Some(c) => {
            let token = parse_cookie(&c, "token");
            match token {
                Some(t) => {
                    let conn = state.db.lock().await;
                    check_access_token(t, &state.jwt_key, &conn)
                }
                None => false,
            }
        }
        None => false,
    };

    tracing::debug!(authenticated, "Auth check");
    Json(AuthCheckResponse { authenticated })
}

// --- Refresh Handler ---

#[derive(Serialize)]
pub struct RefreshResponse {
    success: bool,
}

pub async fn refresh_handler(
    State(state): State<AppState>,
    req: axum::extract::Request,
) -> Response {
    let cookie_str = req
        .headers()
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let raw_refresh = cookie_str
        .as_deref()
        .and_then(|c| parse_cookie(c, "refresh_token"));

    let Some(raw) = raw_refresh else {
        tracing::warn!(reason = "no_refresh_token", "Token refresh failed");
        return (
            StatusCode::UNAUTHORIZED,
            Json(RefreshResponse { success: false }),
        )
            .into_response();
    };

    let hash = hash_refresh_token(raw);

    let refresh_result = {
        let conn = state.db.lock().await;
        verify_refresh_token(&conn, &hash)
    };
    let jti = match refresh_result {
        Ok(Some(j)) => j,
        Ok(None) => {
            tracing::warn!(
                reason = "invalid_or_expired_refresh_token",
                "Token refresh failed"
            );
            return (
                StatusCode::UNAUTHORIZED,
                Json(RefreshResponse { success: false }),
            )
                .into_response();
        }
        Err(e) => {
            tracing::warn!(reason = "db_error", error = %e, "Token refresh failed");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(RefreshResponse { success: false }),
            )
                .into_response();
        }
    };

    // Rotate refresh token
    let (new_raw, new_hash) = generate_refresh_token();
    {
        let conn = state.db.lock().await;
        if rotate_refresh_token(&conn, &jti, &new_hash).is_err() {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(RefreshResponse { success: false }),
            )
                .into_response();
        }
    }

    // Issue new access token
    let token_version = {
        let conn = state.db.lock().await;
        get_token_version(&conn, 1).unwrap_or(1)
    };
    let access_token = match create_jwt(&jti, &state.jwt_key, token_version) {
        Ok(t) => t,
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(RefreshResponse { success: false }),
            )
                .into_response();
        }
    };

    let is_secure =
        req.headers().contains_key("cf-connecting-ip") || req.headers().contains_key("cf-ray");
    let secure_flag = if is_secure { "; Secure" } else { "" };

    let access_cookie = format!(
        "token={}; HttpOnly; SameSite=Lax; Max-Age={}; Path=/{secure_flag}",
        access_token, JWT_EXPIRY_SECS,
    );
    let refresh_cookie = format!(
        "refresh_token={}; HttpOnly; SameSite=Strict; Max-Age={}; Path=/api/auth/refresh{secure_flag}",
        new_raw, REFRESH_TOKEN_EXPIRY_SECS,
    );

    tracing::info!("Token refresh successful");
    let body = serde_json::to_string(&RefreshResponse { success: true }).unwrap();
    Response::builder()
        .status(StatusCode::OK)
        .header(header::SET_COOKIE, &access_cookie)
        .header(header::SET_COOKIE, &refresh_cookie)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body))
        .unwrap()
}

// --- Logout Handler ---

pub async fn logout_handler(
    State(state): State<AppState>,
    req: axum::extract::Request,
) -> Response {
    let cookie_str = req
        .headers()
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let token = cookie_str.as_deref().and_then(|c| parse_cookie(c, "token"));

    match token {
        Some(token_str) => match verify_jwt(token_str, &state.jwt_key) {
            Ok(claims) => {
                tracing::info!(session_jti = %claims.jti, "Session revoked on logout");
                let conn = state.db.lock().await;
                let _ = revoke_session(&conn, &claims.jti);
                let _ = db::insert_audit_log(&conn, "logout", Some("User logged out"), None);
                drop(conn);

                let access_cookie = "token=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/";
                let refresh_cookie =
                    "refresh_token=; HttpOnly; SameSite=Strict; Max-Age=0; Path=/api/auth/refresh";

                let body = serde_json::to_string(&LoginResponse {
                    success: true,
                    message: "Logged out".to_string(),
                })
                .unwrap();

                Response::builder()
                    .status(StatusCode::OK)
                    .header(header::SET_COOKIE, access_cookie)
                    .header(header::SET_COOKIE, refresh_cookie)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body))
                    .unwrap()
            }
            Err(_) => login_err(StatusCode::UNAUTHORIZED, "Invalid token"),
        },
        None => login_err(StatusCode::UNAUTHORIZED, "No auth token"),
    }
}

// --- Auth Middleware ---

pub async fn auth_middleware(
    State(state): State<AppState>,
    req: Request,
    next: middleware::Next,
) -> Response {
    let path = req.uri().path().to_string();
    let method = req.method().to_string();

    let needs_setup = {
        let conn = state.db.lock().await;
        db::is_setup_complete(&conn).map(|c| !c).unwrap_or(true)
    };

    if needs_setup {
        if path.starts_with("/setup")
            || path.starts_with("/api/setup")
            || path == "/api/auth/check"
            || path == "/api/admin/check"
        {
            tracing::debug!(
                path,
                method,
                skip_reason = "setup_not_complete",
                "Auth middleware skip"
            );
            return next.run(req).await;
        }
        tracing::debug!(
            path,
            method,
            redirect = "/setup",
            "Auth middleware redirect to setup"
        );
        return Redirect::to("/setup").into_response();
    }

    if path == "/login"
        || path.starts_with("/setup")
        || path.starts_with("/api/setup")
        || path == "/"
        || path == "/api/auth/check"
        || path == "/api/auth/refresh"
        || path == "/api/admin/check"
        || path == "/api/scripts/execute"
    {
        tracing::debug!(path, method, "Auth middleware skip");
        return next.run(req).await;
    }

    let cookie_str = req
        .headers()
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let token = cookie_str.as_deref().and_then(|c| parse_cookie(c, "token"));

    match token {
        Some(token_str) => match verify_jwt(token_str, &state.jwt_key) {
            Ok(claims) => {
                let valid = {
                    let conn = state.db.lock().await;
                    let session_ok = verify_session(&conn, &claims.jti).unwrap_or(false);
                    if !session_ok {
                        false
                    } else {
                        let tv = get_token_version(&conn, 1).unwrap_or(0);
                        tv == claims.token_version
                    }
                };
                if valid {
                    next.run(req).await
                } else {
                    tracing::warn!(
                        path,
                        method,
                        reason = "session_expired_or_revoked",
                        "Auth middleware denied"
                    );
                    (StatusCode::UNAUTHORIZED, "Session expired or revoked").into_response()
                }
            }
            Err(e) => {
                tracing::warn!(path, method, reason = "invalid_token", error = %e, "Auth middleware denied");
                (StatusCode::UNAUTHORIZED, "Invalid token").into_response()
            }
        },
        None => {
            tracing::warn!(path, method, reason = "no_token", "Auth middleware denied");
            (StatusCode::UNAUTHORIZED, "No auth token").into_response()
        }
    }
}

pub(crate) fn parse_cookie<'a>(cookie_str: &'a str, name: &str) -> Option<&'a str> {
    cookie_str.split(';').find_map(|c| {
        let c = c.trim();
        c.strip_prefix(&format!("{}=", name))
    })
}

// --- Rate Limit Middleware ---

pub async fn rate_limit_middleware(
    State(state): State<AppState>,
    req: Request,
    next: middleware::Next,
) -> Response {
    let path = req.uri().path().to_string();

    if path == "/login"
        || path.starts_with("/setup")
        || path.starts_with("/api/setup")
        || path == "/api/auth/check"
        || path == "/api/auth/refresh"
    {
        return next.run(req).await;
    }

    let ip_str = client_ip_from_headers(req.headers());
    let parsed: std::net::IpAddr = ip_str
        .parse()
        .unwrap_or(std::net::IpAddr::V4(std::net::Ipv4Addr::new(127, 0, 0, 1)));
    let sock = SocketAddr::new(parsed, 0);

    match state.rate_limiter.check_key(&sock) {
        Ok(_) => next.run(req).await,
        Err(_) => {
            tracing::warn!(path, ip = %ip_str, "Rate limit exceeded");
            (
                StatusCode::TOO_MANY_REQUESTS,
                "Rate limit exceeded. Try again later.",
            )
                .into_response()
        }
    }
}

// --- Admin / Localhost Middleware ---

pub fn is_local_request(headers: &axum::http::HeaderMap) -> bool {
    // Cloudflare Quick Tunnels inject cf-connecting-ip and cf-ray headers.
    // Localhost browsers do not have these headers.
    !headers.contains_key("cf-connecting-ip") && !headers.contains_key("cf-ray")
}

pub async fn admin_middleware(req: Request, next: middleware::Next) -> Response {
    if is_local_request(req.headers()) {
        next.run(req).await
    } else {
        let path = req.uri().path();
        tracing::warn!(path, "Admin middleware denied remote request");
        (
            StatusCode::FORBIDDEN,
            "Forbidden: admin routes require localhost access",
        )
            .into_response()
    }
}

#[derive(Serialize)]
pub struct AdminCheckResponse {
    is_local: bool,
}

pub async fn admin_check_handler(headers: axum::http::HeaderMap) -> Json<AdminCheckResponse> {
    let is_local = is_local_request(&headers);
    tracing::info!(is_local, "Admin check");
    Json(AdminCheckResponse { is_local })
}

// --- CSP Middleware ---

pub async fn csp_middleware(req: Request, next: middleware::Next) -> Response {
    let mut response = next.run(req).await;
    response.headers_mut().insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(
            "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'",
        ),
    );
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::init_auth_tables(&conn).unwrap();
        conn
    }

    // --- Password ---

    #[test]
    fn test_password_hash_verify_roundtrip() {
        let pw = "MySecureP@ss1";
        let hash = hash_password(pw).unwrap();
        assert!(verify_password(pw, &hash).unwrap());
        assert!(!verify_password("WrongPassword1!", &hash).unwrap());
    }

    #[test]
    fn test_password_strength_weak() {
        assert!(check_password_strength("password").is_err());
        assert!(check_password_strength("12345678").is_err());
        assert!(check_password_strength("abcdefgh").is_err());
    }

    #[test]
    fn test_password_strength_strong() {
        assert!(check_password_strength("MySecureP@ss1").is_ok());
        assert!(check_password_strength("C0rrectHorseBatteryStaple!").is_ok());
    }

    // --- TOTP ---

    #[test]
    fn test_totp_secret_b32_roundtrip() {
        let secret = generate_totp_secret();
        let b32 = totp_secret_to_b32(&secret);
        let decoded = totp_secret_from_b32(&b32).unwrap();
        assert_eq!(secret, decoded);
    }

    #[test]
    fn test_totp_secret_from_b32_invalid() {
        assert!(totp_secret_from_b32("!!!invalid!!!").is_err());
    }

    #[test]
    fn test_totp_verify_current() {
        let secret = generate_totp_secret();
        let totp = create_totp(secret.clone());
        let code = totp.generate_current().unwrap();
        assert!(verify_totp_code(&secret, &code));
    }

    #[test]
    fn test_totp_verify_wrong_code() {
        let secret = generate_totp_secret();
        assert!(!verify_totp_code(&secret, "000000"));
    }

    #[test]
    fn test_generate_totp_qr_data_uri() {
        let secret = generate_totp_secret();
        let uri = generate_totp_qr_data_uri(&secret);
        assert!(uri.starts_with("data:image/svg+xml;base64,"));
    }

    // --- Recovery Codes ---

    #[test]
    fn test_generate_recovery_codes_count() {
        let codes = generate_recovery_codes();
        assert_eq!(codes.len(), 10);
    }

    #[test]
    fn test_generate_recovery_codes_unique() {
        let codes = generate_recovery_codes();
        let mut sorted = codes.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), 10);
    }

    #[test]
    fn test_recovery_code_hash_verify() {
        let codes = generate_recovery_codes();
        let hashes = hash_recovery_codes(&codes).unwrap();
        for (code, hash) in codes.iter().zip(hashes.iter()) {
            assert!(verify_password(code, hash).unwrap());
        }
    }

    // --- JWT ---

    const JWT_KEY: &[u8] = b"01234567890123456789012345678901";

    #[test]
    fn test_jwt_create_verify() {
        let token = create_jwt("test-jti", JWT_KEY, 1).unwrap();
        let claims = verify_jwt(&token, JWT_KEY).unwrap();
        assert_eq!(claims.sub, "1");
        assert_eq!(claims.jti, "test-jti");
        assert_eq!(claims.token_version, 1);
    }

    #[test]
    fn test_jwt_invalid_signature() {
        let token = create_jwt("test-jti", JWT_KEY, 1).unwrap();
        let wrong_key = b"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        assert!(verify_jwt(&token, wrong_key).is_err());
    }

    #[test]
    fn test_jwt_malformed_token() {
        assert!(verify_jwt("not-a-jwt", JWT_KEY).is_err());
        assert!(verify_jwt("header.payload.invalid", JWT_KEY).is_err());
    }

    #[test]
    fn test_jwt_expired_token() {
        let claims = JwtClaims {
            sub: "1".to_string(),
            exp: 100000,
            iat: 1000,
            jti: "expired-jti".to_string(),
            token_version: 1,
        };
        let token = encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(JWT_KEY),
        )
        .unwrap();
        assert!(verify_jwt(&token, JWT_KEY).is_err());
    }

    // --- Sessions ---

    fn test_session(conn: &Connection) -> String {
        create_session(conn, 1, "test_refresh_hash").unwrap()
    }

    #[test]
    fn test_create_session() {
        let conn = test_conn();
        conn.execute(
            "INSERT INTO users (password_hash, totp_secret, token_version, created_at, updated_at) VALUES ('hash', 'secret', 1, 1000, 1000)",
            [],
        ).unwrap();
        let jti = test_session(&conn);
        assert!(!jti.is_empty());
        assert!(Uuid::parse_str(&jti).is_ok());
    }

    #[test]
    fn test_verify_valid_session() {
        let conn = test_conn();
        conn.execute(
            "INSERT INTO users (password_hash, totp_secret, token_version, created_at, updated_at) VALUES ('hash', 'secret', 1, 1000, 1000)",
            [],
        ).unwrap();
        let jti = test_session(&conn);
        assert!(verify_session(&conn, &jti).unwrap());
    }

    #[test]
    fn test_verify_nonexistent_session() {
        let conn = test_conn();
        assert!(!verify_session(&conn, "nonexistent-jti").unwrap());
    }

    #[test]
    fn test_revoke_all_sessions() {
        let conn = test_conn();
        conn.execute(
            "INSERT INTO users (password_hash, totp_secret, token_version, created_at, updated_at) VALUES ('hash', 'secret', 1, 1000, 1000)",
            [],
        ).unwrap();
        test_session(&conn);
        revoke_all_sessions(&conn).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_multiple_sessions_for_same_user() {
        let conn = test_conn();
        conn.execute(
            "INSERT INTO users (password_hash, totp_secret, token_version, created_at, updated_at) VALUES ('hash', 'secret', 1, 1000, 1000)",
            [],
        ).unwrap();
        let jti1 = test_session(&conn);
        let jti2 = test_session(&conn);
        assert_ne!(jti1, jti2);
        assert!(verify_session(&conn, &jti1).unwrap());
        assert!(verify_session(&conn, &jti2).unwrap());
    }

    #[test]
    fn test_expired_session() {
        let conn = test_conn();
        conn.execute(
            "INSERT INTO users (password_hash, totp_secret, token_version, created_at, updated_at) VALUES ('hash', 'secret', 1, 1000, 1000)",
            [],
        ).unwrap();
        let jti = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO sessions (user_id, token_jti, created_at, expires_at) VALUES (?1, ?2, 1000, 1000)",
            rusqlite::params![1, jti],
        ).unwrap();
        assert!(!verify_session(&conn, &jti).unwrap());
    }

    // --- LockoutState ---

    #[test]
    fn test_lockout_check_locked_new_user() {
        let lockout = LockoutState::new();
        assert!(!lockout.check_locked(1));
    }

    #[test]
    fn test_lockout_after_threshold() {
        let lockout = LockoutState::new();
        for _ in 0..5 {
            lockout.record_failure(1);
        }
        assert!(lockout.check_locked(1));
    }

    #[test]
    fn test_lockout_below_threshold() {
        let lockout = LockoutState::new();
        for _ in 0..3 {
            lockout.record_failure(1);
        }
        assert!(!lockout.check_locked(1));
    }

    #[test]
    fn test_lockout_clear_failures() {
        let lockout = LockoutState::new();
        for _ in 0..5 {
            lockout.record_failure(1);
        }
        assert!(lockout.check_locked(1));
        lockout.clear_failures(1);
        assert!(!lockout.check_locked(1));
    }

    #[test]
    fn test_lockout_isolated_by_user() {
        let lockout = LockoutState::new();
        for _ in 0..5 {
            lockout.record_failure(1);
        }
        assert!(lockout.check_locked(1));
        assert!(!lockout.check_locked(2));
    }

    // --- Parsing ---

    #[test]
    fn test_parse_cookie_simple() {
        assert_eq!(parse_cookie("token=abc123", "token"), Some("abc123"));
    }

    #[test]
    fn test_parse_cookie_multiple() {
        let cookies = "other=val; token=abc123; foo=bar";
        assert_eq!(parse_cookie(cookies, "token"), Some("abc123"));
    }

    #[test]
    fn test_parse_cookie_missing() {
        assert_eq!(parse_cookie("other=val", "token"), None);
    }

    #[test]
    fn test_parse_cookie_empty_str() {
        assert_eq!(parse_cookie("", "token"), None);
    }

    #[test]
    fn test_client_ip_from_headers_xff() {
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("X-Forwarded-For", "192.168.1.1".parse().unwrap());
        assert_eq!(client_ip_from_headers(&headers), "192.168.1.1");
    }

    #[test]
    fn test_client_ip_from_headers_multiple_xff() {
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("X-Forwarded-For", "192.168.1.1, 10.0.0.1".parse().unwrap());
        assert_eq!(client_ip_from_headers(&headers), "192.168.1.1");
    }

    #[test]
    fn test_client_ip_from_headers_missing() {
        let headers = axum::http::HeaderMap::new();
        assert_eq!(client_ip_from_headers(&headers), "127.0.0.1");
    }

    // --- is_local_request ---

    #[test]
    fn test_is_local_request_no_header() {
        let headers = axum::http::HeaderMap::new();
        assert!(is_local_request(&headers));
    }

    #[test]
    fn test_is_local_request_cf_connecting_ip() {
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("cf-connecting-ip", "203.0.113.1".parse().unwrap());
        assert!(!is_local_request(&headers));
    }

    #[test]
    fn test_is_local_request_cf_ray() {
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("cf-ray", "abc123".parse().unwrap());
        assert!(!is_local_request(&headers));
    }

    #[test]
    fn test_is_local_request_both_cf_headers() {
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("cf-connecting-ip", "203.0.113.1".parse().unwrap());
        headers.insert("cf-ray", "abc123".parse().unwrap());
        assert!(!is_local_request(&headers));
    }

    // --- load_or_create_jwt_key ---

    #[test]
    fn test_load_or_create_jwt_key_roundtrip() {
        // Delete any prior key to start fresh
        let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).unwrap();
        // Ignore error if no prior key exists
        let _ = entry.delete_password();

        let key = load_or_create_jwt_key().expect("Should create a new key");
        assert_eq!(key.len(), 32);

        // Loading again should return the same key
        let key2 = load_or_create_jwt_key().expect("Should load existing key");
        assert_eq!(key, key2);

        // Cleanup
        let _ = entry.delete_password();
    }

    // --- Fallback encrypt/decrypt ---

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let mut key = [0u8; 32];
        rand::thread_rng().fill(&mut key);
        let plaintext = b"hello world";
        let encrypted = encrypt_aes_gcm(&key, plaintext).unwrap();
        let decrypted = decrypt_aes_gcm(&key, &encrypted).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_decrypt_too_short() {
        let mut key = [0u8; 32];
        rand::thread_rng().fill(&mut key);
        assert!(decrypt_aes_gcm(&key, b"too short").is_err());
    }

    #[test]
    fn test_decrypt_wrong_key() {
        let mut key1 = [0u8; 32];
        rand::thread_rng().fill(&mut key1);
        let mut key2 = [0u8; 32];
        rand::thread_rng().fill(&mut key2);
        let encrypted = encrypt_aes_gcm(&key1, b"secret").unwrap();
        assert!(decrypt_aes_gcm(&key2, &encrypted).is_err());
    }
}
