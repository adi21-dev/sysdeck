use std::io::Write;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use regex::Regex;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::oneshot;

use crate::get_data_dir;

const MAX_RETRIES: u32 = 3;
const TIMEOUT_API_SECS: u64 = 30;
const TIMEOUT_DOWNLOAD_SECS: u64 = 300;

#[derive(serde::Deserialize)]
struct GithubRelease {
    body: String,
}

fn get_cloudflared_path() -> PathBuf {
    get_data_dir().join("cloudflared.exe")
}

pub async fn ensure_cloudflared() -> Result<(), String> {
    let path = get_cloudflared_path();
    if path.exists() {
        tracing::info!("cloudflared.exe already present at {}", path.display());
        return Ok(());
    }

    // Clean up any leftover temp file from a previous interrupted download
    let tmp_path = path.with_extension("exe.tmp");
    if tmp_path.exists() {
        let _ = std::fs::remove_file(&tmp_path);
    }

    let api_client = reqwest::Client::builder()
        .timeout(Duration::from_secs(TIMEOUT_API_SECS))
        .build()
        .map_err(|e| format!("Failed to build API client: {}", e))?;

    let download_client = reqwest::Client::builder()
        .timeout(Duration::from_secs(TIMEOUT_DOWNLOAD_SECS))
        .build()
        .map_err(|e| format!("Failed to build download client: {}", e))?;

    // Fetch latest release info from GitHub API
    let release: GithubRelease = api_client
        .get("https://api.github.com/repos/cloudflare/cloudflared/releases/latest")
        .header("User-Agent", "NodeDeskAgent/0.1")
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch latest release info: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse release JSON: {}", e))?;

    // Extract SHA256 hash for windows amd64 exe from release body
    let hash_re = Regex::new(r"cloudflared-windows-amd64\.exe:\s*([a-fA-F0-9]{64})")
        .expect("Invalid hash regex");
    let expected_hash = hash_re
        .captures(&release.body)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_lowercase())
        .ok_or_else(|| {
            tracing::error!(
                "Could not find SHA256 hash in release body for cloudflared-windows-amd64.exe"
            );
            "SHA256 hash not found in release notes".to_string()
        })?;

    tracing::info!("Expected SHA256: {}", expected_hash);

    let exe_url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";

    // Retry loop with exponential backoff
    let mut last_err = String::new();
    for attempt in 1..=MAX_RETRIES {
        tracing::info!(
            "Downloading cloudflared.exe (attempt {}/{})...",
            attempt,
            MAX_RETRIES
        );

        match download_cloudflared(&download_client, exe_url, &tmp_path).await {
            Ok(actual_hash) => {
                if actual_hash != expected_hash {
                    let _ = std::fs::remove_file(&tmp_path);
                    return Err(format!(
                        "SHA256 mismatch for cloudflared.exe. Expected: {}, got: {}",
                        expected_hash, actual_hash
                    ));
                }
                tracing::info!("SHA256 verified");

                // Atomically rename temp -> final
                std::fs::rename(&tmp_path, &path)
                    .map_err(|e| format!("Failed to rename temp file: {}", e))?;
                tracing::info!("cloudflared.exe downloaded to {}", path.display());
                return Ok(());
            }
            Err(e) => {
                let _ = std::fs::remove_file(&tmp_path);
                last_err = e;
                tracing::warn!("Download attempt {} failed: {}", attempt, last_err);
                if attempt < MAX_RETRIES {
                    let backoff = Duration::from_secs(2u64.pow(attempt));
                    tracing::info!("Retrying in {}s...", backoff.as_secs());
                    tokio::time::sleep(backoff).await;
                }
            }
        }
    }

    Err(format!(
        "Failed to download cloudflared.exe after {} attempts: {}",
        MAX_RETRIES, last_err
    ))
}

/// Stream the binary download to disk while computing SHA256.
async fn download_cloudflared(
    client: &reqwest::Client,
    url: &str,
    path: &PathBuf,
) -> Result<String, String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Download request failed: {}", e))?;

    let total = response.content_length().unwrap_or(0);
    tracing::info!("Download size: {} MB", total / 1_000_000);

    let mut file = std::fs::File::create(path)
        .map_err(|e| format!("Failed to create temp file: {}", e))?;
    let mut hasher = Sha256::new();
    let mut downloaded: u64 = 0;
    let mut last_log = std::time::Instant::now();

    const CHUNK_TIMEOUT: Duration = Duration::from_secs(60);

    use futures_util::StreamExt;
    let mut stream = response.bytes_stream();
    loop {
        let chunk = match tokio::time::timeout(CHUNK_TIMEOUT, stream.next()).await {
            Ok(Some(Ok(c))) => c,
            Ok(Some(Err(e))) => return Err(format!("Download stream error: {}", e)),
            Ok(None) => break,
            Err(_) => {
                return Err(
                    "Download stalled - no data received for 60s. Retrying...".to_string(),
                )
            }
        };
        hasher.update(&chunk);
        file.write_all(&chunk)
            .map_err(|e| format!("Failed to write to file: {}", e))?;
        downloaded += chunk.len() as u64;

        if last_log.elapsed() >= Duration::from_secs(10) {
            let pct = if total > 0 {
                (downloaded as f64 / total as f64 * 100.0) as u32
            } else {
                0
            };
            tracing::info!(
                "Downloaded {:.1} MB / {} MB ({}%)",
                downloaded as f64 / 1_000_000.0,
                total as f64 / 1_000_000.0,
                pct
            );
            last_log = std::time::Instant::now();
        }
    }

    Ok(hex_encode(&hasher.finalize()))
}

pub async fn run_tunnel_loop(port: u16, mut shutdown_rx: oneshot::Receiver<()>) {
    let path = get_cloudflared_path();
    let url_re = Regex::new(r"https://[\w-]+\.trycloudflare\.com").unwrap();

    loop {
        let mut child = match tokio::process::Command::new(&path)
            .args([
                "tunnel",
                "--url",
                &format!("http://localhost:{}", port),
                "--no-autoupdate",
            ])
            .stderr(Stdio::piped())
            .stdout(Stdio::null())
            .stdin(Stdio::null())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                tracing::error!("Failed to spawn cloudflared: {}", e);
                tokio::time::sleep(Duration::from_secs(5)).await;
                continue;
            }
        };

        let stderr = child
            .stderr
            .take()
            .expect("cloudflared stderr not captured");
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        let mut found_url = false;

        tracing::info!("cloudflared tunnel started");

        loop {
            tokio::select! {
                line = lines.next_line() => {
                    match line {
                        Ok(Some(line)) => {
                            tracing::debug!("[cloudflared] {}", line);
                            if !found_url {
                                if let Some(mat) = url_re.find(&line) {
                                    let url = mat.as_str().to_string();
                                    tracing::info!(">>> Tunnel URL: {}", url);
                                    println!(">>> Tunnel URL: {}", url);
                                    found_url = true;
                                }
                            }
                        }
                        Ok(None) => {
                            tracing::warn!("cloudflared stderr closed");
                            break;
                        }
                        Err(e) => {
                            tracing::error!("Error reading cloudflared stderr: {}", e);
                            break;
                        }
                    }
                }
                _ = &mut shutdown_rx => {
                    tracing::info!("Tunnel shutdown signal received");
                    let _ = child.kill().await;
                    let _ = child.wait().await;
                    tracing::info!("cloudflared terminated");
                    return;
                }
            }
        }

        let status = child.wait().await;
        tracing::warn!("cloudflared exited with: {:?}. Restarting in 2s...", status);
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}
