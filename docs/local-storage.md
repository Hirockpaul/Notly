# Local SQLite storage

## Ownership and location

Packaged Noto uses one authoritative SQLite database owned by the Rust/Tauri process. At startup,
Tauri resolves its platform-specific application-data directory with `app.path().app_data_dir()` and
opens `noto.db` there. No operating-system path is hardcoded or returned to the frontend. The Python
backend does not own a second database; its bounded session caches are temporary.

Browser development cannot invoke Tauri commands, so it uses the explicitly labeled
`browser-development` localStorage repository. Desktop mode never silently falls back to that
repository and never merges browser-development rows into ordinary SQLite reads.

## Schema and integrity

Schema version 1 contains:

- `schema_migrations(version, applied_at)` for migration tracking.
- `app_metadata(key, value)` for verified one-time application migrations.
- `completed_sessions`: primary-key session ID, title, timestamps, duration, transcript status,
  validated transcript JSON, notes status, and row schema version.
- `notes`: one row per session with a foreign key using `ON DELETE CASCADE`, scalar title/summary,
  validated JSON arrays for structured sections, and timestamps.

Indexes cover session creation time and note session lookup. SQLite foreign keys and WAL journaling
are enabled on the owned connection. All user data is passed through parameterized statements.
Multi-step session/notes writes, migrations, note deletion, and delete-all operations use
transactions. Startup and storage statistics run `PRAGMA integrity_check`; initialization failure
never deletes or recreates the existing database.

## Legacy migration

The frontend checks `noto.completed-sessions.v1` before normal application rendering. It validates
every record and deduplicates repeated IDs before invoking `migrate_legacy_sessions`. Rust validates
the data again and imports it transactionally with `INSERT OR IGNORE`, so an existing SQLite record
is never overwritten by stale browser data. Migration metadata is committed only with the records.

The frontend verifies that imported plus existing-skipped rows equals the validated unique input
count, then calls `confirm_legacy_migration`. Only after that command confirms the stored metadata is
the legacy key removed. Invalid JSON, partial records, database errors, interrupted transactions, or
count mismatch leave the original key untouched and display a recovery error. Repeated migration is
idempotent. Browser development makes a separate fallback copy for usability but preserves the
legacy key for a future packaged SQLite migration.

## Commands

The typed Tauri boundary provides:

- `save_completed_session`, `get_completed_sessions`, `get_completed_session`
- `update_session_title`, `delete_completed_session`, `delete_all_sessions`
- `save_generated_notes`, `get_session_notes`, `delete_session_notes`
- `get_storage_statistics`
- `migrate_legacy_sessions`, `confirm_legacy_migration`

Commands validate identifiers, titles, timestamps, durations, transcript associations, segment
boundaries, and notes size. Errors returned to React are stable messages without SQL text or paths.

## Privacy, deletion, and backup

SQLite records stay on the device. Deleting a recording permanently removes it and cascades to its
notes. Settings requires two confirmations before deleting every recording. This does not prevent
audio transfer to NVIDIA when hosted ASR is configured or transcript transfer to the configured
notes provider after the user explicitly generates notes.

The database is not encrypted at rest. On Unix, Noto requests owner-only `0600` permissions for the
database file; this is defense in depth, not encryption. A future encryption upgrade should use a
reviewed SQLite encryption implementation and migration, never application-written cryptography.

For a manual backup, fully quit Noto so WAL state is closed, locate the application-data directory
for the `com.notoai.desktop` application through the operating system, and copy `noto.db`. Restore
only while Noto is stopped and preserve the original file until the restored database passes its
integrity check.

During development, inspect a stopped application's database with:

```sh
sqlite3 "<Tauri app_data_dir>/noto.db"
PRAGMA foreign_keys;
PRAGMA integrity_check;
.tables
SELECT id, title, created_at, duration_seconds, notes_status FROM completed_sessions;
```

Do not edit a live database or delete it as a recovery strategy. Keep a copy and investigate the
reported initialization error first.
