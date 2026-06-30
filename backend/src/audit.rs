use axum::extract::{Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::db::{self, AuditLogEntry};
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct AuditLogQuery {
    pub cursor: Option<i64>,
    pub limit: Option<i64>,
    pub event: Option<String>,
    pub from: Option<i64>,
    pub to: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct AuditLogResponse {
    pub entries: Vec<AuditLogEntry>,
    pub next_cursor: Option<i64>,
    pub has_more: bool,
}

pub async fn logs_handler(
    Query(params): Query<AuditLogQuery>,
    State(state): State<AppState>,
) -> Json<AuditLogResponse> {
    let limit = params.limit.unwrap_or(50).min(200);
    let db = state.db.lock().await;

    let all_entries = db::query_audit_logs(
        &db,
        params.cursor,
        limit,
        params.event.as_deref(),
        params.from,
        params.to,
    )
    .unwrap_or_default();

    let has_more = all_entries.len() as i64 > limit;
    let entries = if has_more {
        all_entries[..all_entries.len() - 1].to_vec()
    } else {
        all_entries
    };
    let next_cursor = entries.last().map(|e| e.id);

    Json(AuditLogResponse {
        entries,
        next_cursor,
        has_more,
    })
}
