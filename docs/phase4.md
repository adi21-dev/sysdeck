
## Phase 4: Feature Implementation (Files, Scripts, Power)

**Goal:** Build the core utility APIs: File Manager, Script Engine, and Hardware Controls.

### 📝 Instructions for `opencode`
*   **File Manager:**
    *   Endpoints for List, Upload, Download, Delete, Rename.
    *   **Security:** All paths must be resolved via `std::fs::canonicalize` and checked against an Allow/Block list to prevent `../../` directory traversal.
    *   **Uploads:** Must use **streaming multipart parsing** (`axum::extract::Multipart`). Write chunks directly to disk. Hard cap at 500MB. Do not load the whole file into RAM.
*   **Script Engine:**
    *   Endpoint to execute predefined or custom scripts (PowerShell/Batch).
    *   **Sandbox:** Spawn process using `tokio::process::Command`. Enforce a strict 5-minute timeout (kill process if exceeded).
    *   Capture stdout/stderr, but truncate if it exceeds 1MB.
*   **Hardware Controls:**
    *   Endpoints for Shutdown, Restart, Sleep.
    *   Implement a global Power Command Queue. If a shutdown is pending, reject new requests.
    *   Include a 5-second cancellation window before executing `shutdown /s /t 5`.

### ✅ Acceptance Criteria
1.  Uploading a 400MB file does not cause RAM usage to spike (verify via Task Manager).
2.  Attempting to access `C:\Windows\System32` via the file API is blocked by path canonicalization.
3.  Running an infinite loop script (e.g., `while(1){}`) is forcefully killed after exactly 5 minutes.
4.  Sending a shutdown command results in the Windows OS initiating a shutdown sequence.

---
