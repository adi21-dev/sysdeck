# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
