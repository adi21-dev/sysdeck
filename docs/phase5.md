
## Phase 5: React Frontend & Dashboard Integration

**Goal:** Build the actual mobile-optimized React dashboard using Vite, Tailwind, shadcn/ui, and Zustand, replacing the placeholder HTML.

### 📝 Instructions for `opencode`
*   Initialize Vite React-TS in `/frontend`. Install Tailwind, `shadcn/ui`, `zustand`, and `recharts`.
*   **Layout:** Create a responsive layout. Sidebar on desktop, bottom-nav or slide-out drawer on mobile.
*   **Dashboard (Telemetry):**
    *   Connect to the `/ws` endpoint. Store data in Zustand.
    *   Use `recharts` to render live, updating line charts for CPU/RAM/Network.
    *   Display hardware temps and disk space in clean `shadcn` Cards.
*   **File Manager & Scripts:**
    *   Build a file browser with upload progress bars (using the streaming API).
    *   Build a script terminal view. Implement "Live Stream" (WebSocket) and "Wait & Show" modes.
*   **Auth & Settings:**
    *   Build the Setup Wizard UI (Password strength meter, TOTP QR code display).
    *   Build a Settings page: Change password, reset TOTP, view recovery codes, "Export Data" (downloads `data.db`), and "Revoke All Devices".
*   **WebSocket Auth Expiry:**
    *   If the backend sends `{"event": "auth_expired"}`, the frontend must immediately clear Zustand state and redirect to `/login`.

### ✅ Acceptance Criteria
1.  The UI is fully usable on a mobile browser (iPhone/Android screen sizes).
2.  Charts update smoothly every 1 second without lagging the browser.
3.  File uploads show a progress bar and do not crash the browser tab.
4.  Clicking "Revoke All Devices" instantly logs out all other open browser tabs.

---
