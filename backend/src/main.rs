use axum::{response::Html, routing::get, Router};
use rusqlite::Connection;
use std::net::TcpListener;
use std::path::PathBuf;
use tokio::sync::oneshot;
use tower_http::compression::CompressionLayer;
use tower_http::cors::CorsLayer;
use tray_icon::menu::{Menu, MenuEvent, MenuItem};
use tray_icon::TrayIconBuilder;

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
    std::fs::create_dir_all(&get_logs_dir()).expect("Failed to create logs directory");
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

    println!("Database initialized at: {}", db_path.display());
    conn
}

fn find_available_port() -> (u16, TcpListener) {
    if let Ok(listener) = TcpListener::bind("127.0.0.1:3939") {
        println!("Bound to port 3939");
        return (3939, listener);
    }

    let listener =
        TcpListener::bind("127.0.0.1:0").expect("Failed to bind to any available port");
    let port = listener.local_addr().unwrap().port();
    println!(
        "Port 3939 was occupied. Fallback to random port: {}",
        port
    );
    (port, listener)
}

fn setup_tray(shutdown_tx: oneshot::Sender<()>) {
    std::thread::spawn(move || {
        let quit_item = MenuItem::new("Quit", true, None);
        let menu =
            Menu::with_items(&[&quit_item]).expect("Failed to create menu");

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

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    println!("NodeDesk Agent v{} starting...", env!("CARGO_PKG_VERSION"));

    init_dirs();
    let _conn = init_db();

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    setup_tray(shutdown_tx);

    let (port, listener) = find_available_port();
    let listener = tokio::net::TcpListener::from_std(listener)
        .expect("Failed to convert std listener to tokio listener");

    let app = Router::new()
        .route("/", get(root_handler))
        .layer(CompressionLayer::new())
        .layer(CorsLayer::permissive());

    println!("Server running at http://localhost:{}", port);

    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            shutdown_rx.await.ok();
        })
        .await
        .expect("Server error");
}
