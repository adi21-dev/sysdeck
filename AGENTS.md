# NodeDesk — Agent Guide

## Dev Commands

```bash
cd backend && cargo run          # builds frontend first (via build.rs)
cd frontend && npm run dev       # Vite dev server on :5173, proxy → :3939

cd backend && cargo test          # 17 unit (16 pass, 1 pre-existing hardware) + 40 integration
cargo clippy                      # zero warnings policy

cd frontend && npm run build      # tsc -b && vite build
npm run lint                      # oxlint --jsx-a11y-plugin
```

## Architecture

- `backend/` — Rust lib crate (`src/lib.rs`) + binary (`src/main.rs`). Cargo needs `[lib]` so `tests/` can import. All shared code in `src/lib.rs`.
- `frontend/` — Vite React-TS, Tailwind v4, shadcn/ui (style `base-nova`, aliases `@/`), Zustand, recharts.
- Vite proxy: `POST /login` → `:3939` (GET bypassed for index.html), `/ws` (ws) → `:3939`, `/api` → `:3939`.
- `backend/build.rs` auto-runs `npm install && npm run build` on Rust compile. Skip with `CROSS=true` env.

## Backend Quirks

- `tokio::net::TcpListener::from_std()` broken on this Windows build — use `TcpListener::bind()`.
- `MutexGuard` from `tokio::sync::Mutex` is not `Send` — do not hold across `.await`.
- Router: `.with_state()` before `.layer()` or `service_fn_with_state` won't compile with `axum::serve`.
- DPAPI uses raw `extern "system"` FFI with `#[repr(C)] Blob` (the `windows` crate `DATA_BLOB` wasn't found at expected path).
- Tests use in-memory SQLite. Pattern: `test_app_with_seeded(seed: impl FnOnce(&Connection))`. Helpers in `tests/common/mod.rs`.
- Pre-existing test failure: `test_set_audio_device` (no real audio device to switch to on this machine, or `SetDefaultEndpoint` fails with `0x80004005`).

### Auth

- Short-lived access JWT (15 min) + opaque refresh token (7 day, SHA-256 hash stored in `sessions.refresh_token_hash`). Cookies: `token` (SameSite=Lax, Path=/), `refresh_token` (SameSite=Strict, `Path=/api/auth/refresh`).
- `POST /api/auth/refresh` validates refresh token, rotates it (new hash in DB), issues new access JWT. Both cookies set in response.
- `POST /api/auth/logout` revokes current session (by JWT `jti`), clears both cookies, audit log. Behind auth middleware.
- Login no longer revokes other sessions — multi-device coexistence.
- `GET /api/settings/sessions` lists all sessions (with `current_jti` to highlight current). `POST /api/settings/sessions/revoke` revokes a specific one.
- `token_version` in JWT claims checked against DB. Bump manually for force-revoke-all; not bumped on login.
- Lockout: 5 failures → 15 min cooldown (in-memory `LockoutState`).
- `Set-Cookie` header trick: `Response::builder().header(...).header(...)` uses `HeaderMap::append()` internally. `HeaderMap::insert()` replaces — do not use for multiple cookies.
- Login response: `JSON {success, message}` + `Set-Cookie` headers. Frontend reads `data.success`, not status code.

### Auth Middleware Skip List

| Middleware | Skipped paths |
|-----------|---------------|
| `auth_middleware` | `/login`, `/setup`*, `/api/setup`*, `/`, `/api/auth/check`, `/api/auth/refresh`, `/api/admin/check` (+ redirects to `/setup` when setup incomplete) |
| `rate_limit_middleware` | `/login`, `/setup`*, `/api/setup`*, `/api/auth/check`, `/api/auth/refresh` |
| `csp_middleware` | All routes |

### Telemetry

- `sysinfo` polling on a dedicated OS thread, sends snapshots over `mpsc` to a tokio task that broadcasts via `broadcast::Sender<Arc<TelemetrySnapshot>>` every 1s.
- SQLite persist only every 60s.
- Fields: `timestamp`, `cpu_usage`, `ram_used`/`ram_total`, `net_rx_bps`/`net_tx_bps`, `temperature` (Option), `disk_used`/`disk_total`, `battery_percent`/`battery_charging`.
- Temperature on Windows falls back to WMI (`MSAcpi_ThermalZoneTemperature` / `Win32_PerfFormattedData_Counters_ThermalZoneInformation`) via PowerShell when `sysinfo::Components` finds no sensors. Batteries use `GetSystemPowerStatus` FFI. Both polled every 30s, both run on the first tick (tick_1s=0 triggers all periodic checks).

### Setup Wizard

- Server-rendered HTML at `GET/POST /setup` (4 steps: password → TOTP QR → recovery codes → relay opt-in). React SPA does `navigate("/login")` after completion or `fetch("/api/setup/status")` to check.
- `SetupManager` stores in-progress flows in a `HashMap<String, SetupFlow>` keyed by state token UUID.

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

- `src/lib/api.ts` is imported as a side-effect in `main.tsx` — overrides `window.fetch` to intercept 401s on `/api/` calls, calls `/api/auth/refresh` with promise lock, retries once, redirects to `/login` on failure.
- `ProtectedRoute` calls `/api/auth/check` on mount. On failure, tries `/api/auth/refresh` first, then retries auth check before redirecting to login.
- `WebSocketProvider` wraps protected routes, connects to `/ws`. `onclose` logs event, calls `fetch("/api/auth/refresh")`, then schedules reconnect with exponential backoff (1s → 2s → 4s … max 30s), reset on successful open.
- All WS messages use `{event, data}` envelope: `telemetry`, `system` (subtype `shutting_down`), `tunnel_status`. Frontend `onmessage` switches on `event`.
- Zustand stores: `useAuthStore` (in-memory only — restored via `/api/auth/check` on mount), `useTelemetryStore` (last 300 points).
- Setup page does not use `window.location.href = "/setup"` — uses React Router navigate instead.
- Login page submits form-urlencoded to `POST /login`, checks `data.success` (JSON, not status code). On mount, calls `/api/auth/check` and redirects to `/dashboard` if authenticated.
- Dashboard uses recharts `AreaChart` with `ResponsiveContainer`. Data from telemetry history slice (last 60 points).
