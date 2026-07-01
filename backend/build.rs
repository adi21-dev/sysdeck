use std::path::Path;
use std::process::Command;

fn main() {
    // Skip frontend build under cross-compilation (no Node.js in Docker)
    if std::env::var("CROSS").is_ok() || std::env::var("CROSS_COMPILE").is_ok() {
        println!("cargo:info=Cross-compilation detected, skipping frontend build");
        return;
    }

    let frontend_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("frontend");

    println!(
        "cargo:rerun-if-changed={}",
        frontend_dir.join("src").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        frontend_dir.join("package.json").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        frontend_dir.join("vite.config.ts").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        frontend_dir.join("index.html").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        frontend_dir.join("tsconfig.json").display()
    );

    let dist_dir = frontend_dir.join("dist");
    if !dist_dir.exists() || is_stale(&frontend_dir, &dist_dir) {
        let node_modules = frontend_dir.join("node_modules");
        if !node_modules.exists() {
            println!("cargo:info=Running npm install...");
            run_npm("install", &frontend_dir);
        }

        println!("cargo:info=Building frontend...");
        run_npm("run build", &frontend_dir);
    }
}

fn npm_cmd() -> (&'static str, &'static str) {
    if cfg!(windows) {
        ("cmd.exe", "/C")
    } else {
        ("npm", "")
    }
}

fn run_npm(args: &str, dir: &Path) {
    let (cmd, prefix) = npm_cmd();
    let full_cmd = format!("npm {}", args);
    let full_args: Vec<&str> = if prefix.is_empty() {
        vec![args]
    } else {
        vec![prefix, &full_cmd]
    };
    let status = Command::new(cmd)
        .args(&full_args)
        .current_dir(dir)
        .status()
        .expect("Failed to execute npm command");
    if !status.success() {
        panic!("npm {} failed", args);
    }
}

fn is_stale(src: &Path, dist: &Path) -> bool {
    let dist_modified = std::fs::metadata(dist).and_then(|m| m.modified()).ok();
    let src_modified = std::fs::metadata(src.join("index.html"))
        .and_then(|m| m.modified())
        .ok();
    match (dist_modified, src_modified) {
        (Some(d), Some(s)) => s > d,
        _ => true,
    }
}
