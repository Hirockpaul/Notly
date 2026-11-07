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

The Linux Tauri configuration bundles and launches the frozen Python backend with authenticated readiness checks and clean shutdown. A Windows release still requires a Windows-built, signed and runtime-tested `noto-backend-x86_64-pc-windows-msvc.exe`; do not substitute the Linux artifact or claim Windows verification from a Linux build.

