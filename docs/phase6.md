
## Phase 6: Packaging, Embedding & Polish

**Goal:** Combine the backend and frontend into a single, portable, highly optimized `.exe`. Handle edge cases like OS shutdowns and log rotation.

### 📝 Instructions for `opencode`
*   **Embedding:**
    *   Update the Vite build script to output to a specific folder.
    *   Use `rust-embed` in the Rust backend to embed the compiled frontend assets directly into the binary. Remove the need to serve files from the disk.
*   **OS Integration:**
    *   Intercept the Windows `WM_QUERYENDSESSION` message.
    *   When intercepted, broadcast `{"action": "shutting_down"}` to all WebSockets, close the SQLite DB cleanly, and exit.
*   **Maintenance:**
    *   Implement log rotation for `%LOCALAPPDATA%\RemotePCAgent\logs\`. Max 10MB per file, keep only the last 3 files.
    *   Ensure the "Export Data" button in the UI correctly streams the SQLite file to the user.
*   **Optimization & Release:**
    *   Update `Cargo.toml` for release profile: `strip = true`, `lto = true`, `codegen-units = 1`, `panic = 'abort'`.
    *   Verify binary size is < 20MB.
    *   Verify idle RAM is < 30MB.
*   **Code Signing (Manual Step for You):**
    *   *Note to user:* `opencode` cannot sign the exe. You must purchase an Authenticode certificate (e.g., from SSL.com or DigiCert) and use `signtool.exe` to sign the final `.exe` to prevent Windows Defender SmartScreen from blocking it.

### ✅ Acceptance Criteria
1.  The final output is a single `.exe` file.
2.  Running the `.exe` on a completely fresh Windows 11 VM (with no Rust or Node installed) works perfectly.
3.  Restarting the Windows VM triggers a graceful shutdown in the agent (no corrupted SQLite DB).
4.  Idle RAM usage is strictly under 30MB.

---
