use axum::{
    body::Body,
    http::{header, HeaderValue, StatusCode, Uri},
    response::{IntoResponse, Response},
};
use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "../frontend/dist/"]
struct Asset;

const CSP: &str = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'";

pub async fn serve_embedded_assets(uri: Uri) -> Response {
    let mut path = uri.path().trim_start_matches('/').to_owned();
    if path.is_empty() {
        path = "index.html".to_owned();
    }
    let resp = if let Some(content) = Asset::get(&path) {
        let mime = mime_guess::from_path(&path).first_or_octet_stream();
        Response::builder()
            .header(header::CONTENT_TYPE, mime.as_ref())
            .body(Body::from(content.data.into_owned()))
            .unwrap()
    } else if let Some(index) = Asset::get("index.html") {
        Response::builder()
            .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
            .body(Body::from(index.data.into_owned()))
            .unwrap()
    } else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let (mut parts, body) = resp.into_parts();
    parts
        .headers
        .insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static(CSP));
    Response::from_parts(parts, body)
}
