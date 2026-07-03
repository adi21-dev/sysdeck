# 📄 Product Requirements Document: SysDeck V1

## 1. Problem Statement
Users need to monitor, manage, and execute tasks on their personal computers (Windows, macOS, Linux) while away. Traditional Remote Desktop Protocol (RDP/VNC) is resource-heavy, requires complex network configurations (port forwarding), and provides a terrible experience on mobile screens. Existing lightweight tools lack deep system integration, require self-hosting complex infrastructure, or compromise on security and ease of use.

## 2. Proposed Solution
**SysDeck** is a standalone, portable, cross-platform executable. When launched, it starts a local web server, embeds a mobile-optimized React dashboard, and securely tunnels it to the public internet. 

Users access the dashboard via any standard web browser (or installed as a PWA on mobile) to monitor system health, manage files, execute scripts, and control hardware securely from anywhere. 

**Core Philosophy:** "Run the binary, and you're connected." Zero-config networking, single-user ownership, and a strict separation between local machine management and remote access.

---

## 3. The "Three UI" Architecture
SysDeck operates on a context-aware UI model. The backend serves the same React frontend, but the UI adapts based on the access context.

### 3.1 Context 1: Localhost Admin UI (The Manager)
*   **Access:** Strictly bound to `127.0.0.1` (or validated via request headers to ensure it's not coming through the tunnel).
*   **Audience:** The Owner, physically sitting at the machine.
*   **Capabilities:** Full access. Includes everything in the Remote UI **plus** the hidden **Settings/Configuration** tab.
*   **Settings Include:** Tunnel controls (start/stop/copy URL), allowed/blocked file paths, port configuration, log/DB export, and update settings.

### 3.2 Context 2: Remote User UI (Desktop Web)
*   **Access:** Accessed via the public Cloudflare Quick Tunnel URL.
*   **Audience:** The Owner, accessing from another computer.
*   **Capabilities:** Dashboard, File Manager, Script Engine, Power Controls. 
*   **Restrictions:** The **Settings/Configuration** tab is completely hidden and API routes for settings return `403 Forbidden`. The user does not see technical jargon (no ports, no tunnel URLs).

### 3.3 Context 3: Remote User UI (Mobile PWA)
*   **Access:** Same as Remote User UI, but accessed via a mobile browser.
*   **Capabilities:** Fully responsive, mobile-first design. Installable to the home screen as a Progressive Web App (PWA) for an app-like experience without App Store friction.

---

## 4. System Architecture & Build Pipeline

### 4.1 The Single Binary & Build Pipeline
SysDeck is distributed as a **single, standalone binary** with zero external dependencies.
*   **Frontend Build:** A Rust `build.rs` script automatically executes `npm install && npm run build` for the React app during compilation.
*   **Embedding:** The compiled React `dist/` folder is embedded directly into the Rust binary using the `rust-embed` crate.
*   **Cross-Compilation:** We use the `cross` tool to compile the Rust backend for Windows (`.exe`), macOS (`.app`/binary), and Linux (ELF binary) from a single codebase.

### 4.2 Network & Tunnel
*   **Local Server:** Listens on a user-configurable local port (e.g., `localhost:3939`).
*   **Public Tunnel (V1):** Uses **Cloudflare Quick Tunnels** (`trycloudflare.com`). The URL changes on every restart, but the Localhost Admin UI provides a prominent "Copy URL" button.
*   **Stream Parsing:** The agent captures `cloudflared` **`stderr`** to extract the ephemeral URL.

### 4.3 Database & Storage
*   **Single Engine:** SQLite (`data.db`) stored in the OS-specific local app data directory (e.g., `~/.config/SysDeck/` on Linux, `%LOCALAPPDATA%\SysDeck\` on Windows).
*   **Concurrency:** Strictly configured with `PRAGMA journal_mode=WAL;` and `PRAGMA synchronous=NORMAL;`.
*   **Secret Storage:** Uses the **`keyring` crate** to securely store the JWT signing key and credentials in the OS-native Keychain (Windows Credential Manager, macOS Keychain, Linux Secret Service). *Fallback:* Machine-ID encryption if the OS keyring is unavailable (e.g., headless Linux).

---

## 5. Security & Access Control (Single-User Model)

### 5.1 Authentication
*   **Single Owner:** There is only one user account. 
*   **Setup:** On first run, the user creates a strong password (enforced via `zxcvbn`) and sets up TOTP (2FA). 10 Recovery codes are generated.
*   **Session Management:** Stateful sessions backed by a 256-bit JWT key (encrypted via `keyring`). 
*   **Context Enforcement:** Middleware strictly checks request origins. Admin routes (`/api/admin/*`) are rejected if the request originates from the Cloudflare tunnel.

### 5.2 Rate Limiting & Brute-Force Protection
*   **Account Lockout:** 5 failed login attempts result in a 15-minute cooldown.
*   **API Abuse:** Standard IP-based rate limiting via the `governor` crate for non-auth endpoints.

### 5.3 File System & Script Security
*   **Path Canonicalization:** All file paths are resolved via `std::fs::canonicalize` and checked against the Admin-defined Allow/Block lists to prevent directory traversal.
*   **Streaming Uploads:** File uploads use streaming multipart parsing. Max size: 500 MB.
*   **Script Sandbox:** Max execution time: 5 minutes. Max stdout/stderr capture: 1 MB. Processes are forcefully killed if limits are exceeded.

---

## 6. Detailed Feature Specifications

### A. System Dashboard (Tiered Telemetry)
To minimize CPU overhead, `sysinfo` polling is tiered:
*   **1s:** CPU %, RAM %, Network Up/Down.
*   **5s:** Hardware Temperatures.
*   **10s:** Disk Space / I/O.
*   **30s:** Battery Status (via OS FFI).
*   *Analytics:* Historical data queried from SQLite, rendered via `recharts`.

### B. Hardware & Power Controls
*   **Power Queue:** Shutdown, Restart, Sleep commands are queued. Includes a 5-second cancellation window.
*   **Active Transfer Guard:** If a file transfer is active, the UI prompts for confirmation before executing a power command.

### C. Secure File Manager & Script Engine
*   **File Manager:** Browse, Upload (streaming), Download, Delete, Rename. Directories sorted first.
*   **Script Engine:** Predefined & Custom Scripts (PowerShell/Bash/CMD). Output Modes: *Live Stream* (via WebSocket) or *Wait & Show*.

### D. System Tray Integration
*   **Status Indicators:** 
    *   🟢 Green = Tunnel active & connected
    *   🟡 Yellow = Tunnel reconnecting
    *   🔴 Red = Tunnel down / offline
*   **Context Menu:** Open Admin UI, Copy Remote URL, Pause/Resume Tunnel, Run on Startup, Quit.
*   **Linux Support:** Uses `libappindicator` / `StatusNotifier` for proper integration with Linux desktop environments.

---

## 7. UX/UI & Design Guidelines
*As an experienced UI/UX designer, the following principles are mandated for the React frontend:*

1.  **Progressive Disclosure:** The Remote UI is clean and minimal. Technical settings are completely hidden unless accessed via Localhost.
2.  **Mobile-First PWA:** The Remote UI is designed for mobile screens first. Bottom navigation bar for mobile, sidebar for desktop.
3.  **Dark Mode:** Essential for a remote monitoring tool. Defaults to system preference, with manual toggle.
4.  **Connection Status:** An always-visible, subtle indicator in the header showing "Connected / Reconnecting / Offline".
5.  **Destructive Action Patterns:** Deleting files or shutting down the PC requires a **two-step confirmation** (e.g., typing "SHUTDOWN" or a double-click confirmation) rather than a simple "OK/Cancel" modal.
6.  **Empty States:** Friendly illustrations and clear CTAs when no scripts exist or no files are uploaded.
7.  **Real-time Feedback:** Skeleton loaders for data, progress bars for uploads, and toast notifications for actions. No blocking modal spinners.
8.  **Accessibility:** WCAG 2.1 AA compliance (keyboard navigation, ARIA labels, sufficient contrast).

---

## 8. Operational Workflows

### 8.1 First-Run Experience
*   **Desktop (Windows/macOS/Linux GUI):** The binary automatically opens the default web browser to `http://localhost:<port>/setup`.
*   **Headless Linux (Servers):** Since there is no GUI to open a browser, the terminal prints:
    ```text
    SysDeck is running on http://127.0.0.1:3939
    To complete setup, use SSH port forwarding or access via your network.
    One-time setup token: a8f9-3b2c-9d1e
    ```

### 8.2 The Shutdown Sequence
1.  **Physical Shutdown:** Rust backend intercepts OS termination signals (`WM_QUERYENDSESSION` on Windows, `SIGTERM` on Linux/Mac), broadcasts `{"action": "shutting_down"}` to WebSockets, and exits gracefully.
2.  **Remote Shutdown:** UI sends command -> Backend checks for active file transfers -> If clear, executes OS shutdown command -> UI transitions to "PC is offline" overlay.

---

## 9. Technical Stack

### Backend (SysDeck Agent)
*   **Language:** Rust (Edition 2021)
*   **Web Framework:** `axum` (with `tower-http` for CORS, Compression, CSP).
*   **Async Runtime:** `tokio`
*   **Database:** `rusqlite` (bundled, WAL mode).
*   **System Info:** `sysinfo` crate.
*   **Security:** `argon2`, `totp-rs`, `jsonwebtoken`, `zxcvbn`, `keyring` (OS Keychain).
*   **File I/O:** `tokio::fs` (streaming multipart).
*   **System Tray:** `tray-icon` (Win/Mac), `libappindicator` (Linux).

### Frontend (Web Dashboard & PWA)
*   **Framework:** React 18+ (Vite), TailwindCSS, Zustand, `recharts`.
*   **Embedding:** `rust-embed` (bundled directly into the Rust binary).
*   **Build Integration:** `build.rs` script triggers `npm run build`.

---

## 10. Performance & Resource Constraints
*Measurement Baseline: Idle, background, no active client connections.*

*   **Binary Size:** **< 25MB** (Optimized via `opt-level="z"`, `lto=true`, `strip=true` in `Cargo.toml`).
*   **Idle CPU:** < 0.5% (Achieved via tiered `sysinfo` polling).
*   **Idle RAM:** **< 40MB**.
*   **Storage Footprint:** SQLite DB < 10MB. Logs < 30MB.

---

## 11. Known Limitations (V1) & V2 Roadmap

### V1 Limitations
1.  **Ephemeral URLs:** Uses Cloudflare Quick Tunnels. The remote URL changes every time the app restarts.
2.  **No File Transfer Resume:** 500MB transfers fail completely on network drop.
3.  **No Native Mobile Apps:** Relies entirely on the responsive PWA.
4.  **Desktop App Only:** Agent terminates when the user logs out of the OS (no background daemon/service mode).
5.  **Audit Log is Append-Only via Logic:** True cryptographic immutability is not enforced.

### V2 Roadmap (Future Consideration)
*   **Cloudflare Named Tunnels:** For persistent URLs and production SLAs (requires user to bring their own domain/Cloudflare account).
*   **Native Mobile Apps:** React Native or Flutter apps for deep OS integration (background clipboard, native push notifications).
*   **Background Service Mode:** Run as a Windows Service / systemd daemon for headless persistence.
*   **Multi-User Support:** Re-introduce granular roles (Viewer, Operator) if community demand arises.
*   **File Transfer Resume:** Chunked uploads/downloads with state tracking.

---
