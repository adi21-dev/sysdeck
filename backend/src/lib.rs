pub mod audit;
pub mod auth;
pub mod db;
pub mod file_manager;
pub mod power;
pub mod script;
pub mod settings;
pub mod setup;
pub mod telemetry;
pub mod tunnel;
pub mod ws;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::{DefaultBodyLimit, Query, State};
use axum::response::{IntoResponse, Json};
use axum::routing::{get, post};
use axum::{middleware, Router};
use rusqlite::Connection;
use tokio::sync::{broadcast, oneshot, Mutex};
use tower_http::cors::CorsLayer;
use tray_icon::menu::{CheckMenuItem, Menu, MenuEvent, MenuItem};
use tray_icon::TrayIconBuilder;

pub use auth::{IpRateLimiter, LockoutState};
pub use db::TelemetrySnapshot;
pub use power::PowerState;
pub use script::ScriptState;
pub use setup::SetupManager;
pub use tunnel::TunnelState;

#[derive(Clone)]
pub struct AppState {
    pub telemetry_tx: broadcast::Sender<Arc<TelemetrySnapshot>>,
    pub db: Arc<Mutex<Connection>>,
    pub jwt_key: Arc<Vec<u8>>,
    pub lockout: Arc<LockoutState>,
    pub setup_manager: Arc<SetupManager>,
    pub rate_limiter: Arc<IpRateLimiter>,
    pub power_state: Arc<PowerState>,
    pub script_state: Arc<ScriptState>,
    pub tunnel_state: Arc<TunnelState>,
    pub port: u16,
}

pub fn get_data_dir() -> PathBuf {
    let local_app_data =
        std::env::var("LOCALAPPDATA").expect("LOCALAPPDATA environment variable not set");
    PathBuf::from(local_app_data).join("NodeDesk")
}

pub fn get_logs_dir() -> PathBuf {
    get_data_dir().join("logs")
}

pub fn get_db_path() -> PathBuf {
    get_data_dir().join("data.db")
}

pub fn init_dirs() {
    let data_dir = get_data_dir();
    std::fs::create_dir_all(&data_dir).expect("Failed to create data directory");
    std::fs::create_dir_all(get_logs_dir()).expect("Failed to create logs directory");
    println!("Data directory: {}", data_dir.display());
}

pub fn init_db() -> Connection {
    let db_path = get_db_path();
    let conn = Connection::open(&db_path).expect("Failed to open database");

    conn.execute_batch("PRAGMA journal_mode=WAL;")
        .expect("Failed to set WAL mode");
    conn.execute_batch("PRAGMA synchronous=NORMAL;")
        .expect("Failed to set synchronous mode");

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )
    .expect("Failed to create schema_version table");

    conn.execute(
        "INSERT OR IGNORE INTO schema_version (version) VALUES (1);",
        [],
    )
    .expect("Failed to insert initial schema version");

    db::init_telemetry_table(&conn).expect("Failed to initialize telemetry table");
    db::init_auth_tables(&conn).expect("Failed to initialize auth tables");

    // Migration v2: battery columns
    let schema_ver: i64 = conn
        .query_row("SELECT COALESCE(MAX(version), 0) FROM schema_version", [], |row| row.get(0))
        .unwrap_or(0);
    if schema_ver < 2 {
        let _ = db::migrate_telemetry_schema_v2(&conn);
        conn.execute("INSERT OR IGNORE INTO schema_version (version) VALUES (2)", [])
            .ok();
    }

    let _ = db::wal_checkpoint(&conn);

    println!("Database initialized at: {}", db_path.display());
    conn
}

pub async fn find_available_port() -> (u16, tokio::net::TcpListener) {
    if let Ok(listener) = tokio::net::TcpListener::bind("127.0.0.1:3939").await {
        let port = listener.local_addr().unwrap().port();
        println!("Bound to port {}", port);
        return (port, listener);
    }

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("Failed to bind to any available port");
    let port = listener.local_addr().unwrap().port();
    println!("Port 3939 was occupied. Fallback to random port: {}", port);
    (port, listener)
}

pub fn setup_tray(shutdown_tx: oneshot::Sender<()>) {
    std::thread::spawn(move || {
        let startup_item = CheckMenuItem::new("Run on startup", true, false, None);
        let quit_item = MenuItem::new("Quit", true, None);
        let menu = Menu::with_items(&[&startup_item, &quit_item]).expect("Failed to create menu");

        let on = std::process::Command::new("reg")
            .args(["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "NodeDesk Agent"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        startup_item.set_checked(on);

        let _tray = TrayIconBuilder::new()
            .with_tooltip("NodeDesk Agent")
            .with_menu(Box::new(menu))
            .build()
            .expect("Failed to build tray icon");

        let menu_channel = MenuEvent::receiver();

        loop {
            if let Ok(event) = menu_channel.recv() {
                if event.id == quit_item.id() {
                    println!("Quit selected from tray. Shutting down...");
                    let _ = shutdown_tx.send(());
                    return;
                }
                if event.id == startup_item.id() {
                    let on = !startup_item.is_checked();
                    startup_item.set_checked(on);
                    let exe = std::env::current_exe().unwrap_or_default();
                    if on {
                        let _ = std::process::Command::new("reg")
                            .args(["add", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "NodeDesk Agent", "/t", "REG_SZ", "/d", &exe.to_string_lossy(), "/f"])
                            .output();
                    } else {
                        let _ = std::process::Command::new("reg")
                            .args(["delete", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "NodeDesk Agent", "/f"])
                            .output();
                    }
                }
            }
        }
    });
}

pub async fn root_handler() -> &'static str {
    "NodeDesk Agent running"
}

pub async fn history_handler(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let range = params.get("range").map(|s| s.as_str()).unwrap_or("1h");
    let seconds = match parse_range(range) {
        Some(s) => s,
        None => {
            return (
                axum::http::StatusCode::BAD_REQUEST,
                "Invalid range format. Use e.g. 1h, 6h, 24h, 7d".to_string(),
            )
                .into_response()
        }
    };

    let since_ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
        - (seconds * 1000);

    let db = state.db.clone();
    let result = tokio::task::spawn_blocking(move || {
        let conn = db.blocking_lock();
        db::query_telemetry_history(&conn, since_ts)
    })
    .await;

    match result.unwrap_or_else(|e| {
        tracing::error!("Telemetry history join error: {}", e);
        Ok(vec![])
    }) {
        Ok(data) => Json(data).into_response(),
        Err(e) => {
            tracing::error!("Failed to query telemetry history: {}", e);
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to query history".to_string(),
            )
                .into_response()
        }
    }
}

pub fn parse_range(s: &str) -> Option<i64> {
    let (num_str, unit) = s.split_at(s.len() - 1);
    let num: i64 = num_str.parse().ok()?;
    match unit {
        "h" => Some(num * 3600),
        "d" => Some(num * 86400),
        "w" => Some(num * 604800),
        _ => None,
    }
}

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/", get(root_handler))
        .route("/ws", get(ws::ws_handler))
        .route("/api/telemetry/history", get(history_handler))
        .route("/api/setup/status", get(setup::setup_status_handler))
        .route("/api/setup/password", post(setup::api_password_handler))
        .route("/api/setup/totp", post(setup::api_totp_handler))
        .route(
            "/api/setup/verify-totp",
            post(setup::api_verify_totp_handler),
        )
        .route(
            "/api/setup/recovery-codes",
            post(setup::api_recovery_codes_handler),
        )
        .route("/api/setup/finish", post(setup::api_finish_handler))
        .route("/api/setup/relay", post(setup::api_relay_handler))
        .route("/api/setup/progress", get(setup::api_progress_handler))
        .route("/api/auth/check", get(auth::auth_check_handler))
        .route("/login", post(auth::login_handler))
        // File Manager
        .route("/api/files/list", get(file_manager::list_handler))
        .route(
            "/api/files/upload",
            post(file_manager::upload_handler).layer(DefaultBodyLimit::max(500 * 1024 * 1024)),
        )
        .route("/api/files/download", get(file_manager::download_handler))
        .route("/api/files/delete", post(file_manager::delete_handler))
        .route("/api/files/rename", post(file_manager::rename_handler))
        // Script Engine
        .route("/api/scripts/execute", post(script::execute_handler))
        .route("/ws/script/{id}", get(script::ws_script_handler))
        // Audit Log
        .route("/api/audit/logs", get(audit::logs_handler))
        // Settings
        .route(
            "/api/settings/change-password",
            post(settings::change_password_handler),
        )
        .route(
            "/api/settings/reset-totp",
            post(settings::reset_totp_handler),
        )
        .route(
            "/api/settings/verify-totp",
            post(settings::verify_totp_handler),
        )
        .route(
            "/api/settings/recovery-codes",
            get(settings::list_recovery_codes_handler),
        )
        .route(
            "/api/settings/recovery-codes/regenerate",
            post(settings::regenerate_recovery_codes_handler),
        )
        .route(
            "/api/settings/revoke-all",
            post(settings::revoke_all_handler),
        )
        .route("/api/settings/export-db", get(settings::export_db_handler))
        .route(
            "/api/settings/download-logs",
            get(settings::download_logs_handler),
        )
        .route(
            "/api/settings/paths",
            get(settings::get_paths_handler).post(settings::set_paths_handler),
        )
        .route(
            "/api/settings/port",
            get(settings::get_port_handler).post(settings::set_port_handler),
        )
        // Power Controls
        .route("/api/power/execute", post(power::execute_handler))
        .route("/api/power/cancel", post(power::cancel_power_handler))
        .route("/api/power/status", get(power::power_status_handler))
        // Tunnel
        .route("/api/tunnel/status", get(tunnel::status_handler))
        .route("/api/tunnel/start", post(tunnel::start_handler))
        .route("/api/tunnel/stop", post(tunnel::stop_handler))
        .with_state(state.clone())
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth::rate_limit_middleware,
        ))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth::auth_middleware,
        ))
        .layer(middleware::from_fn(auth::csp_middleware))
        .layer(CorsLayer::permissive())
}
