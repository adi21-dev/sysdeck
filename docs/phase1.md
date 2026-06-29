
## Phase 1: Core Rust Backend & Local Web Server

**Goal:** Build the foundational Rust executable that creates the data directory, sets up the SQLite database, and starts a local Axum web server serving a placeholder HTML page.

### 📝 Instructions for `opencode`
*   Initialize the Rust workspace in `/backend`.
*   Set up `axum` with `tower-http` (CORS, Compression).
*   Implement the Data Separation logic: On startup, create `%LOCALAPPDATA%\RemotePCAgent\` (and `logs`, `data.db` inside it).
*   Initialize SQLite using `rusqlite`. Strictly enforce:
    ```sql
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=NORMAL;
    ```
*   Create a `schema_version` table.
*   Start the server on `localhost:3939` (implement a fallback to a random port if 3939 is busy).
*   Serve a basic "RemotePC Agent is running" HTML page at the root route.
*   Add a basic System Tray icon using the `tray-icon` crate with a "Quit" option.

### ✅ Acceptance Criteria
1.  Running `cargo run` creates the `%LOCALAPPDATA%\RemotePCAgent\` directory.
2.  `data.db` is created with WAL mode enabled.
3.  Navigating to `http://localhost:3939` shows the placeholder page.
4.  If port 3939 is occupied, it binds to a random port and prints the new port to the console.
5.  A system tray icon appears, and clicking "Quit" gracefully shuts down the app.

---
