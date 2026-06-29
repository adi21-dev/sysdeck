# 📄 Product & Technical Specification: RemotePC Agent V1

## 1. Problem Statement
Users need to monitor, manage, and execute tasks on their personal Windows laptops while away. Traditional Remote Desktop Protocol (RDP) is resource-heavy, requires complex network configurations, and provides a terrible experience on mobile screens. Existing lightweight tools lack deep system integration, require self-hosting complex infrastructure, or compromise on security.

## 2. Proposed Solution
**RemotePC Agent** is a standalone, portable Windows executable (`.exe`). When launched, it starts a local web server, embeds a mobile-optimized React dashboard, and securely tunnels it to the public internet. Users access the dashboard via any standard web browser to monitor system health, manage files, execute scripts, and control hardware securely from anywhere.

---

## 3. System Architecture

### 3.1 High-Level Architecture & Deployment Model
*   **Portable Execution:** The `.exe` is fully portable. Users can place it anywhere (e.g., `C:\Tools\RemotePC.exe`).
*   **Data Separation:** All runtime data is strictly isolated from the executable. Configuration, SQLite databases, logs, and the downloaded `cloudflared.exe` are stored in `%LOCALAPPDATA%\RemotePCAgent\`. This ensures that moving or updating the `.exe` never corrupts user data.
*   **Desktop App vs. Service:** V1 runs as a standard Desktop Application in the user's session. If the user logs out of Windows, the agent terminates. *(Note: V2 will evaluate running as a Windows Service for background persistence).*

### 3.2 Network, Tunnel & Transport
*   **Local Server:** Listens on a fixed, user-configurable local port (e.g., `localhost:3939`). Falls back to a random port if occupied.
*   **Public Tunnel (V1):** Uses **Cloudflare Quick Tunnels** (`trycloudflare.com`) for zero-config simplicity. 
*   **Tunnel Evolution (V2 Roadmap):** V1 explicitly accepts the undocumented limits of Quick Tunnels. V2 will migrate to **Cloudflare Named Tunnels** for production-grade SLAs, persistent URLs, and higher connection limits.
*   **Stream Parsing:** The agent captures and parses `cloudflared` **`stderr`** (where the URL is output) to extract the ephemeral URL.
*   **Runtime Health Monitor:** Continuously monitors the `cloudflared` child process. If it crashes, the agent restarts it and updates the Relay.

### 3.3 Database Architecture (Unified SQLite)
*   **Single Engine:** Uses a single SQLite database (`%LOCALAPPDATA%\RemotePCAgent\data.db`) for both OLTP and OLAP.
*   **Concurrency Configuration:** To prevent blocking between WebSocket reads, telemetry writes, and audit writes, SQLite is strictly configured with:
    ```sql
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=NORMAL;
    ```
*   **Schema Versioning:** A `schema_version` table is created on first run. All future database migrations are handled via sequential SQL scripts checked against this version.
*   **Telemetry Optimization:** WebSocket pushes data every 1 second, but SQLite only persists a data point every 1 minute.

---

## 4. Security & Access Control Model

### 4.1 Authentication & Session Management
*   **Stateful Sessions:** Sessions are **not** purely stateless JWTs. A 256-bit JWT signing key is generated on first run, encrypted using **Windows DPAPI** (tied to the local user account), and stored in the SQLite database. 
*   **Revocation:** The database maintains an active session table. "Revoke All Devices" instantly deletes these rows, invalidating all active JWTs.
*   **WebSocket Expiry:** If a 90-day session token expires while a WebSocket is open, the backend sends an `{"event": "auth_expired"}` message and gracefully closes the socket, forcing a re-login.
*   **CSRF & CSP:** The web server enforces strict `SameSite=Strict` cookies and serves a restrictive `Content-Security-Policy` (CSP) header to prevent XSS.

### 4.2 Rate Limiting & Brute-Force Protection
*   **Authentication Lockout (Account-Based):** Failed login/PIN attempts are tied to the Account ID. 5 failed attempts result in a 15-minute cooldown for that specific account, preventing CGNAT/NAT lockouts.
*   **General API Abuse (IP-Based):** Standard IP-based rate limiting (via `governor`) is applied to non-auth endpoints.

### 4.3 File System Security & Upload Limits
*   **Path Canonicalization:** All requested paths are resolved via `std::fs::canonicalize` and verified against Allow/Block lists to prevent directory traversal (`../../`).
*   **Streaming Uploads:** To prevent RAM exhaustion, file uploads use **streaming multipart parsing** (`axum::extract::Multipart` with streaming). Files are written directly to disk in chunks. Maximum upload size is strictly capped at 500 MB.

### 4.4 Script Execution Sandbox
Scripts execute with user privileges but are strictly sandboxed by the runtime environment:
*   **Timeout:** Maximum execution time of 5 minutes. The process is forcefully killed if exceeded.
*   **Output Limits:** Maximum stdout/stderr capture size of 1 MB. Excess output is truncated to prevent memory exhaustion.

### 4.5 Audit Logging
*   **Append-Only:** Enforced at the application logic layer (no DELETE/UPDATE queries).
*   **Timestamps:** All timestamps are stored internally as **UTC**. The React frontend handles conversion to the user's local timezone.
*   **Events Tracked:** Logins, pairing, script executions, file transfers, and **security settings changes** (password resets, path modifications).

---

## 5. Detailed Feature Specifications

### A. System Dashboard (Tiered Telemetry)
To minimize CPU overhead, `sysinfo` polling is tiered:
*   **1 Second:** CPU %, RAM %, Network Up/Down.
*   **5 Seconds:** Hardware Temperatures.
*   **10 Seconds:** Disk Space / I/O.
*   **30 Seconds:** Battery Status.
*   *Historical Analytics:* Queried from SQLite, rendered via `recharts`, compressed via `gzip`/`Brotli` in transit.

### B. Hardware & Quick Controls
*   **Power Command Queue:** Power commands (Shutdown, Restart, Sleep) are placed in a global queue. If a shutdown is already pending, subsequent requests are rejected or merged to prevent OS-level conflicts. Includes a 5-second cancellation window.

### C. Secure File Manager & Script Engine
*   File Manager: Browse, Upload (streaming), Download, Delete, Rename.
*   Script Engine: Predefined & Custom Scripts. Output Modes: *Live Stream* or *Wait & Show*.

### D. Logging & Maintenance
*   **Log Rotation:** Debug logs in `%LOCALAPPDATA%\RemotePCAgent\logs\` are strictly rotated. Maximum 10MB per file, keeping only the last 3 files.
*   **Database Export:** Settings page includes a "Export Data" button to download a backup of the SQLite database.

---

## 6. Technical Stack

### Backend (Windows Agent)
*   **Language:** Rust (Edition 2021)
*   **Web Framework:** `axum` (with `tower-http` for CORS, Compression, and CSP).
*   **Rate Limiting:** `governor` crate.
*   **Async Runtime:** `tokio`
*   **Database:** `rusqlite` (bundled, WAL mode).
*   **System Info:** `sysinfo` crate.
*   **Security:** `argon2`, `totp-rs`, `jsonwebtoken`, `zxcvbn`, `windows` crate (for DPAPI and OS events).
*   **File I/O:** `tokio::fs` (streaming multipart).
*   **System Tray:** `tray-icon` crate.

### Frontend (Web Dashboard)
*   **Framework:** React 18+ (Vite), TailwindCSS, Zustand, `recharts`.
*   **Embedding:** `rust-embed`.

### Distribution & Trust
*   **Format:** Single Portable `.exe`.
*   **Code Signing:** **Critical for V1 Release.** Because the agent downloads executables, opens tunnels, and runs scripts, it will trigger Windows Defender/SmartScreen heuristics. The `.exe` **must** be signed with an Authenticode certificate to establish trust and prevent false positives.
*   **`cloudflared.exe`:** Downloaded on first run to `%LOCALAPPDATA%`, verified via dynamic `.sha256sum` fetch. The agent checks for `cloudflared` updates alongside its own version check.

---

## 7. Operational Workflows

### 7.1 First Run & Setup
1.  Run `.exe`. Creates `%LOCALAPPDATA%\RemotePCAgent\` directory structure.
2.  Downloads/verifies `cloudflared`.
3.  Binds to local port (falls back if occupied).
4.  Opens browser to `http://localhost:<port>/setup`.
5.  Setup Wizard: Password (`zxcvbn`), TOTP, 10 Recovery Codes (12 random Base32 chars, stored as Argon2id hashes), Relay Opt-In.

### 7.2 The Shutdown Sequence
1.  **Physical Shutdown:** Rust backend intercepts `WM_QUERYENDSESSION`, broadcasts `{"action": "shutting_down"}` to WebSockets, and exits gracefully.
2.  **Remote Shutdown:** 
    *   UI sends command. Backend checks for active file transfers.
    *   If active, UI shows confirmation dialog.
    *   If confirmed, backend replies with success, executes `shutdown /s /t 5`. OS terminates process. UI transitions to "PC is offline".

---

## 8. Performance & Resource Constraints

*Measurement Baseline: Idle, background, no active client connections.*

*   **Binary Size:** **< 20MB**.
*   **Idle CPU:** < 0.5% (Achieved via tiered `sysinfo` polling).
*   **Idle RAM:** **< 30MB**.
*   **Storage Footprint:** SQLite DB < 10MB. Logs < 30MB.
*   **Network:** Minimal bandwidth when idle.

---

## 9. Known Limitations (V1)
1.  **No File Transfer Resume:** 500MB transfers fail completely on network drop.
2.  **No Background Clipboard Polling:** PC-to-Web requires manual triggering.
3.  **No Native Mobile App:** V1 relies entirely on the mobile web browser.
4.  **Windows Only:** No macOS or Linux support.
5.  **Desktop App Only:** Agent terminates on Windows user logout.
6.  **Quick Tunnel Limits:** V1 uses Cloudflare Quick Tunnels, which have undocumented connection/bandwidth limits. V2 will migrate to Named Tunnels.
7.  **Audit Log is Append-Only via Logic:** True cryptographic immutability is not enforced.

---

