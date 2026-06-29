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
use nodedesk_agent::setup::SetupManager;
use nodedesk_agent::AppState;

pub const TEST_JWT_KEY: &[u8] = b"01234567890123456789012345678901";

/// Build a Router + AppState with in-memory SQLite.
/// The seed closure receives a plain `&Connection` before it's wrapped in Mutex,
/// so it can safely use sync rusqlite methods.
pub fn test_app() -> (Router, AppState) {
    test_app_with_seeded(|_| {})
}

/// Like `test_app` but seeds the DB with a closure before wrapping in Arc<Mutex>.
/// The closure runs synchronously (no tokio runtime needed), so it can use
/// blocking DB operations safely.
pub fn test_app_with_seeded(seed: impl FnOnce(&Connection)) -> (Router, AppState) {
    let conn = Connection::open_in_memory().unwrap();
    db::init_telemetry_table(&conn).unwrap();
    db::init_auth_tables(&conn).unwrap();

    conn.execute(
        "INSERT INTO jwt_signing_key (id, encrypted_key) VALUES (1, ?1)",
        rusqlite::params![TEST_JWT_KEY.to_vec()],
    )
    .unwrap();

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

    let app_state = AppState {
        telemetry_tx,
        db,
        jwt_key,
        lockout,
        setup_manager,
        rate_limiter,
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

/// Extract a hidden form field from HTML: name="{name}" value="{value}"
pub fn extract_field(html: &str, name: &str) -> Option<String> {
    let pattern = format!(r#"name="{}" value="([^"]*)""#, name);
    let re = regex::Regex::new(&pattern).ok()?;
    re.captures(html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
}

/// Extract the base32 TOTP secret from step 2 HTML: <code>ABCD1234</code>
pub fn extract_totp_secret(html: &str) -> Option<String> {
    let re = regex::Regex::new(r"<code>([A-Z2-7]+)</code>").ok()?;
    re.captures(html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
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

/// Helper: send a GET request and return the response
pub async fn get(router: &mut Router, path: &str) -> axum::response::Response {
    let req = Request::get(path).body(Body::empty()).unwrap();
    router.clone().oneshot(req).await.unwrap()
}

/// Helper: send a POST request with form body and return the response
pub async fn post(router: &mut Router, path: &str, form_body: &str) -> axum::response::Response {
    let req = Request::post(path)
        .header("content-type", "application/x-www-form-urlencoded")
        .body(Body::from(form_body.to_string()))
        .unwrap();
    router.clone().oneshot(req).await.unwrap()
}
