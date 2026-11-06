use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::sync::{Mutex, MutexGuard};
use tauri::State;

const DATABASE_FILENAME: &str = "noto.db";
const SCHEMA_VERSION: i64 = 1;
const LEGACY_MIGRATION_KEY: &str = "legacy_local_storage_v1";
const BACKUP_FORMAT: &str = "noto-ai-backup";
const BACKUP_VERSION: u32 = 1;
static PENDING_RESTORE: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();

pub struct Database {
    connection: Mutex<Connection>,
    path: Option<PathBuf>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct TranscriptSegment {
    #[serde(alias = "utteranceId")]
    pub utterance_id: String,
    pub speaker: String,
    pub text: String,
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Transcript {
    pub session_id: String,
    pub segments: Vec<TranscriptSegment>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ActionItem {
    pub task: String,
    pub owner: Option<String>,
    pub deadline: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NotesDocument {
    pub title: String,
    pub summary: Option<String>,
    pub key_points: Vec<String>,
    pub action_items: Vec<ActionItem>,
    pub important_information: Vec<String>,
    pub decisions: Vec<String>,
    pub additional_context: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionInput {
    pub session_id: String,
    pub title: String,
    pub created_at: String,
    pub duration_seconds: f64,
    pub transcript_status: String,
    pub transcript: Transcript,
    pub notes: Option<NotesDocument>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StoredSession {
    pub session_id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub duration_seconds: f64,
    pub transcript_status: String,
    pub transcript: Transcript,
    pub notes_status: String,
    pub notes: Option<NotesDocument>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupDocument {
    format: String,
    backup_version: u32,
    application_version: String,
    created_at: String,
    data: BackupData,
}

#[derive(Debug, Deserialize, Serialize)]
struct BackupData {
    sessions: Vec<StoredSession>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupPreview {
    created_at: String,
    backup_version: u32,
    recording_count: usize,
    notes_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    imported: usize,
    skipped_existing: usize,
    integrity: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageStatistics {
    pub storage_mode: &'static str,
    pub total_recordings: i64,
    pub total_notes: i64,
    pub database_size_bytes: u64,
    pub integrity: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationResult {
    pub imported: usize,
    pub skipped_existing: usize,
    pub migration_recorded: bool,
}

impl Database {
    pub fn open(app_data_dir: &Path) -> Result<Self, Box<dyn std::error::Error>> {
        fs::create_dir_all(app_data_dir)?;
        apply_directory_permissions(app_data_dir)?;
        let path = app_data_dir.join(DATABASE_FILENAME);
        let connection = Connection::open(&path)?;
        initialize_connection(&connection)?;
        apply_file_permissions(&path)?;
        Ok(Self {
            connection: Mutex::new(connection),
            path: Some(path),
        })
    }

    #[cfg(test)]
    fn in_memory() -> Result<Self, String> {
        let connection = Connection::open_in_memory().map_err(safe_database_error)?;
        initialize_connection(&connection).map_err(safe_database_error)?;
        Ok(Self {
            connection: Mutex::new(connection),
            path: None,
        })
    }

    fn connection(&self) -> Result<MutexGuard<'_, Connection>, String> {
        self.connection
            .lock()
            .map_err(|_| "Local storage is temporarily unavailable.".to_string())
    }

    fn save_session(&self, input: &SessionInput) -> Result<(), String> {
        validate_session(input)?;
        let transcript_json = serde_json::to_string(&input.transcript).map_err(safe_json_error)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(safe_database_error)?;
        transaction
            .execute(
                "INSERT INTO completed_sessions (
                    id, title, created_at, updated_at, duration_seconds, transcript_status,
                    transcript_data, notes_status, schema_version
                 ) VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title,
                    updated_at = excluded.updated_at,
                    duration_seconds = excluded.duration_seconds,
                    transcript_status = excluded.transcript_status,
                    transcript_data = excluded.transcript_data,
                    schema_version = excluded.schema_version",
                params![
                    input.session_id,
                    input.title,
                    input.created_at,
                    input.duration_seconds,
                    input.transcript_status,
                    transcript_json,
                    if input.notes.is_some() {
                        "generated"
                    } else {
                        "not_generated"
                    },
                    SCHEMA_VERSION,
                ],
            )
            .map_err(safe_database_error)?;
        if let Some(notes) = &input.notes {
            save_notes_transaction(&transaction, &input.session_id, notes, &input.created_at)?;
        }
        transaction.commit().map_err(safe_database_error)
    }

    fn list_sessions(&self) -> Result<Vec<StoredSession>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT s.id, s.title, s.created_at, s.updated_at, s.duration_seconds,
                        s.transcript_status, s.transcript_data, s.notes_status,
                        n.title, n.summary, n.key_points, n.action_items,
                        n.important_information, n.decisions, n.additional_context
                 FROM completed_sessions s
                 LEFT JOIN notes n ON n.session_id = s.id
                 ORDER BY s.created_at DESC, s.id DESC",
            )
            .map_err(safe_database_error)?;
        let rows = statement
            .query_map([], stored_session_from_row)
            .map_err(safe_database_error)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(safe_database_error)
    }

    fn get_session(&self, session_id: &str) -> Result<Option<StoredSession>, String> {
        validate_identifier(session_id)?;
        let connection = self.connection()?;
        connection
            .query_row(
                "SELECT s.id, s.title, s.created_at, s.updated_at, s.duration_seconds,
                        s.transcript_status, s.transcript_data, s.notes_status,
                        n.title, n.summary, n.key_points, n.action_items,
                        n.important_information, n.decisions, n.additional_context
                 FROM completed_sessions s
                 LEFT JOIN notes n ON n.session_id = s.id
                 WHERE s.id = ?1",
                [session_id],
                stored_session_from_row,
            )
            .optional()
            .map_err(safe_database_error)
    }

    fn rename_session(&self, session_id: &str, title: &str) -> Result<bool, String> {
        validate_identifier(session_id)?;
        validate_title(title)?;
        let connection = self.connection()?;
        connection
            .execute(
                "UPDATE completed_sessions SET title = ?2, updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
                params![session_id, title.trim()],
            )
            .map(|changed| changed > 0)
            .map_err(safe_database_error)
    }

    fn delete_session(&self, session_id: &str) -> Result<bool, String> {
        validate_identifier(session_id)?;
        let connection = self.connection()?;
        connection
            .execute("DELETE FROM completed_sessions WHERE id = ?1", [session_id])
            .map(|changed| changed > 0)
            .map_err(safe_database_error)
    }

    fn delete_all(&self) -> Result<usize, String> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(safe_database_error)?;
        let count = transaction
            .execute("DELETE FROM completed_sessions", [])
            .map_err(safe_database_error)?;
        transaction.commit().map_err(safe_database_error)?;
        Ok(count)
    }

    fn save_notes(&self, session_id: &str, notes: &NotesDocument) -> Result<(), String> {
        validate_identifier(session_id)?;
        validate_notes(notes)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(safe_database_error)?;
        let exists: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM completed_sessions WHERE id = ?1)",
                [session_id],
                |row| row.get(0),
            )
            .map_err(safe_database_error)?;
        if !exists {
            return Err("The completed recording no longer exists.".to_string());
        }
        save_notes_transaction(&transaction, session_id, notes, "")?;
        transaction.commit().map_err(safe_database_error)
    }

    fn get_notes(&self, session_id: &str) -> Result<Option<NotesDocument>, String> {
        validate_identifier(session_id)?;
        let connection = self.connection()?;
        connection
            .query_row(
                "SELECT title, summary, key_points, action_items, important_information,
                        decisions, additional_context FROM notes WHERE session_id = ?1",
                [session_id],
                notes_from_row,
            )
            .optional()
            .map_err(safe_database_error)
    }

    fn delete_notes(&self, session_id: &str) -> Result<bool, String> {
        validate_identifier(session_id)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(safe_database_error)?;
        let changed = transaction
            .execute("DELETE FROM notes WHERE session_id = ?1", [session_id])
            .map_err(safe_database_error)?;
        if changed > 0 {
            transaction
                .execute(
                    "UPDATE completed_sessions SET notes_status = 'not_generated',
                     updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
                    [session_id],
                )
                .map_err(safe_database_error)?;
        }
        transaction.commit().map_err(safe_database_error)?;
        Ok(changed > 0)
    }

    fn statistics(&self) -> Result<StorageStatistics, String> {
        let connection = self.connection()?;
        let total_recordings = connection
            .query_row("SELECT COUNT(*) FROM completed_sessions", [], |row| {
                row.get(0)
            })
            .map_err(safe_database_error)?;
        let total_notes = connection
            .query_row("SELECT COUNT(*) FROM notes", [], |row| row.get(0))
            .map_err(safe_database_error)?;
        let integrity = integrity_check(&connection)?;
        let database_size_bytes = self.path.as_ref().map(database_files_size).unwrap_or(0);
        Ok(StorageStatistics {
            storage_mode: "sqlite",
            total_recordings,
            total_notes,
            database_size_bytes,
            integrity,
        })
    }

    fn migrate_legacy(&self, sessions: &[SessionInput]) -> Result<MigrationResult, String> {
        for session in sessions {
            validate_session(session)?;
        }
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(safe_database_error)?;
        let already_recorded: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM app_metadata WHERE key = ?1)",
                [LEGACY_MIGRATION_KEY],
                |row| row.get(0),
            )
            .map_err(safe_database_error)?;
        if already_recorded {
            return Ok(MigrationResult {
                imported: 0,
                skipped_existing: sessions.len(),
                migration_recorded: true,
            });
        }

        let mut imported = 0;
        let mut skipped_existing = 0;
        for session in sessions {
            let transcript_json =
                serde_json::to_string(&session.transcript).map_err(safe_json_error)?;
            let changed = transaction
                .execute(
                    "INSERT OR IGNORE INTO completed_sessions (
                        id, title, created_at, updated_at, duration_seconds, transcript_status,
                        transcript_data, notes_status, schema_version
                     ) VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![
                        session.session_id,
                        session.title,
                        session.created_at,
                        session.duration_seconds,
                        session.transcript_status,
                        transcript_json,
                        if session.notes.is_some() {
                            "generated"
                        } else {
                            "not_generated"
                        },
                        SCHEMA_VERSION,
                    ],
                )
                .map_err(safe_database_error)?;
            if changed == 0 {
                skipped_existing += 1;
                continue;
            }
            imported += 1;
            if let Some(notes) = &session.notes {
                save_notes_transaction(
                    &transaction,
                    &session.session_id,
                    notes,
                    &session.created_at,
                )?;
            }
        }
        transaction
            .execute(
                "INSERT INTO app_metadata (key, value) VALUES (?1, ?2)",
                params![
                    LEGACY_MIGRATION_KEY,
                    format!("{imported}:{skipped_existing}")
                ],
            )
            .map_err(safe_database_error)?;
        transaction.commit().map_err(safe_database_error)?;
        Ok(MigrationResult {
            imported,
            skipped_existing,
            migration_recorded: true,
        })
    }

    fn confirm_migration(&self, expected_records: usize) -> Result<bool, String> {
        let connection = self.connection()?;
        let value: Option<String> = connection
            .query_row(
                "SELECT value FROM app_metadata WHERE key = ?1",
                [LEGACY_MIGRATION_KEY],
                |row| row.get(0),
            )
            .optional()
            .map_err(safe_database_error)?;
        let Some(value) = value else { return Ok(false) };
        let verified: usize = value
            .split(':')
            .map(|part| part.parse::<usize>().unwrap_or(0))
            .sum();
        Ok(verified == expected_records)
    }

    fn backup_document(&self) -> Result<BackupDocument, String> {
        Ok(BackupDocument {
            format: BACKUP_FORMAT.to_string(),
            backup_version: BACKUP_VERSION,
            application_version: env!("CARGO_PKG_VERSION").to_string(),
            created_at: chrono::Utc::now().to_rfc3339(),
            data: BackupData {
                sessions: self.list_sessions()?,
            },
        })
    }

    fn restore(&self, backup: BackupDocument, replace_all: bool) -> Result<RestoreResult, String> {
        validate_backup(&backup)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(safe_database_error)?;
        if replace_all {
            transaction
                .execute("DELETE FROM completed_sessions", [])
                .map_err(safe_database_error)?;
        }
        let mut imported = 0;
        let mut skipped_existing = 0;
        for session in backup.data.sessions {
            let exists: bool = transaction
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM completed_sessions WHERE id = ?1)",
                    [&session.session_id],
                    |row| row.get(0),
                )
                .map_err(safe_database_error)?;
            if exists {
                skipped_existing += 1;
                continue;
            }
            let transcript = serde_json::to_string(&session.transcript).map_err(safe_json_error)?;
            transaction.execute(
                "INSERT INTO completed_sessions (id,title,created_at,updated_at,duration_seconds,transcript_status,transcript_data,notes_status,schema_version) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                params![session.session_id, session.title, session.created_at, session.updated_at, session.duration_seconds, session.transcript_status, transcript, session.notes_status, SCHEMA_VERSION],
            ).map_err(safe_database_error)?;
            if let Some(notes) = &session.notes {
                save_notes_transaction(
                    &transaction,
                    &session.session_id,
                    notes,
                    &session.created_at,
                )?;
            }
            imported += 1;
        }
        let integrity = integrity_check_raw(&transaction).map_err(safe_database_error)?;
        if integrity != "ok" {
            return Err(
                "The restored database failed its integrity check; no data was imported.".into(),
            );
        }
        transaction.commit().map_err(safe_database_error)?;
        Ok(RestoreResult {
            imported,
            skipped_existing,
            integrity,
        })
    }
}

fn validate_backup(backup: &BackupDocument) -> Result<(), String> {
    if backup.format != BACKUP_FORMAT {
        return Err("This is not a Noto AI backup.".into());
    }
    if backup.backup_version > BACKUP_VERSION {
        return Err("This backup was created by a newer unsupported version of Noto AI.".into());
    }
    if backup.backup_version == 0 {
        return Err("The backup version is invalid.".into());
    }
    let mut ids = std::collections::HashSet::new();
    for session in &backup.data.sessions {
        let input = SessionInput {
            session_id: session.session_id.clone(),
            title: session.title.clone(),
            created_at: session.created_at.clone(),
            duration_seconds: session.duration_seconds,
            transcript_status: session.transcript_status.clone(),
            transcript: session.transcript.clone(),
            notes: session.notes.clone(),
        };
        validate_session(&input)?;
        if !ids.insert(&session.session_id) {
            return Err(format!(
                "Backup contains duplicate session ID: {}",
                session.session_id
            ));
        }
    }
    Ok(())
}

fn read_backup(path: &Path) -> Result<BackupDocument, String> {
    let metadata =
        fs::metadata(path).map_err(|_| "The selected backup could not be read.".to_string())?;
    if metadata.len() > 512 * 1024 * 1024 {
        return Err("The selected backup exceeds the 512 MB safety limit.".into());
    }
    let file =
        fs::File::open(path).map_err(|_| "The selected backup could not be opened.".to_string())?;
    let backup: BackupDocument = serde_json::from_reader(std::io::BufReader::new(file))
        .map_err(|_| "The selected file is not valid backup JSON.".to_string())?;
    validate_backup(&backup)?;
    Ok(backup)
}

fn initialize_connection(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;
         CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
         );
         CREATE TABLE IF NOT EXISTS app_metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS completed_sessions (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            duration_seconds REAL NOT NULL CHECK(duration_seconds >= 0),
            transcript_status TEXT NOT NULL,
            transcript_data TEXT NOT NULL CHECK(json_valid(transcript_data)),
            notes_status TEXT NOT NULL,
            schema_version INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL UNIQUE REFERENCES completed_sessions(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            summary TEXT,
            key_points TEXT NOT NULL CHECK(json_valid(key_points)),
            action_items TEXT NOT NULL CHECK(json_valid(action_items)),
            important_information TEXT NOT NULL CHECK(json_valid(important_information)),
            decisions TEXT NOT NULL CHECK(json_valid(decisions)),
            additional_context TEXT NOT NULL CHECK(json_valid(additional_context)),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON completed_sessions(created_at DESC);
         CREATE INDEX IF NOT EXISTS idx_notes_session_id ON notes(session_id);
         INSERT OR IGNORE INTO schema_migrations(version) VALUES (1);",
    )?;
    let version: i64 = connection.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get(0),
    )?;
    if version > SCHEMA_VERSION {
        return Err(rusqlite::Error::InvalidQuery);
    }
    let integrity = integrity_check_raw(connection)?;
    if integrity != "ok" {
        return Err(rusqlite::Error::InvalidQuery);
    }
    Ok(())
}

fn save_notes_transaction(
    transaction: &Transaction<'_>,
    session_id: &str,
    notes: &NotesDocument,
    timestamp: &str,
) -> Result<(), String> {
    validate_notes(notes)?;
    transaction
        .execute(
            "INSERT INTO notes (
                session_id, title, summary, key_points, action_items, important_information,
                decisions, additional_context, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
                       COALESCE(NULLIF(?9, ''), CURRENT_TIMESTAMP),
                       COALESCE(NULLIF(?9, ''), CURRENT_TIMESTAMP))
             ON CONFLICT(session_id) DO UPDATE SET
                title = excluded.title,
                summary = excluded.summary,
                key_points = excluded.key_points,
                action_items = excluded.action_items,
                important_information = excluded.important_information,
                decisions = excluded.decisions,
                additional_context = excluded.additional_context,
                updated_at = CURRENT_TIMESTAMP",
            params![
                session_id,
                notes.title,
                notes.summary,
                serde_json::to_string(&notes.key_points).map_err(safe_json_error)?,
                serde_json::to_string(&notes.action_items).map_err(safe_json_error)?,
                serde_json::to_string(&notes.important_information).map_err(safe_json_error)?,
                serde_json::to_string(&notes.decisions).map_err(safe_json_error)?,
                serde_json::to_string(&notes.additional_context).map_err(safe_json_error)?,
                timestamp,
            ],
        )
        .map_err(safe_database_error)?;
    transaction
        .execute(
            "UPDATE completed_sessions SET notes_status = 'generated',
             updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
            [session_id],
        )
        .map_err(safe_database_error)?;
    Ok(())
}

fn stored_session_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredSession> {
    let transcript_json: String = row.get(6)?;
    let transcript = serde_json::from_str(&transcript_json).map_err(json_to_sql_error)?;
    let notes_title: Option<String> = row.get(8)?;
    let notes = if let Some(title) = notes_title {
        Some(NotesDocument {
            title,
            summary: row.get(9)?,
            key_points: parse_json_column(row, 10)?,
            action_items: parse_json_column(row, 11)?,
            important_information: parse_json_column(row, 12)?,
            decisions: parse_json_column(row, 13)?,
            additional_context: parse_json_column(row, 14)?,
        })
    } else {
        None
    };
    Ok(StoredSession {
        session_id: row.get(0)?,
        title: row.get(1)?,
        created_at: row.get(2)?,
        updated_at: row.get(3)?,
        duration_seconds: row.get(4)?,
        transcript_status: row.get(5)?,
        transcript,
        notes_status: row.get(7)?,
        notes,
    })
}

fn notes_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<NotesDocument> {
    Ok(NotesDocument {
        title: row.get(0)?,
        summary: row.get(1)?,
        key_points: parse_json_column(row, 2)?,
        action_items: parse_json_column(row, 3)?,
        important_information: parse_json_column(row, 4)?,
        decisions: parse_json_column(row, 5)?,
        additional_context: parse_json_column(row, 6)?,
    })
}

fn parse_json_column<T: serde::de::DeserializeOwned>(
    row: &rusqlite::Row<'_>,
    index: usize,
) -> rusqlite::Result<T> {
    let value: String = row.get(index)?;
    serde_json::from_str(&value).map_err(json_to_sql_error)
}

fn json_to_sql_error(error: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}

fn validate_session(input: &SessionInput) -> Result<(), String> {
    validate_identifier(&input.session_id)?;
    validate_title(&input.title)?;
    if input.created_at.trim().is_empty() {
        return Err("A session creation timestamp is required.".to_string());
    }
    if !input.duration_seconds.is_finite() || input.duration_seconds < 0.0 {
        return Err("Session duration must be a non-negative number.".to_string());
    }
    if input.transcript.session_id != input.session_id {
        return Err("Transcript and session identifiers must match.".to_string());
    }
    for segment in &input.transcript.segments {
        if segment.utterance_id.trim().is_empty()
            || segment.text.len() > 100_000
            || !segment.start.is_finite()
            || !segment.end.is_finite()
            || segment.start < 0.0
            || segment.end < segment.start
        {
            return Err("Transcript contains an invalid segment.".to_string());
        }
    }
    if let Some(notes) = &input.notes {
        validate_notes(notes)?;
    }
    Ok(())
}

fn validate_notes(notes: &NotesDocument) -> Result<(), String> {
    validate_title(&notes.title)?;
    if notes
        .summary
        .as_ref()
        .is_some_and(|value| value.len() > 500_000)
    {
        return Err("Notes summary is too large.".to_string());
    }
    Ok(())
}

fn validate_identifier(value: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.len() > 200 {
        return Err("A valid session identifier is required.".to_string());
    }
    Ok(())
}

fn validate_title(value: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.chars().count() > 200 {
        return Err("Title must contain between 1 and 200 characters.".to_string());
    }
    Ok(())
}

fn integrity_check(connection: &Connection) -> Result<String, String> {
    integrity_check_raw(connection).map_err(safe_database_error)
}

fn integrity_check_raw(connection: &Connection) -> rusqlite::Result<String> {
    connection.query_row("PRAGMA integrity_check", [], |row| row.get(0))
}

fn safe_database_error(_error: rusqlite::Error) -> String {
    "Local SQLite storage failed. The existing database was left unchanged.".to_string()
}

fn safe_json_error(_error: serde_json::Error) -> String {
    "Stored session data could not be serialized safely.".to_string()
}

#[cfg(unix)]
fn apply_file_permissions(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
}

#[cfg(unix)]
fn apply_directory_permissions(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
}

#[cfg(not(unix))]
fn apply_file_permissions(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(not(unix))]
fn apply_directory_permissions(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

fn database_files_size(path: &PathBuf) -> u64 {
    let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
        return 0;
    };
    let parent = path.parent().unwrap_or_else(|| Path::new(""));
    [
        path.clone(),
        parent.join(format!("{file_name}-wal")),
        parent.join(format!("{file_name}-shm")),
    ]
    .iter()
    .filter_map(|candidate| fs::metadata(candidate).ok())
    .map(|metadata| metadata.len())
    .sum()
}

#[tauri::command]
pub fn save_completed_session(
    database: State<'_, Database>,
    session: SessionInput,
) -> Result<(), String> {
    database.save_session(&session)
}

#[tauri::command]
pub fn get_completed_sessions(database: State<'_, Database>) -> Result<Vec<StoredSession>, String> {
    database.list_sessions()
}

#[tauri::command]
pub fn get_completed_session(
    database: State<'_, Database>,
    session_id: String,
) -> Result<Option<StoredSession>, String> {
    database.get_session(&session_id)
}

#[tauri::command]
pub fn update_session_title(
    database: State<'_, Database>,
    session_id: String,
    title: String,
) -> Result<bool, String> {
    database.rename_session(&session_id, &title)
}

#[tauri::command]
pub fn delete_completed_session(
    database: State<'_, Database>,
    session_id: String,
) -> Result<bool, String> {
    database.delete_session(&session_id)
}

#[tauri::command]
pub fn delete_all_sessions(database: State<'_, Database>) -> Result<usize, String> {
    database.delete_all()
}

#[tauri::command]
pub fn save_generated_notes(
    database: State<'_, Database>,
    session_id: String,
    notes: NotesDocument,
) -> Result<(), String> {
    database.save_notes(&session_id, &notes)
}

#[tauri::command]
pub fn get_session_notes(
    database: State<'_, Database>,
    session_id: String,
) -> Result<Option<NotesDocument>, String> {
    database.get_notes(&session_id)
}

#[tauri::command]
pub fn delete_session_notes(
    database: State<'_, Database>,
    session_id: String,
) -> Result<bool, String> {
    database.delete_notes(&session_id)
}

#[tauri::command]
pub fn get_storage_statistics(database: State<'_, Database>) -> Result<StorageStatistics, String> {
    database.statistics()
}

#[tauri::command]
pub fn migrate_legacy_sessions(
    database: State<'_, Database>,
    sessions: Vec<SessionInput>,
) -> Result<MigrationResult, String> {
    database.migrate_legacy(&sessions)
}

#[tauri::command]
pub fn confirm_legacy_migration(
    database: State<'_, Database>,
    expected_records: usize,
) -> Result<bool, String> {
    database.confirm_migration(expected_records)
}

#[tauri::command]
pub fn create_backup(database: State<'_, Database>) -> Result<Option<String>, String> {
    let Some(path) = rfd::FileDialog::new()
        .set_title("Create Noto AI backup")
        .set_file_name(&format!(
            "noto-backup-{}.json",
            chrono::Utc::now().format("%Y-%m-%d")
        ))
        .add_filter("Noto AI JSON backup", &["json"])
        .save_file()
    else {
        return Ok(None);
    };
    let backup = database.backup_document()?;
    let temporary = path.with_extension("json.tmp");
    let file = fs::File::create(&temporary).map_err(|_| "The backup file could not be created. Check the folder permissions and available disk space.".to_string())?;
    serde_json::to_writer_pretty(std::io::BufWriter::new(file), &backup).map_err(|_| {
        "The backup could not be written. The database was not changed.".to_string()
    })?;
    let verified = read_backup(&temporary)?;
    if verified.data.sessions.len() != backup.data.sessions.len() {
        return Err("Backup verification failed.".into());
    }
    fs::rename(&temporary, &path).map_err(|_| {
        "The verified backup could not be moved to the selected location.".to_string()
    })?;
    Ok(Some(
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("backup.json")
            .to_string(),
    ))
}

#[tauri::command]
pub fn select_backup_for_restore() -> Result<Option<BackupPreview>, String> {
    let Some(path) = rfd::FileDialog::new()
        .set_title("Restore Noto AI backup")
        .add_filter("Noto AI JSON backup", &["json"])
        .pick_file()
    else {
        return Ok(None);
    };
    let backup = read_backup(&path)?;
    let preview = BackupPreview {
        created_at: backup.created_at.clone(),
        backup_version: backup.backup_version,
        recording_count: backup.data.sessions.len(),
        notes_count: backup
            .data
            .sessions
            .iter()
            .filter(|s| s.notes.is_some())
            .count(),
    };
    *PENDING_RESTORE
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| "Restore selection is unavailable.".to_string())? = Some(path);
    Ok(Some(preview))
}

#[tauri::command]
pub fn restore_selected_backup(
    database: State<'_, Database>,
    replace_all: bool,
) -> Result<RestoreResult, String> {
    let path = PENDING_RESTORE
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| "Restore selection is unavailable.".to_string())?
        .take()
        .ok_or_else(|| "Select and validate a backup before restoring it.".to_string())?;
    database.restore(read_backup(&path)?, replace_all)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notes(title: &str) -> NotesDocument {
        NotesDocument {
            title: title.to_string(),
            summary: Some("Grounded summary".to_string()),
            key_points: vec!["Point".to_string()],
            action_items: vec![],
            important_information: vec![],
            decisions: vec![],
            additional_context: vec![],
        }
    }

    fn session(id: &str, created_at: &str) -> SessionInput {
        SessionInput {
            session_id: id.to_string(),
            title: "Recording".to_string(),
            created_at: created_at.to_string(),
            duration_seconds: 2.0,
            transcript_status: "completed".to_string(),
            transcript: Transcript {
                session_id: id.to_string(),
                segments: vec![TranscriptSegment {
                    utterance_id: "one".to_string(),
                    speaker: "You".to_string(),
                    text: "Grounded transcript".to_string(),
                    start: 0.0,
                    end: 2.0,
                }],
            },
            notes: None,
        }
    }

    #[test]
    fn accepts_fastapi_transcript_segment_field_names_from_tauri_ipc() {
        let payload = serde_json::json!({
            "sessionId": "session-1",
            "title": "Untitled recording",
            "createdAt": "2026-11-05T10:00:00Z",
            "durationSeconds": 2.0,
            "transcriptStatus": "completed",
            "transcript": {
                "session_id": "session-1",
                "segments": [{
                    "utterance_id": "utterance-1",
                    "speaker": "You",
                    "text": "Saved transcript",
                    "start": 0.0,
                    "end": 2.0
                }]
            },
            "notes": null
        });
        let input: SessionInput = serde_json::from_value(payload).unwrap();
        assert_eq!(input.transcript.segments[0].utterance_id, "utterance-1");
        Database::in_memory().unwrap().save_session(&input).unwrap();
    }

    #[test]
    fn initializes_schema_and_tracks_version() {
        let database = Database::in_memory().unwrap();
        let connection = database.connection().unwrap();
        let version: i64 = connection
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
        assert_eq!(integrity_check_raw(&connection).unwrap(), "ok");
    }

    #[test]
    fn saves_retrieves_renames_and_deduplicates_sessions() {
        let database = Database::in_memory().unwrap();
        let input = session("session", "2026-11-05T10:00:00Z");
        database.save_session(&input).unwrap();
        database.save_session(&input).unwrap();
        assert_eq!(database.list_sessions().unwrap().len(), 1);
        assert!(database.rename_session("session", "Renamed").unwrap());
        assert_eq!(
            database.get_session("session").unwrap().unwrap().title,
            "Renamed"
        );
    }

    #[test]
    fn updates_notes_and_cascades_session_deletion() {
        let database = Database::in_memory().unwrap();
        database
            .save_session(&session("session", "2026-11-05T10:00:00Z"))
            .unwrap();
        database.save_notes("session", &notes("First")).unwrap();
        database.save_notes("session", &notes("Updated")).unwrap();
        assert_eq!(
            database.get_notes("session").unwrap().unwrap().title,
            "Updated"
        );
        database.delete_session("session").unwrap();
        assert!(database.get_notes("session").unwrap().is_none());
    }

    #[test]
    fn validates_command_inputs_and_deletes_notes_without_deleting_transcript() {
        let database = Database::in_memory().unwrap();
        let mut input = session("session", "2026-11-05T10:00:00Z");
        input.title = "".to_string();
        assert!(database.save_session(&input).is_err());

        let valid = session("session", "2026-11-05T10:00:00Z");
        database.save_session(&valid).unwrap();
        assert!(database.save_notes("missing", &notes("Notes")).is_err());
        database.save_notes("session", &notes("Notes")).unwrap();
        assert!(database.delete_notes("session").unwrap());
        assert!(database.get_notes("session").unwrap().is_none());
        assert!(database.get_session("session").unwrap().is_some());
    }

    #[test]
    fn migration_is_transactional_idempotent_and_preserves_existing_records() {
        let database = Database::in_memory().unwrap();
        let existing = session("existing", "2026-11-05T12:00:00Z");
        database.save_session(&existing).unwrap();
        let stale_existing = session("existing", "2026-11-01T12:00:00Z");
        let new_session = session("new", "2026-11-04T12:00:00Z");

        let result = database
            .migrate_legacy(&[stale_existing, new_session])
            .unwrap();
        assert_eq!(result.imported, 1);
        assert_eq!(result.skipped_existing, 1);
        assert_eq!(database.list_sessions().unwrap().len(), 2);
        let repeated = database.migrate_legacy(&[]).unwrap();
        assert!(repeated.migration_recorded);
        assert!(database.confirm_migration(2).unwrap());
    }

    #[test]
    fn empty_legacy_migration_is_recorded_and_repeatable() {
        let database = Database::in_memory().unwrap();
        let first = database.migrate_legacy(&[]).unwrap();
        let repeated = database.migrate_legacy(&[]).unwrap();
        assert_eq!(first.imported, 0);
        assert!(first.migration_recorded);
        assert!(repeated.migration_recorded);
        assert!(database.confirm_migration(0).unwrap());
    }

    #[test]
    fn invalid_migration_rolls_back_without_recording_completion() {
        let database = Database::in_memory().unwrap();
        let valid = session("valid", "2026-11-05T12:00:00Z");
        let mut invalid = session("invalid", "2026-11-05T12:00:00Z");
        invalid.transcript.session_id = "mismatch".to_string();
        assert!(database.migrate_legacy(&[valid, invalid]).is_err());
        assert!(database.list_sessions().unwrap().is_empty());
        assert!(!database.confirm_migration(2).unwrap());
    }

    #[test]
    fn sqlite_error_rolls_back_multi_step_transaction() {
        let database = Database::in_memory().unwrap();
        let mut connection = database.connection().unwrap();
        {
            let transaction = connection.transaction().unwrap();
            transaction
                .execute(
                    "INSERT INTO completed_sessions (
                        id, title, created_at, updated_at, duration_seconds, transcript_status,
                        transcript_data, notes_status, schema_version
                     ) VALUES ('valid', 'Title', 'now', 'now', 0, 'completed', '{}',
                               'not_generated', 1)",
                    [],
                )
                .unwrap();
            assert!(transaction
                .execute(
                    "INSERT INTO completed_sessions (
                        id, title, created_at, updated_at, duration_seconds, transcript_status,
                        transcript_data, notes_status, schema_version
                     ) VALUES ('invalid', 'Title', 'now', 'now', 0, 'completed', 'not-json',
                               'not_generated', 1)",
                    [],
                )
                .is_err());
        }
        let count: i64 = connection
            .query_row("SELECT COUNT(*) FROM completed_sessions", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn reports_statistics_and_delete_all() {
        let database = Database::in_memory().unwrap();
        database
            .save_session(&session("session", "2026-11-05T10:00:00Z"))
            .unwrap();
        database.save_notes("session", &notes("Notes")).unwrap();
        let statistics = database.statistics().unwrap();
        assert_eq!(statistics.total_recordings, 1);
        assert_eq!(statistics.total_notes, 1);
        assert_eq!(statistics.integrity, "ok");
        assert_eq!(database.delete_all().unwrap(), 1);
        assert!(database.list_sessions().unwrap().is_empty());
    }

    #[test]
    fn backup_restore_merges_and_skips_duplicate_ids() {
        let source = Database::in_memory().unwrap();
        let mut input = session("session", "2026-11-05T10:00:00Z");
        input.notes = Some(notes("Notes"));
        source.save_session(&input).unwrap();
        let backup = source.backup_document().unwrap();

        let destination = Database::in_memory().unwrap();
        destination.save_session(&input).unwrap();
        let result = destination.restore(backup, false).unwrap();
        assert_eq!(result.imported, 0);
        assert_eq!(result.skipped_existing, 1);
        assert_eq!(result.integrity, "ok");
        assert_eq!(destination.list_sessions().unwrap().len(), 1);
    }

    #[test]
    fn backup_validation_rejects_future_versions_and_duplicates() {
        let database = Database::in_memory().unwrap();
        database
            .save_session(&session("session", "2026-11-05T10:00:00Z"))
            .unwrap();
        let mut future = database.backup_document().unwrap();
        future.backup_version = BACKUP_VERSION + 1;
        assert!(validate_backup(&future).is_err());

        let mut duplicate = database.backup_document().unwrap();
        duplicate
            .data
            .sessions
            .push(duplicate.data.sessions[0].clone());
        assert!(validate_backup(&duplicate).is_err());
    }
}
