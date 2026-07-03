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

    let node_modules = frontend_dir.join("node_modules");
    if !node_modules.exists() {
        println!("cargo:info=Running npm install...");
        run_npm(&["install"], &frontend_dir);
    }

    println!("cargo:info=Building frontend...");
    run_npm(&["run", "build"], &frontend_dir);
}

fn run_npm(args: &[&str], dir: &Path) {
    let status = if cfg!(windows) {
        Command::new("cmd.exe")
            .arg("/C")
            .arg("npm")
            .args(args)
            .current_dir(dir)
            .status()
            .expect("Failed to execute npm command")
    } else {
        Command::new("npm")
            .args(args)
            .current_dir(dir)
            .status()
            .expect("Failed to execute npm command")
    };
    if !status.success() {
        panic!("npm {} failed", args.join(" "));
    }
}
