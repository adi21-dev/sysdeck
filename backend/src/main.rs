use std::io;
use std::sync::Arc;

use tokio::sync::{broadcast, oneshot, Mutex};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::Layer;

use nodedesk_agent::auth;
use nodedesk_agent::db::{self, TelemetrySnapshot};
use nodedesk_agent::{
    build_router, find_available_port, get_data_dir, init_db, init_dirs, setup_tray, AppState,
    LockoutState, PowerState, ScriptState, SetupManager, TunnelState,
};

#[tokio::main]
async fn main() {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "info".into());
    let logs_dir = nodedesk_agent::get_logs_dir();
    let file_appender = tracing_appender::rolling::never(&logs_dir, "nodedesk.log");
    let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::fmt::layer()
                .with_writer(io::stdout)
                .with_filter(filter.clone()),
        )
        .with(
            tracing_subscriber::fmt::layer()
                .with_writer(non_blocking)
                .with_filter(filter),
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

    // Create broadcast channel for telemetry
    let (telemetry_tx, _) = broadcast::channel::<Arc<TelemetrySnapshot>>(256);

    // Start telemetry engine
    nodedesk_agent::telemetry::start_engine(telemetry_tx.clone(), conn.clone());

    // Setup tray and shutdown channels
    let (tray_shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    setup_tray(tray_shutdown_tx);

    // Auth state
    let lockout = Arc::new(LockoutState::new());
    let setup_manager = Arc::new(SetupManager::new());
    let rate_limiter = auth::create_rate_limiter();
    let power_state = Arc::new(PowerState::new());
    let script_state = Arc::new(ScriptState::new());
    let (tunnel_state, _tunnel_rx) = TunnelState::new(&get_data_dir(), port);
    let tunnel_state = Arc::new(tunnel_state);

    // Auto-start tunnel if relay was opted in during setup
    {
        let conn = conn.lock().await;
        if let Some(val) = db::get_setting(&conn, "relay_opt_in") {
            if val == "true" {
                let ts = tunnel_state.clone();
                tokio::spawn(async move {
                    // Small delay to let server start first
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    let _ = TunnelState::start(ts).await;
                });
            }
        }
    }

    let app_state = AppState {
        telemetry_tx,
        db: conn,
        jwt_key,
        lockout,
        setup_manager,
        rate_limiter,
        power_state,
        script_state,
        tunnel_state: tunnel_state.clone(),
        port,
    };

    let app = build_router(app_state.clone());

    // Signal channel for server readiness
    let (server_ready_tx, server_ready_rx) = oneshot::channel::<()>();

    // Start server in a background task, signal when it begins accepting connections
    let shutdown_tunnel = tunnel_state.clone();
    let server_handle = tokio::spawn(async move {
        let _ = server_ready_tx.send(());

        axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                shutdown_rx.await.ok();
                tracing::info!("Shutdown signal received");
                let _ = shutdown_tunnel.stop().await;
            })
            .await
            .expect("Server error");
    });

    server_ready_rx.await.ok();
    println!("Server running at http://localhost:{}", port);

    server_handle.await.expect("Server task panicked");

    println!("NodeDesk Agent stopped.");
}
