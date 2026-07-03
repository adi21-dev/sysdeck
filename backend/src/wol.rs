use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json};
use serde::Deserialize;
use serde_json::json;
use std::net::UdpSocket;

use crate::db;
use crate::AppState;

#[derive(Deserialize)]
pub struct WakeBody {
    pub mac: String,
}

#[derive(Deserialize)]
pub struct SaveMacBody {
    pub label: String,
    pub mac: String,
}

fn parse_mac(raw: &str) -> Result<[u8; 6], String> {
    let hex = raw.replace([':', '-', ' '], "");
    if hex.len() != 12 {
        return Err("Invalid MAC: expected 12 hex chars".to_string());
    }
    let mut mac = [0u8; 6];
    for i in 0..6 {
        mac[i] = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16)
            .map_err(|_| format!("Invalid hex at byte {}", i))?;
    }
    Ok(mac)
}

fn build_magic_packet(mac: &[u8; 6]) -> Vec<u8> {
    let mut packet = vec![0xFFu8; 6];
    for _ in 0..16 {
        packet.extend_from_slice(mac);
    }
    packet
}

pub async fn wake_handler(Json(body): Json<WakeBody>) -> impl IntoResponse {
    let mac = match parse_mac(&body.mac) {
        Ok(m) => m,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"success": false, "message": e})),
            )
                .into_response()
        }
    };
    let packet = build_magic_packet(&mac);

    match UdpSocket::bind("0.0.0.0:0") {
        Ok(socket) => {
            if socket.set_broadcast(true).is_err() {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({"success": false, "message": "Failed to enable broadcast"})),
                )
                    .into_response();
            }
            match socket.send_to(&packet, "255.255.255.255:9") {
                Ok(_) => {
                    Json(json!({"success": true, "message": "Wake packet sent"})).into_response()
                }
                Err(e) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({"success": false, "message": format!("Send failed: {}", e)})),
                )
                    .into_response(),
            }
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"success": false, "message": format!("Socket bind failed: {}", e)})),
        )
            .into_response(),
    }
}

pub async fn list_macs_handler(State(state): State<AppState>) -> Json<serde_json::Value> {
    let conn = state.db.lock().await;
    let stored = db::get_setting(&conn, "wol_macs").unwrap_or_default();
    drop(conn);
    let macs: Vec<serde_json::Value> = if stored.is_empty() {
        vec![]
    } else {
        serde_json::from_str(&stored).unwrap_or_default()
    };
    Json(json!({"success": true, "macs": macs}))
}

pub async fn save_mac_handler(
    State(state): State<AppState>,
    Json(body): Json<SaveMacBody>,
) -> Json<serde_json::Value> {
    if parse_mac(&body.mac).is_err() {
        return Json(json!({"success": false, "message": "Invalid MAC address"}));
    }
    let conn = state.db.lock().await;
    let stored = db::get_setting(&conn, "wol_macs").unwrap_or_else(|| "[]".to_string());
    let mut macs: Vec<serde_json::Value> = serde_json::from_str(&stored).unwrap_or_default();
    macs.push(json!({"label": body.label, "mac": body.mac}));
    let _ = db::set_setting(&conn, "wol_macs", &serde_json::to_string(&macs).unwrap());
    drop(conn);
    Json(json!({"success": true, "macs": macs}))
}

pub async fn delete_mac_handler(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let target = body.get("mac").and_then(|v| v.as_str()).unwrap_or("");
    let conn = state.db.lock().await;
    let stored = db::get_setting(&conn, "wol_macs").unwrap_or_else(|| "[]".to_string());
    let mut macs: Vec<serde_json::Value> = serde_json::from_str(&stored).unwrap_or_default();
    macs.retain(|m| m.get("mac").and_then(|v| v.as_str()) != Some(target));
    let _ = db::set_setting(&conn, "wol_macs", &serde_json::to_string(&macs).unwrap());
    drop(conn);
    Json(json!({"success": true, "macs": macs}))
}
