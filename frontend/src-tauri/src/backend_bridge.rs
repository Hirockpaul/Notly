use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
use tauri::State;

const BACKEND_ORIGIN: &str = "http://127.0.0.1:8765";
const MAX_AUDIO_BYTES: usize = 64_000;
const MAX_SESSION_ID_BYTES: usize = 128;

pub struct BackendBridge {
    client: Client,
    origin: String,
}

impl BackendBridge {
    pub fn new() -> Result<Self, String> {
        Self::with_origin(BACKEND_ORIGIN)
    }

    fn with_origin(origin: &str) -> Result<Self, String> {
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(3))
            .timeout(Duration::from_secs(200))
            .no_proxy()
            .build()
            .map_err(|_| "Could not initialize the local backend client.".to_string())?;
        Ok(Self {
            client,
            origin: origin.trim_end_matches('/').to_string(),
        })
    }

    async fn json(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
        timeout: Duration,
    ) -> Result<Value, BackendCommandError> {
        let mut request = self
            .client
            .request(method, format!("{}{}", self.origin, path));
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request
            .timeout(timeout)
            .send()
            .await
            .map_err(BackendCommandError::from_reqwest)?;
        parse_json_response(response).await
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendCommandError {
    code: &'static str,
    message: String,
    status: Option<u16>,
}

impl BackendCommandError {
    fn invalid(message: &str) -> Self {
        Self {
            code: "validation",
            message: message.to_string(),
            status: None,
        }
    }

    fn from_reqwest(error: reqwest::Error) -> Self {
        if error.is_timeout() {
            Self {
                code: "timeout",
                message: "The local audio backend did not respond in time.".into(),
                status: None,
            }
        } else {
            Self {
                code: "unavailable",
                message: "The local audio backend is unavailable.".into(),
                status: None,
            }
        }
    }
}

async fn parse_json_response(response: reqwest::Response) -> Result<Value, BackendCommandError> {
    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(BackendCommandError::from_reqwest)?;
    let payload: Value = serde_json::from_slice(&bytes).map_err(|_| BackendCommandError {
        code: "invalid_response",
        message: "The local backend returned an invalid response.".into(),
        status: Some(status.as_u16()),
    })?;
    if status.is_success() {
        return Ok(payload);
    }
    let message = payload
        .get("detail")
        .and_then(|detail| detail.as_str().or_else(|| detail.get("message")?.as_str()))
        .unwrap_or("The local backend rejected the request.")
        .to_string();
    Err(BackendCommandError {
        code: "validation",
        message,
        status: Some(status.as_u16()),
    })
}

fn validate_session_id(session_id: &str) -> Result<(), BackendCommandError> {
    if session_id.is_empty()
        || session_id.len() > MAX_SESSION_ID_BYTES
        || !session_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(BackendCommandError::invalid("The session ID is invalid."));
    }
    Ok(())
}

#[tauri::command]
pub async fn backend_start_session(
    state: State<'_, BackendBridge>,
    lifecycle: State<'_, crate::backend_lifecycle::BackendLifecycle>,
) -> Result<Value, BackendCommandError> {
    if lifecycle.status().phase != crate::backend_lifecycle::BackendPhase::Ready {
        return Err(BackendCommandError {
            code: "unavailable",
            message: "The local backend is not ready.".into(),
            status: None,
        });
    }
    state
        .json(
            reqwest::Method::POST,
            "/api/sessions/start",
            None,
            Duration::from_secs(4),
        )
        .await
}

#[tauri::command]
pub async fn backend_get_transcript(
    state: State<'_, BackendBridge>,
    session_id: String,
) -> Result<Value, BackendCommandError> {
    validate_session_id(&session_id)?;
    state
        .json(
            reqwest::Method::GET,
            &format!("/api/sessions/{session_id}/transcript"),
            None,
            Duration::from_secs(4),
        )
        .await
}

#[tauri::command]
pub async fn backend_finish_session(
    state: State<'_, BackendBridge>,
    session_id: String,
) -> Result<Value, BackendCommandError> {
    validate_session_id(&session_id)?;
    state
        .json(
            reqwest::Method::POST,
            &format!("/api/sessions/{session_id}/finish"),
            None,
            Duration::from_secs(200),
        )
        .await
}

#[tauri::command]
pub async fn backend_generate_notes(
    state: State<'_, BackendBridge>,
    session_id: String,
    regenerate: bool,
) -> Result<Value, BackendCommandError> {
    validate_session_id(&session_id)?;
    state
        .json(
            reqwest::Method::POST,
            &format!("/api/sessions/{session_id}/notes"),
            Some(serde_json::json!({ "regenerate": regenerate })),
            Duration::from_secs(70),
        )
        .await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioChunkRequest {
    session_id: String,
    sequence: u64,
    sample_rate: u32,
    channels: u8,
    bytes: Vec<u8>,
}

#[tauri::command]
pub async fn backend_send_audio_chunk(
    state: State<'_, BackendBridge>,
    chunk: AudioChunkRequest,
) -> Result<Value, BackendCommandError> {
    validate_session_id(&chunk.session_id)?;
    if chunk.sample_rate != 16_000 || chunk.channels != 1 {
        return Err(BackendCommandError::invalid(
            "Audio must be 16 kHz mono PCM16.",
        ));
    }
    if chunk.bytes.is_empty() || chunk.bytes.len() > MAX_AUDIO_BYTES || chunk.bytes.len() % 2 != 0 {
        return Err(BackendCommandError::invalid(
            "The PCM16 audio payload is invalid.",
        ));
    }
    let response = state
        .client
        .post(format!("{}/api/audio/chunks", state.origin))
        .timeout(Duration::from_secs(4))
        .header("Content-Type", "application/octet-stream")
        .header("X-Noto-Channels", u16::from(chunk.channels))
        .header("X-Noto-Sample-Rate", chunk.sample_rate)
        .header("X-Noto-Sequence", chunk.sequence)
        .header("X-Noto-Session-Id", &chunk.session_id)
        .body(chunk.bytes)
        .send()
        .await
        .map_err(BackendCommandError::from_reqwest)?;
    parse_json_response(response).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };

    fn mock_http(response: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 8192];
            let _ = stream.read(&mut request);
            stream.write_all(response.as_bytes()).unwrap();
        });
        format!("http://{address}")
    }

    #[test]
    fn rejects_unsafe_session_ids() {
        assert!(validate_session_id("valid-session_1").is_ok());
        assert!(validate_session_id("../health").is_err());
        assert!(validate_session_id("").is_err());
    }

    #[test]
    fn backend_origin_is_fixed_to_loopback() {
        let bridge = BackendBridge::new().unwrap();
        assert_eq!(bridge.origin, "http://127.0.0.1:8765");
    }

    #[tokio::test]
    async fn accepts_successful_json_response() {
        let origin = mock_http("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 11\r\n\r\n{\"ok\":true}");
        let bridge = BackendBridge::with_origin(&origin).unwrap();
        let result = bridge
            .json(
                reqwest::Method::GET,
                "/health",
                None,
                Duration::from_secs(1),
            )
            .await
            .unwrap();
        assert_eq!(result["ok"], true);
    }

    #[tokio::test]
    async fn preserves_http_error_status_and_message() {
        let body = "{\"detail\":\"bad audio\"}";
        let origin = mock_http("HTTP/1.1 422 Unprocessable Entity\r\nContent-Type: application/json\r\nContent-Length: 22\r\n\r\n{\"detail\":\"bad audio\"}");
        let bridge = BackendBridge::with_origin(&origin).unwrap();
        let error = bridge
            .json(
                reqwest::Method::POST,
                "/audio",
                None,
                Duration::from_secs(1),
            )
            .await
            .unwrap_err();
        assert_eq!(error.status, Some(422));
        assert_eq!(error.message, "bad audio");
        assert_eq!(body.len(), 22);
    }

    #[tokio::test]
    async fn rejects_malformed_success_response() {
        let origin = mock_http("HTTP/1.1 200 OK\r\nContent-Length: 8\r\n\r\nnot-json");
        let bridge = BackendBridge::with_origin(&origin).unwrap();
        let error = bridge
            .json(
                reqwest::Method::GET,
                "/health",
                None,
                Duration::from_secs(1),
            )
            .await
            .unwrap_err();
        assert_eq!(error.code, "invalid_response");
    }

    #[tokio::test]
    async fn reports_backend_unavailable() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        drop(listener);
        let bridge = BackendBridge::with_origin(&origin).unwrap();
        let error = bridge
            .json(
                reqwest::Method::GET,
                "/health",
                None,
                Duration::from_millis(100),
            )
            .await
            .unwrap_err();
        assert_eq!(error.code, "unavailable");
    }
}
