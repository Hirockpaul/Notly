# Backup and restore

Desktop Settings can create and restore portable JSON backups. The native picker controls the location; Noto never exposes the SQLite path. A backup is written to a temporary file, parsed and counted for verification, then renamed into place.

Version 1 has this shape: `format: "noto-ai-backup"`, `backupVersion: 1`, `applicationVersion`, `createdAt`, and `data.sessions`. Each session preserves IDs, titles, timestamps, duration, transcript status and timestamped segments, note status, and all structured note fields. Credentials, environment variables, audio buffers, and backend state are excluded.

Restore validates every record and rejects invalid JSON, duplicate IDs inside a backup, and future versions. Merge is the default: existing IDs are preserved and reported as skipped. All inserts and the final SQLite integrity check share one transaction, so any failure rolls back the import. JSON backups are readable and **not encrypted**.

