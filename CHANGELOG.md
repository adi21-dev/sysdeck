# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - Unreleased

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
