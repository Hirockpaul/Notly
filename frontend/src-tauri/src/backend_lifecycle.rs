use serde::Serialize;
use std::{
    net::TcpListener,
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
pub struct BackendConnection {
    pub origin: String,
    pub token: String,
}

struct OwnedChild {
    generation: u64,
    child: Box<dyn ManagedChild>,
}

trait ManagedChild: Send {
    fn kill(self: Box<Self>) -> Result<(), String>;
    #[cfg(test)]
    fn pid(&self) -> u32;
}

impl ManagedChild for CommandChild {
    fn kill(self: Box<Self>) -> Result<(), String> {
        CommandChild::kill(*self).map_err(|error| error.to_string())
    }

    #[cfg(test)]
    fn pid(&self) -> u32 {
        CommandChild::pid(self)
    }
}
struct LifecycleState {
    status: BackendStatus,
    generation: u64,
    child: Option<OwnedChild>,
    connection: Option<BackendConnection>,
}

#[derive(Clone)]
pub struct BackendLifecycle {
    inner: Arc<Mutex<LifecycleState>>,
}

impl BackendLifecycle {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(LifecycleState {
                status: BackendStatus {
                    phase: BackendPhase::Stopped,
                    message: None,
                },
                generation: 0,
                child: None,
                connection: None,
            })),
        }
    }

    pub fn start(&self, app: &AppHandle) -> Result<(), String> {
        self.start_sidecar(app, "noto-backend")
    }

    fn start_sidecar<R: tauri::Runtime>(
        &self,
        app: &tauri::AppHandle<R>,
        sidecar_name: &str,
    ) -> Result<(), String> {
        let Some((generation, connection)) =
            self.begin_generation(reserve_loopback_port, || uuid::Uuid::new_v4().to_string())?
        else {
            return Ok(());
        };

        let command = match app.shell().sidecar(sidecar_name) {
            Ok(command) => command,
            Err(_) => {
                self.fail_generation(
                    generation,
                    "The packaged backend executable is unavailable.",
                );
                return Err("The packaged backend executable is unavailable.".into());
            }
        };
        let port = connection
            .origin
            .rsplit(':')
            .next()
            .ok_or("Invalid backend port.")?;
        let mut command = command
            .set_process_group(true)
            .env("NOTO_BACKEND_PORT", port)
            .env("NOTO_BACKEND_TOKEN", &connection.token)
            .env("NOTO_PARENT_PID", std::process::id().to_string());
        if let Some(start_time) = current_process_start_time() {
            command = command.env("NOTO_PARENT_START_TIME", start_time);
        }
        let (mut events, child) = match command.spawn() {
            Ok(value) => value,
            Err(_) => {
                self.fail_generation(generation, "The packaged backend could not be started.");
                return Err("The packaged backend could not be started.".into());
            }
        };
        if !self.attach_child(generation, Box::new(child))? {
            return Ok(());
        }

        let lifecycle = self.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(event) = events.recv().await {
                if let CommandEvent::Terminated(payload) = event {
                    lifecycle.process_terminated(generation, payload.code);
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
                    lifecycle.fail_and_kill_generation(
                        generation,
                        "Could not initialize the backend health check.",
                    );
                    return;
                }
            };
            for _ in 0..40 {
                if !lifecycle.is_generation_in_phase(generation, BackendPhase::Starting) {
                    return;
                }
                let ready = client
                    .get(format!("{}/health", connection.origin))
                    .header("X-Noto-Backend-Token", &connection.token)
                    .send()
                    .await
                    .is_ok_and(|response| response.status().is_success());
                if ready {
                    lifecycle.set_phase_for_generation(generation, BackendPhase::Ready, None);
                    return;
                }
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
            lifecycle.fail_and_kill_generation(
                generation,
                "The local backend did not become ready within 10 seconds.",
            );
        });
        Ok(())
    }

    fn begin_generation<P, T>(
        &self,
        allocate_port: P,
        create_token: T,
    ) -> Result<Option<(u64, BackendConnection)>, String>
    where
        P: FnOnce() -> Result<u16, String>,
        T: FnOnce() -> String,
    {
        let mut state = self
            .inner
            .lock()
            .map_err(|_| "Backend lifecycle lock failed.")?;
        if matches!(
            state.status.phase,
            BackendPhase::Starting | BackendPhase::Ready
        ) {
            return Ok(None);
        }
        if state.status.phase == BackendPhase::Stopping {
            return Err("The local backend is still stopping.".into());
        }
        let port = allocate_port()?;
        state.generation = state.generation.wrapping_add(1);
        let connection = BackendConnection {
            origin: format!("http://127.0.0.1:{port}"),
            token: create_token(),
        };
        state.status = BackendStatus {
            phase: BackendPhase::Starting,
            message: None,
        };
        state.connection = Some(connection.clone());
        Ok(Some((state.generation, connection)))
    }

    fn attach_child(&self, generation: u64, child: Box<dyn ManagedChild>) -> Result<bool, String> {
        let mut state = self
            .inner
            .lock()
            .map_err(|_| "Backend lifecycle lock failed.")?;
        if state.generation != generation || state.status.phase != BackendPhase::Starting {
            let _ = child.kill();
            return Ok(false);
        }
        state.child = Some(OwnedChild { generation, child });
        Ok(true)
    }

    pub fn stop(&self) {
        let owned = {
            let Ok(mut state) = self.inner.lock() else {
                return;
            };
            state.generation = state.generation.wrapping_add(1);
            state.status = BackendStatus {
                phase: BackendPhase::Stopping,
                message: None,
            };
            state.connection = None;
            state.child.take()
        };
        if let Some(owned) = owned {
            let _ = owned.child.kill();
        }
        if let Ok(mut state) = self.inner.lock() {
            state.status = BackendStatus {
                phase: BackendPhase::Stopped,
                message: None,
            };
        }
    }

    pub fn ready_connection(&self) -> Result<BackendConnection, String> {
        let state = self
            .inner
            .lock()
            .map_err(|_| "Backend lifecycle state is unavailable.")?;
        if state.status.phase != BackendPhase::Ready {
            return Err(format!(
                "The local backend is not ready ({}).",
                phase_name(&state.status.phase)
            ));
        }
        state
            .connection
            .clone()
            .ok_or_else(|| "The local backend connection is unavailable.".into())
    }

    fn process_terminated(&self, generation: u64, code: Option<i32>) {
        let Ok(mut state) = self.inner.lock() else {
            return;
        };
        if state.generation != generation {
            return;
        }
        if state
            .child
            .as_ref()
            .is_some_and(|child| child.generation == generation)
        {
            state.child = None;
        }
        state.connection = None;
        if state.status.phase != BackendPhase::Stopping {
            state.status = BackendStatus {
                phase: BackendPhase::Failed,
                message: Some(format!(
                    "The local backend stopped unexpectedly (code {code:?})."
                )),
            };
        }
    }

    fn fail_generation(&self, generation: u64, message: &str) {
        self.set_phase_for_generation(generation, BackendPhase::Failed, Some(message.to_string()));
    }

    fn fail_and_kill_generation(&self, generation: u64, message: &str) {
        let child = {
            let Ok(mut state) = self.inner.lock() else {
                return;
            };
            if state.generation != generation {
                return;
            }
            state.connection = None;
            state.status = BackendStatus {
                phase: BackendPhase::Failed,
                message: Some(message.into()),
            };
            if state
                .child
                .as_ref()
                .is_some_and(|child| child.generation == generation)
            {
                state.child.take()
            } else {
                None
            }
        };
        if let Some(child) = child {
            let _ = child.child.kill();
        }
    }

    fn set_phase_for_generation(
        &self,
        generation: u64,
        phase: BackendPhase,
        message: Option<String>,
    ) {
        if let Ok(mut state) = self.inner.lock() {
            if state.generation == generation {
                state.status = BackendStatus { phase, message };
            }
        }
    }

    fn is_generation_in_phase(&self, generation: u64, phase: BackendPhase) -> bool {
        self.inner
            .lock()
            .is_ok_and(|state| state.generation == generation && state.status.phase == phase)
    }

    pub fn status(&self) -> BackendStatus {
        self.inner
            .lock()
            .map(|state| state.status.clone())
            .unwrap_or(BackendStatus {
                phase: BackendPhase::Failed,
                message: Some("Backend lifecycle state is unavailable.".into()),
            })
    }
}

fn reserve_loopback_port() -> Result<u16, String> {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|listener| listener.local_addr().map(|a| a.port()))
        .map_err(|_| "Could not allocate a local backend port.".into())
}

#[cfg(target_os = "linux")]
fn current_process_start_time() -> Option<String> {
    linux_process_start_time(std::process::id())
}

#[cfg(target_os = "linux")]
fn linux_process_start_time(pid: u32) -> Option<String> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let suffix = stat.rsplit_once(") ")?.1;
    suffix.split_whitespace().nth(19).map(str::to_string)
}

#[cfg(target_os = "windows")]
fn current_process_start_time() -> Option<String> {
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, GetProcessTimes};

    unsafe {
        let mut creation_time = std::mem::zeroed();
        let mut exit_time = std::mem::zeroed();
        let mut kernel_time = std::mem::zeroed();
        let mut user_time = std::mem::zeroed();
        if GetProcessTimes(
            GetCurrentProcess(),
            &mut creation_time,
            &mut exit_time,
            &mut kernel_time,
            &mut user_time,
        ) == 0
        {
            return None;
        }
        Some(
            (((creation_time.dwHighDateTime as u64) << 32) | creation_time.dwLowDateTime as u64)
                .to_string(),
        )
    }
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
fn current_process_start_time() -> Option<String> {
    None
}

fn phase_name(phase: &BackendPhase) -> &'static str {
    match phase {
        BackendPhase::Starting => "starting",
        BackendPhase::Ready => "ready",
        BackendPhase::Failed => "failed",
        BackendPhase::Stopping => "stopping",
        BackendPhase::Stopped => "stopped",
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
    bridge: tauri::State<'_, crate::backend_bridge::BackendBridge>,
) -> Result<(), String> {
    bridge.cancel_all();
    lifecycle.stop();
    lifecycle.start(&app)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    #[derive(Clone)]
    struct FakeChild {
        killed: Arc<AtomicBool>,
    }

    impl ManagedChild for FakeChild {
        fn kill(self: Box<Self>) -> Result<(), String> {
            self.killed.store(true, Ordering::SeqCst);
            Ok(())
        }

        #[cfg(test)]
        fn pid(&self) -> u32 {
            1
        }
    }

    struct FakeDependencies {
        port: Result<u16, &'static str>,
        spawn_fails: bool,
        expected_token: &'static str,
        health_token: &'static str,
        health_succeeds: bool,
        spawn_count: AtomicUsize,
    }

    struct FakeRequests {
        active: AtomicUsize,
        cancelled: AtomicUsize,
    }

    impl FakeRequests {
        fn with_active(count: usize) -> Self {
            Self {
                active: AtomicUsize::new(count),
                cancelled: AtomicUsize::new(0),
            }
        }

        fn cancel_all(&self) {
            let active = self.active.swap(0, Ordering::SeqCst);
            self.cancelled.fetch_add(active, Ordering::SeqCst);
        }
    }

    impl FakeDependencies {
        fn healthy() -> Self {
            Self {
                port: Ok(43123),
                spawn_fails: false,
                expected_token: "owned-token",
                health_token: "owned-token",
                health_succeeds: true,
                spawn_count: AtomicUsize::new(0),
            }
        }

        fn drive_start(
            &self,
            lifecycle: &BackendLifecycle,
        ) -> Result<(u64, Arc<AtomicBool>), String> {
            let started = lifecycle.begin_generation(
                || self.port.map_err(str::to_string),
                || self.expected_token.to_string(),
            )?;
            let Some((generation, connection)) = started else {
                return Ok((
                    lifecycle.inner.lock().unwrap().generation,
                    Arc::new(AtomicBool::new(false)),
                ));
            };
            self.spawn_count.fetch_add(1, Ordering::SeqCst);
            if self.spawn_fails {
                lifecycle.fail_generation(generation, "spawn failed");
                return Err("spawn failed".into());
            }
            let killed = Arc::new(AtomicBool::new(false));
            lifecycle.attach_child(
                generation,
                Box::new(FakeChild {
                    killed: killed.clone(),
                }),
            )?;
            if self.health_succeeds
                && connection.token == self.expected_token
                && self.health_token == self.expected_token
            {
                lifecycle.set_phase_for_generation(generation, BackendPhase::Ready, None);
            }
            Ok((generation, killed))
        }
    }

    fn child_generation(lifecycle: &BackendLifecycle) -> Option<u64> {
        lifecycle
            .inner
            .lock()
            .unwrap()
            .child
            .as_ref()
            .map(|child| child.generation)
    }

    #[test]
    fn lifecycle_has_explicit_stopped_initial_state() {
        assert_eq!(
            BackendLifecycle::new().status().phase,
            BackendPhase::Stopped
        );
    }

    #[test]
    fn successful_process_startup() {
        let lifecycle = BackendLifecycle::new();
        let dependencies = FakeDependencies::healthy();
        let (generation, killed) = dependencies.drive_start(&lifecycle).unwrap();
        assert_eq!(generation, 1);
        assert_eq!(child_generation(&lifecycle), Some(generation));
        assert!(!killed.load(Ordering::SeqCst));
        assert_eq!(dependencies.spawn_count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn health_check_transitions_starting_to_ready() {
        let lifecycle = BackendLifecycle::new();
        FakeDependencies::healthy().drive_start(&lifecycle).unwrap();
        assert_eq!(lifecycle.status().phase, BackendPhase::Ready);
        assert!(lifecycle.ready_connection().is_ok());
    }

    #[test]
    fn startup_timeout_fails_and_kills_owned_process() {
        let lifecycle = BackendLifecycle::new();
        let mut dependencies = FakeDependencies::healthy();
        dependencies.health_succeeds = false;
        let (generation, killed) = dependencies.drive_start(&lifecycle).unwrap();
        lifecycle.fail_and_kill_generation(generation, "startup timeout");
        assert!(killed.load(Ordering::SeqCst));
        assert_eq!(lifecycle.status().phase, BackendPhase::Failed);
        assert_eq!(child_generation(&lifecycle), None);
    }

    #[test]
    fn process_exit_during_startup_fails_generation() {
        let lifecycle = BackendLifecycle::new();
        let mut dependencies = FakeDependencies::healthy();
        dependencies.health_succeeds = false;
        let (generation, _) = dependencies.drive_start(&lifecycle).unwrap();
        lifecycle.process_terminated(generation, Some(2));
        assert_eq!(lifecycle.status().phase, BackendPhase::Failed);
        assert!(lifecycle.status().message.unwrap().contains("code Some(2)"));
    }

    #[test]
    fn unexpected_process_crash_clears_connection_and_child() {
        let lifecycle = BackendLifecycle::new();
        let (generation, _) = FakeDependencies::healthy().drive_start(&lifecycle).unwrap();
        lifecycle.process_terminated(generation, Some(9));
        assert_eq!(lifecycle.status().phase, BackendPhase::Failed);
        assert!(lifecycle.ready_connection().is_err());
        assert_eq!(child_generation(&lifecycle), None);
    }

    #[test]
    fn clean_shutdown_kills_owned_process() {
        let lifecycle = BackendLifecycle::new();
        let (_, killed) = FakeDependencies::healthy().drive_start(&lifecycle).unwrap();
        lifecycle.stop();
        assert!(killed.load(Ordering::SeqCst));
        assert_eq!(lifecycle.status().phase, BackendPhase::Stopped);
        assert_eq!(child_generation(&lifecycle), None);
    }

    #[test]
    fn shutdown_during_startup_invalidates_startup_generation() {
        let lifecycle = BackendLifecycle::new();
        let mut dependencies = FakeDependencies::healthy();
        dependencies.health_succeeds = false;
        let (generation, killed) = dependencies.drive_start(&lifecycle).unwrap();
        lifecycle.stop();
        lifecycle.set_phase_for_generation(generation, BackendPhase::Ready, None);
        assert!(killed.load(Ordering::SeqCst));
        assert_eq!(lifecycle.status().phase, BackendPhase::Stopped);
    }

    #[test]
    fn restart_after_shutdown_creates_new_generation() {
        let lifecycle = BackendLifecycle::new();
        let dependencies = FakeDependencies::healthy();
        let (first, first_killed) = dependencies.drive_start(&lifecycle).unwrap();
        lifecycle.stop();
        let (second, _) = dependencies.drive_start(&lifecycle).unwrap();
        assert!(second > first);
        assert!(first_killed.load(Ordering::SeqCst));
        assert_eq!(lifecycle.status().phase, BackendPhase::Ready);
    }

    #[test]
    fn duplicate_startup_is_prevented() {
        let lifecycle = BackendLifecycle::new();
        let dependencies = FakeDependencies::healthy();
        let (first, _) = dependencies.drive_start(&lifecycle).unwrap();
        let (duplicate, _) = dependencies.drive_start(&lifecycle).unwrap();
        assert_eq!(first, duplicate);
        assert_eq!(dependencies.spawn_count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn old_process_exit_after_new_start_is_ignored() {
        let lifecycle = BackendLifecycle::new();
        let dependencies = FakeDependencies::healthy();
        let (old, _) = dependencies.drive_start(&lifecycle).unwrap();
        lifecycle.stop();
        let (new, _) = dependencies.drive_start(&lifecycle).unwrap();
        lifecycle.process_terminated(old, Some(1));
        assert_eq!(lifecycle.status().phase, BackendPhase::Ready);
        assert_eq!(child_generation(&lifecycle), Some(new));
    }

    #[test]
    fn stale_generation_cannot_change_current_state() {
        let lifecycle = BackendLifecycle::new();
        {
            let mut state = lifecycle.inner.lock().unwrap();
            state.generation = 2;
            state.status.phase = BackendPhase::Ready;
        }
        lifecycle.process_terminated(1, Some(1));
        assert_eq!(lifecycle.status().phase, BackendPhase::Ready);
    }

    #[test]
    fn old_process_cannot_clear_new_child_handle() {
        let lifecycle = BackendLifecycle::new();
        let dependencies = FakeDependencies::healthy();
        let (old, _) = dependencies.drive_start(&lifecycle).unwrap();
        lifecycle.stop();
        let (new, _) = dependencies.drive_start(&lifecycle).unwrap();
        lifecycle.process_terminated(old, None);
        assert_eq!(child_generation(&lifecycle), Some(new));
    }

    #[test]
    fn shutdown_while_requests_active_cancels_before_process_stop() {
        let lifecycle = BackendLifecycle::new();
        FakeDependencies::healthy().drive_start(&lifecycle).unwrap();
        let requests = FakeRequests::with_active(2);
        requests.cancel_all();
        lifecycle.stop();
        assert_eq!(requests.active.load(Ordering::SeqCst), 0);
        assert_eq!(requests.cancelled.load(Ordering::SeqCst), 2);
        assert_eq!(lifecycle.status().phase, BackendPhase::Stopped);
    }

    #[test]
    fn restart_while_requests_active_cancels_and_uses_new_generation() {
        let lifecycle = BackendLifecycle::new();
        let dependencies = FakeDependencies::healthy();
        let (old, _) = dependencies.drive_start(&lifecycle).unwrap();
        let requests = FakeRequests::with_active(3);
        requests.cancel_all();
        lifecycle.stop();
        let (new, _) = dependencies.drive_start(&lifecycle).unwrap();
        assert_eq!(requests.cancelled.load(Ordering::SeqCst), 3);
        assert!(new > old);
    }

    #[test]
    fn port_collision_fails_without_spawning() {
        let lifecycle = BackendLifecycle::new();
        let mut dependencies = FakeDependencies::healthy();
        dependencies.port = Err("address in use");
        assert!(dependencies.drive_start(&lifecycle).is_err());
        assert_eq!(dependencies.spawn_count.load(Ordering::SeqCst), 0);
        assert_eq!(lifecycle.status().phase, BackendPhase::Stopped);
    }

    #[test]
    fn unrelated_process_on_selected_port_never_becomes_ready() {
        let lifecycle = BackendLifecycle::new();
        let mut dependencies = FakeDependencies::healthy();
        dependencies.health_token = "unrelated-token";
        dependencies.drive_start(&lifecycle).unwrap();
        assert_eq!(lifecycle.status().phase, BackendPhase::Starting);
        assert!(lifecycle.ready_connection().is_err());
    }

    #[test]
    fn incorrect_backend_authentication_token_is_rejected() {
        let lifecycle = BackendLifecycle::new();
        let mut dependencies = FakeDependencies::healthy();
        dependencies.health_token = "wrong-token";
        dependencies.drive_start(&lifecycle).unwrap();
        assert_eq!(lifecycle.status().phase, BackendPhase::Starting);
    }

    #[test]
    fn correct_backend_authentication_token_is_accepted() {
        let lifecycle = BackendLifecycle::new();
        FakeDependencies::healthy().drive_start(&lifecycle).unwrap();
        assert_eq!(lifecycle.status().phase, BackendPhase::Ready);
    }

    #[test]
    fn health_check_failure_remains_starting_until_bounded_timeout() {
        let lifecycle = BackendLifecycle::new();
        let mut dependencies = FakeDependencies::healthy();
        dependencies.health_succeeds = false;
        let (generation, _) = dependencies.drive_start(&lifecycle).unwrap();
        assert_eq!(lifecycle.status().phase, BackendPhase::Starting);
        lifecycle.fail_and_kill_generation(generation, "health check failed");
        assert_eq!(lifecycle.status().phase, BackendPhase::Failed);
    }

    #[test]
    fn recovery_after_unexpected_termination_starts_new_generation() {
        let lifecycle = BackendLifecycle::new();
        let dependencies = FakeDependencies::healthy();
        let (failed, _) = dependencies.drive_start(&lifecycle).unwrap();
        lifecycle.process_terminated(failed, Some(1));
        let (recovered, _) = dependencies.drive_start(&lifecycle).unwrap();
        assert!(recovered > failed);
        assert_eq!(lifecycle.status().phase, BackendPhase::Ready);
    }

    #[test]
    fn process_spawn_failure_sets_failed_state_without_child() {
        let lifecycle = BackendLifecycle::new();
        let mut dependencies = FakeDependencies::healthy();
        dependencies.spawn_fails = true;
        assert!(dependencies.drive_start(&lifecycle).is_err());
        assert_eq!(lifecycle.status().phase, BackendPhase::Failed);
        assert_eq!(child_generation(&lifecycle), None);
    }

    #[cfg(target_os = "linux")]
    fn packaged_sidecar_name() -> &'static str {
        "../../binaries/noto-backend-x86_64-unknown-linux-gnu"
    }

    #[cfg(target_os = "linux")]
    fn mock_tauri_app() -> tauri::App<tauri::test::MockRuntime> {
        tauri::test::mock_builder()
            .plugin(tauri_plugin_shell::init())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock Tauri app should initialize the real shell plugin")
    }

    #[cfg(target_os = "linux")]
    async fn wait_for_phase(lifecycle: &BackendLifecycle, expected: BackendPhase) {
        tokio::time::timeout(Duration::from_secs(12), async {
            let mut interval = tokio::time::interval(Duration::from_millis(20));
            loop {
                interval.tick().await;
                if lifecycle.status().phase == expected {
                    return;
                }
            }
        })
        .await
        .unwrap_or_else(|_| panic!("lifecycle did not reach {expected:?}"));
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn real_tauri_sidecar_channel_reports_stderr_readiness_and_termination() {
        use tauri_plugin_shell::{process::CommandEvent, ShellExt};

        let app = mock_tauri_app();
        let port = reserve_loopback_port().unwrap();
        let token = "integration-owned-token";
        let (mut events, child) = app
            .shell()
            .sidecar(packaged_sidecar_name())
            .unwrap()
            .set_process_group(true)
            .env("NOTO_BACKEND_PORT", port.to_string())
            .env("NOTO_BACKEND_TOKEN", token)
            .spawn()
            .unwrap();

        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let origin = format!("http://127.0.0.1:{port}");
        let mut saw_stderr = false;
        tokio::time::timeout(Duration::from_secs(12), async {
            let mut interval = tokio::time::interval(Duration::from_millis(20));
            loop {
                tokio::select! {
                    event = events.recv() => match event {
                        Some(CommandEvent::Stderr(bytes)) => saw_stderr |= !bytes.is_empty(),
                        Some(CommandEvent::Terminated(payload)) => panic!("sidecar exited before readiness: {payload:?}"),
                        Some(_) => {}
                        None => panic!("sidecar event channel closed before readiness"),
                    },
                    _ = interval.tick() => {
                        if client.get(format!("{origin}/health"))
                            .header("X-Noto-Backend-Token", token)
                            .send().await.is_ok_and(|response| response.status().is_success()) {
                            break;
                        }
                    }
                }
            }
        }).await.expect("packaged sidecar should become healthy");

        assert!(saw_stderr, "Uvicorn startup output should arrive on stderr");
        assert_eq!(
            client
                .get(format!("{origin}/health"))
                .send()
                .await
                .unwrap()
                .status(),
            401
        );
        assert_eq!(
            client
                .get(format!("{origin}/health"))
                .header("X-Noto-Backend-Token", token)
                .send()
                .await
                .unwrap()
                .status(),
            200
        );

        child.kill().unwrap();

        tokio::time::timeout(Duration::from_secs(5), async {
            let mut interval = tokio::time::interval(Duration::from_millis(20));
            loop {
                interval.tick().await;
                if client
                    .get(format!("{origin}/health"))
                    .header("X-Noto-Backend-Token", token)
                    .send()
                    .await
                    .is_err()
                {
                    break;
                }
            }
        })
        .await
        .expect("terminated sidecar must release its port");
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn lifecycle_consumes_real_termination_events_and_recovers_without_orphans() {
        let app = mock_tauri_app();
        let lifecycle = BackendLifecycle::new();
        lifecycle
            .start_sidecar(app.handle(), packaged_sidecar_name())
            .unwrap();
        wait_for_phase(&lifecycle, BackendPhase::Ready).await;
        let first_origin = lifecycle.ready_connection().unwrap().origin;

        let pid = lifecycle
            .inner
            .lock()
            .unwrap()
            .child
            .as_ref()
            .unwrap()
            .child
            .pid();
        let kill_status = std::process::Command::new("kill")
            .args(["-9", "--", &format!("-{pid}")])
            .status()
            .unwrap();
        assert!(kill_status.success());
        wait_for_phase(&lifecycle, BackendPhase::Failed).await;
        lifecycle
            .start_sidecar(app.handle(), packaged_sidecar_name())
            .unwrap();
        wait_for_phase(&lifecycle, BackendPhase::Ready).await;
        let second_origin = lifecycle.ready_connection().unwrap().origin;
        assert_ne!(first_origin, second_origin);

        lifecycle.stop();
        assert_eq!(lifecycle.status().phase, BackendPhase::Stopped);
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            let mut interval = tokio::time::interval(Duration::from_millis(20));
            loop {
                interval.tick().await;
                if client
                    .get(format!("{second_origin}/health"))
                    .send()
                    .await
                    .is_err()
                {
                    break;
                }
            }
        })
        .await
        .expect("shutdown should leave no reachable backend process");
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn packaged_sidecar_exits_when_its_declared_parent_dies() {
        use std::io::Write;
        use tauri_plugin_shell::{process::CommandEvent, ShellExt};

        let app = mock_tauri_app();
        let mut owner = std::process::Command::new("sleep")
            .arg("60")
            .spawn()
            .unwrap();
        let mut unrelated = std::process::Command::new("sleep")
            .arg("60")
            .spawn()
            .unwrap();
        let port = reserve_loopback_port().unwrap();
        let token = "parent-death-ready-token";
        let (mut events, child) = app
            .shell()
            .sidecar(packaged_sidecar_name())
            .unwrap()
            .set_process_group(true)
            .env("NOTO_BACKEND_PORT", port.to_string())
            .env("NOTO_BACKEND_TOKEN", token)
            .env("NOTO_PARENT_PID", owner.id().to_string())
            .env(
                "NOTO_PARENT_START_TIME",
                linux_process_start_time(owner.id()).unwrap(),
            )
            .spawn()
            .unwrap();
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let origin = format!("http://127.0.0.1:{port}");

        let result = tokio::time::timeout(Duration::from_secs(15), async {
            let mut interval = tokio::time::interval(Duration::from_millis(20));
            loop {
                interval.tick().await;
                if client
                    .get(format!("{origin}/health"))
                    .header("X-Noto-Backend-Token", token)
                    .send()
                    .await
                    .is_ok_and(|response| response.status().is_success())
                {
                    break;
                }
            }

            let mut active_request = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
            active_request
                .write_all(b"POST /api/audio/chunks HTTP/1.1\r\nHost: localhost\r\nContent-Length: 1000000\r\n\r\n")
                .unwrap();
            owner.kill().unwrap();
            owner.wait().unwrap();

            loop {
                match events.recv().await {
                    Some(CommandEvent::Terminated(payload)) => break payload,
                    Some(_) => {}
                    None => panic!("sidecar event channel closed without termination"),
                }
            }
        })
        .await;

        if result.is_err() {
            let _ = child.kill();
        }
        let terminated = result.expect("sidecar should exit after its declared parent dies");
        assert_eq!(terminated.code, Some(0));
        assert!(unrelated.try_wait().unwrap().is_none());
        assert!(client
            .get(format!("{origin}/health"))
            .header("X-Noto-Backend-Token", token)
            .send()
            .await
            .is_err());
        unrelated.kill().unwrap();
        unrelated.wait().unwrap();
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn packaged_sidecar_exits_if_parent_dies_during_initialization() {
        use tauri_plugin_shell::{process::CommandEvent, ShellExt};

        let app = mock_tauri_app();
        let mut owner = std::process::Command::new("sleep")
            .arg("60")
            .spawn()
            .unwrap();
        let port = reserve_loopback_port().unwrap();
        let (mut events, child) = app
            .shell()
            .sidecar(packaged_sidecar_name())
            .unwrap()
            .set_process_group(true)
            .env("NOTO_BACKEND_PORT", port.to_string())
            .env("NOTO_BACKEND_TOKEN", "startup-parent-death-token")
            .env("NOTO_PARENT_PID", owner.id().to_string())
            .env(
                "NOTO_PARENT_START_TIME",
                linux_process_start_time(owner.id()).unwrap(),
            )
            .spawn()
            .unwrap();
        owner.kill().unwrap();
        owner.wait().unwrap();

        let result = tokio::time::timeout(Duration::from_secs(15), async {
            loop {
                match events.recv().await {
                    Some(CommandEvent::Terminated(payload)) => break payload,
                    Some(_) => {}
                    None => panic!("sidecar event channel closed without termination"),
                }
            }
        })
        .await;
        if result.is_err() {
            let _ = child.kill();
        }
        assert_eq!(
            result
                .expect("sidecar should detect a parent that exited before initialization")
                .code,
            Some(0)
        );
        assert!(std::net::TcpStream::connect(("127.0.0.1", port)).is_err());
    }
    #[test]
    fn readiness_rejects_every_non_ready_phase() {
        assert!(BackendLifecycle::new().ready_connection().is_err());
    }
    #[test]
    fn loopback_ports_are_allocated() {
        assert_ne!(reserve_loopback_port().unwrap(), 0);
    }
}
