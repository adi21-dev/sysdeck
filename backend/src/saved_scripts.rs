use axum::extract::{Path, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::db;
use crate::AppState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SavedScript {
    pub id: String,
    pub title: String,
    pub content: String,
    pub script_type: String,
    pub pinned: bool,
    pub pinned_order: Option<i32>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Deserialize)]
pub struct CreateBody {
    pub title: String,
    pub content: String,
    pub script_type: String,
}

#[derive(Deserialize)]
pub struct UpdateBody {
    pub title: Option<String>,
    pub content: Option<String>,
    pub script_type: Option<String>,
}

#[derive(Deserialize)]
pub struct PinBody {
    pub pinned: bool,
}

// ponytail: JSON blob in settings table. New table if scripts exceed ~100 or queries need filtering.
fn load_all(conn: &rusqlite::Connection) -> Vec<SavedScript> {
    let stored = db::get_setting(conn, "saved_scripts").unwrap_or_default();
    if stored.is_empty() {
        return vec![];
    }
    serde_json::from_str(&stored).unwrap_or_default()
}

fn save_all(conn: &rusqlite::Connection, scripts: &[SavedScript]) {
    let json = serde_json::to_string(scripts).unwrap_or_default();
    let _ = db::set_setting(conn, "saved_scripts", &json);
}

fn now() -> i64 {
    crate::now_secs()
}

pub async fn list_handler(State(state): State<AppState>) -> Json<serde_json::Value> {
    let conn = state.db.lock().await;
    let scripts = load_all(&conn);
    drop(conn);
    Json(json!({"success": true, "scripts": scripts}))
}

pub async fn create_handler(
    State(state): State<AppState>,
    Json(body): Json<CreateBody>,
) -> Json<serde_json::Value> {
    if body.title.trim().is_empty() {
        return Json(json!({"success": false, "message": "Title is required"}));
    }
    if body.content.trim().is_empty() {
        return Json(json!({"success": false, "message": "Script content is required"}));
    }

    let conn = state.db.lock().await;
    let mut scripts = load_all(&conn);
    let ts = now();
    let script = SavedScript {
        id: Uuid::new_v4().to_string(),
        title: body.title.trim().to_string(),
        content: body.content.trim().to_string(),
        script_type: body.script_type,
        pinned: false,
        pinned_order: None,
        created_at: ts,
        updated_at: ts,
    };
    scripts.push(script.clone());
    save_all(&conn, &scripts);
    drop(conn);
    Json(json!({"success": true, "script": script}))
}

pub async fn update_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateBody>,
) -> Json<serde_json::Value> {
    let conn = state.db.lock().await;
    let mut scripts = load_all(&conn);
    let idx = scripts.iter().position(|s| s.id == id);
    match idx {
        None => {
            drop(conn);
            Json(json!({"success": false, "message": "Script not found"}))
        }
        Some(i) => {
            if let Some(title) = body.title {
                scripts[i].title = title;
            }
            if let Some(content) = body.content {
                scripts[i].content = content;
            }
            if let Some(script_type) = body.script_type {
                scripts[i].script_type = script_type;
            }
            scripts[i].updated_at = now();
            let script = scripts[i].clone();
            save_all(&conn, &scripts);
            drop(conn);
            Json(json!({"success": true, "script": script}))
        }
    }
}

pub async fn delete_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Json<serde_json::Value> {
    let conn = state.db.lock().await;
    let mut scripts = load_all(&conn);
    let len_before = scripts.len();
    scripts.retain(|s| s.id != id);
    if scripts.len() == len_before {
        drop(conn);
        return Json(json!({"success": false, "message": "Script not found"}));
    }
    save_all(&conn, &scripts);
    drop(conn);
    Json(json!({"success": true, "message": "Script deleted"}))
}

pub async fn pin_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<PinBody>,
) -> Json<serde_json::Value> {
    let conn = state.db.lock().await;
    let mut scripts = load_all(&conn);
    let idx = scripts.iter().position(|s| s.id == id);
    match idx {
        None => {
            drop(conn);
            Json(json!({"success": false, "message": "Script not found"}))
        }
        Some(i) => {
            if body.pinned {
                let pinned_count = scripts.iter().filter(|s| s.pinned).count();
                if pinned_count >= 5 {
                    drop(conn);
                    return Json(json!({"success": false, "message": "Maximum 5 pinned scripts"}));
                }
                scripts[i].pinned = true;
                scripts[i].pinned_order = Some(pinned_count as i32);
            } else {
                scripts[i].pinned = false;
                scripts[i].pinned_order = None;
            }
            scripts[i].updated_at = now();
            let script = scripts[i].clone();
            save_all(&conn, &scripts);
            drop(conn);
            Json(json!({"success": true, "script": script}))
        }
    }
}
