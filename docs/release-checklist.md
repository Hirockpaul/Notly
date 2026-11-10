# Stable release validation checklist

Record the date, OS, build artifact, tester, and evidence for every performed item. Do not mark provider/device checks from automated tests.

- Microphone: granted, denied, unavailable, start/stop, long recording, empty recording.
- NVIDIA ASR: valid/missing/invalid credentials, network failure, rate limit, long and multiple utterances, final VAD flush.
- Notes: valid/invalid provider, empty transcript, generate/regenerate, malformed response, timeout.
- SQLite: create/save/restart/rename/delete/delete-all, integrity, legacy localStorage migration.
- Backup: create and parse, empty-database restore, merge, duplicate skip, invalid/future backup, interrupted restore, post-restore integrity.
- Discord: configure/test/disconnect, short/long delivery, invalid/deleted webhook, network failure, rate limit.
- Linux packaging: install/uninstall the `.deb`, launch the AppImage on a clean desktop, verify the bundled `appsink` plugin, microphone selection/live meter/recording, English and Hindi ASR, noise reduction, notifications, launch-at-startup after reboot, backend lifecycle, and persistence.
- Windows packaging: install/uninstall the NSIS setup on clean Windows, verify Authenticode, microphone/notification/autostart behavior after reboot, backend lifecycle, and persistence.
- macOS packaging: install the DMG on clean Apple Silicon, verify Gatekeeper and notarization, microphone permission/capture, notifications, login startup after reboot, backend lifecycle, and persistence.

## Release gates

The Linux AppImage bundles WebKitGTK's GStreamer media framework and CI verifies `usr/lib/gstreamer-1.0/libgstapp.so`, preventing the previous `appsink` warning from silently returning. Every platform freezes its Python sidecar on its native runner. Never substitute a sidecar from another operating system or claim real hardware/provider/reboot verification from CI.
