# NodeDesk — Agent Guide

## Dev Commands

```bash
# run both simultaneously in separate terminals
cd backend && cargo run
cd frontend && npm run dev

# backend
cd backend && cargo test          # 48 unit + 14 integration
cargo clippy                      # zero warnings policy

# frontend
cd frontend && npm run build      # tsc -b && vite build
npm run lint                      # oxlint
```

## Architecture

- `backend/` — Rust lib crate (`src/lib.rs`) + binary (`src/main.rs`). Cargo requires `[lib]` section so integration tests (`tests/`) can import from the library. All shared code in `src/lib.rs`.
- `frontend/` — Vite React-TS with Tailwind v4, shadcn/ui, Zustand, recharts.
- Development: Vite proxy (`/setup`, `/login` POST-only, `/ws`, `/api`) → `http://127.0.0.1:3939`. Frontend devs hit `localhost:5173`, backend handles `localhost:3939`.

## Backend Quirks

- `tokio::net::TcpListener::from_std()` is broken on this Windows build — use `TcpListener::bind()` directly.
- `MutexGuard` from `tokio::sync::Mutex` does not implement `Send` — do not hold across `.await`.
- Router: `.with_state()` before `.layer()` or `service_fn_with_state` won't compile with `axum::serve`.
- DPAPI uses raw `extern "system"` FFI with `#[repr(C)] Blob` (the `windows` crate `DATA_BLOB` was not found at expected path).
- Tests use in-memory SQLite. Pattern: `test_app_with_seeded(seed: impl FnOnce(&Connection))`.
- Integration test helpers live in `tests/common/mod.rs`.

### Security Middleware Skip List

| Middleware | Skipped paths |
|-----------|---------------|
| `auth_middleware` | `/login`, `/setup`*, `/`, `/api/auth/check` (+ redirects to `/setup` when setup incomplete) |
| `rate_limit_middleware` | `/login`, `/setup`*, `/api/auth/check` |
| `csp_middleware` | All routes (adds CSP header) |

### Telemetry

- `sysinfo` polling on a dedicated OS thread, sends snapshots over `mpsc` channel to a tokio task that broadcasts via `broadcast::Sender<Arc<TelemetrySnapshot>>` every 1s.
- SQLite persist only every 60s (saves I/O).
- `TelemetrySnapshot` fields: `timestamp`, `cpu_usage`, `ram_used`/`ram_total`, `net_rx_bps`/`net_tx_bps`, `temperature` (Option), `disk_used`/`disk_total`, `battery_percent`/`battery_charging` (both Option, battery always None currently).

### Auth

- JWT signing key: 256-bit, DPAPI-encrypted, stored in `jwt_signing_key` table.
- Sessions table tracks active JWTs by `jti`. "Revoke All Devices" = `DELETE FROM sessions`.
- Login: POST `/login` with `password` + `totp_code` (form-urlencoded). Returns `200 {success, message}` + `Set-Cookie: token=...`.
- Account lockout: 5 failures → 15 min cooldown (in-memory `LockoutState`).
- Session restore on page refresh: frontend calls `GET /api/auth/check`, backend validates JWT cookie against sessions table.

### Setup Wizard

- Still server-rendered HTML at `GET/POST /setup` (4 steps: password → TOTP QR → recovery codes → relay opt-in). React SPA redirects to backend's wizard.
- SetupManager stores in-progress flows in a `HashMap<String, SetupFlow>` keyed by state token UUID.

### File Uploads

- Raw body stream via `BodyStream` + `filter_map` (NOT `axum::extract::Multipart` — `Multipart::next()` has a `B: Send` bound that `Body` doesn't satisfy). Path passed as query param.
- 500MB hard cap, partial files cleaned up on error.
- Path validation: `std::fs::canonicalize` + `\\?\` prefix stripping + blocked prefix list (System32, Windows, Program Files).

### Script Engine

- 5-minute timeout, process killed via `child.kill()` + `child.wait()`.
- 1MB output truncation per stream.
- Live output via `broadcast::channel<ScriptOutput>`, WebSocket at `/ws/script/{id}`.

### Power Controls

- Global queue with 5s cancellation window (oneshot channel).
- Checks `active_uploads` counter before executing. Returns `active_transfers` count if uploads in progress and `confirmed` not set.

## Frontend Quirks

- Zustand stores: `useAuthStore` (in-memory only — session restored via `/api/auth/check` on mount) and `useTelemetryStore` (keeps last 300 data points).
- `ProtectedRoute` calls `/api/auth/check` on mount. Shows nothing until response, then either renders `<Outlet/>` or redirects to `/login`.
- `WebSocketProvider` wraps protected routes, connects to `/ws`, handles `auth_expired` event, auto-reconnects every 3s.
- `Setup.tsx` does a full-page `window.location.href = "/setup"` to hand off to the server-rendered wizard. After completion, backend redirects to `/`.
- Login page submits form-urlencoded to `POST /login` (proxied to backend), checks `data.success` in JSON response (not status code).
- Dashboard uses recharts `AreaChart` with `ResponsiveContainer`. Data from telemetry history slice (last 60 points).
