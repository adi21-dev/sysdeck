# Tunnel, Battery, Relay Opt-In Design

**Date**: 2025-06-30
**Status**: Approved

## 1. Battery Polling + Dashboard Indicator

### Backend

- Add Win32 `GetSystemPowerStatus` FFI to `telemetry.rs` (same `extern "system"` + `#[repr(C)]` pattern as DPAPI in `auth.rs`)
- Call every 30s on the OS polling thread
- Populate existing `battery_percent: Option<f32>` and `battery_charging: Option<bool>` fields

### Frontend

- **Metric card**: Bottom-row card showing `🔋 {percent}%` + `⚡` when charging
  - Green >60%, Yellow 20–60%, Red <20%
- **Chart panel**: Third recharts `AreaChart` panel alongside CPU/RAM and Network
  - Domain `[0, 100]`, yellow gradient, same styling pattern
- Data rides existing telemetry WS stream, no new plumbing

## 2. Cloudflare Quick Tunnel

### Module

`backend/src/tunnel.rs`, declared `pub mod tunnel`. New dep: `reqwest` with `rustls-tls`.

### State

```
Idle → Downloading → Starting → Running{url} → Failed(error)
                 ↘                         ↙
               Failed(error)        Idle (restart)
```

### AppState

```rust
pub struct TunnelState {
    pub status: RwLock<TunnelStatus>,
    pub url: RwLock<Option<String>>,
    pub child_pid: RwLock<Option<u32>>,
    pub tx: broadcast::Sender<Arc<TunnelEvent>>,
}

pub enum TunnelStatus { Idle, Downloading, Starting, Running{url:String}, Failed(String) }
```

Also `port: u16` in `AppState`.

### Download (retry + SHA256)

1. `GET https://api.github.com/repos/cloudflare/cloudflared/releases/latest`
2. Parse assets for `cloudflared-windows-amd64.exe` → URL + SHA256 from release body
3. Download to temp file, SHA256 hash, compare
4. Mismatch → delete temp, return `Failed("Checksum mismatch")`
5. Match → move to `{data_dir}/cloudflared.exe`
6. Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 5 attempts

### Spawn + monitor

1. `Command::new(cloudflared_path).args(["tunnel", "--url", &format!("http://localhost:{}", port)])`
2. Pipe stderr, read lines for `trycloudflare.com` URL via regex
3. Monitor via `child.wait().await`: on exit, log code, wait 2s, restart. **No HTTP pings.**

### Shutdown

`TunnelState::stop()`: kill child via `Command::kill()` + `Command::wait()`. Called from `/api/tunnel/stop` and `main.rs` shutdown hook.

### API endpoints (auth-proxied)

- `POST /api/tunnel/start` — start tunnel
- `POST /api/tunnel/stop` — stop tunnel
- `GET /api/tunnel/status` — current status + URL

### WS integration

`tunnel_tx: broadcast::Sender<Arc<TunnelEvent>>` in `AppState`. WS handler subscribes to both `telemetry_tx` and `tunnel_tx`, multiplexes into single stream. Messages have `event` field (`"telemetry"` or `"tunnel_status"`).

### Frontend (Settings.tsx)

- Tunnel section: status badge + Start/Stop button
- Running: clickable tunnel URL

## 3. Setup Relay Opt-In

### SetupFlow

Add `relay_opt_in: bool` (default `false`).

### Flow

After step 3 (recovery codes confirmed), transition to step 4 `"relay_opt_in"` instead of finishing.

### New API endpoint

`POST /api/setup/relay?token=...` with body `{"enabled": bool}` — updates flow, returns new token.

### Updated finish handler

After creating user, write `db::set_setting("relay_opt_in", "true"|"false")`.

### Updated progress handler

Recognize step 4 as `"relay_opt_in"`.

### Frontend (Setup.tsx)

- STEPS becomes `["Password", "Two-Factor Auth", "Recovery Codes", "Relay"]`
- New `StepRelay` component: description + toggle
- Posts to `/api/setup/relay` then `/api/setup/finish`

### Auto-start on app launch (main.rs)

After DB init, check `db::get_setting("relay_opt_in")`. If `"true"`, call internal tunnel start (direct function call, not HTTP). **No Windows Registry changes.**

## Dependencies

- `reqwest = { version = "0.12", default-features = false, features = ["rustls-tls"] }` — for GitHub API + cloudflared download
- `sha2` — for SHA256 verification of downloaded binary
