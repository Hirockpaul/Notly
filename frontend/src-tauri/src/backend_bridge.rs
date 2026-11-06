use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashMap, sync::Mutex, time::Duration};
use tauri::State;
use tokio_util::sync::CancellationToken;

const MAX_AUDIO_BYTES: usize = 64_000;
const MAX_SESSION_ID_BYTES: usize = 128;
const MAX_CONCURRENT_REQUESTS: usize = 1024;

struct RegisteredRequest {
    request_id: String,
    token: CancellationToken,
    dispatched: bool,
}

#[derive(Clone, Copy)]
struct RequestIdentity<'a> {
    request_id: &'a str,
    registration_id: &'a str,
}

#[derive(Default)]
struct RequestState {
    registrations: HashMap<String, RegisteredRequest>,
    request_ids: HashMap<String, String>,
}

impl RequestState {
    fn register(&mut self, request_id: &str) -> Result<String, BackendCommandError> {
        validate_request_id(request_id)?;
        if self.request_ids.contains_key(request_id) {
            return Err(BackendCommandError::invalid(
                "The request ID is already registered.",
            ));
        }
        if self.registrations.len() >= MAX_CONCURRENT_REQUESTS {
            return Err(BackendCommandError::capacity());
        }
        let registration_id = uuid::Uuid::new_v4().to_string();
        let token = CancellationToken::new();
        self.registrations.insert(
            registration_id.clone(),
            RegisteredRequest {
                request_id: request_id.to_string(),
                token,
                dispatched: false,
            },
        );
        self.request_ids
            .insert(request_id.to_string(), registration_id.clone());
        Ok(registration_id)
    }

    fn claim(
        &mut self,
        request_id: &str,
        registration_id: &str,
    ) -> Result<CancellationToken, BackendCommandError> {
        validate_request_id(request_id)?;
        let registration = self
            .registrations
            .get_mut(registration_id)
            .filter(|registration| registration.request_id == request_id)
            .ok_or_else(BackendCommandError::cancelled)?;
        if registration.dispatched {
            return Err(BackendCommandError::invalid(
                "The request registration was already dispatched.",
            ));
        }
        registration.dispatched = true;
        Ok(registration.token.clone())
    }

    fn cancel(&mut self, registration_id: &str) {
        if let Some(registration) = self.registrations.remove(registration_id) {
            self.request_ids.remove(&registration.request_id);
            registration.token.cancel();
        }
    }

    fn complete(&mut self, registration_id: &str) {
        if let Some(registration) = self.registrations.remove(registration_id) {
            self.request_ids.remove(&registration.request_id);
        }
    }
}

pub struct BackendBridge {
    client: Client,
    requests: Mutex<RequestState>,
}

impl BackendBridge {
    pub fn new() -> Result<Self, String> {
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(3))
            .timeout(Duration::from_secs(200))
            .no_proxy()
            .build()
            .map_err(|_| "Could not initialize the local backend client.".to_string())?;
        Ok(Self {
            client,
            requests: Mutex::new(RequestState::default()),
        })
    }

    async fn json(
        &self,
        connection: &crate::backend_lifecycle::BackendConnection,
        identity: RequestIdentity<'_>,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
        timeout: Duration,
    ) -> Result<Value, BackendCommandError> {
        let token = self.claim(identity.request_id, identity.registration_id)?;
        let mut request = self
            .client
            .request(method, format!("{}{}", connection.origin, path))
            .header("X-Noto-Backend-Token", &connection.token);
        if let Some(body) = body {
            request = request.json(&body);
        }
        let result = tokio::select! {
            _ = token.cancelled() => Err(BackendCommandError::cancelled()),
            response = request.timeout(timeout).send() => {
                match response {
                    Ok(response) => parse_json_response(response).await,
                    Err(error) => Err(BackendCommandError::from_reqwest(error)),
                }
            }
        };
        self.remove(identity.registration_id);
        result
    }

    fn register(&self, request_id: &str) -> Result<String, BackendCommandError> {
        let mut requests = self
            .requests
            .lock()
            .map_err(|_| BackendCommandError::unavailable())?;
        requests.register(request_id)
    }

    fn claim(
        &self,
        request_id: &str,
        registration_id: &str,
    ) -> Result<CancellationToken, BackendCommandError> {
        let mut requests = self
            .requests
            .lock()
            .map_err(|_| BackendCommandError::unavailable())?;
        requests.claim(request_id, registration_id)
    }

    fn remove(&self, registration_id: &str) {
        if let Ok(mut requests) = self.requests.lock() {
            requests.complete(registration_id);
        }
    }

    pub fn cancel_all(&self) {
        if let Ok(mut requests) = self.requests.lock() {
            for registration in requests.registrations.values() {
                registration.token.cancel();
            }
            requests.registrations.clear();
            requests.request_ids.clear();
        }
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

    fn unavailable() -> Self {
        Self {
            code: "unavailable",
            message: "The local backend is unavailable.".into(),
            status: None,
        }
    }
    fn capacity() -> Self {
        Self {
            code: "capacity",
            message: "Too many backend requests are registered.".into(),
            status: None,
        }
    }
    fn cancelled() -> Self {
        Self {
            code: "cancelled",
            message: "The backend request was cancelled.".into(),
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

fn validate_request_id(request_id: &str) -> Result<(), BackendCommandError> {
    if request_id.is_empty()
        || request_id.len() > 64
        || !request_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err(BackendCommandError::invalid("The request ID is invalid."));
    }
    Ok(())
}

fn ready(
    lifecycle: &crate::backend_lifecycle::BackendLifecycle,
) -> Result<crate::backend_lifecycle::BackendConnection, BackendCommandError> {
    lifecycle
        .ready_connection()
        .map_err(|message| BackendCommandError {
            code: "unavailable",
            message,
            status: None,
        })
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

/// Creates a one-use server registration for a client request ID. The returned
/// nonce is the cancellation identity and must accompany the matching request.
#[tauri::command]
pub fn backend_register_request(
    state: State<'_, BackendBridge>,
    request_id: String,
) -> Result<String, BackendCommandError> {
    state.register(&request_id)
}

#[tauri::command]
pub async fn backend_start_session(
    state: State<'_, BackendBridge>,
    lifecycle: State<'_, crate::backend_lifecycle::BackendLifecycle>,
    request_id: String,
    registration_id: String,
) -> Result<Value, BackendCommandError> {
    let connection = ready(&lifecycle)?;
    state
        .json(
            &connection,
            RequestIdentity {
                request_id: &request_id,
                registration_id: &registration_id,
            },
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
    lifecycle: State<'_, crate::backend_lifecycle::BackendLifecycle>,
    request_id: String,
    registration_id: String,
    session_id: String,
) -> Result<Value, BackendCommandError> {
    let connection = ready(&lifecycle)?;
    validate_session_id(&session_id)?;
    state
        .json(
            &connection,
            RequestIdentity {
                request_id: &request_id,
                registration_id: &registration_id,
            },
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
    lifecycle: State<'_, crate::backend_lifecycle::BackendLifecycle>,
    request_id: String,
    registration_id: String,
    session_id: String,
) -> Result<Value, BackendCommandError> {
    let connection = ready(&lifecycle)?;
    validate_session_id(&session_id)?;
    state
        .json(
            &connection,
            RequestIdentity {
                request_id: &request_id,
                registration_id: &registration_id,
            },
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
    lifecycle: State<'_, crate::backend_lifecycle::BackendLifecycle>,
    request_id: String,
    registration_id: String,
    session_id: String,
    regenerate: bool,
) -> Result<Value, BackendCommandError> {
    let connection = ready(&lifecycle)?;
    validate_session_id(&session_id)?;
    state
        .json(
            &connection,
            RequestIdentity {
                request_id: &request_id,
                registration_id: &registration_id,
            },
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
    lifecycle: State<'_, crate::backend_lifecycle::BackendLifecycle>,
    request_id: String,
    registration_id: String,
    chunk: AudioChunkRequest,
) -> Result<Value, BackendCommandError> {
    let connection = ready(&lifecycle)?;
    validate_session_id(&chunk.session_id)?;
    if chunk.sample_rate != 16_000 || chunk.channels != 1 {
        return Err(BackendCommandError::invalid(
            "Audio must be 16 kHz mono PCM16.",
        ));
    }
    if chunk.bytes.is_empty()
        || chunk.bytes.len() > MAX_AUDIO_BYTES
        || !chunk.bytes.len().is_multiple_of(2)
    {
        return Err(BackendCommandError::invalid(
            "The PCM16 audio payload is invalid.",
        ));
    }
    let token = state.claim(&request_id, &registration_id)?;
    let request = state
        .client
        .post(format!("{}/api/audio/chunks", connection.origin))
        .timeout(Duration::from_secs(4))
        .header("X-Noto-Backend-Token", &connection.token)
        .header("Content-Type", "application/octet-stream")
        .header("X-Noto-Channels", u16::from(chunk.channels))
        .header("X-Noto-Sample-Rate", chunk.sample_rate)
        .header("X-Noto-Sequence", chunk.sequence)
        .header("X-Noto-Session-Id", &chunk.session_id)
        .body(chunk.bytes);
    let result = tokio::select! {
        _ = token.cancelled() => Err(BackendCommandError::cancelled()),
        response = request.send() => {
            match response {
                Ok(response) => parse_json_response(response).await,
                Err(error) => Err(BackendCommandError::from_reqwest(error)),
            }
        }
    };
    state.remove(&registration_id);
    result
}

#[tauri::command]
pub fn backend_cancel_request(
    state: State<'_, BackendBridge>,
    registration_id: String,
) -> Result<(), BackendCommandError> {
    state
        .requests
        .lock()
        .map_err(|_| BackendCommandError::unavailable())?
        .cancel(&registration_id);
    Ok(())
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

    fn connection(origin: String) -> crate::backend_lifecycle::BackendConnection {
        crate::backend_lifecycle::BackendConnection {
            origin,
            token: "test-token".into(),
        }
    }

    #[test]
    fn rejects_unsafe_session_ids() {
        assert!(validate_session_id("valid-session_1").is_ok());
        assert!(validate_session_id("../health").is_err());
        assert!(validate_session_id("").is_err());
    }

    #[test]
    fn rejects_unsafe_request_ids() {
        assert!(validate_request_id("request-1").is_ok());
        assert!(validate_request_id("../request").is_err());
    }

    #[test]
    fn cancellation_before_dispatch_is_fail_closed() {
        let mut state = RequestState::default();
        let registration_id = state.register("early").unwrap();
        state.cancel(&registration_id);
        let error = state.claim("early", &registration_id).unwrap_err();
        assert_eq!(error.code, "cancelled");
        assert!(state.registrations.is_empty());
    }

    #[test]
    fn registration_before_cancellation_cancels_active_token() {
        let mut state = RequestState::default();
        let registration_id = state.register("active").unwrap();
        let token = state.claim("active", &registration_id).unwrap();
        state.cancel(&registration_id);
        assert!(token.is_cancelled());
    }

    #[test]
    fn duplicate_cancellation_is_idempotent() {
        let mut state = RequestState::default();
        let registration_id = state.register("duplicate").unwrap();
        state.cancel(&registration_id);
        state.cancel(&registration_id);
        assert!(state.registrations.is_empty());
        assert!(state.request_ids.is_empty());
    }

    #[test]
    fn duplicate_registration_is_rejected() {
        let mut state = RequestState::default();
        state.register("used").unwrap();
        assert_eq!(state.register("used").unwrap_err().code, "validation");
    }

    #[test]
    fn stale_cancellation_cannot_affect_reused_client_id() {
        let mut state = RequestState::default();
        let old_registration = state.register("reused").unwrap();
        state.claim("reused", &old_registration).unwrap();
        state.complete(&old_registration);
        let new_registration = state.register("reused").unwrap();
        assert_ne!(old_registration, new_registration);
        state.cancel(&old_registration);
        assert!(state.claim("reused", &new_registration).is_ok());
    }

    #[test]
    fn capacity_exhaustion_rejects_without_eviction() {
        let mut state = RequestState::default();
        for index in 0..MAX_CONCURRENT_REQUESTS {
            state.register(&format!("pending-{index}")).unwrap();
        }
        assert_eq!(
            state.register("over-capacity").unwrap_err().code,
            "capacity"
        );
        assert_eq!(state.registrations.len(), MAX_CONCURRENT_REQUESTS);
    }

    #[test]
    fn more_than_1024_sequential_requests_are_cleaned_up() {
        let mut state = RequestState::default();
        for index in 0..(MAX_CONCURRENT_REQUESTS + 100) {
            let request_id = format!("sequential-{index}");
            let registration_id = state.register(&request_id).unwrap();
            state.claim(&request_id, &registration_id).unwrap();
            state.complete(&registration_id);
        }
        assert!(state.registrations.is_empty());
        assert!(state.request_ids.is_empty());
    }

    #[test]
    fn more_than_1024_cancellations_do_not_accumulate_state() {
        let mut state = RequestState::default();
        for index in 0..(MAX_CONCURRENT_REQUESTS + 100) {
            let request_id = format!("cancel-{index}");
            let registration_id = state.register(&request_id).unwrap();
            state.cancel(&registration_id);
            state.cancel(&registration_id);
        }
        assert!(state.registrations.is_empty());
        assert!(state.request_ids.is_empty());
    }

    #[tokio::test]
    async fn pending_cancellation_does_not_dispatch_http_request() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let bridge = BackendBridge::new().unwrap();
        let registration_id = bridge.register("cancelled-before-send").unwrap();
        bridge.requests.lock().unwrap().cancel(&registration_id);
        let error = bridge
            .json(
                &connection(format!("http://{}", listener.local_addr().unwrap())),
                RequestIdentity {
                    request_id: "cancelled-before-send",
                    registration_id: &registration_id,
                },
                reqwest::Method::GET,
                "/must-not-dispatch",
                None,
                Duration::from_millis(100),
            )
            .await
            .unwrap_err();
        assert_eq!(error.code, "cancelled");
        thread::sleep(Duration::from_millis(20));
        assert!(listener.accept().is_err());
    }

    #[tokio::test]
    async fn accepts_successful_json_response() {
        let origin = mock_http("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 11\r\n\r\n{\"ok\":true}");
        let bridge = BackendBridge::new().unwrap();
        let registration_id = bridge.register("request-json").unwrap();
        let result = bridge
            .json(
                &connection(origin),
                RequestIdentity {
                    request_id: "request-json",
                    registration_id: &registration_id,
                },
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
        let bridge = BackendBridge::new().unwrap();
        let registration_id = bridge.register("request-error").unwrap();
        let error = bridge
            .json(
                &connection(origin),
                RequestIdentity {
                    request_id: "request-error",
                    registration_id: &registration_id,
                },
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
        let bridge = BackendBridge::new().unwrap();
        let registration_id = bridge.register("request-invalid").unwrap();
        let error = bridge
            .json(
                &connection(origin),
                RequestIdentity {
                    request_id: "request-invalid",
                    registration_id: &registration_id,
                },
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
    async fn request_failure_cleans_up_registration() {
        let origin = "http://127.0.0.1:0".to_string();
        let bridge = BackendBridge::new().unwrap();
        let registration_id = bridge.register("request-unavailable").unwrap();
        let error = bridge
            .json(
                &connection(origin),
                RequestIdentity {
                    request_id: "request-unavailable",
                    registration_id: &registration_id,
                },
                reqwest::Method::GET,
                "/health",
                None,
                Duration::from_millis(100),
            )
            .await
            .unwrap_err();
        assert!(matches!(error.code, "unavailable" | "timeout"));
        assert!(bridge.requests.lock().unwrap().registrations.is_empty());
    }
}
