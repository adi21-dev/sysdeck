use std::collections::HashMap;
use std::net::SocketAddr;
use std::num::NonZeroU32;
use std::sync::Arc;
use std::time::{Duration, Instant};

use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use axum::extract::Request;
use axum::extract::State;
use axum::http::{header, HeaderValue, StatusCode};
use axum::middleware;
use axum::response::{IntoResponse, Redirect, Response};
use axum::{Form, Json};
use data_encoding::{BASE32_NOPAD, BASE64};
use governor::clock::DefaultClock;
use governor::state::keyed::DefaultKeyedStateStore;
use governor::{Quota, RateLimiter};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use rand::Rng;
use serde::{Deserialize, Serialize};
use totp_rs::{Algorithm, Secret, TOTP};
use uuid::Uuid;

use crate::db;
use crate::AppState;

// --- Constants ---

const JWT_EXPIRY_SECS: i64 = 90 * 24 * 3600;
const LOCKOUT_THRESHOLD: u32 = 5;
const LOCKOUT_DURATION: Duration = Duration::from_secs(15 * 60);
const RATE_LIMIT_REQUESTS: u32 = 60;

// --- DPAPI (raw FFI) ---

#[repr(C)]
struct Blob {
    cb_data: u32,
    pb_data: *mut u8,
}

extern "system" {
    fn CryptProtectData(
        p_data_in: *const Blob,
        sz_data_descr: *const u16,
        p_optional_entropy: *const Blob,
        pv_reserved: *const std::ffi::c_void,
        p_prompt_struct: *const std::ffi::c_void,
        dw_flags: u32,
        p_data_out: *mut Blob,
    ) -> i32;

    fn CryptUnprotectData(
        p_data_in: *const Blob,
        ppsz_data_descr: *mut *mut u16,
        p_optional_entropy: *const Blob,
        pv_reserved: *const std::ffi::c_void,
        p_prompt_struct: *const std::ffi::c_void,
        dw_flags: u32,
        p_data_out: *mut Blob,
    ) -> i32;

    fn LocalFree(ptr: *mut u8) -> *mut u8;
}

fn dpapi_encrypt(plaintext: &[u8]) -> Result<Vec<u8>, String> {
    unsafe {
        let data_in = Blob {
            cb_data: plaintext.len() as u32,
            pb_data: plaintext.as_ptr() as *mut u8,
        };
        let mut data_out = Blob {
            cb_data: 0,
            pb_data: std::ptr::null_mut(),
        };

        if CryptProtectData(
            &data_in as *const Blob,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            0,
            &mut data_out as *mut Blob,
        ) != 0
        {
            let result =
                std::slice::from_raw_parts(data_out.pb_data, data_out.cb_data as usize).to_vec();
            LocalFree(data_out.pb_data);
            Ok(result)
        } else {
            Err("DPAPI encryption failed".to_string())
        }
    }
}

fn dpapi_decrypt(ciphertext: &[u8]) -> Result<Vec<u8>, String> {
    unsafe {
        let data_in = Blob {
            cb_data: ciphertext.len() as u32,
            pb_data: ciphertext.as_ptr() as *mut u8,
        };
        let mut data_out = Blob {
            cb_data: 0,
            pb_data: std::ptr::null_mut(),
        };

        if CryptUnprotectData(
            &data_in as *const Blob,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            0,
            &mut data_out as *mut Blob,
        ) != 0
        {
            let result =
                std::slice::from_raw_parts(data_out.pb_data, data_out.cb_data as usize).to_vec();
            LocalFree(data_out.pb_data);
            Ok(result)
        } else {
            Err("DPAPI decryption failed".to_string())
        }
    }
}

// --- JWT Key Management ---

pub fn load_or_create_jwt_key(conn: &rusqlite::Connection) -> Result<Vec<u8>, String> {
    let mut stmt = conn
        .prepare("SELECT encrypted_key FROM jwt_signing_key WHERE id = 1")
        .map_err(|e| format!("Failed to query jwt_signing_key: {}", e))?;

    let existing: Option<Vec<u8>> = stmt.query_row([], |row| row.get(0)).ok();

    if let Some(encrypted) = existing {
        dpapi_decrypt(&encrypted)
    } else {
        let key: [u8; 32] = rand::thread_rng().gen();
        let encrypted = dpapi_encrypt(&key)?;
        conn.execute(
            "INSERT INTO jwt_signing_key (id, encrypted_key) VALUES (1, ?1)",
            rusqlite::params![encrypted],
        )
        .map_err(|e| format!("Failed to store JWT signing key: {}", e))?;
        Ok(key.to_vec())
    }
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
        Some("NodeDesk".to_string()),
        "NodeDesk".to_string(),
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
}

pub fn create_jwt(jti: &str, key: &[u8]) -> Result<String, String> {
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

pub fn create_session(conn: &rusqlite::Connection, user_id: i64) -> Result<String, String> {
    let jti = Uuid::new_v4().to_string();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    let expires = now + JWT_EXPIRY_SECS;

    conn.execute(
        "INSERT INTO sessions (user_id, token_jti, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![user_id, jti, now, expires],
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

pub fn revoke_all_sessions(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute("DELETE FROM sessions", [])
        .map_err(|e| format!("Failed to revoke sessions: {}", e))?;
    Ok(())
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
    (code, Json(LoginResponse { success: false, message: msg.to_string() })).into_response()
}

pub async fn login_handler(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Form(form): Form<LoginForm>,
) -> Response {
    let user_id = 1i64;
    let ip = client_ip_from_headers(&headers);

    if state.lockout.check_locked(user_id) {
        let conn = state.db.lock().await;
        let _ = db::insert_audit_log(&conn, "login_locked", Some("Account locked"), Some(&ip));
        drop(conn);
        return login_err(StatusCode::TOO_MANY_REQUESTS, "Account locked. Try again in 15 minutes.");
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
        Err(_) => return login_err(StatusCode::INTERNAL_SERVER_ERROR, "Server configuration error"),
    };

    if !verify_totp_code(&secret_bytes, &form.totp_code) {
        let attempts = state.lockout.record_failure(user_id);
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
    let jti = {
        let conn = state.db.lock().await;
        let result = create_session(&conn, user_id);
        drop(conn);
        match result {
            Ok(j) => j,
            Err(e) => return login_err(StatusCode::INTERNAL_SERVER_ERROR, &format!("Session creation failed: {}", e)),
        }
    };

    let token = match create_jwt(&jti, &state.jwt_key) {
        Ok(t) => t,
        Err(e) => return login_err(StatusCode::INTERNAL_SERVER_ERROR, &format!("Token creation failed: {}", e)),
    };

    {
        let conn = state.db.lock().await;
        let _ = db::insert_audit_log(&conn, "login_success", Some("Login successful"), Some(&ip));
        let _ = db::wal_checkpoint(&conn);
    }

    let cookie = format!(
        "token={}; HttpOnly; SameSite=Strict; Max-Age={}; Path=/",
        token, JWT_EXPIRY_SECS
    );

    (
        StatusCode::OK,
        [("Set-Cookie", cookie.as_str())],
        Json(LoginResponse {
            success: true,
            message: "Login successful".to_string(),
        }),
    )
        .into_response()
}

// --- Auth Check Handler ---

#[derive(Serialize)]
pub struct AuthCheckResponse {
    authenticated: bool,
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
                Some(t) => match verify_jwt(t, &state.jwt_key) {
                    Ok(claims) => {
                        let conn = state.db.lock().await;
                        verify_session(&conn, &claims.jti).unwrap_or(false)
                    }
                    Err(_) => false,
                },
                None => false,
            }
        }
        None => false,
    };

    Json(AuthCheckResponse { authenticated })
}

// --- Auth Middleware ---

pub async fn auth_middleware(
    State(state): State<AppState>,
    req: Request,
    next: middleware::Next,
) -> Response {
    let path = req.uri().path().to_string();

    let needs_setup = {
        let conn = state.db.lock().await;
        db::is_setup_complete(&conn).map(|c| !c).unwrap_or(true)
    };

    if needs_setup {
        if path.starts_with("/setup") || path.starts_with("/api/setup") || path == "/api/auth/check" {
            return next.run(req).await;
        }
        return Redirect::to("/setup").into_response();
    }

    if path == "/login" || path.starts_with("/setup") || path.starts_with("/api/setup") || path == "/" || path == "/api/auth/check" {
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
                    verify_session(&conn, &claims.jti).unwrap_or(false)
                };
                if valid {
                    next.run(req).await
                } else {
                    (StatusCode::UNAUTHORIZED, "Session expired or revoked").into_response()
                }
            }
            Err(_) => (StatusCode::UNAUTHORIZED, "Invalid token").into_response(),
        },
        None => (StatusCode::UNAUTHORIZED, "No auth token").into_response(),
    }
}

fn parse_cookie<'a>(cookie_str: &'a str, name: &str) -> Option<&'a str> {
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

    if path == "/login" || path.starts_with("/setup") || path.starts_with("/api/setup") || path == "/api/auth/check" {
        return next.run(req).await;
    }

    let ip_str = client_ip_from_headers(req.headers());
    let parsed: std::net::IpAddr = ip_str
        .parse()
        .unwrap_or(std::net::IpAddr::V4(std::net::Ipv4Addr::new(127, 0, 0, 1)));
    let sock = SocketAddr::new(parsed, 0);

    match state.rate_limiter.check_key(&sock) {
        Ok(_) => next.run(req).await,
        Err(_) => (
            StatusCode::TOO_MANY_REQUESTS,
            "Rate limit exceeded. Try again later.",
        )
            .into_response(),
    }
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
        let token = create_jwt("test-jti", JWT_KEY).unwrap();
        let claims = verify_jwt(&token, JWT_KEY).unwrap();
        assert_eq!(claims.sub, "1");
        assert_eq!(claims.jti, "test-jti");
    }

    #[test]
    fn test_jwt_invalid_signature() {
        let token = create_jwt("test-jti", JWT_KEY).unwrap();
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
        };
        let token = encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(JWT_KEY),
        )
        .unwrap();
        assert!(verify_jwt(&token, JWT_KEY).is_err());
    }

    // --- DPAPI ---

    #[ignore]
    #[test]
    fn test_dpapi_encrypt_decrypt_roundtrip() {
        let data = b"Hello, NodeDesk!";
        let encrypted = dpapi_encrypt(data).unwrap();
        let decrypted = dpapi_decrypt(&encrypted).unwrap();
        assert_eq!(data.to_vec(), decrypted);
    }

    // --- Sessions ---

    #[test]
    fn test_create_session() {
        let conn = test_conn();
        conn.execute(
            "INSERT INTO users (password_hash, totp_secret, created_at, updated_at) VALUES ('hash', 'secret', 1000, 1000)",
            [],
        ).unwrap();
        let jti = create_session(&conn, 1).unwrap();
        assert!(!jti.is_empty());
        assert!(Uuid::parse_str(&jti).is_ok());
    }

    #[test]
    fn test_verify_valid_session() {
        let conn = test_conn();
        conn.execute(
            "INSERT INTO users (password_hash, totp_secret, created_at, updated_at) VALUES ('hash', 'secret', 1000, 1000)",
            [],
        ).unwrap();
        let jti = create_session(&conn, 1).unwrap();
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
            "INSERT INTO users (password_hash, totp_secret, created_at, updated_at) VALUES ('hash', 'secret', 1000, 1000)",
            [],
        ).unwrap();
        create_session(&conn, 1).unwrap();
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
            "INSERT INTO users (password_hash, totp_secret, created_at, updated_at) VALUES ('hash', 'secret', 1000, 1000)",
            [],
        ).unwrap();
        let jti1 = create_session(&conn, 1).unwrap();
        let jti2 = create_session(&conn, 1).unwrap();
        assert_ne!(jti1, jti2);
        assert!(verify_session(&conn, &jti1).unwrap());
        assert!(verify_session(&conn, &jti2).unwrap());
    }

    #[test]
    fn test_expired_session() {
        let conn = test_conn();
        conn.execute(
            "INSERT INTO users (password_hash, totp_secret, created_at, updated_at) VALUES ('hash', 'secret', 1000, 1000)",
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
}
