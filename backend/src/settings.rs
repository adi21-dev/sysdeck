use std::io::{Read, Write};

use axum::body::Body;
use tracing;
use axum::extract::State;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use bytes::Bytes;
use futures_util::stream;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::io::AsyncReadExt;
use zip::write::FileOptions;

use crate::auth;
use crate::db;
use crate::AppState;

fn ok_json(msg: &str) -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::OK,
        Json(json!({"success": true, "message": msg})),
    )
}

fn err_json(code: StatusCode, msg: &str) -> (StatusCode, Json<serde_json::Value>) {
    (code, Json(json!({"success": false, "message": msg})))
}

#[derive(Deserialize)]
pub struct PasswordChange {
    current_password: String,
    new_password: String,
}

pub async fn change_password_handler(
    State(state): State<AppState>,
    Json(body): Json<PasswordChange>,
) -> Response {
    let db_lock = state.db.lock().await;
    let result: Result<String, _> =
        db_lock.query_row("SELECT password_hash FROM users WHERE id = 1", [], |row| {
            row.get::<_, String>(0)
        });
    let current_hash = match result {
        Ok(r) => r,
        Err(_) => return err_json(StatusCode::NOT_FOUND, "User not found").into_response(),
    };
    drop(db_lock);

    if !auth::verify_password(&body.current_password, &current_hash).unwrap_or(false) {
        tracing::warn!(handler = "change_password_handler", "wrong current password");
        return err_json(StatusCode::UNAUTHORIZED, "Current password is incorrect").into_response();
    }

    if let Err(e) = auth::check_password_strength(&body.new_password) {
        return err_json(StatusCode::BAD_REQUEST, &e).into_response();
    }

    let new_hash = match auth::hash_password(&body.new_password) {
        Ok(h) => h,
        Err(e) => return err_json(StatusCode::INTERNAL_SERVER_ERROR, &e).into_response(),
    };

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    let db_lock = state.db.lock().await;
    if let Err(e) = db_lock.execute(
        "UPDATE users SET password_hash = ?1, updated_at = ?2 WHERE id = 1",
        rusqlite::params![new_hash, now],
    ) {
        return err_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("DB error: {}", e),
        )
        .into_response();
    }
    let _ = db::insert_audit_log(&db_lock, "password_changed", None, None);
    drop(db_lock);
    tracing::info!(handler = "change_password_handler", "password changed");
    ok_json("Password updated").into_response()
}

#[derive(Serialize)]
pub struct TotpResetResponse {
    success: bool,
    qr_svg: Option<String>,
    secret: Option<String>,
    message: Option<String>,
}

pub async fn reset_totp_handler(State(state): State<AppState>) -> Json<TotpResetResponse> {
    tracing::info!(handler = "reset_totp_handler", "TOTP reset initiated");
    let secret = auth::generate_totp_secret();
    let qr_svg = auth::generate_totp_qr_data_uri(&secret);
    let b32 = auth::totp_secret_to_b32(&secret);

    let db_lock = state.db.lock().await;
    let _ = db::insert_audit_log(&db_lock, "totp_reset_initiated", None, None);
    drop(db_lock);

    Json(TotpResetResponse {
        success: true,
        qr_svg: Some(qr_svg),
        secret: Some(b32),
        message: None,
    })
}

#[derive(Deserialize)]
pub struct VerifyTotpBody {
    secret: String,
    code: String,
}

pub async fn verify_totp_handler(
    State(state): State<AppState>,
    Json(body): Json<VerifyTotpBody>,
) -> Response {
    let secret_bytes = match auth::totp_secret_from_b32(&body.secret) {
        Ok(b) => b,
        Err(_) => {
            tracing::warn!(handler = "verify_totp_handler", "invalid secret format");
            return err_json(StatusCode::BAD_REQUEST, "Invalid secret format").into_response()
        }
    };

    if !auth::verify_totp_code(&secret_bytes, &body.code) {
        tracing::warn!(handler = "verify_totp_handler", "invalid TOTP code");
        return err_json(StatusCode::BAD_REQUEST, "Invalid TOTP code").into_response();
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    let db_lock = state.db.lock().await;
    if let Err(e) = db_lock.execute(
        "UPDATE users SET totp_secret = ?1, updated_at = ?2 WHERE id = 1",
        rusqlite::params![body.secret, now],
    ) {
        return err_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("DB error: {}", e),
        )
        .into_response();
    }
    let _ = db::insert_audit_log(&db_lock, "totp_reset_completed", None, None);
    drop(db_lock);
    tracing::info!(handler = "verify_totp_handler", "TOTP updated");
    ok_json("TOTP updated").into_response()
}

pub async fn list_recovery_codes_handler(State(state): State<AppState>) -> Response {
    tracing::info!(handler = "list_recovery_codes_handler", "recovery codes listed");
    let db_lock = state.db.lock().await;
    let codes: Vec<String> =
        match db_lock.prepare("SELECT code_hash FROM recovery_codes WHERE used = 0 ORDER BY id") {
            Ok(mut stmt) => stmt
                .query_map([], |row| row.get::<_, String>(0))
                .unwrap()
                .filter_map(|r| r.ok())
                .collect(),
            Err(_) => vec![],
        };
    drop(db_lock);
    Json(json!({"success": true, "codes": codes})).into_response()
}

pub async fn regenerate_recovery_codes_handler(State(state): State<AppState>) -> Response {
    tracing::info!(handler = "regenerate_recovery_codes_handler", "recovery codes regenerated");
    let plain_codes = auth::generate_recovery_codes();
    let hashes = match auth::hash_recovery_codes(&plain_codes) {
        Ok(h) => h,
        Err(e) => return err_json(StatusCode::INTERNAL_SERVER_ERROR, &e).into_response(),
    };

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    let db_lock = state.db.lock().await;
    let _ = db_lock.execute("DELETE FROM recovery_codes", []);
    for hash in &hashes {
        let _ = db_lock.execute(
            "INSERT INTO recovery_codes (code_hash, used, created_at) VALUES (?1, 0, ?2)",
            rusqlite::params![hash, now],
        );
    }
    let _ = db::insert_audit_log(&db_lock, "recovery_codes_regenerated", None, None);
    drop(db_lock);
    Json(json!({"success": true, "codes": plain_codes})).into_response()
}

pub async fn revoke_all_handler(State(state): State<AppState>) -> Response {
    tracing::info!(handler = "revoke_all_handler", "all sessions revoked");
    let db_lock = state.db.lock().await;
    match auth::revoke_all_sessions(&db_lock) {
        Ok(_) => {
            let _ = db::insert_audit_log(&db_lock, "all_sessions_revoked", None, None);
            drop(db_lock);
            ok_json("All sessions revoked").into_response()
        }
        Err(e) => {
            drop(db_lock);
            err_json(StatusCode::INTERNAL_SERVER_ERROR, &e).into_response()
        }
    }
}

pub async fn list_sessions_handler(
    State(state): State<AppState>,
    req: axum::extract::Request,
) -> Response {
    tracing::info!(handler = "list_sessions_handler", "sessions listed");
    let current_jti = req
        .headers()
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(|c| auth::parse_cookie(c, "token"))
        .and_then(|t| auth::verify_jwt(t, &state.jwt_key).ok())
        .map(|claims| claims.jti);

    let db_lock = state.db.lock().await;
    let sessions = auth::list_sessions(&db_lock, 1).unwrap_or_default();
    drop(db_lock);

    Json(json!({
        "success": true,
        "sessions": sessions,
        "current_jti": current_jti,
    }))
    .into_response()
}

#[derive(Deserialize)]
pub struct RevokeSessionBody {
    jti: String,
}

pub async fn revoke_session_handler(
    State(state): State<AppState>,
    Json(body): Json<RevokeSessionBody>,
) -> Response {
    tracing::info!(handler = "revoke_session_handler", jti = %&body.jti[..8], "session revoked");
    let db_lock = state.db.lock().await;
    match auth::revoke_session(&db_lock, &body.jti) {
        Ok(_) => {
            let _ = crate::db::insert_audit_log(
                &db_lock,
                "session_revoked",
                Some(&format!("Session {} revoked", &body.jti[..8])),
                None,
            );
            drop(db_lock);
            ok_json("Session revoked").into_response()
        }
        Err(e) => {
            drop(db_lock);
            err_json(StatusCode::INTERNAL_SERVER_ERROR, &e).into_response()
        }
    }
}

pub async fn export_db_handler(State(_state): State<AppState>) -> Response {
    tracing::info!(handler = "export_db_handler", "database export requested");
    let db_path = crate::get_db_path();
    let file = match tokio::fs::File::open(&db_path).await {
        Ok(f) => f,
        Err(e) => {
            return err_json(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("Failed to read DB: {}", e),
            )
            .into_response()
        }
    };

    let stream = stream::unfold(file, |mut file| async {
        let mut buf = vec![0u8; 65536];
        match file.read(&mut buf).await {
            Ok(0) => None,
            Ok(n) => {
                buf.truncate(n);
                Some((Ok::<_, std::io::Error>(Bytes::from(buf)), file))
            }
            Err(e) => Some((Err(e), file)),
        }
    });

    let filename = db_path.file_name().unwrap().to_str().unwrap_or("data.db");
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}\"", filename),
        )
        .body(Body::from_stream(stream))
        .unwrap()
}

pub async fn download_logs_handler(State(_state): State<AppState>) -> Response {
    tracing::info!(handler = "download_logs_handler", "log download requested");
    let logs_dir = crate::get_logs_dir();
    let mut buffer = Vec::new();
    {
        let mut zip_writer = zip::ZipWriter::new(std::io::Cursor::new(&mut buffer));
        let options: FileOptions<'_, ()> =
            FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

        if let Ok(entries) = std::fs::read_dir(&logs_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    let name = path.file_name().unwrap().to_str().unwrap_or("unknown");
                    if let Ok(mut file) = std::fs::File::open(&path) {
                        let mut contents = Vec::new();
                        if file.read_to_end(&mut contents).is_ok() {
                            let _ = zip_writer.start_file(name, options);
                            let _ = zip_writer.write_all(&contents);
                        }
                    }
                }
            }
        }
        let _ = zip_writer.finish();
    }

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/zip")
        .header(
            header::CONTENT_DISPOSITION,
            "attachment; filename=\"logs.zip\"",
        )
        .body(axum::body::Body::from(buffer))
        .unwrap()
}

pub async fn get_paths_handler(State(state): State<AppState>) -> Json<serde_json::Value> {
    tracing::info!(handler = "get_paths_handler", "paths retrieved");
    let db_lock = state.db.lock().await;
    let allowed = db::get_setting(&db_lock, "allowed_paths")
        .and_then(|v| serde_json::from_str::<Vec<String>>(&v).ok())
        .unwrap_or_default();
    let blocked = db::get_setting(&db_lock, "blocked_paths")
        .and_then(|v| serde_json::from_str::<Vec<String>>(&v).ok())
        .unwrap_or_default();
    drop(db_lock);
    Json(json!({"success": true, "allowed": allowed, "blocked": blocked}))
}

#[derive(Deserialize)]
pub struct PathsBody {
    allowed: Vec<String>,
    blocked: Vec<String>,
}

pub async fn set_paths_handler(
    State(state): State<AppState>,
    Json(body): Json<PathsBody>,
) -> Json<serde_json::Value> {
    tracing::info!(handler = "set_paths_handler", "paths updated");
    // Validate no overlapping allowed paths
    for i in 0..body.allowed.len() {
        let a = body.allowed[i].trim_end_matches('\\').to_lowercase();
        for j in (i + 1)..body.allowed.len() {
            let b = body.allowed[j].trim_end_matches('\\').to_lowercase();
            if a.starts_with(&format!("{}\\", b)) || b.starts_with(&format!("{}\\", a)) || a == b {
                return Json(json!({
                    "success": false,
                    "message": format!("Overlapping paths: '{}' and '{}'", body.allowed[i], body.allowed[j])
                }));
            }
        }
    }
    let allowed_json = serde_json::to_string(&body.allowed).unwrap_or_default();
    let blocked_json = serde_json::to_string(&body.blocked).unwrap_or_default();
    let db_lock = state.db.lock().await;
    let _ = db::set_setting(&db_lock, "allowed_paths", &allowed_json);
    let _ = db::set_setting(&db_lock, "blocked_paths", &blocked_json);
    let _ = db::insert_audit_log(&db_lock, "paths_updated", None, None);
    drop(db_lock);
    Json(json!({"success": true, "message": "Paths updated"}))
}

pub async fn get_relay_handler(State(state): State<AppState>) -> Json<serde_json::Value> {
    tracing::info!(handler = "get_relay_handler", "relay status retrieved");
    let db_lock = state.db.lock().await;
    let enabled = db::get_setting(&db_lock, "relay_opt_in")
        .map(|v| v == "true")
        .unwrap_or(false);
    drop(db_lock);
    Json(json!({"success": true, "enabled": enabled}))
}

#[derive(Deserialize)]
pub struct RelayBody {
    enabled: bool,
}

pub async fn set_relay_handler(
    State(state): State<AppState>,
    Json(body): Json<RelayBody>,
) -> Json<serde_json::Value> {
    tracing::info!(handler = "set_relay_handler", enabled = body.enabled, "relay toggled");
    let db_lock = state.db.lock().await;
    let _ = db::set_setting(&db_lock, "relay_opt_in", if body.enabled { "true" } else { "false" });
    let _ = db::insert_audit_log(
        &db_lock,
        "relay_opt_in",
        Some(if body.enabled { "enabled" } else { "disabled" }),
        None,
    );
    drop(db_lock);

    if body.enabled {
        let status = state.tunnel_state.status.read().await;
        if matches!(&*status, crate::tunnel::TunnelStatus::Idle | crate::tunnel::TunnelStatus::Failed(_)) {
            drop(status);
            let _ = crate::tunnel::TunnelState::start(state.tunnel_state.clone()).await;
        }
    }

    Json(json!({"success": true, "message": if body.enabled { "Tunnel will auto-start on launch" } else { "Tunnel auto-start disabled" }}))
}

pub async fn get_port_handler(State(state): State<AppState>) -> Json<serde_json::Value> {
    tracing::info!(handler = "get_port_handler", "port retrieved");
    let db_lock = state.db.lock().await;
    let port = db::get_setting(&db_lock, "port")
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(3939);
    drop(db_lock);
    Json(json!({"success": true, "port": port}))
}

#[derive(Deserialize)]
pub struct PortBody {
    port: u16,
}

pub async fn set_port_handler(
    State(state): State<AppState>,
    Json(body): Json<PortBody>,
) -> Json<serde_json::Value> {
    if body.port < 1024 {
        tracing::warn!(handler = "set_port_handler", port = body.port, "port out of range");
        return Json(json!({"success": false, "message": "Port must be between 1024 and 65535"}));
    }
    tracing::info!(handler = "set_port_handler", port = body.port, "port updated");
    let db_lock = state.db.lock().await;
    let _ = db::set_setting(&db_lock, "port", &body.port.to_string());
    let _ = db::insert_audit_log(
        &db_lock,
        "port_changed",
        Some(&format!("Port changed to {}", body.port)),
        None,
    );
    drop(db_lock);
    Json(
        json!({"success": true, "new_port": body.port, "message": "Port will change on next restart"}),
    )
}
