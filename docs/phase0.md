# 📖 RemotePC Agent V1: Vibe Coding Master Plan

## Phase 0: Environment, Tooling & "Vibe Coding" Strategy (For You)

This phase is for **you** to set up the environment and understand how to manage `opencode` so it doesn't hallucinate or lose context.

### 1. Prerequisites & Setup
*   **OS:** Windows 11.
*   **Rust:** Ensure `rustup` is using the 2024 edition. Run `rustup default stable` and verify `cargo --version`.
*   **Node.js:** Install LTS (v20+).
*   **Tools:** Install `opencode`, VSCode, and Git.
*   **Monorepo Initialization:**
    ```bash
    mkdir remotepc-agent && cd remotepc-agent
    git init
    # Create the structure
    mkdir backend frontend docs
    ```

### 2. The "Vibe Coding" Workflow Rules
AI agents fail when they lose context or try to do too much at once. Follow these rules:
1.  **The "One Phase" Rule:** Never feed Phase 1 and Phase 2 to `opencode` at the same time. Complete one phase, ensure it compiles and passes acceptance criteria, *then* move to the next.
2.  **The Context File:** Create a file named `CONTEXT.md` in the root of your repo. Paste the **entire original Product & Technical Specification** into it. Tell `opencode`: *"Always read CONTEXT.md before starting any task."*
3.  **Compile Checks:** After `opencode` writes code, immediately run `cargo check` (backend) or `npm run build` (frontend). If it fails, feed the error back to `opencode` and say: *"Fix this compilation error."*
4.  **No "Magic" Imports:** If `opencode` uses a crate or npm package not listed in the spec, stop it. Tell it to use the approved stack (e.g., `axum`, `rusqlite`, `sysinfo`).

---
