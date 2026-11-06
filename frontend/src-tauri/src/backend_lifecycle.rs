use serde::Serialize;
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::AppHandle;
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum BackendPhase {
    Starting,
    Ready,
    Failed,
    Stopping,
    Stopped,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendStatus {
    pub phase: BackendPhase,
    pub message: Option<String>,
}

#[derive(Clone)]
pub struct BackendLifecycle {
    status: Arc<Mutex<BackendStatus>>,
    child: Arc<Mutex<Option<CommandChild>>>,
}

impl BackendLifecycle {
    pub fn new() -> Self {
        Self {
            status: Arc::new(Mutex::new(BackendStatus {
                phase: BackendPhase::Stopped,
                message: None,
            })),
            child: Arc::new(Mutex::new(None)),
        }
    }

    pub fn start(&self, app: &AppHandle) -> Result<(), String> {
        let mut child_guard = self
            .child
            .lock()
            .map_err(|_| "Backend process lock failed.")?;
        if child_guard.is_some() {
            return Ok(());
        }
        if reqwest::blocking::Client::builder()
            .no_proxy()
            .timeout(Duration::from_millis(500))
            .build()
            .and_then(|client| client.get("http://127.0.0.1:8765/health").send())
            .is_ok_and(|response| response.status().is_success())
        {
            self.set_status(BackendPhase::Ready, None);
            return Ok(());
        }
        self.set_status(BackendPhase::Starting, None);
        let command = app
            .shell()
            .sidecar("noto-backend")
            .map_err(|_| "The packaged backend executable is unavailable.".to_string())?;
        let (mut events, child) = command
            .env("NOTO_BACKEND_PORT", "8765")
            .spawn()
            .map_err(|_| "The packaged backend could not be started.".to_string())?;
        *child_guard = Some(child);
        drop(child_guard);

        let lifecycle = self.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(event) = events.recv().await {
                if let CommandEvent::Terminated(payload) = event {
                    let stopping = lifecycle.status().phase == BackendPhase::Stopping;
                    if !stopping {
                        lifecycle.set_status(
                            BackendPhase::Failed,
                            Some(format!(
                                "The local backend stopped unexpectedly (code {:?}).",
                                payload.code
                            )),
                        );
                    }
                    if let Ok(mut child) = lifecycle.child.lock() {
                        *child = None;
                    }
                    break;
                }
            }
        });

        let lifecycle = self.clone();
        tauri::async_runtime::spawn(async move {
            let client = match reqwest::Client::builder()
                .no_proxy()
                .timeout(Duration::from_secs(1))
                .build()
            {
                Ok(client) => client,
                Err(_) => {
                    lifecycle.fail_and_stop("Could not initialize the backend health check.");
                    return;
                }
            };
            for _ in 0..40 {
                if lifecycle.status().phase != BackendPhase::Starting {
                    return;
                }
                if let Ok(response) = client.get("http://127.0.0.1:8765/health").send().await {
                    if response.status().is_success() {
                        lifecycle.set_status(BackendPhase::Ready, None);
                        return;
                    }
                }
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
            lifecycle.fail_and_stop("The local backend did not become ready within 10 seconds.");
        });
        Ok(())
    }

    pub fn stop(&self) {
        self.set_status(BackendPhase::Stopping, None);
        if let Ok(mut guard) = self.child.lock() {
            if let Some(child) = guard.take() {
                let _ = child.kill();
            }
        }
        self.set_status(BackendPhase::Stopped, None);
    }

    fn fail_and_stop(&self, message: &str) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(child) = guard.take() {
                let _ = child.kill();
            }
        }
        self.set_status(BackendPhase::Failed, Some(message.to_string()));
    }

    fn set_status(&self, phase: BackendPhase, message: Option<String>) {
        if let Ok(mut status) = self.status.lock() {
            *status = BackendStatus { phase, message };
        }
    }

    pub fn status(&self) -> BackendStatus {
        self.status
            .lock()
            .map(|status| status.clone())
            .unwrap_or(BackendStatus {
                phase: BackendPhase::Failed,
                message: Some("Backend lifecycle state is unavailable.".into()),
            })
    }
}

#[tauri::command]
pub fn backend_status(lifecycle: tauri::State<'_, BackendLifecycle>) -> BackendStatus {
    lifecycle.status()
}

#[tauri::command]
pub fn backend_restart(
    app: AppHandle,
    lifecycle: tauri::State<'_, BackendLifecycle>,
) -> Result<(), String> {
    lifecycle.stop();
    lifecycle.start(&app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lifecycle_has_explicit_stopped_initial_state() {
        let lifecycle = BackendLifecycle::new();
        assert_eq!(lifecycle.status().phase, BackendPhase::Stopped);
    }

    #[test]
    fn duplicate_state_does_not_leak_sensitive_output() {
        let lifecycle = BackendLifecycle::new();
        lifecycle.set_status(BackendPhase::Failed, Some("Backend failed.".into()));
        assert_eq!(
            lifecycle.status().message.as_deref(),
            Some("Backend failed.")
        );
    }
}
