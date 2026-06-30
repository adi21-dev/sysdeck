use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::Ordering;

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json, Response};
use futures_util::StreamExt;
use http_body_util::BodyStream;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;

use crate::db;

const MAX_UPLOAD_SIZE: u64 = 500 * 1024 * 1024;
const BLOCKED_PREFIXES: &[&str] = &[
    r"c:\windows\system32",
    r"c:\windows",
    r"c:\program files",
    r"c:\program files (x86)",
];

pub fn validate_path(requested: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(requested);
    let canonical = std::fs::canonicalize(&path)
        .map_err(|e| format!("Invalid path: {}", e))?;

    let lower = canonical.to_string_lossy().to_lowercase();
    for blocked in BLOCKED_PREFIXES {
        if lower.starts_with(blocked) {
            return Err(format!("Access to '{}' is blocked", canonical.display()));
        }
    }

    Ok(canonical)
}

#[derive(Serialize)]
struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: i64,
    modified: String,
}

#[derive(Deserialize)]
pub(crate) struct ListQuery {
    path: Option<String>,
}

#[derive(Serialize)]
struct ListResponse {
    success: bool,
    entries: Vec<FileEntry>,
    path: String,
    error: Option<String>,
}

pub(crate) async fn list_handler(Query(query): Query<ListQuery>) -> impl IntoResponse {
    let path_str = query.path.unwrap_or_else(|| "C:\\".to_string());

    let dir = match validate_path(&path_str) {
        Ok(p) => p,
        Err(e) => {
            return Json(ListResponse {
                success: false,
                entries: vec![],
                path: path_str,
                error: Some(e),
            })
            .into_response()
        }
    };

    if !dir.is_dir() {
        return Json(ListResponse {
            success: false,
            entries: vec![],
            path: path_str,
            error: Some("Not a directory".to_string()),
        })
        .into_response();
    }

    let mut entries = Vec::new();
    let read_dir = match std::fs::read_dir(&dir) {
        Ok(d) => d,
        Err(e) => {
            return Json(ListResponse {
                success: false,
                entries: vec![],
                path: path_str,
                error: Some(format!("Failed to read directory: {}", e)),
            })
            .into_response()
        }
    };

    for entry in read_dir.flatten() {
        let meta = entry.metadata().ok();
        entries.push(FileEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry.path().to_string_lossy().to_string(),
            is_dir: entry.file_type().map(|t| t.is_dir()).unwrap_or(false),
            size: meta.as_ref().map(|m| m.len() as i64).unwrap_or(-1),
            modified: meta
                .and_then(|m| m.modified().ok())
                .map(|t| {
                    t.duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs()
                        .to_string()
                })
                .unwrap_or_default(),
        });
    }

    entries.sort_by(|a, b| {
        if a.is_dir != b.is_dir {
            b.is_dir.cmp(&a.is_dir)
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    Json(ListResponse {
        success: true,
        entries,
        path: dir.to_string_lossy().to_string(),
        error: None,
    })
    .into_response()
}

#[derive(Serialize)]
struct UploadResponse {
    success: bool,
    message: String,
    path: Option<String>,
}

pub(crate) async fn upload_handler(
    State(state): State<crate::AppState>,
    Query(query): Query<HashMap<String, String>>,
    req: axum::extract::Request,
) -> Response {
    state
        .power_state
        .active_uploads
        .fetch_add(1, Ordering::Relaxed);

    let result = upload_stream(&state, query, req).await;

    state
        .power_state
        .active_uploads
        .fetch_sub(1, Ordering::Relaxed);

    match result {
        Ok(path) => Json(UploadResponse {
            success: true,
            message: "File uploaded".to_string(),
            path: Some(path),
        })
        .into_response(),
        Err(e) => {
            let conn = state.db.lock().await;
            let _ = db::insert_audit_log(&conn, "upload_failed", Some(&e), None);
            drop(conn);
            Json(UploadResponse {
                success: false,
                message: e,
                path: None,
            })
            .into_response()
        }
    }
}

async fn upload_stream(
    state: &crate::AppState,
    query: HashMap<String, String>,
    req: axum::extract::Request,
) -> Result<String, String> {
    let target_path = query
        .get("path")
        .ok_or_else(|| "Missing 'path' query parameter".to_string())?;

    let canonical = validate_path(target_path)?;

    let file_path = if canonical.is_dir() {
        // If target is a directory, derive filename from Content-Disposition or default
        let filename = req
            .headers()
            .get("Content-Disposition")
            .and_then(|v| v.to_str().ok())
            .and_then(|d| {
                d.split(';')
                    .find_map(|p| p.trim().strip_prefix("filename="))
                    .map(|n| n.trim_matches('"').to_string())
            })
            .unwrap_or_else(|| "upload.bin".to_string());
        canonical.join(filename)
    } else {
        canonical
    };

    // Validate the parent directory exists
    if let Some(parent) = file_path.parent() {
        if !parent.exists() {
            return Err(format!("Parent directory does not exist: {}", parent.display()));
        }
    }

    let body = req.into_body();
    let mut stream = Box::pin(BodyStream::new(body).filter_map(|r| async move {
        match r {
            Ok(frame) => {
                if frame.data_ref().is_some() {
                    Some(Ok::<_, std::io::Error>(frame.into_data().unwrap()))
                } else {
                    None
                }
            }
            Err(e) => Some(Err(std::io::Error::new(std::io::ErrorKind::Other, e))),
        }
    }));

    let mut file = tokio::fs::File::create(&file_path)
        .await
        .map_err(|e| format!("Failed to create file: {}", e))?;

    let mut total: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let data = chunk.map_err(|e| format!("Read error: {}", e))?;
        total += data.len() as u64;
        if total > MAX_UPLOAD_SIZE {
            let _ = tokio::fs::remove_file(&file_path).await;
            return Err("File exceeds 500MB limit".to_string());
        }
        file.write_all(&data)
            .await
            .map_err(|e| format!("Write error: {}", e))?;
    }

    file.flush()
        .await
        .map_err(|e| format!("Flush error: {}", e))?;

    let conn = state.db.lock().await;
    let _ = db::insert_audit_log(
        &conn,
        "file_uploaded",
        Some(&format!("{} ({})", file_path.display(), total)),
        None,
    );
    drop(conn);

    Ok(file_path.to_string_lossy().to_string())
}

#[derive(Deserialize)]
pub(crate) struct DownloadQuery {
    path: String,
}

pub(crate) async fn download_handler(Query(query): Query<DownloadQuery>) -> Response {
    let path = match validate_path(&query.path) {
        Ok(p) => p,
        Err(e) => {
            return (StatusCode::BAD_REQUEST, e).into_response();
        }
    };

    if !path.is_file() {
        return (StatusCode::NOT_FOUND, "File not found".to_string()).into_response();
    }

    let filename = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    match tokio::fs::read(&path).await {
        Ok(data) => (
            StatusCode::OK,
            [
                ("Content-Type", "application/octet-stream"),
                (
                    "Content-Disposition",
                    &format!("attachment; filename=\"{}\"", filename),
                ),
            ],
            data,
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to read file: {}", e),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
pub(crate) struct DeleteRequest {
    path: String,
}

#[derive(Serialize)]
struct DeleteResponse {
    success: bool,
    message: String,
}

pub(crate) async fn delete_handler(
    State(state): State<crate::AppState>,
    Json(req): Json<DeleteRequest>,
) -> Response {
    let path = match validate_path(&req.path) {
        Ok(p) => p,
        Err(e) => {
            return Json(DeleteResponse {
                success: false,
                message: e,
            })
            .into_response()
        }
    };

    let result = if path.is_dir() {
        std::fs::remove_dir_all(&path)
    } else {
        std::fs::remove_file(&path)
    };

    match result {
        Ok(_) => {
            let conn = state.db.lock().await;
            let _ = db::insert_audit_log(
                &conn,
                "file_deleted",
                Some(&path.to_string_lossy()),
                None,
            );
            drop(conn);
            Json(DeleteResponse {
                success: true,
                message: "Deleted".to_string(),
            })
            .into_response()
        }
        Err(e) => Json(DeleteResponse {
            success: false,
            message: format!("Delete failed: {}", e),
        })
        .into_response(),
    }
}

#[derive(Deserialize)]
pub(crate) struct RenameRequest {
    from: String,
    to: String,
}

#[derive(Serialize)]
struct RenameResponse {
    success: bool,
    message: String,
}

pub(crate) async fn rename_handler(
    State(state): State<crate::AppState>,
    Json(req): Json<RenameRequest>,
) -> Response {
    let from = match validate_path(&req.from) {
        Ok(p) => p,
        Err(e) => {
            return Json(RenameResponse {
                success: false,
                message: e,
            })
            .into_response()
        }
    };

    let to = PathBuf::from(&req.to);
    if let Some(parent) = to.parent() {
        if !parent.as_os_str().is_empty() {
            if let Err(e) = validate_path(&parent.to_string_lossy()) {
                return Json(RenameResponse {
                    success: false,
                    message: e,
                })
                .into_response();
            }
        }
    }

    match std::fs::rename(&from, &to) {
        Ok(_) => {
            let conn = state.db.lock().await;
            let _ = db::insert_audit_log(
                &conn,
                "file_renamed",
                Some(&format!("{} -> {}", from.display(), to.display())),
                None,
            );
            drop(conn);
            Json(RenameResponse {
                success: true,
                message: "Renamed".to_string(),
            })
            .into_response()
        }
        Err(e) => Json(RenameResponse {
            success: false,
            message: format!("Rename failed: {}", e),
        })
        .into_response(),
    }
}
