use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::State;
use axum::response::Json;

use serde::Serialize;
use sha2::{Digest, Sha256};
use tokio::fs;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::{broadcast, Mutex, RwLock};

use crate::AppState;

#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
const SHA256_URL: &str = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe.sha256";
#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
const DOWNLOAD_URL: &str = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";
#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
const CLOUDFLARED_FILENAME: &str = "cloudflared.exe";

#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
const SHA256_URL: &str = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.sha256sum";
#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
const DOWNLOAD_URL: &str =
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64";
#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
const CLOUDFLARED_FILENAME: &str = "cloudflared";

#[cfg(all(target_os = "linux", target_arch = "aarch64"))]
const SHA256_URL: &str = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.sha256sum";
#[cfg(all(target_os = "linux", target_arch = "aarch64"))]
const DOWNLOAD_URL: &str =
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64";
#[cfg(all(target_os = "linux", target_arch = "aarch64"))]
const CLOUDFLARED_FILENAME: &str = "cloudflared";

#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
const SHA256_URL: &str = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.sha256sum";
#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
const DOWNLOAD_URL: &str =
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64";
#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
const CLOUDFLARED_FILENAME: &str = "cloudflared";

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
const SHA256_URL: &str = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.sha256sum";
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
const DOWNLOAD_URL: &str =
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64";
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
const CLOUDFLARED_FILENAME: &str = "cloudflared";

const MAX_RETRIES: u32 = 5;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub enum TunnelStatus {
    Idle,
    Downloading,
    Starting,
    Running { url: String },
    Failed(String),
}

impl std::fmt::Display for TunnelStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TunnelStatus::Idle => write!(f, "idle"),
            TunnelStatus::Downloading => write!(f, "downloading"),
            TunnelStatus::Starting => write!(f, "starting"),
            TunnelStatus::Running { .. } => write!(f, "running"),
            TunnelStatus::Failed(_) => write!(f, "failed"),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct TunnelEvent {
    pub event: String,
    pub status: String,
    pub url: Option<String>,
    pub error: Option<String>,
}

pub struct TunnelState {
    pub status: RwLock<TunnelStatus>,
    pub url: RwLock<Option<String>>,
    pub exe_path: PathBuf,
    pub port: u16,
    kill_tx: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
    pub tx: broadcast::Sender<Arc<TunnelEvent>>,
}

impl TunnelState {
    pub fn new(
        data_dir: &std::path::Path,
        port: u16,
    ) -> (Self, broadcast::Receiver<Arc<TunnelEvent>>) {
        let (tx, rx) = broadcast::channel(100);
        (
            Self {
                status: RwLock::new(TunnelStatus::Idle),
                url: RwLock::new(None),
                exe_path: data_dir.join(CLOUDFLARED_FILENAME),
                port,
                kill_tx: Mutex::new(None),
                tx,
            },
            rx,
        )
    }

    pub async fn start(this: Arc<Self>) -> Result<(), String> {
        {
            let status = this.status.read().await;
            match &*status {
                TunnelStatus::Idle | TunnelStatus::Failed(_) => {}
                _ => return Err(format!("Tunnel is {}", status)),
            }
        }

        if !this.exe_path.exists() {
            this.set_status(TunnelStatus::Downloading).await;
            download_cloudflared(&this.exe_path).await?;
        }

        this.set_status(TunnelStatus::Starting).await;

        let (kill_tx, kill_rx) = tokio::sync::oneshot::channel::<()>();
        {
            let mut k = this.kill_tx.lock().await;
            *k = Some(kill_tx);
        }

        let weak = Arc::downgrade(&this);
        tokio::spawn(async move {
            run_tunnel_loop(weak, kill_rx).await;
        });

        Ok(())
    }

    pub async fn stop(&self) -> Result<(), String> {
        let mut k = self.kill_tx.lock().await;
        if let Some(tx) = k.take() {
            let _ = tx.send(());
        }
        self.set_status(TunnelStatus::Idle).await;
        self.url.write().await.take();
        Ok(())
    }

    pub async fn set_status(&self, status: TunnelStatus) {
        let url = match &status {
            TunnelStatus::Running { url } => Some(url.clone()),
            _ => None,
        };
        let error = match &status {
            TunnelStatus::Failed(e) => Some(e.clone()),
            _ => None,
        };
        *self.status.write().await = status;
        *self.url.write().await = url.clone();
        let _ = self.tx.send(Arc::new(TunnelEvent {
            event: "tunnel_status".to_string(),
            status: self.status.read().await.to_string(),
            url,
            error,
        }));
    }
}

async fn download_cloudflared(exe_path: &std::path::Path) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .user_agent("sysdeck-agent/0.1")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let checksum = download_with_retry(&client, SHA256_URL).await?;
    let checksum_text =
        std::str::from_utf8(&checksum).map_err(|e| format!("Invalid checksum UTF-8: {}", e))?;
    let expected_hash = checksum_text
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().next())
        .ok_or_else(|| "Failed to parse SHA256 checksum".to_string())?
        .to_string();

    let binary_data = download_with_retry(&client, DOWNLOAD_URL).await?;

    let actual_hash = data_encoding::HEXLOWER.encode(&Sha256::digest(&binary_data));
    if actual_hash != expected_hash {
        return Err(format!(
            "SHA256 mismatch: expected {}, got {}",
            expected_hash, actual_hash
        ));
    }

    let tmp = exe_path.with_extension("tmp");
    fs::write(&tmp, &binary_data)
        .await
        .map_err(|e| format!("Write failed: {}", e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755))
            .await
            .ok();
    }

    fs::rename(&tmp, exe_path)
        .await
        .map_err(|e| format!("Rename failed: {}", e))?;

    Ok(())
}

async fn download_with_retry(client: &reqwest::Client, url: &str) -> Result<Vec<u8>, String> {
    let mut backoff = Duration::from_secs(1);
    for attempt in 1..=MAX_RETRIES {
        let resp = client
            .get(url)
            .send()
            .await
            .map_err(|e| format!("Attempt {} failed: {}", attempt, e))?;

        if resp.status().is_success() {
            return resp
                .bytes()
                .await
                .map(|b| b.to_vec())
                .map_err(|e| format!("Read: {}", e));
        }

        if attempt < MAX_RETRIES {
            tracing::warn!(
                "Attempt {} returned {}, retry in {:?}",
                attempt,
                resp.status(),
                backoff
            );
            tokio::time::sleep(backoff).await;
            backoff *= 2;
        }
    }
    Err(format!("All {} attempts failed", MAX_RETRIES))
}

async fn run_tunnel_loop(
    weak: std::sync::Weak<TunnelState>,
    mut kill_rx: tokio::sync::oneshot::Receiver<()>,
) {
    tracing::info!("tunnel loop started");
    loop {
        let state = match weak.upgrade() {
            Some(s) => s,
            None => return,
        };

        let mut child = match Command::new(&state.exe_path)
            .args([
                "tunnel",
                "--no-autoupdate",
                "--url",
                &format!("http://localhost:{}", state.port),
            ])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
        {
            Ok(c) => {
                tracing::info!("cloudflared spawned successfully");
                c
            }
            Err(e) => {
                state
                    .set_status(TunnelStatus::Failed(format!("Spawn failed: {}", e)))
                    .await;
                return;
            }
        };

        let stderr = child.stderr.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let mut stderr_lines = BufReader::new(stderr).lines();
        let mut stdout_lines = BufReader::new(stdout).lines();
        let mut stderr_done = false;
        let mut stdout_done = false;
        let mut found_url = false;

        let timeout = tokio::time::sleep(Duration::from_secs(30));
        tokio::pin!(timeout);

        tracing::info!("waiting for tunnel URL (30s timeout)");
        loop {
            tokio::select! {
                line = stderr_lines.next_line(), if !stderr_done => {
                    match line {
                        Ok(Some(l)) => {
                            tracing::info!("cloudflared stderr: {}", l);
                            if let Some(url) = l.split_whitespace().find(|w| w.contains("trycloudflare.com")) {
                                found_url = true;
                                state.set_status(TunnelStatus::Running { url: url.to_string() }).await;
                            }
                        }
                        _ => stderr_done = true,
                    }
                }
                line = stdout_lines.next_line(), if !stdout_done => {
                    match line {
                        Ok(Some(l)) => {
                            tracing::info!("cloudflared stdout: {}", l);
                            if let Some(url) = l.split_whitespace().find(|w| w.contains("trycloudflare.com")) {
                                found_url = true;
                                state.set_status(TunnelStatus::Running { url: url.to_string() }).await;
                            }
                        }
                        _ => stdout_done = true,
                    }
                }
                _ = &mut kill_rx => {
                    let _ = child.kill().await;
                    let _ = child.wait().await;
                    return;
                }
                _ = &mut timeout => {
                    if !found_url {
                        let _ = child.kill().await;
                        let _ = child.wait().await;
                        state.set_status(TunnelStatus::Failed("Tunnel start timed out after 30s".to_string())).await;
                        return;
                    }
                }
            }
            if found_url || (stderr_done && stdout_done) {
                break;
            }
        }

        if !found_url {
            state
                .set_status(TunnelStatus::Failed("No tunnel URL received".to_string()))
                .await;
            return;
        }

        // Monitor process — restart on exit (or kill on signal)
        tokio::select! {
            result = child.wait() => {
                match result {
                    Ok(status) => tracing::warn!(
                        "cloudflared exited with {:?}, restarting in 2s",
                        status.code()
                    ),
                    Err(e) => tracing::error!("cloudflared wait error: {}", e),
                }
                state.set_status(TunnelStatus::Starting).await;
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
            _ = &mut kill_rx => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                return;
            }
        }
    }
}

// API handlers

#[derive(Serialize)]
pub struct TunnelStatusResponse {
    pub success: bool,
    pub status: String,
    pub url: Option<String>,
    pub error: Option<String>,
}

pub(crate) async fn status_handler(State(state): State<AppState>) -> Json<TunnelStatusResponse> {
    let status = state.tunnel_state.status.read().await;
    let url = state.tunnel_state.url.read().await.clone();
    let error = match &*status {
        TunnelStatus::Failed(e) => Some(e.clone()),
        _ => None,
    };
    Json(TunnelStatusResponse {
        success: true,
        status: status.to_string(),
        url,
        error,
    })
}

pub(crate) async fn start_handler(State(state): State<AppState>) -> Json<serde_json::Value> {
    match TunnelState::start(state.tunnel_state.clone()).await {
        Ok(()) => Json(serde_json::json!({"success": true, "message": "Tunnel started"})),
        Err(e) => Json(serde_json::json!({"success": false, "error": e})),
    }
}

pub(crate) async fn stop_handler(State(state): State<AppState>) -> Json<serde_json::Value> {
    match state.tunnel_state.stop().await {
        Ok(()) => Json(serde_json::json!({"success": true, "message": "Tunnel stopped"})),
        Err(e) => Json(serde_json::json!({"success": false, "error": e})),
    }
}
