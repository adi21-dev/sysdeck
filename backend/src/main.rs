// Windows subsystem — no console window on double-click. The app runs silently
// in the system tray. When launched from `cargo run` the parent's terminal is
// inherited, so the startup banner is still visible during development.
#![cfg_attr(windows, windows_subsystem = "windows")]

use std::sync::Arc;

use tokio::sync::{broadcast, oneshot, Mutex};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::Layer;

use sysdeck_agent::auth;
use sysdeck_agent::db::{self, TelemetrySnapshot};
use sysdeck_agent::tunnel::TunnelStatus;
use sysdeck_agent::{
    build_router, find_available_port, get_data_dir, init_db, init_dirs, spawn_tray, AppState,
    InitHistory, LockoutState, PowerState, ScriptState, SetupManager, TerminalState, TrayCommand,
    TunnelState,
};

#[cfg(target_os = "windows")]
fn spawn_windows_shutdown_listener() {
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassW,
        TranslateMessage, HWND_MESSAGE, MSG, WM_ENDSESSION, WM_QUERYENDSESSION, WNDCLASSW,
        WS_EX_TOOLWINDOW,
    };

    unsafe extern "system" fn wnd_proc(
        _hwnd: HWND,
        msg: u32,
        _wparam: WPARAM,
        _lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_QUERYENDSESSION => 1isize,
            WM_ENDSESSION => std::process::exit(0),
            _ => DefWindowProcW(_hwnd, msg, _wparam, _lparam),
        }
    }

    std::thread::spawn(move || unsafe {
        let class_name: Vec<u16> = "SysDeckHiddenWindow\0".encode_utf16().collect();
        let wc = WNDCLASSW {
            style: 0,
            lpfnWndProc: Some(wnd_proc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: std::ptr::null_mut(),
            hIcon: std::ptr::null_mut(),
            hCursor: std::ptr::null_mut(),
            hbrBackground: std::ptr::null_mut(),
            lpszMenuName: std::ptr::null(),
            lpszClassName: class_name.as_ptr(),
        };
        RegisterClassW(&wc);
        let hwnd = CreateWindowExW(
            WS_EX_TOOLWINDOW,
            class_name.as_ptr(),
            std::ptr::null(),
            0,
            0,
            0,
            0,
            0,
            HWND_MESSAGE,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        );
        let mut msg = std::mem::zeroed::<MSG>();
        while GetMessageW(&mut msg, hwnd, 0, 0) != 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    });
}

#[tokio::main]
async fn main() {
    // Shared init history — the frontend polls this to show step-by-step progress.
    let init_history = Arc::new(std::sync::Mutex::new(InitHistory::default()));

    // Log to file only.
    let filter =
        tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into());
    let logs_dir = sysdeck_agent::get_logs_dir();
    let file_appender = tracing_appender::rolling::never(&logs_dir, "sysdeck.log");
    let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::fmt::layer()
                .with_writer(non_blocking)
                .with_filter(filter),
        )
        .init();

    #[cfg(target_os = "windows")]
    spawn_windows_shutdown_listener();

    // ── Init step 1: directories ──
    {
        let mut h = init_history.lock().unwrap();
        h.steps.push("Initializing data directories...".into());
    }
    init_dirs();

    // ── Init step 2: database ──
    {
        let mut h = init_history.lock().unwrap();
        h.steps.push("Setting up database...".into());
    }
    let conn = Arc::new(Mutex::new(init_db()));
    let db_for_shutdown = conn.clone();

    // ── Init step 3: JWT signing key ──
    {
        let mut h = init_history.lock().unwrap();
        h.steps.push("Generating security keys...".into());
    }
    let jwt_key = Arc::new(auth::load_or_create_jwt_key().expect("Failed to load JWT signing key"));

    // ── Init step 4: network ──
    {
        let mut h = init_history.lock().unwrap();
        h.steps.push("Starting server...".into());
    }
    let (port, listener) = find_available_port().await;

    // Create broadcast channels
    let (telemetry_tx, _) = broadcast::channel::<Arc<TelemetrySnapshot>>(256);
    let (system_tx, _) = broadcast::channel::<String>(16);
    let (clipboard_tx, _) = broadcast::channel::<String>(16);

    // ── Init step 5: telemetry ──
    {
        let mut h = init_history.lock().unwrap();
        h.steps.push("Starting telemetry engine...".into());
    }
    sysdeck_agent::telemetry::start_engine(telemetry_tx.clone(), conn.clone());

    // Auth state
    let lockout = Arc::new(LockoutState::new());
    let setup_manager = Arc::new(SetupManager::new());
    let rate_limiter = auth::create_rate_limiter();
    let power_state = Arc::new(PowerState::new());
    let script_state = Arc::new(ScriptState::new());
    let terminal_state = Arc::new(TerminalState::default());
    let (tunnel_state, _tunnel_rx) = TunnelState::new(&get_data_dir(), port);
    let tunnel_state = Arc::new(tunnel_state);

    // Setup tray (skip on headless Linux)
    let (tray_shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let (tray_cmd_tx, tray_action_rx) = spawn_tray(port, tray_shutdown_tx);

    // Handle tunnel status → tray icon updates
    let tunnel_state_clone = tunnel_state.clone();
    tokio::spawn(async move {
        let mut rx = tunnel_state_clone.tx.subscribe();
        loop {
            match rx.recv().await {
                Ok(event) => match event.status.as_str() {
                    "running" => {
                        tray_cmd_tx.send(TrayCommand::SetConnected).ok();
                        tray_cmd_tx
                            .send(TrayCommand::SetUrl(event.url.clone()))
                            .ok();
                    }
                    "starting" | "downloading" => {
                        tray_cmd_tx.send(TrayCommand::SetReconnecting).ok();
                    }
                    "failed" => {
                        tray_cmd_tx.send(TrayCommand::SetOffline).ok();
                    }
                    "idle" => {
                        tray_cmd_tx.send(TrayCommand::SetOffline).ok();
                    }
                    _ => {}
                },
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    // Handle tray actions (tunnel toggle)
    let tunnel_state_clone2 = tunnel_state.clone();
    tokio::spawn(async move {
        loop {
            match tray_action_rx.try_recv() {
                Ok(sysdeck_agent::TrayAction::ToggleTunnel) => {
                    let status = tunnel_state_clone2.status.read().await.clone();
                    match status {
                        TunnelStatus::Running { .. }
                        | TunnelStatus::Starting
                        | TunnelStatus::Downloading => {
                            let _ = TunnelState::stop(&tunnel_state_clone2).await;
                        }
                        _ => {
                            let _ = TunnelState::start(tunnel_state_clone2.clone()).await;
                        }
                    }
                }
                Err(crossbeam_channel::TryRecvError::Empty) => {
                    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                }
                Err(crossbeam_channel::TryRecvError::Disconnected) => break,
            }
        }
    });

    // Auto-start tunnel if relay was opted in during setup
    {
        let conn = conn.lock().await;
        if let Some(val) = db::get_setting(&conn, "relay_opt_in") {
            if val == "true" {
                let ts = tunnel_state.clone();
                tokio::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    let _ = TunnelState::start(ts).await;
                });
            }
        }
    }

    // Clipboard polling
    let clipboard_tx_clone = clipboard_tx.clone();
    tokio::spawn(async move {
        let mut last = String::new();
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
            let text = tokio::task::spawn_blocking(move || {
                arboard::Clipboard::new()
                    .ok()
                    .and_then(|mut c| c.get_text().ok())
            })
            .await
            .unwrap_or(None);
            if let Some(text) = text {
                if text != last {
                    last = text.clone();
                    let _ = clipboard_tx_clone.send(text);
                }
            }
        }
    });

    let system_tx_clone = system_tx.clone();

    // ── Mark init complete ──
    {
        let mut h = init_history.lock().unwrap();
        h.steps.push("Ready".into());
    }

    let app_state = AppState {
        telemetry_tx,
        system_tx,
        clipboard_tx,
        db: conn,
        jwt_key,
        lockout,
        setup_manager,
        rate_limiter,
        power_state,
        script_state,
        terminal_state,
        tunnel_state: tunnel_state.clone(),
        port,
        init_history,
    };

    let app = build_router(app_state.clone());

    // Signal channel for server readiness
    let (server_ready_tx, server_ready_rx) = oneshot::channel::<()>();

    let shutdown_tunnel = tunnel_state.clone();
    let system_tx_clone2 = system_tx_clone.clone();

    #[cfg(target_os = "windows")]
    async fn wait_for_shutdown_signal() {
        use tokio::signal::windows;
        let mut ctrl_c = windows::ctrl_c().expect("Failed to bind Ctrl+C");
        let mut ctrl_shutdown = windows::ctrl_shutdown().expect("Failed to bind Ctrl+Shutdown");
        tokio::select! {
            _ = ctrl_c.recv() => tracing::info!("Received Ctrl+C"),
            _ = ctrl_shutdown.recv() => tracing::info!("Received Windows Shutdown signal"),
        }
    }

    #[cfg(not(target_os = "windows"))]
    async fn wait_for_shutdown_signal() {
        use tokio::signal::unix::{signal, SignalKind};
        let mut sigterm = signal(SignalKind::terminate()).expect("Failed to bind SIGTERM");
        let mut sigint = signal(SignalKind::interrupt()).expect("Failed to bind SIGINT");
        tokio::select! {
            _ = sigterm.recv() => tracing::info!("Received SIGTERM"),
            _ = sigint.recv() => tracing::info!("Received SIGINT (Ctrl+C)"),
        }
    }

    let server_handle = tokio::spawn(async move {
        let _ = server_ready_tx.send(());

        tracing::info!(port, "Listening");
        axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                tokio::select! {
                    _ = shutdown_rx => tracing::info!("Tray quit signal received"),
                    _ = wait_for_shutdown_signal() => {},
                }
                tracing::info!("Shutdown signal received, notifying clients...");
                let _ = system_tx_clone2
                    .send(r#"{"event":"system","data":{"type":"shutting_down"}}"#.to_string());
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                let _ = shutdown_tunnel.stop().await;
                tracing::info!("Finalizing database...");
                if let Ok(db_lock) = db_for_shutdown.try_lock() {
                    let _ = sysdeck_agent::db::wal_checkpoint(&db_lock);
                    drop(db_lock);
                }
            })
            .await
            .expect("Server error");
    });

    server_ready_rx.await.ok();

    // Open the browser to the setup wizard / dashboard.
    let _ = open::that(format!("http://localhost:{}", port));

    server_handle.await.expect("Server task panicked");
}
