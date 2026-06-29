
## Phase 2: Cloudflare Tunnel & Telemetry Engine

**Goal:** Integrate `cloudflared` to expose the local server to the internet, and build the tiered `sysinfo` telemetry engine that broadcasts data via WebSockets.

### 📝 Instructions for `opencode`
*   **Tunnel Integration:**
    *   On startup, check if `cloudflared.exe` exists in `%LOCALAPPDATA%\RemotePCAgent\`. If not, download it from the official Cloudflare GitHub releases and verify the SHA256 checksum.
    *   Spawn `cloudflared` as a child process with the `tunnel --url localhost:3939` arguments.
    *   **Crucial:** Capture `stderr` of the child process. Parse the output using Regex to extract the `*.trycloudflare.com` URL. Print this URL to the console and log it.
    *   Implement a health monitor: if the `cloudflared` process dies, restart it.
*   **Telemetry Engine:**
    *   Use the `sysinfo` crate. Implement a tiered polling system using `tokio::time::interval`:
        *   1s: CPU %, RAM %, Network Up/Down.
        *   5s: Hardware Temperatures.
        *   10s: Disk Space / I/O.
        *   30s: Battery Status.
    *   Create a WebSocket endpoint (`/ws`).
    *   Broadcast the 1-second telemetry data to all connected WebSocket clients.
    *   *Optimization:* Only persist data to SQLite once every 1 minute to save I/O.

### ✅ Acceptance Criteria
1.  Console prints a valid `https://[random].trycloudflare.com` URL.
2.  Accessing that public URL from a different device loads the placeholder page.
3.  Connecting to `/ws` via a WebSocket client receives JSON telemetry data every 1 second.
4.  Killing the `cloudflared` process manually via Task Manager results in the agent restarting it automatically.

---
