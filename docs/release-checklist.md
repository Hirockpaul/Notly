# Stable release validation checklist

Record the date, OS, build artifact, tester, and evidence for every performed item. Do not mark provider/device checks from automated tests.

- Microphone: granted, denied, unavailable, start/stop, long recording, empty recording.
- NVIDIA ASR: valid/missing/invalid credentials, network failure, rate limit, long and multiple utterances, final VAD flush.
- Notes: valid/invalid provider, empty transcript, generate/regenerate, malformed response, timeout.
- SQLite: create/save/restart/rename/delete/delete-all, integrity, legacy localStorage migration.
- Backup: create and parse, empty-database restore, merge, duplicate skip, invalid/future backup, interrupted restore, post-restore integrity.
- Discord: configure/test/disconnect, short/long delivery, invalid/deleted webhook, network failure, rate limit.
- Packaging: install/uninstall on clean Windows, launch without a development checkout, backend start/stop, app-data database persistence, clean shutdown.

## Known packaging gate

The current Tauri configuration does **not** bundle or launch the Python FastAPI backend. `tauri build` can bundle the webview shell, but that artifact is not a self-contained production application and must not be released as stable. A Windows release needs a frozen, signed backend sidecar (for example, a tested PyInstaller executable), a Tauri `externalBin` declaration, lifecycle/startup health checks, and clean shutdown. Development continues to use a separately launched `uvicorn` server.

