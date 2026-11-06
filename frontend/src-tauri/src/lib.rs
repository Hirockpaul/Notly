mod backend_bridge;
mod backend_lifecycle;
mod discord;
mod storage;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .on_permission_request(|_, kind| match kind {
            tauri::webview::PermissionKind::Microphone => tauri::webview::PermissionResponse::Allow,
            _ => tauri::webview::PermissionResponse::Default,
        })
        .setup(|app| {
            let database = storage::Database::open(&app.path().app_data_dir()?)?;
            app.manage(database);
            app.manage(backend_bridge::BackendBridge::new()?);
            let lifecycle = backend_lifecycle::BackendLifecycle::new();
            lifecycle.start(app.handle())?;
            app.manage(lifecycle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            backend_bridge::backend_start_session,
            backend_bridge::backend_send_audio_chunk,
            backend_bridge::backend_get_transcript,
            backend_bridge::backend_finish_session,
            backend_bridge::backend_generate_notes,
            backend_lifecycle::backend_status,
            backend_lifecycle::backend_restart,
            storage::save_completed_session,
            storage::get_completed_sessions,
            storage::get_completed_session,
            storage::update_session_title,
            storage::delete_completed_session,
            storage::delete_all_sessions,
            storage::save_generated_notes,
            storage::get_session_notes,
            storage::delete_session_notes,
            storage::get_storage_statistics,
            storage::migrate_legacy_sessions,
            storage::confirm_legacy_migration,
            storage::create_backup,
            storage::select_backup_for_restore,
            storage::restore_selected_backup,
            discord::discord_status,
            discord::configure_discord,
            discord::test_discord,
            discord::disconnect_discord,
            discord::send_notes_to_discord,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Noto AI")
        .run(|app, event| {
            if matches!(
                event,
                tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
            ) {
                app.state::<backend_lifecycle::BackendLifecycle>().stop();
            }
        });
}
