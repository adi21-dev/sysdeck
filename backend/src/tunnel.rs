use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use regex::Regex;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::oneshot;

use crate::get_data_dir;

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

    tracing::info!("Downloading cloudflared.exe...");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    // Fetch latest release info from GitHub API
    let release: GithubRelease = client
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

    // Download binary
    let exe_url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";
    let response = client
        .get(exe_url)
        .send()
        .await
        .map_err(|e| format!("Failed to download cloudflared: {}", e))?;
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read cloudflared response: {}", e))?;

    // Verify SHA256
    let actual_hash = hex_encode(&Sha256::digest(&bytes));
    if actual_hash != expected_hash {
        return Err(format!(
            "SHA256 mismatch for cloudflared.exe. Expected: {}, got: {}",
            expected_hash, actual_hash
        ));
    }
    tracing::info!("SHA256 verified");

    std::fs::write(&path, &bytes).map_err(|e| format!("Failed to write cloudflared.exe: {}", e))?;
    tracing::info!("cloudflared.exe downloaded to {}", path.display());
    Ok(())
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
