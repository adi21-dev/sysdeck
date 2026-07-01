pub mod audit;
pub mod auth;
pub mod db;
pub mod embed;
pub mod file_manager;
pub mod power;
pub mod script;
pub mod settings;
pub mod setup;
pub mod telemetry;
pub mod tunnel;
pub mod ws;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::extract::{DefaultBodyLimit, Query, State};
use axum::response::{IntoResponse, Json};
use axum::routing::{get, post};
use axum::{middleware, Router};
use rusqlite::Connection;
use tokio::sync::{broadcast, oneshot, Mutex};
use tower_http::cors::CorsLayer;
use tray_icon::menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tray_icon::{Icon, MouseButton, TrayIconBuilder, TrayIconEvent};
use std::time::Duration;

/// Commands sent from the main thread to the tray thread.
#[derive(Debug)]
pub enum TrayCommand {
    SetConnected,
    SetReconnecting,
    SetOffline,
    SetUrl(Option<String>),
    SetStartupCheck(bool),
    Shutdown,
}

/// Actions the tray thread sends back when menu items are clicked.
#[derive(Debug)]
pub enum TrayAction {
    ToggleTunnel,
}

pub use auth::{admin_check_handler, admin_middleware, IpRateLimiter, LockoutState};
pub use setup::{check_token_handler, verify_setup_token_handler};
pub use db::TelemetrySnapshot;
pub use power::{MockOs, PowerAction, PowerState, RealOs, SystemCommands};
pub use script::ScriptState;
pub use setup::SetupManager;
pub use tunnel::TunnelState;

#[derive(Clone)]
pub struct AppState {
    pub telemetry_tx: broadcast::Sender<Arc<TelemetrySnapshot>>,
    pub system_tx: broadcast::Sender<String>,
    pub db: Arc<Mutex<Connection>>,
    pub jwt_key: Arc<Vec<u8>>,
    pub lockout: Arc<LockoutState>,
    pub setup_manager: Arc<SetupManager>,
    pub rate_limiter: Arc<IpRateLimiter>,
    pub power_state: Arc<PowerState>,
    pub script_state: Arc<ScriptState>,
    pub tunnel_state: Arc<TunnelState>,
    pub port: u16,
    pub setup_token: Arc<String>,
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

const MAX_LOG_SIZE: u64 = 10 * 1024 * 1024;
const MAX_LOG_FILES: usize = 3;

pub fn rotate_logs(logs_dir: &Path) {
    // Shift old logs: remove beyond limit, shift .2→.3, .1→.2, current→.1
    let _ = std::fs::remove_file(logs_dir.join(format!("nodedesk.{}.log", MAX_LOG_FILES)));
    for i in (2..=MAX_LOG_FILES).rev() {
        let _ = std::fs::rename(
            logs_dir.join(format!("nodedesk.{}.log", i - 1)),
            logs_dir.join(format!("nodedesk.{}.log", i)),
        );
    }
    let current = logs_dir.join("nodedesk.log");
    if current.exists() {
        let _ = std::fs::rename(&current, logs_dir.join("nodedesk.1.log"));
    }
}

pub fn init_dirs() {
    let data_dir = get_data_dir();
    std::fs::create_dir_all(&data_dir).expect("Failed to create data directory");
    std::fs::create_dir_all(get_logs_dir()).expect("Failed to create logs directory");
    println!("Data directory: {}", data_dir.display());
    // Rotate logs if current file exceeds 10 MB
    let log_path = get_logs_dir().join("nodedesk.log");
    if log_path.exists() {
        if let Ok(meta) = std::fs::metadata(&log_path) {
            if meta.len() > MAX_LOG_SIZE {
                rotate_logs(&get_logs_dir());
                println!("Log rotated (exceeded {} MB)", MAX_LOG_SIZE / 1024 / 1024);
            }
        }
    }
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
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);
    if schema_ver < 2 {
        let _ = db::migrate_telemetry_schema_v2(&conn);
        conn.execute(
            "INSERT OR IGNORE INTO schema_version (version) VALUES (2)",
            [],
        )
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

fn is_startup_enabled() -> bool {
    if cfg!(target_os = "windows") {
        std::process::Command::new("reg")
            .args([
                "query",
                "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                "/v",
                "NodeDesk Agent",
            ])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    } else if cfg!(target_os = "linux") {
        let path = dirs::config_dir().map(|p| p.join("autostart/nodedesk-agent.desktop"));
        path.map(|p| p.exists()).unwrap_or(false)
    } else if cfg!(target_os = "macos") {
        let path =
            dirs::home_dir().map(|p| p.join("Library/LaunchAgents/com.nodedesk.agent.plist"));
        path.map(|p| p.exists()).unwrap_or(false)
    } else {
        false
    }
}

fn set_startup(enabled: bool) {
    let exe = std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    if cfg!(target_os = "windows") {
        if enabled {
            let _ = std::process::Command::new("reg")
                .args([
                    "add",
                    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                    "/v",
                    "NodeDesk Agent",
                    "/t",
                    "REG_SZ",
                    "/d",
                    &exe,
                    "/f",
                ])
                .output();
        } else {
            let _ = std::process::Command::new("reg")
                .args([
                    "delete",
                    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                    "/v",
                    "NodeDesk Agent",
                    "/f",
                ])
                .output();
        }
    } else if cfg!(target_os = "linux") {
        if let Some(config_dir) = dirs::config_dir() {
            let autostart_dir = config_dir.join("autostart");
            let desktop_file = autostart_dir.join("nodedesk-agent.desktop");
            if enabled {
                let _ = std::fs::create_dir_all(&autostart_dir);
                let content = format!(
                    "[Desktop Entry]\nType=Application\nName=NodeDesk Agent\nExec={}\nX-GNOME-Autostart-enabled=true\n",
                    exe
                );
                let _ = std::fs::write(&desktop_file, content);
            } else {
                let _ = std::fs::remove_file(&desktop_file);
            }
        }
    } else if cfg!(target_os = "macos") {
        if let Some(home) = dirs::home_dir() {
            let launch_agents = home.join("Library/LaunchAgents");
            let plist = launch_agents.join("com.nodedesk.agent.plist");
            if enabled {
                let _ = std::fs::create_dir_all(&launch_agents);
                let content = format!(
                    r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.nodedesk.agent</string>
<key>ProgramArguments</key><array><string>{}</string></array>
<key>RunAtLoad</key><true/>
</dict></plist>"#,
                    exe
                );
                let _ = std::fs::write(&plist, content);
            } else {
                let _ = std::fs::remove_file(&plist);
            }
        }
    }
}

fn create_tray_icon(r: u8, g: u8, b: u8) -> Icon {
    let size = 16u32;
    let mut rgba = Vec::with_capacity((size * size * 4) as usize);
    let cx = size as f32 / 2.0;
    let cy = size as f32 / 2.0;
    let radius = (size as f32 / 2.0) - 1.0;
    for y in 0..size {
        for x in 0..size {
            let dx = x as f32 - cx;
            let dy = y as f32 - cy;
            if (dx * dx + dy * dy).sqrt() <= radius {
                rgba.extend_from_slice(&[r, g, b, 255]);
            } else {
                rgba.extend_from_slice(&[0, 0, 0, 0]);
            }
        }
    }
    Icon::from_rgba(rgba, size, size).expect("Failed to create icon")
}

/// Spawn the system tray thread. Returns a sender for tray commands and a receiver
/// for actions that need handling in the main tokio loop.
/// On headless Linux (no DISPLAY), the tray is not created and both channels are closed.
pub fn spawn_tray(
    port: u16,
    shutdown_tx: oneshot::Sender<()>,
) -> (crossbeam_channel::Sender<TrayCommand>, crossbeam_channel::Receiver<TrayAction>) {
    let (cmd_tx, cmd_rx) = crossbeam_channel::unbounded();
    let (action_tx, action_rx) = crossbeam_channel::unbounded();

    // Skip tray entirely on headless Linux
    if cfg!(target_os = "linux") && std::env::var("DISPLAY").is_err() {
        return (cmd_tx, action_rx);
    }

    std::thread::spawn(move || {
        let green = create_tray_icon(34, 197, 94);
        let yellow = create_tray_icon(234, 179, 8);
        let red = create_tray_icon(239, 68, 68);

        let open_item = MenuItem::new("Open Admin UI", true, None);
        let copy_url_item = MenuItem::new("Copy Remote URL", false, None);
        let pause_item = MenuItem::new("Pause Tunnel", true, None);
        let startup_item = CheckMenuItem::new("Run on Startup", true, false, None);
        let quit_item = MenuItem::new("Quit", true, None);

        let menu = Menu::with_items(&[
            &open_item,
            &copy_url_item,
            &PredefinedMenuItem::separator(),
            &pause_item,
            &startup_item,
            &PredefinedMenuItem::separator(),
            &quit_item,
        ])
        .expect("Failed to create menu");

        startup_item.set_checked(is_startup_enabled());

        let tray = TrayIconBuilder::new()
            .with_tooltip("NodeDesk Agent")
            .with_icon(green.clone())
            .with_menu(Box::new(menu))
            .build()
            .expect("Failed to build tray icon");

        #[cfg(target_os = "windows")]
        fn pump_messages() {
            use windows_sys::Win32::UI::WindowsAndMessaging::{
                DispatchMessageW, PeekMessageW, PM_REMOVE, TranslateMessage,
            };
            unsafe {
                let mut msg = std::mem::zeroed();
                while PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_REMOVE) != 0 {
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
        }

        let mut tunnel_url: Option<String> = None;
        let menu_channel = MenuEvent::receiver();
        let ticker = crossbeam_channel::tick(Duration::from_millis(50));

        loop {
            crossbeam_channel::select! {
                recv(ticker) -> _ => {
                    #[cfg(target_os = "windows")]
                    pump_messages();
                }
                recv(menu_channel) -> event => {
                    if let Ok(event) = event {
                        if event.id == quit_item.id() {
                            println!("Quit selected from tray. Shutting down...");
                            let _ = shutdown_tx.send(());
                            return;
                        }
                        if event.id == open_item.id() {
                            let url = format!("http://localhost:{}", port);
                            if let Err(e) = open::that(&url) {
                                tracing::error!("Failed to open browser: {}", e);
                            }
                        }
                        if event.id == copy_url_item.id() {
                            if let Some(ref url) = tunnel_url {
                                if let Ok(mut clipboard) = arboard::Clipboard::new() {
                                    let _ = clipboard.set_text(url);
                                }
                            }
                        }
                        if event.id == pause_item.id() {
                            let _ = action_tx.send(TrayAction::ToggleTunnel);
                        }
                        if event.id == startup_item.id() {
                            let on = !startup_item.is_checked();
                            startup_item.set_checked(on);
                            set_startup(on);
                        }
                    }
                }
                recv(TrayIconEvent::receiver()) -> click => {
                    if let Ok(
                        TrayIconEvent::Click { button: MouseButton::Left, .. }
                        | TrayIconEvent::DoubleClick { .. }
                    ) = click {
                        let url = format!("http://localhost:{}", port);
                        let _ = open::that(&url);
                    }
                }
                recv(cmd_rx) -> cmd => {
                    match cmd {
                        Ok(TrayCommand::SetConnected) => {
                            tray.set_icon(Some(green.clone())).ok();
                            tray.set_tooltip(Some("NodeDesk: Connected")).ok();
                            pause_item.set_text("Pause Tunnel");
                            copy_url_item.set_enabled(true);
                        }
                        Ok(TrayCommand::SetReconnecting) => {
                            tray.set_icon(Some(yellow.clone())).ok();
                            tray.set_tooltip(Some("NodeDesk: Reconnecting...")).ok();
                            copy_url_item.set_enabled(false);
                        }
                        Ok(TrayCommand::SetOffline) => {
                            tray.set_icon(Some(red.clone())).ok();
                            tray.set_tooltip(Some("NodeDesk: Offline")).ok();
                            pause_item.set_text("Resume Tunnel");
                            copy_url_item.set_enabled(false);
                        }
                        Ok(TrayCommand::SetUrl(url)) => {
                            tunnel_url = url;
                        }
                        Ok(TrayCommand::SetStartupCheck(on)) => {
                            startup_item.set_checked(on);
                        }
                        Ok(TrayCommand::Shutdown) => break,
                        Err(_) => break,
                    }
                }
            }
        }
    });

    (cmd_tx, action_rx)
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
    // Admin-only routes (settings/configuration) - require localhost access
    let admin_routes = Router::new()
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
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth::admin_middleware,
        ));

    Router::new()
        .merge(admin_routes)
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
        .route("/api/setup/check-token", get(setup::check_token_handler))
        .route("/api/setup/verify-setup-token", post(setup::verify_setup_token_handler))
        .route("/api/auth/check", get(auth::auth_check_handler))
        .route("/api/admin/check", get(auth::admin_check_handler))
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
        .fallback(embed::serve_embedded_assets)
}
