
## Phase 3: Security, Auth & Database Schema

**Goal:** Implement the robust security model, including the setup wizard, DPAPI-encrypted JWTs, TOTP, and rate limiting.

### 📝 Instructions for `opencode`
*   **Database Schema:** Create tables for `users`, `sessions`, `audit_logs` (append-only), and `settings`.
*   **Setup Wizard:**
    *   If `users` table is empty, the frontend (for now, just a basic HTML form) redirects to `/setup`.
    *   Implement Password creation (validate using `zxcvbn` for strength).
    *   Generate a TOTP secret (`totp-rs`), display a QR code, and require verification.
    *   Generate 10 Recovery Codes (12 random Base32 chars). Store them in the DB as **Argon2id** hashes.
*   **Authentication & JWT:**
    *   Generate a 256-bit random JWT signing key on first run.
    *   Encrypt this key using **Windows DPAPI** (via the `windows` crate) before storing it in the DB.
    *   Implement Login endpoint: Validates Password + TOTP. Returns an HTTP-only, `SameSite=Strict` cookie containing a 90-day JWT.
*   **Security Middleware:**
    *   Implement Account-based lockout: 5 failed logins = 15-minute cooldown for that Account ID.
    *   Implement IP-based rate limiting for non-auth endpoints using `governor`.
    *   Add strict `Content-Security-Policy` (CSP) headers to all responses.

### ✅ Acceptance Criteria
1.  First run forces the `/setup` flow. Cannot bypass it.
2.  Passwords weak according to `zxcvbn` are rejected.
3.  JWT signing key in the SQLite DB is unreadable (encrypted via DPAPI).
4.  5 failed login attempts lock the account for 15 minutes.
5.  Audit log records the initial setup and all subsequent logins.

---
