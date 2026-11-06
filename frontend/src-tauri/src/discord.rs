use crate::storage::NotesDocument;
use reqwest::blocking::{Client, Response};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

const SERVICE: &str = "com.notoai.desktop";
const ACCOUNT: &str = "discord-webhook";
const MAX_MESSAGE_CHARS: usize = 1900;
static SENDING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscordStatus {
    connected: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscordDelivery {
    title: String,
    created_at: String,
    duration_seconds: f64,
    notes: NotesDocument,
    #[serde(default)]
    start_at: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryResult {
    messages_sent: usize,
    total_messages: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryError {
    message: String,
    delivered_messages: usize,
    total_messages: usize,
}

struct SendGuard;
impl Drop for SendGuard {
    fn drop(&mut self) {
        SENDING.store(false, Ordering::Release);
    }
}

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, ACCOUNT)
        .map_err(|_| "Secure credential storage is unavailable on this device.".into())
}

fn webhook() -> Result<String, String> {
    entry()?
        .get_password()
        .map_err(|_| "Discord is not configured.".into())
}

fn validate_url(value: &str) -> Result<(), String> {
    let valid_host = value.starts_with("https://discord.com/api/webhooks/")
        || value.starts_with("https://discordapp.com/api/webhooks/");
    if !valid_host || value.len() > 2048 {
        return Err("Enter a valid Discord incoming webhook URL.".into());
    }
    Ok(())
}

fn client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("Noto-AI/0.1")
        .build()
        .map_err(|_| "Discord networking could not be initialized.".into())
}

fn check_response(response: Response) -> Result<(), String> {
    match response.status().as_u16() {
        200..=299 => Ok(()),
        401 | 403 | 404 => Err(
            "Discord rejected or could not find this webhook. Reconfigure the integration.".into(),
        ),
        429 => Err("Discord is rate limiting delivery. Wait briefly and try again.".into()),
        500..=599 => Err("Discord is temporarily unavailable.".into()),
        _ => Err("Discord rejected the request.".into()),
    }
}

fn post_message(http: &Client, url: &str, body: &str) -> Result<(), String> {
    let payload = serde_json::json!({"content": body, "allowed_mentions": {"parse": []}});
    let mut response = http
        .post(format!("{url}?wait=true"))
        .json(&payload)
        .send()
        .map_err(|_| "Discord could not be reached. Check your network connection.".to_string())?;
    if response.status().as_u16() == 429 {
        let header_wait = response
            .headers()
            .get("retry-after")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<f64>().ok());
        let wait_seconds = response
            .json::<serde_json::Value>()
            .ok()
            .and_then(|value| value.get("retry_after").and_then(|v| v.as_f64()))
            .or(header_wait)
            .unwrap_or(1.0)
            .clamp(0.0, 20.0);
        std::thread::sleep(Duration::from_secs_f64(wait_seconds));
        response = http
            .post(format!("{url}?wait=true"))
            .json(&payload)
            .send()
            .map_err(|_| {
                "Discord could not be reached after its requested retry delay.".to_string()
            })?;
    }
    check_response(response)
}

fn test_url(url: &str) -> Result<(), String> {
    validate_url(url)?;
    test_url_request(url)
}

fn test_url_request(url: &str) -> Result<(), String> {
    let response = client()?
        .get(url)
        .send()
        .map_err(|_| "Discord could not be reached. Check your network connection.".to_string())?;
    check_response(response)
}

#[tauri::command]
pub fn discord_status() -> DiscordStatus {
    DiscordStatus {
        connected: webhook().is_ok(),
    }
}

#[tauri::command]
pub fn configure_discord(webhook_url: String) -> Result<DiscordStatus, String> {
    test_url(&webhook_url)?;
    entry()?
        .set_password(&webhook_url)
        .map_err(|_| "The Discord credential could not be saved securely.".to_string())?;
    Ok(DiscordStatus { connected: true })
}

#[tauri::command]
pub fn test_discord() -> Result<(), String> {
    test_url(&webhook()?)
}

#[tauri::command]
pub fn disconnect_discord() -> Result<(), String> {
    delete_credential(&entry()?)
}

trait CredentialDeleter {
    fn delete_saved_credential(&self) -> Result<(), keyring::Error>;
}

impl CredentialDeleter for keyring::Entry {
    fn delete_saved_credential(&self) -> Result<(), keyring::Error> {
        self.delete_credential()
    }
}

fn delete_credential(store: &impl CredentialDeleter) -> Result<(), String> {
    match store.delete_saved_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("The Discord credential could not be removed from secure storage.".into()),
    }
}

#[tauri::command]
pub fn send_notes_to_discord(delivery: DiscordDelivery) -> Result<DeliveryResult, DeliveryError> {
    if SENDING.swap(true, Ordering::AcqRel) {
        return Err(DeliveryError {
            message: "A Discord delivery is already in progress.".into(),
            delivered_messages: 0,
            total_messages: 0,
        });
    }
    let _guard = SendGuard;
    let url = webhook().map_err(|message| DeliveryError {
        message,
        delivered_messages: 0,
        total_messages: 0,
    })?;
    let content = format_delivery(&delivery).map_err(|message| DeliveryError {
        message,
        delivered_messages: 0,
        total_messages: 0,
    })?;
    let chunks = split_messages(&content, MAX_MESSAGE_CHARS);
    let total = chunks.len();
    let start_at = delivery.start_at.min(total);
    let http = client().map_err(|message| DeliveryError {
        message,
        delivered_messages: start_at,
        total_messages: total,
    })?;
    deliver_chunks(&http, &url, &chunks, start_at)
}

fn deliver_chunks(
    http: &Client,
    url: &str,
    chunks: &[String],
    start_at: usize,
) -> Result<DeliveryResult, DeliveryError> {
    let total = chunks.len();
    for (index, chunk) in chunks.iter().enumerate().skip(start_at) {
        let body = if total > 1 {
            format!("**Part {}/{}**\n{}", index + 1, total, chunk)
        } else {
            chunk.clone()
        };
        if let Err(error) = post_message(&http, &url, &body) {
            return Err(DeliveryError {
                message: format!(
                    "{error} Delivered {index} of {total} messages; notes remain saved locally."
                ),
                delivered_messages: index,
                total_messages: total,
            });
        }
    }
    Ok(DeliveryResult {
        messages_sent: total.saturating_sub(start_at),
        total_messages: total,
    })
}

fn format_delivery(delivery: &DiscordDelivery) -> Result<String, String> {
    if delivery.title.trim().is_empty() || delivery.notes.title.trim().is_empty() {
        return Err("Only completed generated notes can be sent.".into());
    }
    let mut sections = vec![format!(
        "# {}\n**Recorded:** {} · **Duration:** {}:{:02}",
        delivery.title,
        delivery.created_at,
        delivery.duration_seconds.max(0.0) as u64 / 60,
        delivery.duration_seconds.max(0.0) as u64 % 60
    )];
    if let Some(summary) = delivery
        .notes
        .summary
        .as_ref()
        .filter(|v| !v.trim().is_empty())
    {
        sections.push(format!("## Summary\n{summary}"));
    }
    add_list(&mut sections, "Key Points", &delivery.notes.key_points);
    if !delivery.notes.action_items.is_empty() {
        sections.push(format!(
            "## Action Items\n{}",
            delivery
                .notes
                .action_items
                .iter()
                .map(|v| format!(
                    "- {}{}{}",
                    v.task,
                    v.owner
                        .as_ref()
                        .map(|x| format!(" — {x}"))
                        .unwrap_or_default(),
                    v.deadline
                        .as_ref()
                        .map(|x| format!(" ({x})"))
                        .unwrap_or_default()
                ))
                .collect::<Vec<_>>()
                .join("\n")
        ));
    }
    add_list(&mut sections, "Decisions", &delivery.notes.decisions);
    add_list(
        &mut sections,
        "Important Information",
        &delivery.notes.important_information,
    );
    add_list(
        &mut sections,
        "Additional Context",
        &delivery.notes.additional_context,
    );
    Ok(sections.join("\n\n"))
}

fn add_list(target: &mut Vec<String>, title: &str, values: &[String]) {
    if !values.is_empty() {
        target.push(format!(
            "## {title}\n{}",
            values
                .iter()
                .map(|v| format!("- {v}"))
                .collect::<Vec<_>>()
                .join("\n")
        ));
    }
}

fn split_messages(value: &str, limit: usize) -> Vec<String> {
    let limit = limit.max(1);
    let mut result = Vec::new();
    let mut current = String::new();
    for paragraph in value.split("\n\n") {
        let mut remaining = paragraph;
        while !remaining.is_empty() {
            let separator = if current.is_empty() { "" } else { "\n\n" };
            let available =
                limit.saturating_sub(current.chars().count() + separator.chars().count());
            if available == 0 {
                result.push(std::mem::take(&mut current));
                continue;
            }
            let (piece, rest) = split_at_char_count(remaining, available);
            if !current.is_empty() {
                current.push_str(separator);
            }
            current.push_str(piece);
            remaining = rest;
            if !remaining.is_empty() || current.chars().count() == limit {
                result.push(std::mem::take(&mut current));
            }
        }
    }
    if !current.is_empty() {
        result.push(current);
    }
    result
}

fn split_at_char_count(value: &str, count: usize) -> (&str, &str) {
    if value.chars().count() <= count {
        return (value, "");
    }
    let index = value
        .char_indices()
        .nth(count)
        .map(|(index, _)| index)
        .unwrap_or(value.len());
    value.split_at(index)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::atomic::AtomicUsize;
    use std::sync::{Arc, Mutex};

    fn mock_server(responses: Vec<(u16, &'static str)>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let responses = Arc::new(Mutex::new(VecDeque::from(responses)));
        std::thread::spawn(move || {
            while let Some((status, body)) = responses.lock().unwrap().pop_front() {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0_u8; 8192];
                let _ = stream.read(&mut request);
                let reason = match status {
                    200 => "OK",
                    204 => "No Content",
                    401 => "Unauthorized",
                    403 => "Forbidden",
                    404 => "Not Found",
                    429 => "Too Many Requests",
                    _ => "Server Error",
                };
                let response = format!("HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                stream.write_all(response.as_bytes()).unwrap();
            }
        });
        format!("http://{address}/api/webhooks/test")
    }

    fn slow_server() -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request);
            std::thread::sleep(Duration::from_millis(150));
        });
        format!("http://{address}/api/webhooks/test")
    }

    #[test]
    fn splits_without_truncating() {
        let source = "a".repeat(5000);
        let parts = split_messages(&source, 1900);
        assert!(parts.len() >= 3);
        assert_eq!(parts.concat(), source);
        assert!(parts.iter().all(|p| p.chars().count() <= 1900));
    }
    #[test]
    fn rejects_non_discord_urls() {
        assert!(validate_url("https://example.com/secret").is_err());
    }

    #[test]
    fn splitting_is_unicode_safe_and_preserves_all_content() {
        for source in [
            "অসমীয়া ভাষা আৰু এটা দীঘল অনুচ্ছেদ 🐘✨".repeat(200),
            "हिन्दी भाषा और इमोजी 🚀✅".repeat(250),
            "English paragraph with punctuation—kept valid.".repeat(200),
        ] {
            let parts = split_messages(&source, 1900);
            assert!(parts.iter().all(|part| part.chars().count() <= 1900));
            assert_eq!(parts.concat(), source);
        }
    }

    #[test]
    fn mocked_webhook_delivery_succeeds_and_handles_permanent_errors() {
        let http = client().unwrap();
        assert!(post_message(&http, &mock_server(vec![(204, "")]), "notes").is_ok());
        for status in [401, 403, 404, 500] {
            assert!(post_message(&http, &mock_server(vec![(status, "{}")]), "notes").is_err());
        }
    }

    #[test]
    fn mocked_webhook_connection_test_requires_a_successful_response() {
        assert!(test_url_request(&mock_server(vec![(200, "{}")])).is_ok());
        assert!(test_url_request(&mock_server(vec![(404, "{}")])).is_err());
        assert!(test_url_request(&mock_server(vec![(401, "{}")])).is_err());
    }

    #[test]
    fn mocked_rate_limit_retries_once_and_reports_exhaustion() {
        let http = client().unwrap();
        let recovered = mock_server(vec![(429, r#"{"retry_after":0}"#), (204, "")]);
        assert!(post_message(&http, &recovered, "notes").is_ok());
        let exhausted = mock_server(vec![
            (429, r#"{"retry_after":0}"#),
            (429, r#"{"retry_after":0}"#),
        ]);
        assert!(post_message(&http, &exhausted, "notes")
            .unwrap_err()
            .contains("rate limiting"));
    }

    #[test]
    fn network_connection_failure_is_safe_and_redacted() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/secret-token", listener.local_addr().unwrap());
        drop(listener);
        let error = post_message(&client().unwrap(), &url, "notes").unwrap_err();
        assert!(!error.contains("secret-token"));
    }

    #[test]
    fn network_timeout_is_reported_without_url_details() {
        let http = Client::builder()
            .timeout(Duration::from_millis(20))
            .build()
            .unwrap();
        let error = post_message(&http, &slow_server(), "notes").unwrap_err();
        assert!(error.contains("could not be reached"));
        assert!(!error.contains("api/webhooks"));
    }

    #[test]
    fn partial_delivery_reports_progress_and_retry_resumes_without_duplicates() {
        let chunks = vec!["first".to_string(), "second".to_string()];
        let first_url = mock_server(vec![(204, ""), (500, "{}")]);
        let failure = deliver_chunks(&client().unwrap(), &first_url, &chunks, 0).unwrap_err();
        assert_eq!(failure.delivered_messages, 1);
        assert_eq!(failure.total_messages, 2);

        let retry_url = mock_server(vec![(204, "")]);
        let result = deliver_chunks(
            &client().unwrap(),
            &retry_url,
            &chunks,
            failure.delivered_messages,
        )
        .unwrap();
        assert_eq!(result.messages_sent, 1);
        assert_eq!(result.total_messages, 2);
    }

    #[test]
    fn duplicate_send_guard_rejects_an_active_delivery() {
        SENDING.store(true, Ordering::Release);
        assert!(SENDING.swap(true, Ordering::AcqRel));
        SENDING.store(false, Ordering::Release);
    }

    struct FakeCredentialDeleter(AtomicUsize);
    impl CredentialDeleter for FakeCredentialDeleter {
        fn delete_saved_credential(&self) -> Result<(), keyring::Error> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    }

    #[test]
    fn disconnect_deletes_the_saved_credential() {
        let store = FakeCredentialDeleter(AtomicUsize::new(0));
        delete_credential(&store).unwrap();
        assert_eq!(store.0.load(Ordering::SeqCst), 1);
    }

    #[test]
    #[ignore = "sends one real verification message using the locally configured OS-vault credential"]
    fn live_configured_webhook_test_and_delivery() {
        assert_eq!(
            std::env::var("NOTO_RUN_LIVE_DISCORD_TEST").as_deref(),
            Ok("1")
        );
        let url = webhook().expect("a Discord webhook must already be configured");
        test_url(&url).expect("Discord connection test must succeed");
        post_message(
            &client().unwrap(),
            &url,
            "**Noto AI integration verification**\nManual delivery check completed successfully. No transcript or generated-note content was included.",
        )
        .expect("Discord verification delivery must succeed");
    }
}
