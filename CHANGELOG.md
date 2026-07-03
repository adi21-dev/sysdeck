# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-07-04

### Added
- **Setup Key Verification**: Implemented backend validation for the console-printed Setup Key (via new endpoints `/api/setup/check-token` and `/api/setup/verify-setup-token`) and cookie-based authorization to secure the Setup Wizard against unauthorized remote access.
- **Startup Console**: Added descriptive instructions and use-case details about the generated setup key in the startup console banner.
- **Documentation**: Documented the Setup Key generation and its verification purposes in the main README.md file.

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
