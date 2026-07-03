// On Windows, "windows" subsystem means no console auto-attaches to the process.
// We manually allocate one at startup for the splash screen via AllocConsole().
// On Linux/macOS this attribute is silently ignored — the terminal is already there.
#![cfg_attr(windows, windows_subsystem = "windows")]

use std::io;
use std::sync::Arc;

use rand::Rng;
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

// ── Windows splash console ──────────────────────────────────────────────────
//
// Atomics shared between the console ctrl handler (Win32 callback) and the
// async Enter-wait task. The ctrl handler is a bare C function pointer, so
// it cannot capture variables — globals are the only option here.
#[cfg(windows)]
static CONSOLE_PORT: std::sync::atomic::AtomicU16 =
    std::sync::atomic::AtomicU16::new(0);
#[cfg(windows)]
static CONSOLE_ATTACHED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
/// Ensures the browser is opened at most once regardless of which path
/// (X-button vs. Enter key) fires first.
#[cfg(windows)]
static BROWSER_OPENED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Registered with `SetConsoleCtrlHandler`.
///
/// When the user clicks the **X** on the splash console, Windows delivers
/// `CTRL_CLOSE_EVENT`. Returning `1` (TRUE) tells Windows **not** to kill
/// the process — we just detach the console and keep running via the tray.
///
/// Other signals (Ctrl+C, Ctrl+Break, logoff, shutdown) return `0` (FALSE)
/// so the default handler runs and tokio's graceful-shutdown path takes over.
#[cfg(windows)]
unsafe extern "system" fn console_ctrl_handler(ctrl_type: u32) -> i32 {
    use windows_sys::Win32::System::Console::{CTRL_CLOSE_EVENT, FreeConsole};
    if ctrl_type == CTRL_CLOSE_EVENT {
        // Detach the console window — closing it will NOT kill the process.
        if CONSOLE_ATTACHED.swap(false, std::sync::atomic::Ordering::SeqCst) {
            FreeConsole();
            // Closing stdin unblocks the Enter-wait read_line() below,
            // which will then call open_dashboard_once() itself.
            // We open the browser here only if Enter-wait hasn't already done it.
            open_dashboard_once();
        }
        1 // TRUE — suppress OS default (process termination)
    } else {
        0 // FALSE — let Ctrl+C / shutdown etc. flow to tokio's signal handler
    }
}

/// Open the dashboard in the default browser exactly once.
/// Safe to call from both the ctrl handler and the Enter-wait task.
#[cfg(windows)]
fn open_dashboard_once() {
    use std::sync::atomic::Ordering;
    if BROWSER_OPENED.swap(true, Ordering::SeqCst) {
        return; // already opened by the other code path
    }
    let port = CONSOLE_PORT.load(Ordering::SeqCst);
    if port != 0 {
        let _ = open::that(format!("http://localhost:{}", port));
    }
}

/// Allocate a fresh console window for the startup splash.
/// Must be called before any `println!` so output goes to the right place.
#[cfg(windows)]
fn init_splash_console() {
    use windows_sys::Win32::System::Console::{
        AllocConsole, SetConsoleCtrlHandler, SetConsoleOutputCP, SetConsoleTitleW,
    };
    unsafe {
        AllocConsole();
        // CP_UTF8 = 65001 — without this, ✓ and ⚡ render as garbage boxes.
        SetConsoleOutputCP(65001);
        CONSOLE_ATTACHED.store(true, std::sync::atomic::Ordering::SeqCst);
        // Register handler AFTER setting CONSOLE_ATTACHED = true.
        SetConsoleCtrlHandler(Some(console_ctrl_handler), 1);
        let title: Vec<u16> = "SysDeck Agent\0".encode_utf16().collect();
        SetConsoleTitleW(title.as_ptr());
    }
}

/// Detach (close) the splash console. Idempotent — safe to call multiple times.
#[cfg(windows)]
fn detach_splash_console() {
    use windows_sys::Win32::System::Console::FreeConsole;
    if CONSOLE_ATTACHED.swap(false, std::sync::atomic::Ordering::SeqCst) {
        unsafe { FreeConsole(); }
    }
}
// ── end Windows splash console ───────────────────────────────────────────────

#[tokio::main]
async fn main() {
    // Allocate the splash console before ANY println! so stdout is routed correctly.
    #[cfg(windows)]
    init_splash_console();

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

    // Generate setup token for headless/remote setup
    let setup_token: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(16)
        .map(char::from)
        .collect();
    let setup_token = Arc::new(setup_token);

    let (port, listener) = find_available_port().await;
    println!("  ✓  Server bound to localhost:{}", port);

    // Store the port for the console ctrl handler (Windows: needed if user clicks X).
    #[cfg(windows)]
    CONSOLE_PORT.store(port, std::sync::atomic::Ordering::SeqCst);

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
        setup_token,
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
        let mut ctrl_close = windows::ctrl_close().expect("Failed to bind Ctrl+Close");
        let mut ctrl_shutdown = windows::ctrl_shutdown().expect("Failed to bind Ctrl+Shutdown");
        tokio::select! {
            _ = ctrl_c.recv() => tracing::info!("Received Ctrl+C"),
            _ = ctrl_close.recv() => tracing::info!("Received Ctrl+Close"),
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
                let _ = system_tx_clone2.send(r#"{"event":"system","data":{"type":"shutting_down"}}"#.to_string());
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

    // ── Startup banner (complete) ────────────────────────────────────────────
    println!();
    println!("  ──────────────────────────────────────────────────");
    println!("  Dashboard  →  http://localhost:{}", port);
    println!("  Manage     →  System tray icon");
    println!("  Setup key  →  {}", setup_token);
    println!("  ──────────────────────────────────────────────────");

    let is_headless = cfg!(target_os = "linux") && std::env::var("DISPLAY").is_err();
    if is_headless {
        println!();
        println!("  Headless mode — no display detected.");
        println!("  Use SSH port forwarding to reach the dashboard:");
        println!("  ssh -L {}:127.0.0.1:{} user@host", port, port);
    } else {
        println!();
        println!("  Press Enter to open the dashboard.");
        println!("  Close this window at any time — SysDeck keeps running.");
    }
    println!();
    // ────────────────────────────────────────────────────────────────────────

    // Spawn a blocking task to wait for Enter, then open the browser and
    // detach the splash console. On Windows, if the user closes the window
    // first (CTRL_CLOSE_EVENT), FreeConsole() closes stdin, read_line()
    // returns EOF, and open_dashboard_once() is a no-op (already opened).
    if !is_headless {
        tokio::task::spawn_blocking(move || {
            let mut buf = String::new();
            // Returns Ok(0) on EOF (stdin closed by FreeConsole) or Ok(n) on Enter.
            let _ = std::io::stdin().read_line(&mut buf);

            #[cfg(windows)]
            {
                detach_splash_console();
                open_dashboard_once();
            }
            #[cfg(not(windows))]
            {
                let _ = open::that(format!("http://localhost:{}", port));
            }
        });
    }

    server_handle.await.expect("Server task panicked");

    println!("SysDeck Agent stopped.");
}
