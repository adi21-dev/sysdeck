# NodeDesk — Remote PC Agent

A lightweight, portable Windows agent that exposes a mobile-optimized web dashboard for remote system monitoring, file management, script execution, and hardware control — all through a secure Cloudflare tunnel. No RDP, no complex config.

## Architecture

```
┌─────────────────────────────────────────────┐
│  Windows Laptop (running NodeDesk Agent)     │
│                                              │
│  ┌──────────────┐     ┌──────────────────┐  │
│  │  Rust Backend │◄───►│  SQLite (WAL)    │  │
│  │  (Axum 0.7)   │     │  data.db         │  │
│  ├──────────────┤     └──────────────────┘  │
│  │  /ws         │─── sysinfo telemetry      │
│  │  /api/files  │─── file manager           │
│  │  /api/scripts│─── script engine          │
│  │  /api/power  │─── shutdown/restart/sleep │
│  │  /login      │─── password + TOTP auth   │
│  │  /setup      │─── first-run wizard       │
│  └──────┬───────┘                           │
│         │                                   │
│  ┌──────▼───────┐     ┌──────────────────┐  │
│  │  React SPA   │     │  cloudflared      │  │
│  │  (Vite)      │     │  tunnel           │  │
│  │  shadcn/ui   │     │  trycloudflare.com│  │
│  └──────────────┘     └────────┬─────────┘  │
└────────────────────────────────┼────────────┘
                                 │
                    ┌────────────▼─────────┐
                    │  Public Internet     │
                    │  (any browser)       │
                    └──────────────────────┘
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
| Auth | Argon2id, TOTP, DPAPI-encrypted JWT, zxcvbn |
| Rate Limit | governor |
| System Tray | tray-icon |

## Features

- **Dashboard** — live CPU, RAM, network, disk, temperature, battery via WebSocket (1s polling)
- **File Manager** — browse, upload (streaming, 500MB cap, progress bar), download, delete, rename with path canonicalization and System32 block
- **Script Engine** — run PowerShell/Batch scripts; live streaming or wait-and-show output; 5-min timeout; 1MB output truncation
- **Power Controls** — Shutdown, Restart, Sleep with 5-second cancellation window; checks active uploads before power off
- **Security** — password + TOTP login, 90-day JWT sessions, account lockout (5 failures → 15 min), IP rate limiting, CSP headers
- **Audit Log** — append-only log of logins, file transfers, script executions, and security changes
- **Setup Wizard** — first-run flow: password strength check → TOTP QR → recovery codes → done
- **System Tray** — "Quit" option in the Windows system tray

## Getting Started

### Prerequisites
- Windows 10/11
- Rust toolchain (edition 2021)
- Node.js 20+

### Build & Run
```bash
# Backend
cd backend
cargo run

# Frontend (dev mode)
cd frontend
npm install
npm run dev
```

On first run, the backend:
1. Creates `%LOCALAPPDATA%\NodeDesk\` for data and logs
2. Downloads `cloudflared.exe` with SHA256 verification
3. Binds to `localhost:3939` (falls back to random port)
4. Spawns the Cloudflare tunnel
5. Opens your browser to the setup wizard

### Production Build
```bash
cd frontend
npm run build
cd ../backend
cargo build --release
```

The compiled `backend/target/release/nodedesk-agent.exe` is a single portable binary. The Vite build output is embedded via `rust-embed`.

## Project Structure

```
nodedesk/
├── backend/
│   ├── src/
│   │   ├── main.rs          # Entry point
│   │   ├── lib.rs           # AppState, router, server setup
│   │   ├── auth.rs          # Authentication, JWT, DPAPI, TOTP
│   │   ├── db.rs            # SQLite schema, telemetry queries
│   │   ├── telemetry.rs     # sysinfo polling engine
│   │   ├── tunnel.rs        # Cloudflare tunnel manager
│   │   ├── setup.rs         # Setup wizard
│   │   ├── ws.rs            # WebSocket handler
│   │   ├── file_manager.rs  # File operations
│   │   ├── script.rs        # Script execution
│   │   └── power.rs         # Power controls
│   ├── tests/
│   └── Cargo.toml
├── frontend/
│   ├── src/
│   │   ├── components/      # shadcn/ui + layout components
│   │   ├── pages/           # Dashboard, Files, Scripts, etc.
│   │   ├── hooks/           # WebSocket hook
│   │   └── lib/             # Zustand store, utilities
│   └── package.json
├── docs/
│   ├── phase0.md through phase6.md
│   └── CONTEXT.md
└── README.md
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/setup` | Setup wizard |
| POST | `/setup` | Submit setup step |
| GET | `/login` | Login page |
| POST | `/login` | Authenticate (password + TOTP) |
| GET | `/ws` | Telemetry WebSocket |
| GET | `/api/telemetry/history` | Historical telemetry data |
| GET | `/api/files/list` | List directory contents |
| POST | `/api/files/upload` | Upload file (streaming) |
| GET | `/api/files/download` | Download file |
| POST | `/api/files/delete` | Delete file |
| POST | `/api/files/rename` | Rename file |
| POST | `/api/scripts/execute` | Start script execution |
| GET | `/ws/script/{id}` | Script output WebSocket |
| POST | `/api/power/shutdown` | Shutdown |
| POST | `/api/power/restart` | Restart |
| POST | `/api/power/sleep` | Sleep |
| POST | `/api/power/cancel` | Cancel pending power command |
| GET | `/api/power/status` | Check pending power status |

## Testing

```bash
cd backend
cargo test    # 48 unit + 14 integration tests
cargo clippy  # zero warnings
```

## Security

- Passwords hashed with **Argon2id**; checked with **zxcvbn** (score ≥ 3/4 required)
- TOTP via **totp-rs** (SHA1, 30s window, 6 digits)
- Recovery codes: 10 random Base32 strings, stored as Argon2id hashes
- JWT signing key: 256-bit random, encrypted with **Windows DPAPI**, stored in SQLite
- Sessions: tracked in DB; "Revoke All Devices" deletes all sessions, invalidates all JWTs
- Account lockout: 5 failed attempts → 15-minute cooldown (in-memory, per user)
- IP rate limiting: 60 req/min per IP (governor); skipped for `/setup` and `/login`
- CSP: `default-src 'self'` with restricted style/img/script sources
- File path safety: `std::fs::canonicalize` + blocklist prevents directory traversal and System32 access
- Uploads: streaming with 500MB hard cap, partial files cleaned up on error
- Scripts: 5-minute timeout with forced kill; 1MB output truncation

## License

MIT
