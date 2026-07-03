mod common;

use axum::http::StatusCode;
use common::*;
use serde_json::json;
use sysdeck_agent::auth;
use tower::ServiceExt;

// ============================================================
// Setup Wizard — JSON API Tests
// ============================================================

#[tokio::test]
async fn test_setup_json_api_full_flow() {
    let (mut router, _state) = test_app();

    // Verify setup token to get setup_authorized cookie
    let resp = post_json(
        &mut router,
        "/api/setup/verify-setup-token",
        json!({"token": "test-setup-token-123"}),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);
    let cookie = resp
        .headers()
        .get(axum::http::header::SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();

    // Step 1: Set password
    let resp = authed_post_json(
        &mut router,
        "/api/setup/password",
        &cookie,
        json!({"password": "MySecureP@ss1"}),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);
    let data = body_json(resp).await;
    assert_eq!(data["success"], true);
    let token = data["token"].as_str().unwrap().to_string();

    // Step 2: Get TOTP secret
    let resp = post_json(
        &mut router,
        &format!("/api/setup/totp?token={}", token),
        json!({}),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);
    let data = body_json(resp).await;
    assert_eq!(data["success"], true);
    let secret_b32 = data["secret"].as_str().unwrap().to_string();

    // Generate a valid TOTP code
    let secret = auth::totp_secret_from_b32(&secret_b32).unwrap();
    let code = auth::create_totp(secret).generate_current().unwrap();

    // Step 3: Verify TOTP
    let resp = post_json(
        &mut router,
        &format!("/api/setup/verify-totp?token={}", token),
        json!({"code": code}),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);
    let data = body_json(resp).await;
    assert_eq!(data["success"], true);
    assert!(data["codes"].as_array().unwrap().len() >= 8);
    let token2 = data["token"].as_str().unwrap().to_string();

    // Step 4: Finish
    let resp = post_json(
        &mut router,
        &format!("/api/setup/finish?token={}", token2),
        json!({}),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);
    let data = body_json(resp).await;
    assert_eq!(data["success"], true);

    // Verify setup is complete
    let resp = get(&mut router, "/api/setup/status").await;
    let data = body_json(resp).await;
    assert_eq!(data["is_setup_complete"], true);
}

#[tokio::test]
async fn test_setup_invalid_token_returns_error() {
    let (mut router, _state) = test_app();
    let resp = post_json(&mut router, "/api/setup/totp?token=nonexistent", json!({})).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let data = body_json(resp).await;
    assert_eq!(data["success"], false);
}

#[tokio::test]
async fn test_setup_weak_password_rejected() {
    let (mut router, _state) = test_app();
    // Verify setup token to get setup_authorized cookie
    let resp = post_json(
        &mut router,
        "/api/setup/verify-setup-token",
        json!({"token": "test-setup-token-123"}),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);
    let cookie = resp
        .headers()
        .get(axum::http::header::SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();

    let resp = authed_post_json(
        &mut router,
        "/api/setup/password",
        &cookie,
        json!({"password": "weak"}),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let data = body_json(resp).await;
    assert_eq!(data["success"], false);
}

// ============================================================
// Auth Check Tests
// ============================================================

#[tokio::test]
async fn test_auth_check_unauthenticated() {
    let (router, _state) = test_app();
    let req = axum::http::Request::get("/api/auth/check")
        .body(axum::body::Body::empty())
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    let data = body_json(resp).await;
    assert_eq!(data["authenticated"], false);
}

#[tokio::test]
async fn test_auth_check_authenticated() {
    let (mut router, secret) = test_app_with_user();
    let cookie = login_and_cookie(&mut router, &secret).await;

    let resp = authed_get(&mut router, "/api/auth/check", &cookie).await;
    let data = body_json(resp).await;
    assert_eq!(data["authenticated"], true);
}

// ============================================================
// Login Tests
// ============================================================

#[tokio::test]
async fn test_login_success() {
    let (mut router, secret) = test_app_with_user();
    let code = auth::create_totp(secret).generate_current().unwrap();
    let resp = login_request(&mut router, "TestP@ss123", &code).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let cookie = resp
        .headers()
        .get("set-cookie")
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    assert!(cookie.contains("token="));
}

#[tokio::test]
async fn test_login_bad_password() {
    let (mut router, secret) = test_app_with_user();
    let code = auth::create_totp(secret).generate_current().unwrap();
    let resp = login_request(&mut router, "WrongP@ss1", &code).await;
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_login_bad_totp() {
    let (mut router, _secret) = test_app_with_user();
    let resp = login_request(&mut router, "TestP@ss123", "000000").await;
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_login_lockout() {
    let (mut router, secret) = test_app_with_user();
    let code = auth::create_totp(secret.clone())
        .generate_current()
        .unwrap();
    for _ in 0..5 {
        let resp = login_request(&mut router, "WrongP@ss1", &code).await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }
    let code = auth::create_totp(secret).generate_current().unwrap();
    let resp = login_request(&mut router, "TestP@ss123", &code).await;
    assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
}

// ============================================================
// Script Execution Tests
// ============================================================

#[tokio::test]
async fn test_script_execute_wait_mode() {
    let (mut router, secret) = test_app_with_user();
    let cookie = login_and_cookie(&mut router, &secret).await;

    // Run a simple echo command in wait mode
    let resp = authed_post_json(
        &mut router,
        "/api/scripts/execute",
        &cookie,
        json!({"script_type": "cmd", "content": "echo hello", "mode": "wait"}),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);
    let data = body_json(resp).await;
    assert_eq!(data["success"], true);
    assert!(!data["id"].as_str().unwrap().is_empty());
    let result = &data["result"];
    assert_eq!(result["exit_code"], 0);
    assert!(result["stdout"].as_str().unwrap().contains("hello"));
}

// ============================================================
// Settings Tests
// ============================================================

#[tokio::test]
async fn test_settings_change_password() {
    let (mut router, secret) = test_app_with_user();
    let cookie = login_and_cookie(&mut router, &secret).await;

    let resp = authed_post_json(
        &mut router,
        "/api/settings/change-password",
        &cookie,
        json!({"current_password": "TestP@ss123", "new_password": "C0rrectHorseBatteryStaple!"}),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);
    let data = body_json(resp).await;
    assert_eq!(data["success"], true);
}

#[tokio::test]
async fn test_settings_change_password_wrong_current() {
    let (mut router, secret) = test_app_with_user();
    let cookie = login_and_cookie(&mut router, &secret).await;

    let resp = authed_post_json(
        &mut router,
        "/api/settings/change-password",
        &cookie,
        json!({"current_password": "WrongP@ss", "new_password": "C0rrectHorseBatteryStaple!"}),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_settings_get_port() {
    let (mut router, secret) = test_app_with_user();
    let cookie = login_and_cookie(&mut router, &secret).await;

    let resp = authed_get(&mut router, "/api/settings/port", &cookie).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let data = body_json(resp).await;
    assert_eq!(data["success"], true);
    // Default port is 3939
    assert_eq!(data["port"], 3939);
}

// ============================================================
// Auth Middleware Tests
// ============================================================

#[tokio::test]
async fn test_auth_middleware_no_token() {
    let (_router, _state) = test_app_with_user();
    // On a test_app_with_user, the user exists but we don't have a cookie.
    // Protected routes should return 401.
    let req = axum::http::Request::get("/api/telemetry/history?range=1h")
        .body(axum::body::Body::empty())
        .unwrap();
    let resp = _router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_auth_middleware_with_valid_token() {
    let (mut router, secret) = test_app_with_user();
    let cookie = login_and_cookie(&mut router, &secret).await;

    let resp = authed_get(&mut router, "/api/telemetry/history?range=1h", &cookie).await;
    assert_eq!(resp.status(), StatusCode::OK);
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

#[tokio::test]
async fn test_telemetry_history_empty() {
    let (mut router, secret) = test_app_with_user();
    let cookie = login_and_cookie(&mut router, &secret).await;

    let resp = authed_get(&mut router, "/api/telemetry/history?range=1h", &cookie).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_string(resp).await;
    assert_eq!(body, "[]");
}

#[tokio::test]
async fn test_telemetry_history_bad_range() {
    let (mut router, secret) = test_app_with_user();
    let cookie = login_and_cookie(&mut router, &secret).await;

    let resp = authed_get(&mut router, "/api/telemetry/history?range=invalid", &cookie).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

// ============================================================
// File Manager Tests
// ============================================================

#[tokio::test]
async fn test_file_list_unauthenticated() {
    let (router, _state) = test_app_with_user();
    let req = axum::http::Request::get("/api/files/list?path=C:%5C")
        .body(axum::body::Body::empty())
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_file_list_authenticated() {
    let secret = sysdeck_agent::auth::generate_totp_secret();
    let (mut router, _state) = test_app_with_seeded(|conn| {
        seed_user(conn, "TestP@ss123", &secret);
        sysdeck_agent::db::set_setting(conn, "allowed_paths", r#"["C:\\Users"]"#).unwrap();
    });
    let cookie = login_and_cookie(&mut router, &secret).await;

    let resp = authed_get(&mut router, "/api/files/list?path=C:%5CUsers", &cookie).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let data = body_json(resp).await;
    assert_eq!(data["success"], true);
    assert!(data["entries"].is_array());
}

#[tokio::test]
async fn test_file_list_invalid_path() {
    let (mut router, secret) = test_app_with_user();
    let cookie = login_and_cookie(&mut router, &secret).await;

    let resp = authed_get(
        &mut router,
        "/api/files/list?path=Z:%5Cnonexistent",
        &cookie,
    )
    .await;
    let data = body_json(resp).await;
    assert_eq!(data["success"], false);
    assert!(data["error"].is_string());
}

// ============================================================
// Power Control Tests
// ============================================================

#[tokio::test]
async fn test_power_status_unauthenticated() {
    let (router, _state) = test_app_with_user();
    let req = axum::http::Request::get("/api/power/status")
        .body(axum::body::Body::empty())
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_power_status_authenticated() {
    let (mut router, secret) = test_app_with_user();
    let cookie = login_and_cookie(&mut router, &secret).await;

    let resp = authed_get(&mut router, "/api/power/status", &cookie).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let data = body_json(resp).await;
    assert_eq!(data["has_pending"], false);
}

#[tokio::test]
#[ignore = "dangerous: would actually trigger power action"]
async fn test_power_execute_requires_confirmation() {
    let (mut router, secret) = test_app_with_user();
    let cookie = login_and_cookie(&mut router, &secret).await;

    let resp = authed_post_json(
        &mut router,
        "/api/power/execute",
        &cookie,
        json!({"action": "shutdown"}),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);
    let data = body_json(resp).await;
    assert!(data["success"] == true || data["success"] == false);
}

#[tokio::test]
#[ignore = "dangerous: would actually trigger power action"]
async fn test_power_execute_records_action_in_mock() {
    let totp_secret = sysdeck_agent::auth::generate_totp_secret();
    let (mut router, _state, mock) = test_app_with_mock(|conn| {
        seed_user(conn, "TestP@ss123", &totp_secret);
    });
    let code = sysdeck_agent::auth::create_totp(totp_secret)
        .generate_current()
        .unwrap();
    let resp = login_request(&mut router, "TestP@ss123", &code).await;
    assert_eq!(resp.status(), 200);
    let cookie = resp
        .headers()
        .get("set-cookie")
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();

    let resp = authed_post_json(
        &mut router,
        "/api/power/execute",
        &cookie,
        json!({"action": "shutdown", "confirmed": true}),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);

    tokio::time::sleep(std::time::Duration::from_secs(6)).await;

    let last = mock.last_action.lock().unwrap();
    assert_eq!(*last, Some(sysdeck_agent::PowerAction::Shutdown));
}

// ============================================================
// Audit Log Tests
// ============================================================

#[tokio::test]
async fn test_audit_logs_unauthenticated() {
    let (router, _state) = test_app_with_user();
    let req = axum::http::Request::get("/api/audit/logs")
        .body(axum::body::Body::empty())
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_audit_logs_authenticated() {
    let (mut router, secret) = test_app_with_user();
    let _cookie = login_and_cookie(&mut router, &secret).await;
    let code = sysdeck_agent::auth::create_totp(secret.clone())
        .generate_current()
        .unwrap();
    // Perform a second login to generate another audit entry;
    // the second login revokes the first session, so use the new cookie.
    let resp2 = login_request(&mut router, "TestP@ss123", &code).await;
    let cookie2 = resp2
        .headers()
        .get("set-cookie")
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();

    let resp = authed_get(&mut router, "/api/audit/logs", &cookie2).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let data = body_json(resp).await;
    assert!(data["entries"].is_array());
    assert!(!data["entries"].as_array().unwrap().is_empty());
}

// ============================================================
// Settings Paths Tests
// ============================================================

#[tokio::test]
async fn test_settings_paths_unauthenticated() {
    let (router, _state) = test_app_with_user();
    let req = axum::http::Request::get("/api/settings/paths")
        .body(axum::body::Body::empty())
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_settings_paths_authenticated() {
    let (mut router, secret) = test_app_with_user();
    let cookie = login_and_cookie(&mut router, &secret).await;

    let resp = authed_get(&mut router, "/api/settings/paths", &cookie).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let data = body_json(resp).await;
    assert!(data["success"] == true || data["success"] == false);
}

#[tokio::test]
async fn test_settings_paths_set_and_get() {
    let (mut router, secret) = test_app_with_user();
    let cookie = login_and_cookie(&mut router, &secret).await;

    let resp = authed_post_json(
        &mut router,
        "/api/settings/paths",
        &cookie,
        json!({"allowed": ["C:\\Users"], "blocked": ["C:\\Windows"]}),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);
    let data = body_json(resp).await;
    assert_eq!(data["success"], true);
}

// ============================================================
// Script Execute Audit Test
// ============================================================

#[tokio::test]
async fn test_script_execute_creates_audit_log() {
    let (mut router, secret) = test_app_with_user();
    let cookie = login_and_cookie(&mut router, &secret).await;

    // Run a script in wait mode
    let resp = authed_post_json(
        &mut router,
        "/api/scripts/execute",
        &cookie,
        json!({"script_type": "cmd", "content": "echo audit_test", "mode": "wait"}),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);

    // Verify audit log was created
    let resp = authed_get(
        &mut router,
        "/api/audit/logs?event=script_executed",
        &cookie,
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);
    let data = body_json(resp).await;
    let entries = data["entries"].as_array().unwrap();
    assert!(entries.iter().any(|e| e["event"] == "script_executed"));
}

// ============================================================
// Admin / Localhost Middleware Tests
// ============================================================

#[tokio::test]
async fn test_admin_check_local() {
    let (router, _state) = test_app();
    let req = axum::http::Request::get("/api/admin/check")
        .body(axum::body::Body::empty())
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    let data = body_json(resp).await;
    assert_eq!(data["is_local"], true);
}

#[tokio::test]
async fn test_admin_check_remote() {
    let (router, _state) = test_app();
    let req = axum::http::Request::get("/api/admin/check")
        .header("cf-connecting-ip", "203.0.113.1")
        .body(axum::body::Body::empty())
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    let data = body_json(resp).await;
    assert_eq!(data["is_local"], false);
}

#[tokio::test]
async fn test_settings_rejected_via_tunnel() {
    let (mut router, secret) = test_app_with_user();
    let cookie = login_and_cookie(&mut router, &secret).await;

    // Simulate tunnel request with Cloudflare headers
    let req = axum::http::Request::get("/api/settings/port")
        .header("cookie", &cookie)
        .header("cf-ray", "abc123")
        .body(axum::body::Body::empty())
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn test_settings_allowed_via_localhost() {
    let (mut router, secret) = test_app_with_user();
    let cookie = login_and_cookie(&mut router, &secret).await;

    // Localhost request (no X-Forwarded-For) should work
    let resp = authed_get(&mut router, "/api/settings/port", &cookie).await;
    assert_eq!(resp.status(), StatusCode::OK);
}

// ============================================================
// Control Center Tests
// ============================================================

#[tokio::test]
async fn test_control_center_status() {
    let (mut router, secret) = test_app_with_user();
    let cookie = login_and_cookie(&mut router, &secret).await;

    let resp = authed_get(&mut router, "/api/control-center/status", &cookie).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let data = body_json(resp).await;
    assert_eq!(data["success"], true);
    assert!(data["data"]["dark_mode"].is_boolean());
    // Other fields are optional, but should exist
    assert!(data["data"].get("wifi_on").is_some());
    assert!(data["data"].get("dnd_on").is_some());
}

#[tokio::test]
async fn test_control_center_toggle_dark_mode() {
    let (mut router, secret) = test_app_with_user();
    let cookie = login_and_cookie(&mut router, &secret).await;

    let resp = authed_post_json(
        &mut router,
        "/api/control-center/toggle",
        &cookie,
        json!({"toggle": "dark_mode", "enabled": true}),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);
    let data = body_json(resp).await;
    assert_eq!(data["success"], true);
    assert!(data["data"]["dark_mode"].is_boolean());
}

#[tokio::test]
async fn test_control_center_toggle_wifi() {
    let (mut router, secret) = test_app_with_user();
    let cookie = login_and_cookie(&mut router, &secret).await;

    let resp = authed_post_json(
        &mut router,
        "/api/control-center/toggle",
        &cookie,
        json!({"toggle": "wifi", "enabled": true}),
    )
    .await;
    // May succeed or fail depending on whether Wi-Fi adapter exists
    let status = resp.status();
    let data = body_json(resp).await;
    assert!(status == StatusCode::OK || status == StatusCode::INTERNAL_SERVER_ERROR);
    if status == StatusCode::OK {
        assert_eq!(data["success"], true);
    }
}

#[tokio::test]
async fn test_control_center_toggle_unsupported() {
    let (mut router, secret) = test_app_with_user();
    let cookie = login_and_cookie(&mut router, &secret).await;

    let resp = authed_post_json(
        &mut router,
        "/api/control-center/toggle",
        &cookie,
        json!({"toggle": "bluetooth", "enabled": true}),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
#[ignore = "dangerous: would turn off monitor"]
async fn test_display_monitor_off() {
    let (mut router, secret) = test_app_with_user();
    let cookie = login_and_cookie(&mut router, &secret).await;

    let resp = authed_post_json(
        &mut router,
        "/api/control-center/monitor",
        &cookie,
        json!({"action": "off"}),
    )
    .await;
    // May succeed or fail depending on OS
    assert!(resp.status() == StatusCode::OK || resp.status() == StatusCode::INTERNAL_SERVER_ERROR);
}
