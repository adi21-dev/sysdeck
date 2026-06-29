use std::sync::Arc;

use tokio::sync::{broadcast, oneshot, Mutex};

use nodedesk_agent::auth;
use nodedesk_agent::db::TelemetrySnapshot;
use nodedesk_agent::{
    build_router, find_available_port, init_db, init_dirs, setup_tray, AppState, LockoutState,
    SetupManager,
};

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

    // Load or create JWT signing key (DPAPI encrypted)
    let jwt_key = {
        let conn = conn.lock().await;
        Arc::new(auth::load_or_create_jwt_key(&conn).expect("Failed to load JWT signing key"))
    };

    let (port, listener) = find_available_port().await;

    // Ensure cloudflared is downloaded
    let mut cloudflared_available = true;
    if let Err(e) = nodedesk_agent::tunnel::ensure_cloudflared().await {
        tracing::error!("Failed to setup cloudflared tunnel: {}", e);
        tracing::warn!("Continuing without tunnel. Only local access available.");
        cloudflared_available = false;
    }

    // Create broadcast channel for telemetry
    let (telemetry_tx, _) = broadcast::channel::<Arc<TelemetrySnapshot>>(256);

    // Start telemetry engine
    nodedesk_agent::telemetry::start_engine(telemetry_tx.clone(), conn.clone());

    // Setup tray and shutdown channels
    let (tray_shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let (tunnel_shutdown_tx, tunnel_shutdown_rx) = oneshot::channel::<()>();
    setup_tray(tray_shutdown_tx);

    // Auth state
    let lockout = Arc::new(LockoutState::new());
    let setup_manager = Arc::new(SetupManager::new());
    let rate_limiter = auth::create_rate_limiter();

    let app_state = AppState {
        telemetry_tx,
        db: conn,
        jwt_key,
        lockout,
        setup_manager,
        rate_limiter,
    };

    let app = build_router(app_state.clone());

    // Signal channel for server readiness
    let (server_ready_tx, server_ready_rx) = oneshot::channel::<()>();

    // Start server in a background task, signal when it begins accepting connections
    let server_handle = tokio::spawn(async move {
        let _ = server_ready_tx.send(());

        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                shutdown_rx.await.ok();
                tracing::info!("Shutdown signal received, stopping tunnel...");
                let _ = tunnel_shutdown_tx.send(());
            })
            .await
            .expect("Server error");
    });

    // Wait for the server to be ready before starting the tunnel
    server_ready_rx.await.ok();
    println!("Server running at http://localhost:{}", port);

    if cloudflared_available {
        println!("Starting tunnel... (URL may take a moment to propagate on Cloudflare edge)");
        let tunnel_handle = tokio::spawn(nodedesk_agent::tunnel::run_tunnel_loop(
            port,
            tunnel_shutdown_rx,
        ));

        // Wait for server to finish (triggers graceful shutdown)
        server_handle.await.expect("Server task panicked");

        // Give tunnel a moment to clean up
        let _ = tokio::time::timeout(std::time::Duration::from_secs(5), tunnel_handle).await;
    } else {
        server_handle.await.expect("Server task panicked");
    }

    println!("NodeDesk Agent stopped.");
}
