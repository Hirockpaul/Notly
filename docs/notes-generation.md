# Notes generation architecture

Noto treats transcription and notes generation as separate stages. NVIDIA Canary is used only for
offline speech-to-text. After the final transcript exists, the user may explicitly call `POST
/api/sessions/{session_id}/notes` with `{"regenerate": false}`. Stopping a recording never triggers
notes generation.

The backend verifies that the session is completed and meaningful, then passes the immutable
timestamped transcript to the selected notes provider. The hosted implementation uses the generic
OpenAI-compatible `POST /v1/chat/completions` protocol through Python's standard HTTP library; it
does not use the OpenAI SDK. The prompt forbids external facts and unsupported inference, requests
temperature zero and JSON output, and preserves unknown owners or deadlines as `null`.

Provider output is validated as a structured document. Empty filler documents, malformed JSON,
timeouts, authentication failures, and provider failures become safe HTTP errors. Concurrent calls
for the same session share one task. Successful notes are cached, while `regenerate: true` starts a
new generation after any active request finishes.

Packaged desktop builds save the final transcript first and generated notes later through typed
Tauri commands into the same local SQLite database. Notes regeneration updates the notes row while
leaving `completed_sessions.transcript_data` unchanged. Browser development uses a separate
development-only localStorage repository. Backend caches retain at most 100 completed transcripts
and notes and reset when the backend process restarts; they are not durable storage.

The UI omits empty note sections. It supports per-section copy, Copy all as Markdown, Markdown
download, and plain-text download. The original transcript remains a separate view and is never
rewritten by notes generation.
