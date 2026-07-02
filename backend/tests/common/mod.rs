use std::sync::Arc;

use axum::body::Body;
use axum::http::Request;
use axum::Router;
use governor::{Quota, RateLimiter};
use rusqlite::Connection;

use tokio::sync::{broadcast, Mutex};
use tower::ServiceExt;

use nodedesk_agent::auth::LockoutState;
use nodedesk_agent::db::{self, TelemetrySnapshot};
use nodedesk_agent::get_data_dir;
use nodedesk_agent::setup::SetupManager;
use nodedesk_agent::{AppState, MockOs, PowerState, ScriptState, SystemCommands, TunnelState};

pub const TEST_JWT_KEY: &[u8] = b"01234567890123456789012345678901";

/// Build a Router + AppState with in-memory SQLite.
pub fn test_app() -> (Router, AppState) {
    test_app_with_seeded(|_| {})
}

/// Build a Router seeded with a user for authenticated tests.
/// Returns (router, user_totp_secret) so tests can generate TOTP codes.
pub fn test_app_with_user() -> (Router, Vec<u8>) {
    let secret = nodedesk_agent::auth::generate_totp_secret();
    let password = "TestP@ss123";
    let router = test_app_with_seeded(|conn| {
        seed_user(conn, password, &secret);
    });
    (router.0, secret)
}

/// Like `test_app_with_seeded` but returns the MockOs for assertions.
/// Power OS commands are recorded instead of executed.
pub fn test_app_with_mock(
    seed: impl FnOnce(&Connection),
) -> (Router, AppState, Arc<MockOs>) {
    let mock = Arc::new(MockOs::new());
    let router = test_app_inner(seed, mock.clone() as Arc<dyn SystemCommands>);
    (router.0, router.1, mock)
}

/// Like `test_app` but seeds the DB with a closure before wrapping in Arc<Mutex>.
/// All tests use MockOs by default — power OS commands are never actually executed.
pub fn test_app_with_seeded(seed: impl FnOnce(&Connection)) -> (Router, AppState) {
    test_app_inner(seed, Arc::new(MockOs::new()))
}

fn test_app_inner(
    seed: impl FnOnce(&Connection),
    commands: Arc<dyn SystemCommands>,
) -> (Router, AppState) {
    let conn = Connection::open_in_memory().unwrap();
    db::init_telemetry_table(&conn).unwrap();
    db::init_auth_tables(&conn).unwrap();

    seed(&conn);

    let db = Arc::new(Mutex::new(conn));
    let jwt_key = Arc::new(TEST_JWT_KEY.to_vec());
    let lockout = Arc::new(LockoutState::new());
    let setup_manager = Arc::new(SetupManager::new());
    let rate_limiter = Arc::new(RateLimiter::keyed(
        Quota::per_second(std::num::NonZeroU32::new(60).unwrap())
            .allow_burst(std::num::NonZeroU32::new(5).unwrap()),
    ));
    let (telemetry_tx, _) = broadcast::channel::<Arc<TelemetrySnapshot>>(256);
    let (system_tx, _) = broadcast::channel::<String>(16);
    let (clipboard_tx, _) = broadcast::channel::<String>(16);
    let power_state = Arc::new(PowerState::with_commands(commands));
    let script_state = Arc::new(ScriptState::new());

    let (tunnel_state, _) = TunnelState::new(&get_data_dir(), 3939);
    let app_state = AppState {
        telemetry_tx,
        system_tx,
        clipboard_tx,
        db,
        jwt_key,
        lockout,
        setup_manager,
        rate_limiter,
        power_state,
        script_state,
        tunnel_state: Arc::new(tunnel_state),
        port: 3939,
        setup_token: Arc::new("test-setup-token-123".to_string()),
    };

    let router = nodedesk_agent::build_router(app_state.clone());
    (router, app_state)
}

/// Collect the response body into a String
pub async fn body_string(resp: axum::response::Response) -> String {
    let body = resp.into_body();
    let bytes = axum::body::to_bytes(body, 1024 * 1024).await.unwrap();
    String::from_utf8(bytes.to_vec()).unwrap()
}

/// Collect the response body into a serde_json::Value
pub async fn body_json(resp: axum::response::Response) -> serde_json::Value {
    let s = body_string(resp).await;
    serde_json::from_str(&s).unwrap()
}

/// Seed a user into the DB. Exported for reuse by other test modules.
pub fn seed_user(conn: &rusqlite::Connection, password: &str, totp_secret: &[u8]) {
    let hash = nodedesk_agent::auth::hash_password(password).unwrap();
    let b32 = nodedesk_agent::auth::totp_secret_to_b32(totp_secret);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    conn.execute(
        "INSERT INTO users (password_hash, totp_secret, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![hash, b32, now, now],
    ).unwrap();
}

/// Perform a login request and return the HTTP response
pub async fn login_request(
    router: &mut Router,
    password: &str,
    totp_code: &str,
) -> axum::response::Response {
    let body = format!("password={}&totp_code={}", password, totp_code);
    let req = Request::post("/login")
        .header("content-type", "application/x-www-form-urlencoded")
        .body(Body::from(body))
        .unwrap();
    router.clone().oneshot(req).await.unwrap()
}

/// Login and extract the Set-Cookie value
pub async fn login_and_cookie(router: &mut Router, secret: &[u8]) -> String {
    let code = nodedesk_agent::auth::create_totp(secret.to_vec())
        .generate_current()
        .unwrap();
    let resp = login_request(router, "TestP@ss123", &code).await;
    assert_eq!(resp.status(), 200);
    resp.headers()
        .get("set-cookie")
        .unwrap()
        .to_str()
        .unwrap()
        .to_string()
}

/// Helper: send a GET request and return the response
pub async fn get(router: &mut Router, path: &str) -> axum::response::Response {
    let req = Request::get(path).body(Body::empty()).unwrap();
    router.clone().oneshot(req).await.unwrap()
}

/// Helper: send a POST request with JSON body
pub async fn post_json(
    router: &mut Router,
    path: &str,
    body: serde_json::Value,
) -> axum::response::Response {
    let body = serde_json::to_string(&body).unwrap();
    let req = Request::post(path)
        .header("content-type", "application/json")
        .body(Body::from(body))
        .unwrap();
    router.clone().oneshot(req).await.unwrap()
}

/// Helper: send an authenticated GET request with a cookie
pub async fn authed_get(router: &mut Router, path: &str, cookie: &str) -> axum::response::Response {
    let req = Request::get(path)
        .header("cookie", cookie)
        .body(Body::empty())
        .unwrap();
    router.clone().oneshot(req).await.unwrap()
}

/// Helper: send an authenticated POST request with JSON body
pub async fn authed_post_json(
    router: &mut Router,
    path: &str,
    cookie: &str,
    body: serde_json::Value,
) -> axum::response::Response {
    let body = serde_json::to_string(&body).unwrap();
    let req = Request::post(path)
        .header("cookie", cookie)
        .header("content-type", "application/json")
        .body(Body::from(body))
        .unwrap();
    router.clone().oneshot(req).await.unwrap()
}
