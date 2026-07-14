# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Companion Deck Positioning**: Redesigned SysDeck as a Windows-first Companion Dashboard & Macro Deck for spare smartphones/tablets. New README with vision, quick start, phone mockups, and SmartScreen warning.
- **Win32 Icon Extraction**: `GET /api/icon?path=...` — `SHGetFileInfoW` + GDI pipeline extracts app icons as RGBA PNGs. In-memory `HashMap` cache, `Cache-Control: public, max-age=86400`.
- **Installed Apps Scanner**: `GET /api/apps` — recursive scan of Start Menu directories (`%ProgramData%`, `%APPDATA%`). Filters `.exe`/`.lnk`/`.appref-ms`. Returns `[{name, path}]` sorted. Max depth 3.
- **App Launcher**: `POST /api/launch` — `.lnk`/`.appref-ms` via `open::that()`, `.exe` via `std::process::Command::new(path).spawn()`.
- **Window List with `exe_path`**: `WindowInfo` extended with `exe_path` via `GetWindowThreadProcessId` + `OpenProcess` + `QueryFullProcessImageNameW`. Broadcast over WebSocket every 3s via new `windows_tx` channel.
- **Instant Lock PC**: `POST /api/power/lock` — spawns blocking task calling `LockWorkStation()` directly. No 5s cancellation window.
- **OLED Overview Page**: New scroll-snap layout with 3 sections — Ambient (large clock + vitals), Deck (toggles + apps), Admin (8-card grid). Desktop sidebar layout at `md:` breakpoint.
- **QuickToggles Macro Deck**: 7 one-tap buttons in 4-column grid — Monitor Off, Lock PC, Media Play/Pause, Dark/Light Mode, Wi-Fi, Mute, DND. Haptic feedback on all.
- **AppDeck Component**: Running apps horizontal scroller with icons + All Apps searchable drawer (bottom sheet).
- **AdminCockpit**: 8-card grid (System Health, Files, Terminal, Scripts, Network, Controls, Audit, Settings) navigating to existing pages. Section 3 of Overview.
- **Wake Lock Hook**: Auto-acquires `navigator.wakeLock` at app root via `useWakeLock` hook. Releases on unmount.
- **Ambient Mode**: Clock + gauges auto-fade after idle timeout. OLED-safe black backgrounds throughout.
- **Radial Gauge Components**: Circular SVG gauges for CPU/RAM/Disk/Temp with teal gradient accents.
- **PWA polish**: `vite-plugin-pwa` with `display: standalone`, `background_color: #000000`, iOS meta tags. No separate `manifest.json`.
- **PWA Install Onboarding**: Setup wizard now has a 5th step ("Install App") after relay configuration, guiding users through "Add to Home Screen" on mobile browsers.
- **README Phone Mockups**: SVG phone mockups showing Ambient Mode and App Deck at top of README.
- **SmartScreen Warning**: Bold callout in README warning about Windows SmartScreen false positive with "More Info → Run Anyway" bypass instructions.
- **Forgot Password Flow**: Login page now shows a "Forgot password?" link that opens an instruction modal with the exact data directory path (fetched from new `GET /api/system/data-dir`), a "Copy Path" button, and step-by-step manual reset instructions.
- **Single-Click Uninstall**: Settings page "Danger Zone" card with `POST /api/system/uninstall` endpoint. Two-phase cleanup: Rust deletes data dir, registry auto-start key, OS keychain JWT secret, and tunnel binary; then a detached batch script with retry loop deletes the locked `.exe` and itself.
- **Uninstall Overlay**: Full-screen "Uninstalling SysDeck..." overlay masks the WebSocket disconnect when the backend process exits.
- **Telemetry GPU Temperature Rounding**: `temperature_gpu` values are now rounded to one decimal place before storage.

### Changed
- **Companion Deck Positioning**: Repositioned SysDeck from generic admin tool to focused Windows Companion Deck. Updated README, architecture diagram, and quick start guide.
- **OLED CSS Theme**: Dark mode surfaces use pure `hsl(0 0% 0%)` background, `hsl(0 0% 4%)` cards, `hsl(0 0% 6%)` popovers. Removed all transparent-white surfaces. Gradient overlays use `from-zinc-800/20`.
- **WebSocket Reconnect**: `reconnectAttempts.current` now resets to 0 on `visibilitychange → visible` — no more 30s backoff when unlocking the phone.
- **Mobile Tunnel Responsiveness**: Rearchitected hardware mutation handlers to be fire-and-forget (`tokio::spawn`) — return HTTP 200 immediately, broadcast result over a new `hardware_tx` WebSocket channel. Eliminates per-pixel slider lag over tunnel.
- **WS-Driven State Sync**: Added `hardware_tx` broadcast channel to `AppState`. WebSocket handler subscribes and forwards JSON to clients. Frontend `applyHardwareUpdate()` dispatches on `type` field to keep Zustand store in sync without polling.
- **Slider Optimization**: Volume/brightness sliders use local state + `onMouseUp`/`onTouchEnd` HTTP POST pattern (no per-pixel requests). Applied to both `Controls.tsx` and `ControlCenter.tsx`.
- **Removed Polling**: Both `Controls.tsx` and `ControlCenter.tsx` no longer run 5-second `fetchAll()` intervals. Power status polling kept at 1s.
- **GET Request Deduplication**: Fetch interceptor deduplicates in-flight GET requests via `inflightRequests` Map — prevents duplicate API calls.
- **Haptic Feedback**: Added `navigator.vibrate(10)` on all toggle clicks in `Controls.tsx` and `ControlCenter.tsx`.
- **Mobile Touch UX**: Added `touch-action: none` on all sliders to prevent vertical scroll interference. Added `safe-area-inset-bottom` padding to `BottomNav.tsx` for mobile notch/home bar clearance.
- **Dashboard Chart Performance**: Set `isAnimationActive={false}` on all recharts Area elements to prevent frame drops on mobile.
- **Page Visibility**: WebSocket reconnects on tab visibility change (via `visibilitychange` listener) to resume real-time updates after phone sleep.
- **Toggle Name Validation**: Added synchronous toggle name validation (`dark_mode`/`wifi`/`dnd`) to `control_center_toggle_handler` before spawning async task.
- **Windows FFI Migration**: Replaced all remaining shell command spawns (`reg`, `shutdown`, `rundll32`, `taskkill`, `netsh`, `powershell`) with direct Win32 FFI calls:
  - Power actions → `ExitWindowsEx`, `SetSuspendState`, `LockWorkStation`, `WTSDisconnectSession`
  - Process kill → `OpenProcess` + `TerminateProcess`
  - Startup registry → `RegOpenKeyExW`/`RegSetValueExW`/`RegDeleteValueW`
  - DNS flush → `DnsFlushResolverCache`
  - WiFi scan → `WlanOpenHandle`/`WlanScan`/`WlanGetAvailableNetworkList`
- **Code Consolidation**: Unified `run_cmd` helper into `hardware.rs` (removed duplicate from `network.rs`). Simplified `get_control_center_status()` to delegate to `get_toggle_status()`.
- **Toggle State Detection**: `get_toggle_status()` now detects actual wifi and DND state on all platforms (Windows: WLAN API + Registry, macOS: `networksetup` + `defaults`, Linux: `nmcli` + `gsettings`). Set handlers (`audio_mute`, `toggle_wifi`, `toggle_dnd`) check current state before applying changes — skip redundant operations.
- **Chart Data Rounding**: Dashboard chart data now rounds CPU usage, CPU temperature, and GPU temperature to one decimal place, so tooltips show clean values.

### Removed
- **ControlCenter.tsx**: Legacy page removed — superseded by QuickToggles macro deck (Overview Section 1) and AdminCockpit grid.
- **frontend/public/manifest.json**: No longer needed — PWA manifest handled by `vite-plugin-pwa`.

### Fixed
- **Cookie SameSite for Tunnel Access**: Changed `refresh_token` cookie from `SameSite=Strict` to `SameSite=Lax` in login, refresh, and logout handlers. Prevents silent 401 → redirect loop when accessing via Cloudflare tunnel.
- **Controls Page Broken Toggles**: WiFi and DND toggles on the Controls page were calling nonexistent `/api/toggles/wifi` and `/api/toggles/dnd` endpoints, returning SPA HTML instead of JSON. Changed to use `toggleControlCenter` which POSTs to the existing `/api/control-center/toggle` route. Added backend routes for those old endpoints as fallback. Removed Bluetooth toggle (no backend support). Added `/api/display/night-light` handler (previously 404).
- **Toggle Store Desync**: `toggleControlCenter` now syncs both `controlCenter` and `toggles` Zustand stores on success, rolls both back on failure.
- **Impractical Quick Toggles**: Removed Dark Mode toggle from Controls page (not a useful quick action). Removed Night Light toggle (no functional backend implementation).

## [2.0.0] - 2026-07-13

### Added
- **UI/UX Hardening Design Spec**: Comprehensive spec document for fixing ~33 UX issues across the frontend, organized into 4 waves (Hardening, Accessibility, Architecture, Polish). See `.opencode/plans/2026-07-13-ui-ux-hardening-design.md`.
- **Teal Glassmorphism Theme**: Complete visual redesign with teal color palette, frosted glass surfaces (`glass-card`, `glass-panel`), and gradient shine overlays.
- **Dashboard Components**: New `StatCard` and `ChartCard` components for telemetry display with recharts integration.
- **TOTP Input Component**: New `totp-input` component for one-time password entry.
- **Lazy Loading**: Page components are now lazy-loaded for improved initial bundle size.
- **Neumorphism Effects**: CSS variables and utility classes (`.neu`, `.neu-inset`, `.neu-hover`) with `neu` variant added to the `Button` component.
- **Error State Handling**: Root redirect now displays an error state with a retry button on failure.
- **Saved Scripts**: New `saved_scripts` backend module with CRUD API routes (`GET/POST/PUT/DELETE /api/scripts/saved`), and frontend `info-button` UI component.
- **Custom Script Timeout**: `ExecuteRequest` now accepts an optional `timeout_seconds` field — frontend sends custom timeout, backend passes it to `run_script`.
- **Telemetry Rounding**: CPU usage and temperature values are now rounded to one decimal place for cleaner display.
- **Init Progress Screen**: New `InitProgress` component shown at app startup. Polls `/api/setup/init-history` and animates through each init step (database, security keys, server, telemetry) with checkmark transitions before redirecting to setup/login.
- **Init History API**: New `GET /api/setup/init-history` endpoint returns the list of init steps recorded during startup.
- **Global Navigate**: New `setGlobalNavigate` in `api.ts` — the 401 interceptor now uses React Router's `navigate` via a lightweight `NavigateProvider` in `App.tsx` instead of a full-page `window.location.href` reload.

### Changed
- **Visual Redesign**: All pages (Dashboard, Controls, ControlCenter, Audit, Files, Scripts, Settings, Login, Setup, RemoteDesktop) updated to teal glassmorphism theme with consistent frosted glass styling.
- **Glassmorphism Enhancement**: Enhanced with `saturate`, gradient shine overlays, and hover lift effects on cards and panels.
- **Layout Components**: Redesigned Sidebar, BottomNav, AppLayout, ProtectedRoute, and WebSocketProvider with the new theme.
- **UI Components**: Upgraded Card, Input, Badge, Button, Toast, and Skeleton components with enhanced glass styling.
- **Interactive Elements**: Quick toggle buttons and interactive elements use neumorphism; progress bars and toggle switches have glow shadows.
- **Audit Page**: Redesigned with glass cards and improved layout.
- **Windows Console Strategy**: Re-added `windows_subsystem = "windows"` — zero console popup on double-click. Removed all `AllocConsole`/`FreeConsole`/`SetConsoleCtrlHandler` / daemon-spawn code. The app runs silently in the system tray; browser auto-opens to the init progress screen. When run from `cargo run` the parent terminal is inherited, so log output is still visible during development.
- **Root Redirect**: Replaced inlined setup-status check with the `InitProgress` component, which polls init-history first, then checks setup status.
- **Init Progress UX**: `InitProgress` now checks setup status on mount first. Fresh installs show full step-by-step animation with "Continue to Setup" button. Returning users see a brief "Starting up..." spinner then "Continue to Dashboard" — no unnecessary `/login` hop.
- **Auth Redirect**: `handleUnauthenticated` in the fetch interceptor now uses React Router `navigate` (via `setGlobalNavigate`) instead of `window.location.href` for smooth client-side redirect.
- **Tunnel URL Extraction**: Improved ANSI escape code stripping with proper CSI/OSC handling and more robust URL pattern matching.
- **AppState**: Added `init_history: Arc<Mutex<InitHistory>>` field for sharing init progress with the API.
- **Settings Page Redesign**: Split monolithic Configuration card into dedicated cards (File Access Paths, Server Configuration, Backup & Export) with proper shadcn/ui `Card` components, icons, and per-section error states instead of one global error banner.
- **Settings Data Loading**: Changed `useEffect` dependency from `[tunnel]` (Zustand store object, causes re-render loop) to `[]` with `useTunnelStore.getState().setTunnel()` — fixes random "Failed to load..." errors on every settings page reload.

### Removed
- **Unused Store Fields**: Cleaned up unused fields from `audit-store` and `files-store`.
- **All Splash & Daemon Code**: Removed `--daemon` flag, `spawn_background_daemon()`, all `AllocConsole`/`FreeConsole`/`SetConsoleCtrlHandler` logic, and the interactive/daemon branching in `main.rs`. No more separate console window, no more process re-spawn.

### CI
- **Release Body Extraction**: Release workflow now extracts the relevant changelog section and passes it to `action-gh-release` for curated release notes.

## [1.1.0] - 2026-07-04

### Added
- **Zero-Friction Portable Workflow**: Redesigned the onboarding process by completely removing the setup key requirements. Added a welcoming onboarding screen (Step 0) in the browser before configuring the system.
- **Cloudflare Tunnel Auto-Start**: Configured the Cloudflare tunnel to dynamically start immediately upon completing the setup wizard if the user opts in, removing any need for a server restart.
- **User-Friendly Startup Console**: Updated the server CLI banner on launch to show a clean box-drawing layout directing the user to press Enter to instantly minimize the window to system tray and open their default browser.

### Fixed
- **Windows Console Flashing**: Resolved an issue where multiple empty Command Prompt/PowerShell terminal windows flashed on the screen on Windows during startup and periodic background operations (telemetry WMI polling, network/hardware status checks, registry queries, and Cloudflare tunnel spawning) by forcing child processes to spawn silently with the `CREATE_NO_WINDOW` process creation flag.

## [1.0.1] - 2026-07-03

### Fixed
- **CI/CD Pipeline**: GitHub Actions build and linker failures on macOS and Linux runners.
- **Linux Platform**: Added missing `libxdo-dev` dependency on build environments to fix input compilation/linking.
- **macOS Platform**: Fixed key mapping error by conditionalizing `F21`–`F24` keys, which are not supported by Enigo on macOS.
- **macOS Platform**: Silenced compiler warning for unused `brightness` variable during macOS-specific display operations.
- **Frontend Code Quality**: Resolved all `oxlint` accessibility and linting warnings:
  - Cleaned up unused imports and variables across multiple components.
  - Linked form controls to labels for better screen reader compatibility.
  - Added missing `aria-label` properties to toggle elements.
  - Normalized React Hook dependency arrays.
- **Backend Code Quality**: Removed unused imports (`std::io`, `std::ffi::c_void`), cleaned up unused `mut` specifiers, and resolved `Arc` borrow-after-move error in `main.rs`.

## [1.0.0] - 2026-07-03

### Added
- **Core Architecture**: Lightweight remote system administration agent utilizing a Rust backend and embedded React/TypeScript single-page app (SPA).
- **System Telemetry**: Real-time telemetry monitoring including CPU load, RAM usage, network interface speeds, disk usage, and battery capacity.
- **File Manager**: Directory navigation, file downloads, secure path validation blocklists, and streaming uploads supporting files up to 500MB.
- **Terminal Emulator**: Remote interactive terminal interface leveraging PTY and `xterm.js`.
- **Script Engine**: Secure execution of PowerShell (Windows) and Bash (macOS/Linux) scripts with customizable execution timeouts.
- **Power Management**: Support for remote Shutdown, Restart, Sleep, Hibernate, Sign Out, Lock, and Switch User actions with a 5-second grace period cancel queue.
- **Cloudflare Tunnels**: Integrated `cloudflared` tunnel creation for secure remote access without port forwarding.
- **System Tray Widget**: Native system tray application displaying active status, quick tunnel actions, and port configurations.
- **Security & MFA**: Cryptographic password hashing (Argon2id), mandatory TOTP multi-factor authentication setup, recovery code generation, and automated lockout policies.

[2.0.0]: https://github.com/adi21-dev/sysdeck/compare/v1.1.0...v2.0.0
[1.1.0]: https://github.com/adi21-dev/sysdeck/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/adi21-dev/sysdeck/releases/tag/v1.0.0
