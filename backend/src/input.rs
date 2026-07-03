use axum::extract::Query;
use axum::response::{IntoResponse, Json};

use data_encoding::BASE64;
use enigo::{Axis, Direction, Key, Keyboard, Mouse};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tracing;

// ── Request types ──

#[derive(Deserialize)]
pub struct MouseMoveReq {
    pub x: i32,
    pub y: i32,
    pub relative: Option<bool>,
}

#[derive(Deserialize)]
pub struct MouseClickReq {
    pub button: Option<String>,
    pub double: Option<bool>,
}

#[derive(Deserialize)]
pub struct MouseScrollReq {
    pub dx: Option<i32>,
    pub dy: Option<i32>,
}

#[derive(Deserialize)]
pub struct MouseDragReq {
    pub x: i32,
    pub y: i32,
    pub button: Option<String>,
}

#[derive(Deserialize)]
pub struct KeyboardTypeReq {
    pub text: String,
}

#[derive(Deserialize)]
pub struct KeyboardPressReq {
    pub keys: Vec<String>,
}

#[derive(Deserialize)]
pub struct MediaKeyReq {
    pub key: String,
}

#[derive(Deserialize)]
pub struct ClipboardSetReq {
    pub text: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct ClipboardEvent {
    pub text: Option<String>,
}

#[derive(Deserialize)]
pub struct ScreenshotReq {
    pub monitor: Option<usize>,
    pub region: Option<ScreenshotRegion>,
}

#[derive(Deserialize)]
pub struct ScreenshotRegion {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

#[derive(Deserialize)]
pub struct BrowserOpenReq {
    pub url: String,
}

// ── Helpers ──

fn enigo_button(name: &str) -> Result<enigo::Button, String> {
    match name {
        "left" => Ok(enigo::Button::Left),
        "right" => Ok(enigo::Button::Right),
        "middle" => Ok(enigo::Button::Middle),
        _ => Err(format!("Unknown button: {}", name)),
    }
}

// ponytail: named keys + raw VK codes for alphanumeric (hotkeys). Full key map if needed.
fn key_from_str(s: &str) -> Option<Key> {
    let lower = s.to_lowercase();
    let k = match lower.as_str() {
        "alt" => Key::Alt,
        "backspace" => Key::Backspace,
        "caps_lock" | "capslock" => Key::CapsLock,
        "control" | "ctrl" => Key::Control,
        "delete" | "del" => Key::Delete,
        "down" | "downarrow" => Key::DownArrow,
        "end" => Key::End,
        "escape" | "esc" => Key::Escape,
        "home" => Key::Home,
        "left" | "leftarrow" => Key::LeftArrow,
        "meta" | "windows" | "win" | "super" | "cmd" => Key::Meta,
        "option" => Key::Alt,
        "page_down" | "pagedown" | "pgdn" => Key::PageDown,
        "page_up" | "pageup" | "pgup" => Key::PageUp,
        "return" | "enter" => Key::Return,
        "right" | "rightarrow" => Key::RightArrow,
        "shift" => Key::Shift,
        "space" => Key::Space,
        "tab" => Key::Tab,
        "up" | "uparrow" => Key::UpArrow,
        "f1" => Key::F1,
        "f2" => Key::F2,
        "f3" => Key::F3,
        "f4" => Key::F4,
        "f5" => Key::F5,
        "f6" => Key::F6,
        "f7" => Key::F7,
        "f8" => Key::F8,
        "f9" => Key::F9,
        "f10" => Key::F10,
        "f11" => Key::F11,
        "f12" => Key::F12,
        "f13" => Key::F13,
        "f14" => Key::F14,
        "f15" => Key::F15,
        "f16" => Key::F16,
        "f17" => Key::F17,
        "f18" => Key::F18,
        "f19" => Key::F19,
        "f20" => Key::F20,
        #[cfg(not(target_os = "macos"))]
        "f21" => Key::F21,
        #[cfg(not(target_os = "macos"))]
        "f22" => Key::F22,
        #[cfg(not(target_os = "macos"))]
        "f23" => Key::F23,
        #[cfg(not(target_os = "macos"))]
        "f24" => Key::F24,
        _ => return None,
    };
    Some(k)
}

// ── Mouse handlers ──

pub async fn mouse_move_handler(Json(req): Json<MouseMoveReq>) -> impl IntoResponse {
    let result = tokio::task::spawn_blocking(move || -> Result<(), String> {
        let mut enigo = enigo::Enigo::new(&enigo::Settings::default())
            .map_err(|e| format!("enigo init: {}", e))?;
        let coord = if req.relative.unwrap_or(false) {
            enigo::Coordinate::Rel
        } else {
            enigo::Coordinate::Abs
        };
        enigo
            .move_mouse(req.x, req.y, coord)
            .map_err(|e| format!("mouse move: {}", e))
    })
    .await;

    match result {
        Ok(Ok(())) => Json(json!({"success": true})).into_response(),
        _ => Json(json!({"success": false, "message": "Mouse move failed"})).into_response(),
    }
}

pub async fn mouse_click_handler(Json(req): Json<MouseClickReq>) -> impl IntoResponse {
    let button = req.button.as_deref().unwrap_or("left").to_string();
    let double = req.double.unwrap_or(false);

    let result = tokio::task::spawn_blocking(move || -> Result<(), String> {
        let mut enigo = enigo::Enigo::new(&enigo::Settings::default())
            .map_err(|e| format!("enigo init: {}", e))?;
        let btn = enigo_button(&button)?;
        if double {
            enigo
                .button(btn, enigo::Direction::Click)
                .map_err(|e| format!("click: {}", e))?;
            std::thread::sleep(std::time::Duration::from_millis(50));
            enigo
                .button(btn, enigo::Direction::Click)
                .map_err(|e| format!("click: {}", e))
        } else {
            enigo
                .button(btn, enigo::Direction::Click)
                .map_err(|e| format!("click: {}", e))
        }
    })
    .await;

    match result {
        Ok(Ok(())) => Json(json!({"success": true})).into_response(),
        _ => Json(json!({"success": false, "message": "Click failed"})).into_response(),
    }
}

pub async fn mouse_scroll_handler(Json(req): Json<MouseScrollReq>) -> impl IntoResponse {
    let result = tokio::task::spawn_blocking(move || -> Result<(), String> {
        let mut enigo = enigo::Enigo::new(&enigo::Settings::default())
            .map_err(|e| format!("enigo init: {}", e))?;
        let dy = req.dy.unwrap_or(0);
        let dx = req.dx.unwrap_or(0);
        if dy != 0 {
            enigo
                .scroll(dy, Axis::Vertical)
                .map_err(|e| format!("scroll: {}", e))?;
        }
        if dx != 0 {
            enigo
                .scroll(dx, Axis::Horizontal)
                .map_err(|e| format!("scroll: {}", e))?;
        }
        Ok(())
    })
    .await;

    match result {
        Ok(Ok(())) => Json(json!({"success": true})).into_response(),
        _ => Json(json!({"success": false, "message": "Scroll failed"})).into_response(),
    }
}

pub async fn mouse_drag_handler(Json(req): Json<MouseDragReq>) -> impl IntoResponse {
    let result = tokio::task::spawn_blocking(move || -> Result<(), String> {
        let mut enigo = enigo::Enigo::new(&enigo::Settings::default())
            .map_err(|e| format!("enigo init: {}", e))?;
        let btn = enigo_button(req.button.as_deref().unwrap_or("left"))?;
        enigo
            .button(btn, enigo::Direction::Press)
            .map_err(|e| format!("drag press: {}", e))?;
        enigo
            .move_mouse(req.x, req.y, enigo::Coordinate::Abs)
            .map_err(|e| format!("drag move: {}", e))?;
        enigo
            .button(btn, enigo::Direction::Release)
            .map_err(|e| format!("drag release: {}", e))
    })
    .await;

    match result {
        Ok(Ok(())) => Json(json!({"success": true})).into_response(),
        _ => Json(json!({"success": false, "message": "Drag failed"})).into_response(),
    }
}

// ── Keyboard handlers ──

pub async fn keyboard_type_handler(Json(req): Json<KeyboardTypeReq>) -> impl IntoResponse {
    let result = tokio::task::spawn_blocking(move || -> Result<(), String> {
        let mut enigo = enigo::Enigo::new(&enigo::Settings::default())
            .map_err(|e| format!("enigo init: {}", e))?;
        enigo.text(&req.text).map_err(|e| format!("type: {}", e))
    })
    .await;

    match result {
        Ok(Ok(())) => Json(json!({"success": true})).into_response(),
        _ => Json(json!({"success": false, "message": "Type failed"})).into_response(),
    }
}

fn is_modifier(k: &Key) -> bool {
    matches!(k, Key::Control | Key::Shift | Key::Alt | Key::Meta)
}

pub async fn keyboard_press_handler(Json(req): Json<KeyboardPressReq>) -> impl IntoResponse {
    let result = tokio::task::spawn_blocking(move || -> Result<(), String> {
        let mut enigo = enigo::Enigo::new(&enigo::Settings::default())
            .map_err(|e| format!("enigo init: {}", e))?;

        let mut modifiers: Vec<Key> = Vec::new();
        let mut keycodes: Vec<Key> = Vec::new();
        let mut chars = String::new();

        for k in &req.keys {
            if let Some(key) = key_from_str(k) {
                if is_modifier(&key) {
                    modifiers.push(key);
                } else {
                    keycodes.push(key);
                }
            } else if k.len() == 1 {
                chars.push(k.chars().next().unwrap());
            }
        }

        for k in &modifiers {
            enigo
                .key(*k, Direction::Press)
                .map_err(|e| format!("key press: {}", e))?;
        }
        for k in &keycodes {
            enigo
                .key(*k, Direction::Click)
                .map_err(|e| format!("key click: {}", e))?;
        }
        if !chars.is_empty() {
            enigo.text(&chars).map_err(|e| format!("key text: {}", e))?;
        }
        for k in modifiers.iter().rev() {
            enigo
                .key(*k, Direction::Release)
                .map_err(|e| format!("key release: {}", e))?;
        }
        Ok(())
    })
    .await;

    match result {
        Ok(Ok(())) => Json(json!({"success": true})).into_response(),
        _ => Json(json!({"success": false, "message": "Hotkey failed"})).into_response(),
    }
}

pub async fn media_key_handler(Json(req): Json<MediaKeyReq>) -> impl IntoResponse {
    // Reuse the existing media key implementation from hardware.rs
    match crate::hardware::trigger_media_key(req.key).await {
        Ok(()) => Json(json!({"success": true})).into_response(),
        Err(e) => Json(json!({"success": false, "message": e})).into_response(),
    }
}

// ── Clipboard handlers ──

pub async fn clipboard_get_handler() -> impl IntoResponse {
    tracing::info!("Clipboard get requested");
    let result = tokio::task::spawn_blocking(move || -> Result<ClipboardEvent, String> {
        let mut cb = arboard::Clipboard::new().map_err(|e| format!("clipboard: {}", e))?;
        let text = cb.get_text().ok();
        Ok(ClipboardEvent { text })
    })
    .await;

    match result {
        Ok(Ok(event)) => Json(json!({"success": true, "data": event})).into_response(),
        _ => Json(json!({"success": false, "message": "Clipboard read failed"})).into_response(),
    }
}

pub async fn clipboard_set_handler(Json(req): Json<ClipboardSetReq>) -> impl IntoResponse {
    tracing::info!("Clipboard set requested");
    let result = tokio::task::spawn_blocking(move || -> Result<(), String> {
        let mut cb = arboard::Clipboard::new().map_err(|e| format!("clipboard: {}", e))?;
        if let Some(text) = req.text {
            cb.set_text(text).map_err(|e| format!("set text: {}", e))?;
        }
        Ok(())
    })
    .await;

    match result {
        Ok(Ok(())) => Json(json!({"success": true})).into_response(),
        _ => Json(json!({"success": false, "message": "Clipboard write failed"})).into_response(),
    }
}

// ── Screenshot handlers ──

pub async fn screenshot_handler(Query(params): Query<Option<ScreenshotReq>>) -> impl IntoResponse {
    tracing::info!("Screenshot requested");
    let result = tokio::task::spawn_blocking(move || -> Result<String, String> {
        let monitors = xcap::Monitor::all().map_err(|e| format!("monitors: {}", e))?;
        let idx = params.as_ref().and_then(|r| r.monitor).unwrap_or(0);
        let monitor = monitors.get(idx).ok_or("Monitor not found")?;
        let img = monitor
            .capture_image()
            .map_err(|e| format!("capture: {}", e))?;

        let cropped = if let Some(region) = params.as_ref().and_then(|r| r.region.as_ref()) {
            let rx = region.x.max(0) as u32;
            let ry = region.y.max(0) as u32;
            let rw = region.w.min(img.width().saturating_sub(rx));
            let rh = region.h.min(img.height().saturating_sub(ry));
            let mut img = img;
            image::imageops::crop(&mut img, rx, ry, rw, rh).to_image()
        } else {
            img
        };

        let mut buf = std::io::Cursor::new(Vec::new());
        cropped
            .write_to(&mut buf, image::ImageFormat::Png)
            .map_err(|e| format!("encode: {}", e))?;
        let b64 = BASE64.encode(&buf.into_inner());
        Ok(b64)
    })
    .await;

    match result {
        Ok(Ok(b64)) => Json(json!({"success": true, "data": {"png_b64": b64}})).into_response(),
        _ => Json(json!({"success": false, "message": "Screenshot failed"})).into_response(),
    }
}

// ── Browser handlers ──

pub async fn browser_open_handler(Json(req): Json<BrowserOpenReq>) -> impl IntoResponse {
    tracing::info!(url = %req.url, "Browser open requested");
    // ponytail: open URL via system default browser. Tab control via DevTools Protocol if needed.
    match open::that(&req.url) {
        Ok(()) => Json(json!({"success": true})).into_response(),
        Err(e) => {
            Json(json!({"success": false, "message": format!("open: {}", e)})).into_response()
        }
    }
}
