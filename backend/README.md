# Noto AI Backend

## Configuration and startup

Copy `.env.example` to `.env`, select `NOTO_TRANSCRIPTION_PROVIDER=nvidia` and/or `NOTO_NOTES_PROVIDER=openai_compatible`, and fill only the variables for that provider. The two providers are independent. `fake` providers are intended for development and automated tests, not a production release. Hosted ASR and notes providers may incur provider charges; Noto has no offline ASR fallback.

Run development backend:

```bash
python -m venv .venv
.venv/Scripts/pip install -e ".[dev]"   # Windows
.venv/Scripts/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

The service binds to loopback and accepts the configured Tauri/Vite origins. Never use `VITE_` variables for provider keys. Logs and user-facing errors intentionally omit authorization headers, API keys, transcript bodies, and Discord credentials.

## Packaged desktop backend

The backend is frozen with PyInstaller and bundled as a Tauri sidecar. End users do not need Python or a virtual environment.

Linux packaging, from the repository root:

```bash
backend/.venv/bin/python -m pip install -e 'backend[dev,package]'
./scripts/build-sidecar.sh
npm --prefix frontend run tauri:build -- --bundles deb
```

Windows packaging must run on Windows so PyInstaller produces a native executable. Install Node.js, Rust stable MSVC, Visual Studio C++ Build Tools, Python 3.12, and WebView2, then run:

```powershell
py -3.12 -m venv backend\.venv
backend\.venv\Scripts\python -m pip install -e "backend[dev,package]"
scripts\build-sidecar.ps1 x86_64-pc-windows-msvc
cd frontend
npm ci
npm run typecheck
npm run lint
npm run format:check
npm test -- --run
npm run tauri:build
```

Do not copy a Linux sidecar into a Windows package. Build and test each sidecar on its target OS with the matching Rust target triple.

Tauri allocates a loopback-only port, starts `noto-backend` with a per-launch authentication token, waits up to 10 seconds for an authenticated `GET /health`, exposes lifecycle state through `backend_status`, and terminates only its generation-owned process on exit. React communicates with FastAPI only through allow-listed Rust commands and never receives the port or token.

Each frontend backend call first obtains a one-use, server-generated registration nonce. Dispatch atomically claims that nonce and cancellation targets it rather than the reusable client label, so a stale cancellation cannot affect a later request. At most 1,024 requests may be registered concurrently; additional registrations fail explicitly without evicting existing cancellation identities. Completion and cancellation remove registrations, so sequential request volume is not capped.

### Parent-death cleanup

On Linux, Rust passes the desktop PID and its `/proc/<pid>/stat` start time to the sidecar. The backend first opens a kernel `pidfd`, then validates the PID's current `/proc` start time while retaining that descriptor, and only waits after the identity matches. When the process referenced by the `pidfd` exits—even through `SIGKILL`—the descriptor becomes readable and Uvicorn begins bounded graceful shutdown. A missing parent, unavailable identity, or mismatched start time fails closed. The ordering closes the identity-check-to-`pidfd_open` window; it does not provide semantics beyond the kernel's `pidfd` reference and the separately read `/proc` identity. This is an ownership signal, not a network heartbeat, so temporary UI or IPC stalls do not stop the backend.

On Windows, Rust obtains the desktop process creation time with `GetProcessTimes`. The backend opens a `SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION` handle, compares that handle's creation time with the expected identity, and only then waits for it to become signaled. A missing identity or reused PID is treated as parent death. Tauri process-group mode additionally uses a Windows Job Object for explicit lifecycle kills. Windows behavior must be verified on a Windows build before release; cross-platform mock tests cannot validate Win32 handle or PyInstaller behavior.

Running `uvicorn` directly for development does not set `NOTO_PARENT_PID`, so parent monitoring is disabled in that workflow.

Local FastAPI session and audio-ingestion service for Noto AI Solo Mode. Audio remains in memory;
detected utterances are sent to the selected transcription provider and released after completion.

`GET /api/sessions/{session_id}/transcript` returns a reconnectable full snapshot containing the
timestamp-aligned completed utterances, pending count, and per-utterance errors. `POST
/api/sessions/{session_id}/finish` flushes the last utterance and waits for every bounded ASR task;
successful text is retained if another utterance fails. Idle disconnected recording sessions are
cancelled after five minutes.

`POST /api/sessions/{session_id}/notes` accepts `{"regenerate": false}` and is valid only after the
session completes with meaningful transcript text. It returns `{sessionId, status, notes}` with
validated summary, key points, action items, important information, decisions, and additional
context. Concurrent requests for one session share one provider call; a cached result is returned
unless `regenerate` is explicitly true. Notes and completed transcripts are retained in bounded
in-memory caches and are lost on backend restart. These caches support active API workflows only;
the packaged desktop application's Rust-owned SQLite database is the authoritative durable store.

## Setup and server

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
uvicorn app.main:app --host 127.0.0.1 --port 8765 --reload
```

The default `NOTO_TRANSCRIPTION_PROVIDER=fake` requires no credentials. For NVIDIA hosted Canary,
follow the environment setup in [`../README.md`](../README.md). The backend fails startup with an
actionable configuration error if NVIDIA is selected without its API key or Function ID.

The default `NOTO_NOTES_PROVIDER=fake` is deterministic and credential-free. A hosted provider uses
`NOTO_NOTES_PROVIDER=openai_compatible` with `NOTO_NOTES_API_URL`, `NOTO_NOTES_API_KEY`,
`NOTO_NOTES_MODEL`, and optional `NOTO_NOTES_TIMEOUT_SECONDS`. The API URL is the full
chat-completions endpoint. Missing hosted configuration fails startup rather than silently falling
back to fake output.

## Quality checks

```bash
pytest
ruff check .
ruff format --check .
```
