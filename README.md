# NodeDesk — Remote PC Agent

A lightweight, cross-platform remote system management agent with a mobile-optimized web dashboard. Monitor CPU/RAM/disk/network, browse and transfer files, run scripts, and control power — all through a secure Cloudflare tunnel. No RDP, no complex config.

## Architecture

```
┌──────────────────────────────────────────────┐
│  Host (Windows / Linux / macOS)              │
│                                               │
│  ┌──────────────┐     ┌───────────────────┐  │
│  │  Rust Backend │◄───►│  SQLite (WAL)     │  │
│  │  (Axum 0.7)   │     │  data.db          │  │
│  ├──────────────┤     └───────────────────┘  │
│  │  /ws         │─── sysinfo telemetry       │
│  │  /api/files  │─── file manager            │
│  │  /api/scripts│─── script engine           │
│  │  /api/power  │─── power controls          │
│  │  /api/settings│─── settings admin         │
│  │  /api/audit  │─── audit log              │
│  │  /login      │─── password + TOTP auth    │
│  │  /setup      │─── first-run wizard        │
│  └──────┬───────┘                            │
│         │                                     │
│  ┌──────▼───────┐     ┌───────────────────┐  │
│  │  React SPA   │     │  cloudflared       │  │
│  │  (Vite)      │     │  tunnel            │  │
│  │  shadcn/ui   │     │  trycloudflare.com │  │
│  │  Tailwind v4 │     └─────────┬──────────┘  │
│  └──────────────┘               │              │
└─────────────────────────────────┼──────────────┘
                                  │
                     ┌────────────▼───────────┐
                     │  Public Internet        │
                     │  (any browser, any OS)  │
                     └────────────────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Rust, Axum 0.7, tokio, rusqlite (WAL) |
| Frontend | React 19, Vite, Tailwind CSS v4, shadcn/ui |
| State | Zustand |
| Charts | Recharts |
| Icons | Lucide React |
| Tunnel | Cloudflare Quick Tunnel (cloudflared) |
| Auth | Argon2id, TOTP, keyring (OS Keychain), zxcvbn |
| Rate Limit | governor |
| System Tray | tray-icon (cross-platform) |
| Secret Storage | keyring crate (Windows Credential Manager, macOS Keychain, Linux Secret Service) |

## Features

- **Dashboard** — live CPU, RAM, network, disk, temperature via WebSocket (1s polling); real-time charts
- **File Manager** — browse, upload (streaming, 500MB cap), download, delete, rename; table/grid views; path canonicalization with system directory block
- **Script Engine** — run PowerShell/Batch/Shell scripts; live streaming or wait-and-show output; 5-min timeout; 1MB output truncation
- **Power Controls** — Shutdown, Restart, Sleep, Sign Out, Lock; 5-second cancellation window; active-upload check before power off; two-step type-to-confirm
- **Security** — password + TOTP login, 90-day JWT sessions, OS Keychain-stored signing key, account lockout (5 failures → 15 min), IP rate limiting, CSP headers
- **Admin Context** — settings routes restricted to localhost; remote tunnel users see a limited dashboard without admin access
- **Audit Log** — append-only log of logins, file transfers, script executions, and security changes; filterable by event type and date range
- **Setup Wizard** — server-rendered first-run flow: password strength check → TOTP QR → recovery codes → relay opt-in
- **PWA** — installable as a desktop/mobile app; service worker for offline support
- **Dark Mode** — toggle in sidebar; follows system preference by default; persisted to localStorage
- **System Tray** — cross-platform tray icon with autostart support (Windows: reg.exe, Linux: .desktop, macOS: LaunchAgents)
- **Connection Status** — always-visible indicator (green/yellow/red) for WebSocket health
- **Headless Linux** — automatic terminal-only mode when no display is available; prints SSH port-forwarding instructions
- **Shutdown Sequence** — graceful WebSocket notification before the server stops

## Getting Started

### Prerequisites

| OS | Requirements |
|----|-------------|
| Windows | Windows 10/11, Rust toolchain (edition 2021), Node.js 20+ |
| Linux | systemd, dbus (for Secret Service), xdg-utils, Node.js 20+, Docker (for cross-compilation) |
| macOS | macOS 12+, Xcode CLI tools, Node.js 20+ |

### Quick Start

```bash
git clone https://github.com/your-org/nodedesk
cd nodedesk

# Backend (starts both backend + frontend automatically via build.rs)
cd backend
cargo run

# Or for frontend development (hot-reload):
cd frontend
npm install
npm run dev
```

On first run, the backend:
1. Creates `~/.local/share/NodeDesk/` or `%LOCALAPPDATA%\NodeDesk\` for data and logs
2. Stores the JWT signing key in your OS keychain (Credential Manager / Keychain / Secret Service)
3. Downloads `cloudflared` with SHA256 verification
4. Binds to `localhost:3939` (falls back to random port)
5. Opens your browser to the setup wizard

### Production Build

```bash
cd frontend && npm run build
cd ../backend && cargo build --release
```

The compiled binary is self-contained — the Vite build output is embedded via `rust-embed`. Build.rs auto-triggers the frontend build during native compilation.

The release profile is optimized for size (`opt-level = "z"`, LTO, `panic = "abort"`, single codegen unit, symbols stripped) — expect a ~10 MB binary.

### Cross-Compilation

Build for Linux from any host using [`cross`](https://github.com/cross-rs/cross):

```bash
# Pre-build frontend (not available inside Docker)
cd frontend && npm run build && cd ..

# Cross-compile the backend
cd backend
cross build --release --target x86_64-unknown-linux-gnu
```

The resulting binary is at `backend/target/x86_64-unknown-linux-gnu/release/nodedesk-agent.exe`.

> **How it works**: `Cross.toml` maps the Linux target to a custom Docker image defined in `cross/Dockerfile.x86_64-unknown-linux-gnu`, which extends the official `cross` base image with `libappindicator3-dev`, `libgtk-3-dev`, `libdbus-1-dev`, and `libsecret-1-dev`. The `build.rs` detects cross-compilation via the `CROSS` environment variable and skips the frontend build (Node.js is not available in the container).

## Project Structure

```
nodedesk/
├── backend/
│   ├── build.rs              # Auto-builds frontend during native cargo build (skipped under cross)
│   ├── src/
│   │   ├── main.rs           # Entry point, keyring init, shutdown signal
│   │   ├── lib.rs            # AppState, router, DB init, system tray, autostart
│   │   ├── auth.rs           # JWT, keyring, TOTP, auth middleware, admin middleware
│   │   ├── db.rs             # SQLite schema, telemetry/audit queries
│   │   ├── telemetry.rs      # sysinfo polling engine (dedicated OS thread)
│   │   ├── tunnel.rs         # Cloudflare tunnel manager (download + lifecycle)
│   │   ├── setup.rs          # Setup wizard state machine + handlers
│   │   ├── settings.rs       # Password/TOTP/port/paths settings handlers
│   │   ├── ws.rs             # WebSocket handler (telemetry + system events)
│   │   ├── file_manager.rs   # File listing, upload, download, delete, rename
│   │   ├── script.rs         # Script execution engine (process management)
│   │   ├── power.rs          # Shutdown/restart/sleep/signout/lock + cancel
│   │   └── audit.rs          # Audit log queries
│   ├── tests/
│   │   ├── common/mod.rs     # Test helpers (test_app, login helpers)
│   │   └── integration.rs    # 34 integration tests
│   └── Cargo.toml
├── cross/
│   └── Dockerfile.x86_64-unknown-linux-gnu  # Custom Docker image for cross-compilation
├── Cross.toml                                # cross configuration
├── frontend/
│   ├── e2e/
│   │   ├── specs/            # 8 Playwright spec files (23 tests)
│   │   └── playwright.config.ts
│   ├── src/
│   │   ├── components/
│   │   │   ├── layout/       # Sidebar, BottomNav, AppLayout, ProtectedRoute
│   │   │   └── ui/           # shadcn/ui: toast, skeleton, empty-state, confirm-dialog, etc.
│   │   ├── pages/            # Dashboard, Files, Scripts, Controls, Audit, Settings, Login, Setup
│   │   ├── hooks/            # WebSocket hook
│   │   └── lib/              # Zustand stores, navigation config, utilities
│   ├── public/               # PWA assets (manifest, icons, service worker)
│   └── package.json
└── README.md
```

## API Endpoints

### Authentication
| Method | Path | Description |
|--------|------|-------------|
| GET | `/login` | Login page (frontend route) |
| POST | `/login` | Authenticate (password + TOTP, form-urlencoded) |
| GET | `/api/auth/check` | Validate JWT cookie, restore session |
| GET | `/api/admin/check` | Check if request is from localhost |

### Setup Wizard
| Method | Path | Description |
|--------|------|-------------|
| GET | `/setup` | Server-rendered setup wizard |
| POST | `/setup` | Submit setup step |
| GET | `/api/setup/status` | Check if setup is complete |
| POST | `/api/setup/password` | Set initial password (step 1) |
| POST | `/api/setup/totp` | Generate TOTP secret (step 2) |
| POST | `/api/setup/verify-totp` | Verify TOTP code (step 3) |
| POST | `/api/setup/recovery-codes` | Generate recovery codes (step 4) |
| POST | `/api/setup/finish` | Complete setup |

### Dashboard & Telemetry
| Method | Path | Description |
|--------|------|-------------|
| GET | `/ws` | Telemetry + system events WebSocket |
| GET | `/api/telemetry/history` | Historical telemetry data (query params: `from`, `to`) |

### File Management
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/files/list` | List directory contents |
| POST | `/api/files/upload` | Upload file (streaming, path in query) |
| GET | `/api/files/download` | Download file |
| POST | `/api/files/delete` | Delete file(s) |
| POST | `/api/files/rename` | Rename file |
| POST | `/api/files/mkdir` | Create directory |

### Scripts
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/scripts/execute` | Start script execution |
| GET | `/ws/script/{id}` | Script output WebSocket |

### Power Controls
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/power/shutdown` | Shutdown |
| POST | `/api/power/restart` | Restart |
| POST | `/api/power/sleep` | Sleep |
| POST | `/api/power/signout` | Sign Out |
| POST | `/api/power/lock` | Lock |
| POST | `/api/power/cancel` | Cancel pending power command |
| GET | `/api/power/status` | Check pending power status |

### Settings (localhost only)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings/paths` | Get file access paths |
| POST | `/api/settings/paths` | Set file access paths |
| GET | `/api/settings/port` | Get current port |
| POST | `/api/settings/port` | Set port (takes effect on restart) |
| POST | `/api/settings/change-password` | Change password |
| POST | `/api/settings/verify-totp` | Verify TOTP code |
| POST | `/api/settings/reset-totp` | Reset TOTP secret |
| GET | `/api/settings/export-db` | Download database backup |
| POST | `/api/settings/regenerate-recovery-codes` | Regenerate recovery codes |

### Audit Log
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/audit/logs` | Query audit logs (query params: `event`, `from`, `to`, `offset`, `limit`) |

## Testing

```bash
# Backend (88 tests)
cd backend
cargo test              # 54 unit + 34 integration tests
cargo clippy            # zero warnings policy

# Frontend (23 Playwright tests)
cd frontend
npm run test:e2e        # starts backend + frontend automatically
npm run lint            # oxlint

# Full build verification
npm run build           # tsc -b && vite build
```

## Security

- **Passwords**: hashed with **Argon2id**; checked with **zxcvbn** (score ≥ 3/4 required)
- **TOTP**: via **totp-rs** (SHA1, 30s window, 6 digits)
- **Recovery codes**: 10 random Base32 strings, stored as Argon2id hashes
- **JWT signing key**: 256-bit random, stored in **OS Keychain** via `keyring` crate (Windows Credential Manager, macOS Keychain, Linux Secret Service)
- **Sessions**: tracked in DB; "Revoke All Devices" deletes all sessions, invalidates all JWTs
- **Account lockout**: 5 failed attempts → 15-minute cooldown (in-memory, per user)
- **IP rate limiting**: 60 req/min per IP (governor); skipped for `/setup` and `/login`
- **CSP**: `default-src 'self'` with restricted style/img/script sources
- **Admin route protection**: settings and admin endpoints blocked for non-localhost requests (detected via `X-Forwarded-For` header)
- **File path safety**: `std::fs::canonicalize` + blocklist prevents directory traversal and system directory access
- **Uploads**: streaming with 500MB hard cap, partial files cleaned up on error
- **Scripts**: 5-minute timeout with forced kill; 1MB output truncation

## License

MIT
