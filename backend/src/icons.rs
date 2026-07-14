use axum::extract::Query;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Json};
use serde::Deserialize;
use serde_json::json;
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;

// ponytail: global lock, only one icon extraction at a time — GDI objects are per-thread
use std::sync::Mutex;
static ICON_LOCK: Mutex<()> = Mutex::new(());

// ponytail: simple HashMap cache, no LRU dep — 4000 apps × ~1KB = ~4MB max
use std::collections::HashMap;
use std::sync::LazyLock;
static ICON_CACHE: LazyLock<Mutex<HashMap<String, Vec<u8>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn wide(s: &str) -> Vec<u16> {
    OsStr::new(s)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[repr(C)]
struct MyIconInfo {
    f_icon: i32,
    x_hotspot: u32,
    y_hotspot: u32,
    hbm_mask: *mut std::ffi::c_void,
    hbm_color: *mut std::ffi::c_void,
}

extern "system" {
    fn GetIconInfo(h_icon: *mut std::ffi::c_void, picon_info: *mut MyIconInfo) -> i32;
}

fn extract_png_bytes(path: &str) -> Result<Vec<u8>, String> {
    use std::mem::{size_of, zeroed};
    use windows_sys::Win32::Graphics::Gdi::*;
    use windows_sys::Win32::UI::Shell::*;
    use windows_sys::Win32::UI::WindowsAndMessaging::DestroyIcon;

    let _lock = ICON_LOCK.lock().unwrap();
    let path_w = wide(path);

    let mut shfi: SHFILEINFOW = unsafe { zeroed() };
    let ret = unsafe {
        SHGetFileInfoW(
            path_w.as_ptr(),
            0,
            &mut shfi,
            size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        )
    };
    if ret == 0 || shfi.hIcon.is_null() {
        return Err("SHGetFileInfoW failed".to_string());
    }
    let hicon = shfi.hIcon;

    let mut icon_info: MyIconInfo = unsafe { zeroed() };
    if unsafe { GetIconInfo(hicon, &mut icon_info) } == 0 {
        unsafe { DestroyIcon(hicon) };
        return Err("GetIconInfo failed".to_string());
    }

    let mut bitmap: BITMAP = unsafe { zeroed() };
    if unsafe {
        GetObjectW(
            icon_info.hbm_color as *mut _,
            size_of::<BITMAP>() as i32,
            &mut bitmap as *mut _ as *mut _,
        )
    } == 0
    {
        unsafe {
            DestroyIcon(hicon);
            DeleteObject(icon_info.hbm_color);
            DeleteObject(icon_info.hbm_mask);
        }
        return Err("GetObjectW failed".to_string());
    }

    let width = bitmap.bmWidth;
    let height = bitmap.bmHeight;
    if width <= 0 || height <= 0 {
        unsafe {
            DestroyIcon(hicon);
            DeleteObject(icon_info.hbm_color);
            DeleteObject(icon_info.hbm_mask);
        }
        return Err("Invalid icon dimensions".to_string());
    }

    let hdc = unsafe { CreateCompatibleDC(std::ptr::null_mut()) };
    if hdc.is_null() {
        unsafe {
            DestroyIcon(hicon);
            DeleteObject(icon_info.hbm_color);
            DeleteObject(icon_info.hbm_mask);
        }
        return Err("CreateCompatibleDC failed".to_string());
    }

    let old = unsafe { SelectObject(hdc, icon_info.hbm_color as *mut _) };

    let mut bmi: BITMAPINFO = unsafe { zeroed() };
    bmi.bmiHeader.biSize = size_of::<BITMAPINFOHEADER>() as u32;
    bmi.bmiHeader.biWidth = width;
    bmi.bmiHeader.biHeight = -height;
    bmi.bmiHeader.biPlanes = 1;
    bmi.bmiHeader.biBitCount = 32;
    bmi.bmiHeader.biCompression = 0;

    let stride = width as usize * 4;
    let pixel_count = stride * height as usize;
    let mut pixels = vec![0u8; pixel_count];

    let ret = unsafe {
        GetDIBits(
            hdc,
            icon_info.hbm_color as *mut _,
            0,
            height as u32,
            pixels.as_mut_ptr() as *mut _,
            &mut bmi,
            0,
        )
    };

    unsafe {
        SelectObject(hdc, old);
        DeleteDC(hdc);
        DestroyIcon(hicon);
        DeleteObject(icon_info.hbm_color);
        DeleteObject(icon_info.hbm_mask);
    }

    if ret == 0 {
        return Err("GetDIBits failed".to_string());
    }

    // BGRA → RGBA swap
    for chunk in pixels.chunks_exact_mut(4) {
        chunk.swap(0, 2);
    }

    let img = image::RgbaImage::from_raw(width as u32, height as u32, pixels)
        .ok_or("RgbaImage::from_raw failed")?;

    let mut buf = std::io::Cursor::new(Vec::new());
    img.write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| format!("PNG encode failed: {}", e))?;
    Ok(buf.into_inner())
}

fn get_icon_png(path: &str) -> Result<Vec<u8>, String> {
    let mut cache = ICON_CACHE.lock().unwrap();
    if let Some(cached) = cache.get(path) {
        return Ok(cached.clone());
    }
    let bytes = extract_png_bytes(path)?;
    cache.insert(path.to_string(), bytes.clone());
    Ok(bytes)
}

pub async fn icon_handler(Query(params): Query<IconQuery>) -> impl IntoResponse {
    let path = match std::fs::canonicalize(&params.path) {
        Ok(p) => p.to_string_lossy().to_string(),
        Err(_) => return (StatusCode::BAD_REQUEST, "Invalid path".to_string()).into_response(),
    };

    // ponytail: blocked paths check lifted from file_manager
    let blocked = ["system32", "windows", "program files"];
    let lower = path.to_lowercase();
    if blocked.iter().any(|b| {
        lower.starts_with(&format!("c:\\{b}")) || lower.starts_with(&format!("c:\\windows\\{b}"))
    }) {
        return (StatusCode::FORBIDDEN, "Access denied".to_string()).into_response();
    }

    match get_icon_png(&path) {
        Ok(bytes) => {
            let headers = HeaderMap::from_iter([
                (
                    axum::http::header::CONTENT_TYPE,
                    "image/png".parse().unwrap(),
                ),
                (
                    axum::http::header::CACHE_CONTROL,
                    "public, max-age=86400".parse().unwrap(),
                ),
            ]);
            (headers, bytes).into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

#[derive(Deserialize)]
pub struct IconQuery {
    pub path: String,
}

#[derive(serde::Serialize)]
pub struct AppInfo {
    pub name: String,
    pub path: String,
}

pub async fn apps_handler() -> Json<serde_json::Value> {
    let apps = tokio::task::spawn_blocking(|| {
        let mut apps = Vec::new();
        let start_menu_dirs = [
            std::path::PathBuf::from(r"C:\ProgramData\Microsoft\Windows\Start Menu\Programs"),
            dirs::data_dir()
                .unwrap_or_else(|| std::path::PathBuf::from(r"C:\Users\Default\AppData\Roaming"))
                .join("Microsoft\\Windows\\Start Menu\\Programs"),
        ];

        fn scan_dir(dir: &Path, apps: &mut Vec<AppInfo>, depth: usize) {
            if depth > 3 || !dir.is_dir() {
                return;
            }
            if let Ok(entries) = std::fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        scan_dir(&path, apps, depth + 1);
                    } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                        if matches!(ext, "exe" | "lnk" | "appref-ms") {
                            let name = path
                                .file_stem()
                                .and_then(|s| s.to_str())
                                .unwrap_or("")
                                .to_string();
                            apps.push(AppInfo {
                                name,
                                path: path.to_string_lossy().to_string(),
                            });
                        }
                    }
                }
            }
        }

        for dir in &start_menu_dirs {
            scan_dir(dir, &mut apps, 0);
        }
        apps.sort_by_key(|a| a.name.to_lowercase());
        apps
    })
    .await
    .unwrap_or_default();

    Json(json!({ "success": true, "apps": apps }))
}

#[derive(Deserialize)]
pub struct LaunchRequest {
    pub path: String,
}

pub async fn launch_handler(Json(req): Json<LaunchRequest>) -> impl IntoResponse {
    // ponytail: .lnk files need ShellExecute / open crate; .exe can use Command directly
    let result = if req.path.ends_with(".lnk") || req.path.ends_with(".appref-ms") {
        open::that(&req.path).map_err(|e| e.to_string())
    } else {
        std::process::Command::new(&req.path)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    };
    match result {
        Ok(()) => Json(json!({ "success": true })).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "success": false, "message": e })),
        )
            .into_response(),
    }
}
