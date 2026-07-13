// Console subsystem — inherit the parent's console (cargo terminal) so there's
// no separate window the user can accidentally close. On standalone launch
// a console appears briefly, then we re-spawn as a hidden process.

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
    LockoutState, PowerState, ScriptState, SetupManager, TerminalState, TrayCommand, TunnelState,
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

// ── Windows background daemon ─────────────────────────────────────────────────
//
// When the user presses Enter we spawn a detached sibling process and exit,
// so `cargo run` returns to the prompt while the app keeps running in the
// system tray. The `--daemon` instance skips the console banner and just
// runs the server + tray.
#[cfg(windows)]
fn spawn_background_daemon() {
    use std::os::windows::process::CommandExt;
    use std::sync::atomic::{AtomicBool, Ordering};
    static ONCE: AtomicBool = AtomicBool::new(false);
    if ONCE.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Ok(exe) = std::env::current_exe() {
        // DETACHED_PROCESS = 0x00000100 — no console inherited or allocated.
        if std::process::Command::new(exe)
            .arg("--daemon")
            .creation_flags(0x00000100)
            .spawn()
            .is_ok()
        {
            std::process::exit(0);
        }
        // fall through — if spawn failed, keep running in current process
    }
}
// ── end Windows background daemon ─────────────────────────────────────────────

#[tokio::main]
async fn main() {
    let daemon_mode = std::env::args().any(|a| a == "--daemon");

    let filter =
        tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into());
    let logs_dir = sysdeck_agent::get_logs_dir();
    let file_appender = tracing_appender::rolling::never(&logs_dir, "sysdeck.log");
    let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);

    // File appender only — stdout logging is replaced by the banner below.
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::fmt::layer()
                .with_writer(non_blocking)
                .with_filter(filter),
        )
        .init();

    println!();
    println!("  ⚡  SysDeck Agent  v{}", env!("CARGO_PKG_VERSION"));
    println!();

    #[cfg(target_os = "windows")]
    spawn_windows_shutdown_listener();

    init_dirs();
    println!("  ✓  Data directory ready");

    let conn = Arc::new(Mutex::new(init_db()));
    let db_for_shutdown = conn.clone();
    println!("  ✓  Database initialized");

    // Load or create JWT signing key (OS Keychain via keyring)
    let jwt_key = Arc::new(auth::load_or_create_jwt_key().expect("Failed to load JWT signing key"));
    println!("  ✓  JWT signing key loaded");

    let (port, listener) = find_available_port().await;
    println!("  ✓  Server bound to localhost:{}", port);

    // Create broadcast channels
    let (telemetry_tx, _) = broadcast::channel::<Arc<TelemetrySnapshot>>(256);
    let (system_tx, _) = broadcast::channel::<String>(16);
    let (clipboard_tx, _) = broadcast::channel::<String>(16);

    // Start telemetry engine
    sysdeck_agent::telemetry::start_engine(telemetry_tx.clone(), conn.clone());
    println!("  ✓  Telemetry engine started");

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

    // Start clipboard polling task
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
    };

    let app = build_router(app_state.clone());

    // Signal channel for server readiness
    let (server_ready_tx, server_ready_rx) = oneshot::channel::<()>();

    // Start server in a background task, signal when it begins accepting connections
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

    if daemon_mode {
        // ── Daemon mode — no console, no banner, just the tray ──
        let _ = open::that(format!("http://localhost:{}", port));
        server_handle.await.expect("Server task panicked");
    } else {
        // ── Interactive mode — show banner, spawn daemon on Enter ──
        println!();
        println!("┌────────────────────────────────────────────────────────┐");
        println!("│  ⚡ SysDeck is running!                                │");
        println!("├────────────────────────────────────────────────────────┤");
        println!("│  The app is now active in your system tray.            │");
        println!("│                                                        │");
        println!("│  Press [Enter] to minimize to tray and open the browser│");
        println!("│  Press [Ctrl+C] to stop the app                        │");
        println!("└────────────────────────────────────────────────────────┘");
        println!();

        let port_for_block = port;
        tokio::task::spawn_blocking(move || {
            let mut buf = String::new();
            let _ = std::io::stdin().read_line(&mut buf);
            let _ = open::that(format!("http://localhost:{}", port_for_block));
        })
        .await
        .ok();

        // Spawn a detached daemon and exit, giving the terminal back to the user.
        // On non-Windows the process just keeps running (user can Ctrl+C).
        #[cfg(windows)]
        spawn_background_daemon();

        server_handle.await.expect("Server task panicked");
        println!("SysDeck Agent stopped.");
    }
}
