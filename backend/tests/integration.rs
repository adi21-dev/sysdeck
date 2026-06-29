mod common;

use axum::http::StatusCode;
use axum::Router;
use common::*;
use nodedesk_agent::auth;
use tower::ServiceExt;

// ============================================================
// Setup Wizard Tests
// ============================================================

#[tokio::test]
async fn test_setup_redirect_no_users() {
    let (mut router, _state) = test_app();
    let resp = get(&mut router, "/").await;
    assert_eq!(
        resp.status(),
        303,
        "Expected redirect to /setup for unauthenticated /"
    );
    let location = resp
        .headers()
        .get("location")
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    assert!(
        location.contains("/setup"),
        "Expected redirect to /setup, got: {}",
        location
    );
}

#[tokio::test]
async fn test_setup_wizard_full_flow() {
    let (mut router, _state) = test_app();

    // Step 1: Password creation
    let resp = post(
        &mut router,
        "/setup",
        "action=password&password=MySecureP@ss1&password_confirm=MySecureP@ss1",
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);
    let html = body_string(resp).await;
    assert!(html.contains("Step 2 of 4"), "Expected step 2, got: {html}");

    // Extract TOTP secret + state_token from step 2 HTML
    let secret_b32 = extract_totp_secret(&html).expect("TOTP secret not found in step 2");
    let token = extract_field(&html, "state_token").expect("state_token not found in step 2");

    // Step 2: Verify TOTP with a real code
    let secret = auth::totp_secret_from_b32(&secret_b32).unwrap();
    let code = auth::create_totp(secret).generate_current().unwrap();
    let body = format!(
        "action=verify_totp&state_token={}&totp_code={}",
        token, code
    );
    let resp = post(&mut router, "/setup", &body).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let html = body_string(resp).await;
    assert!(html.contains("Step 3 of 4"), "Expected step 3, got: {html}");

    // Step 3: Confirm recovery codes
    let token = extract_field(&html, "state_token").expect("state_token not found in step 3");
    let body = format!("action=confirm_codes&state_token={}", token);
    let resp = post(&mut router, "/setup", &body).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let html = body_string(resp).await;
    assert!(html.contains("Step 4 of 4"), "Expected step 4, got: {html}");

    // Step 4: Finish with relay opt-in
    let token = extract_field(&html, "state_token").expect("state_token not found in step 4");
    let body = format!("action=finish&state_token={}&relay_optin=on", token);
    let resp = post(&mut router, "/setup", &body).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let html = body_string(resp).await;
    assert!(
        html.contains("Setup Complete"),
        "Expected completion, got: {html}"
    );
}

#[tokio::test]
async fn test_setup_weak_password_rejected() {
    let (mut router, _state) = test_app();
    let resp = post(
        &mut router,
        "/setup",
        "action=password&password=weak&password_confirm=weak",
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);
    let html = body_string(resp).await;
    assert!(
        html.contains("too weak") || html.contains("8 characters"),
        "Expected password error, got: {html}"
    );
}

#[tokio::test]
async fn test_setup_already_completed_redirects() {
    let (mut router, _state) = test_app_with_seeded(|conn| {
        let hash = auth::hash_password("TestP@ss123").unwrap();
        let secret = auth::totp_secret_to_b32(&auth::generate_totp_secret());
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        conn.execute(
            "INSERT INTO users (password_hash, totp_secret, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![hash, secret, now, now],
        ).unwrap();
    });

    // GET /setup with existing user should redirect (303 See Other via Redirect::to("/"))
    let resp = get(&mut router, "/setup").await;
    assert_eq!(resp.status(), 303);

    // POST /setup with existing user should also redirect
    let resp = post(
        &mut router,
        "/setup",
        "action=password&password=MySecureP@ss1&password_confirm=MySecureP@ss1",
    )
    .await;
    assert_eq!(resp.status(), 303);
}

// ============================================================
// Login Tests
// ============================================================

fn seed_user(conn: &rusqlite::Connection, password: &str, totp_secret: &[u8]) {
    let hash = auth::hash_password(password).unwrap();
    let b32 = auth::totp_secret_to_b32(totp_secret);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    conn.execute(
        "INSERT INTO users (password_hash, totp_secret, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![hash, b32, now, now],
    ).unwrap();
}

#[tokio::test]
async fn test_login_success() {
    let secret = auth::generate_totp_secret();
    let password = "TestP@ss123";
    let (mut router, _state) = test_app_with_seeded(|conn| {
        seed_user(conn, password, &secret);
    });

    let code = auth::create_totp(secret).generate_current().unwrap();
    let resp = login_request(&mut router, password, &code).await;
    assert_eq!(resp.status(), StatusCode::OK);

    let cookie = resp
        .headers()
        .get("set-cookie")
        .expect("set-cookie header missing")
        .to_str()
        .unwrap()
        .to_string();
    assert!(!cookie.is_empty());
    assert!(cookie.contains("token="));
}

#[tokio::test]
async fn test_login_bad_password() {
    let secret = auth::generate_totp_secret();
    let (mut router, _state) = test_app_with_seeded(|conn| {
        seed_user(conn, "RealP@ss123", &secret);
    });

    let code = auth::create_totp(secret).generate_current().unwrap();
    let resp = login_request(&mut router, "WrongP@ss1", &code).await;
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_login_bad_totp() {
    let secret = auth::generate_totp_secret();
    let password = "TestP@ss123";
    let (mut router, _state) = test_app_with_seeded(|conn| {
        seed_user(conn, password, &secret);
    });

    let resp = login_request(&mut router, password, "000000").await;
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_login_lockout() {
    let secret = auth::generate_totp_secret();
    let password = "TestP@ss123";
    let (mut router, _state) = test_app_with_seeded(|conn| {
        seed_user(conn, password, &secret);
    });

    let code = auth::create_totp(secret).generate_current().unwrap();

    // 5 failed attempts with bad password
    for _ in 0..5 {
        let resp = login_request(&mut router, "WrongP@ss1", &code).await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    // 6th attempt should be locked even with correct credentials
    let resp = login_request(&mut router, password, &code).await;
    assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
}

// ============================================================
// Auth Middleware Tests
// ============================================================

#[tokio::test]
async fn test_auth_middleware_no_token() {
    let secret = auth::generate_totp_secret();
    let (router, _state) = test_app_with_seeded(|conn| {
        seed_user(conn, "TestP@ss123", &secret);
    });

    // Access /ws without auth token
    let req = axum::http::Request::get("/ws")
        .header("upgrade", "websocket")
        .header("connection", "upgrade")
        .header("sec-websocket-key", "dGhlIHNhbXBsZSBub25jZQ==")
        .header("sec-websocket-version", "13")
        .body(axum::body::Body::empty())
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_auth_middleware_with_valid_token() {
    let secret = auth::generate_totp_secret();
    let password = "TestP@ss123";
    let (mut router, _state) = test_app_with_seeded(|conn| {
        seed_user(conn, password, &secret);
    });

    // Login to get a valid token
    let code = auth::create_totp(secret).generate_current().unwrap();
    let resp = login_request(&mut router, password, &code).await;
    let cookie = resp
        .headers()
        .get("set-cookie")
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();

    // Use token to access /ws
    let req = axum::http::Request::get("/ws")
        .header("upgrade", "websocket")
        .header("connection", "upgrade")
        .header("sec-websocket-key", "dGhlIHNhbXBsZSBub25jZQ==")
        .header("sec-websocket-version", "13")
        .header("cookie", &cookie)
        .body(axum::body::Body::empty())
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    // Should get 101 Switching Protocols (or 426 Upgrade Required if WS headers not fully correct)
    // At minimum, should NOT be 401
    assert_ne!(resp.status(), StatusCode::UNAUTHORIZED);
}

// ============================================================
// CSP Header Tests
// ============================================================

#[tokio::test]
async fn test_csp_header_present() {
    let (mut router, _state) = test_app();
    let resp = get(&mut router, "/").await;
    let csp = resp
        .headers()
        .get("content-security-policy")
        .expect("CSP header missing")
        .to_str()
        .unwrap();
    assert!(csp.contains("default-src 'self'"));
    assert!(csp.contains("style-src 'self' 'unsafe-inline'"));
    assert!(csp.contains("img-src 'self' data:"));
    assert!(csp.contains("script-src 'self'"));
}

// ============================================================
// Telemetry / Parse Range Tests
// ============================================================

async fn login_and_extract_cookie(router: &mut Router, user_secret: &[u8]) -> String {
    let code = auth::create_totp(user_secret.to_vec())
        .generate_current()
        .unwrap();
    let resp = router
        .clone()
        .oneshot(
            axum::http::Request::post("/login")
                .header("content-type", "application/x-www-form-urlencoded")
                .body(axum::body::Body::from(format!(
                    "password=TestP@ss123&totp_code={}",
                    code
                )))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    resp.headers()
        .get("set-cookie")
        .unwrap()
        .to_str()
        .unwrap()
        .to_string()
}

#[tokio::test]
async fn test_telemetry_history_empty() {
    let secret = auth::generate_totp_secret();
    let password = "TestP@ss123";
    let (mut router, _state) = test_app_with_seeded(|conn| {
        seed_user(conn, password, &secret);
    });

    let cookie = login_and_extract_cookie(&mut router, &secret).await;

    let resp = router
        .clone()
        .oneshot(
            axum::http::Request::get("/api/telemetry/history?range=1h")
                .header("cookie", &cookie)
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_string(resp).await;
    assert_eq!(body, "[]");
}

// ============================================================
// Login Form Page (GET /login)
// ============================================================

#[tokio::test]
async fn test_login_page_returns_form() {
    let (mut router, _state) = test_app_with_seeded(|conn| {
        let hash = auth::hash_password("TestP@ss123").unwrap();
        let secret = auth::totp_secret_to_b32(&auth::generate_totp_secret());
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        conn.execute(
            "INSERT INTO users (password_hash, totp_secret, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![hash, secret, now, now],
        ).unwrap();
    });

    let resp = get(&mut router, "/login").await;
    assert_eq!(resp.status(), StatusCode::OK);
    let html = body_string(resp).await;
    assert!(html.contains("<h1>Login</h1>"), "Expected login heading, got: {html}");
    assert!(html.contains("name=\"password\""), "Expected password field, got: {html}");
    assert!(html.contains("name=\"totp_code\""), "Expected TOTP field, got: {html}");
    assert!(html.contains("action=\"/login\""), "Expected form action, got: {html}");
}

#[tokio::test]
async fn test_telemetry_history_bad_range() {
    let secret = auth::generate_totp_secret();
    let password = "TestP@ss123";
    let (mut router, _state) = test_app_with_seeded(|conn| {
        seed_user(conn, password, &secret);
    });

    let cookie = login_and_extract_cookie(&mut router, &secret).await;

    let resp = router
        .clone()
        .oneshot(
            axum::http::Request::get("/api/telemetry/history?range=invalid")
                .header("cookie", &cookie)
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}
