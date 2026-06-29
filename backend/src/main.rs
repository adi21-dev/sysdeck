mod db;
mod telemetry;
mod tunnel;
mod ws;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::{Query, State};
use axum::response::{Html, IntoResponse, Json};
use axum::routing::get;
use axum::Router;
use rusqlite::Connection;
use tokio::sync::{broadcast, oneshot, Mutex};
use tower_http::compression::CompressionLayer;
use tower_http::cors::CorsLayer;
use tray_icon::menu::{Menu, MenuEvent, MenuItem};
use tray_icon::TrayIconBuilder;

use db::TelemetrySnapshot;

#[derive(Clone)]
pub struct AppState {
    pub telemetry_tx: broadcast::Sender<Arc<TelemetrySnapshot>>,
    pub db: Arc<Mutex<Connection>>,
}

fn get_data_dir() -> PathBuf {
    let local_app_data =
        std::env::var("LOCALAPPDATA").expect("LOCALAPPDATA environment variable not set");
    PathBuf::from(local_app_data).join("NodeDesk")
}

fn get_logs_dir() -> PathBuf {
    get_data_dir().join("logs")
}

fn get_db_path() -> PathBuf {
    get_data_dir().join("data.db")
}

fn init_dirs() {
    let data_dir = get_data_dir();
    std::fs::create_dir_all(&data_dir).expect("Failed to create data directory");
    std::fs::create_dir_all(get_logs_dir()).expect("Failed to create logs directory");
    println!("Data directory: {}", data_dir.display());
}

fn init_db() -> Connection {
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

    println!("Database initialized at: {}", db_path.display());
    conn
}

async fn find_available_port() -> (u16, tokio::net::TcpListener) {
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

fn setup_tray(shutdown_tx: oneshot::Sender<()>) {
    std::thread::spawn(move || {
        let quit_item = MenuItem::new("Quit", true, None);
        let menu = Menu::with_items(&[&quit_item]).expect("Failed to create menu");

        let _tray = TrayIconBuilder::new()
            .with_tooltip("NodeDesk Agent")
            .with_menu(Box::new(menu))
            .build()
            .expect("Failed to build tray icon");

        let menu_channel = MenuEvent::receiver();

        if let Ok(event) = menu_channel.recv() {
            if event.id == quit_item.id() {
                println!("Quit selected from tray. Shutting down...");
                let _ = shutdown_tx.send(());
            }
        }
    });
}

async fn root_handler() -> Html<&'static str> {
    Html(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NodeDesk Agent</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #0f0f0f; color: #e0e0e0; }
        .card { text-align: center; padding: 2.5rem 3rem; border-radius: 12px; background: #1a1a1a; box-shadow: 0 4px 24px rgba(0,0,0,0.4); border: 1px solid #2a2a2a; }
        .status-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #22c55e; margin-right: 10px; box-shadow: 0 0 8px rgba(34,197,94,0.4); vertical-align: middle; }
        h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.75rem; display: flex; align-items: center; justify-content: center; }
        p { color: #888; font-size: 0.95rem; }
    </style>
</head>
<body>
    <div class="card">
        <h1><span class="status-dot"></span>NodeDesk Agent</h1>
        <p>NodeDesk Agent is running and ready.</p>
    </div>
</body>
</html>"#,
    )
}

async fn history_handler(
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
    match tokio::task::spawn_blocking(move || {
        let conn = db.blocking_lock();
        db::query_telemetry_history(&conn, since_ts)
    })
    .await
    {
        Ok(Ok(data)) => Json(data).into_response(),
        Ok(Err(e)) => {
            tracing::error!("Failed to query telemetry history: {}", e);
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to query history".to_string(),
            )
                .into_response()
        }
        Err(e) => {
            tracing::error!("Telemetry history join error: {}", e);
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to query history".to_string(),
            )
                .into_response()
        }
    }
}

fn parse_range(s: &str) -> Option<i64> {
    let re = regex::Regex::new(r"^(\d+)([hdw])$").ok()?;
    let caps = re.captures(s)?;
    let num: i64 = caps.get(1)?.as_str().parse().ok()?;
    match caps.get(2)?.as_str() {
        "h" => Some(num * 3600),
        "d" => Some(num * 86400),
        "w" => Some(num * 604800),
        _ => None,
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    println!("NodeDesk Agent v{} starting...", env!("CARGO_PKG_VERSION"));

    init_dirs();
    let conn = Arc::new(Mutex::new(init_db()));

    let (port, listener) = find_available_port().await;

    // Ensure cloudflared is downloaded
    if let Err(e) = tunnel::ensure_cloudflared().await {
        tracing::error!("Failed to setup cloudflared tunnel: {}", e);
        tracing::warn!("Continuing without tunnel. Only local access available.");
    }

    // Create broadcast channel for telemetry
    let (telemetry_tx, _) = broadcast::channel::<Arc<TelemetrySnapshot>>(256);

    // Start telemetry engine
    telemetry::start_engine(telemetry_tx.clone(), conn.clone());

    // Setup tray and shutdown channels
    let (tray_shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let (tunnel_shutdown_tx, tunnel_shutdown_rx) = oneshot::channel::<()>();
    setup_tray(tray_shutdown_tx);

    // Start tunnel in background
    let tunnel_handle = tokio::spawn(tunnel::run_tunnel_loop(port, tunnel_shutdown_rx));

    let app_state = AppState {
        telemetry_tx,
        db: conn,
    };

    let app = Router::new()
        .route("/", get(root_handler))
        .route("/ws", get(ws::ws_handler))
        .route("/api/telemetry/history", get(history_handler))
        .with_state(app_state)
        .layer(CompressionLayer::new())
        .layer(CorsLayer::permissive());

    println!("Server running at http://localhost:{}", port);

    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            shutdown_rx.await.ok();
            tracing::info!("Shutdown signal received, stopping tunnel...");
            let _ = tunnel_shutdown_tx.send(());
        })
        .await
        .expect("Server error");

    // Wait for tunnel to clean up
    let _ = tokio::time::timeout(std::time::Duration::from_secs(5), tunnel_handle).await;
    println!("NodeDesk Agent stopped.");
}
