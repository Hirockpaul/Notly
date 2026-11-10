# Noto AI

Noto AI is a Tauri desktop recorder with local SQLite transcripts and structured notes. Backups and optional manual Discord delivery are available from Settings; see [backup and restore](docs/backup-and-restore.md), [Discord integration](docs/discord-integration.md), the [CI and release guide](docs/releasing.md), and the [release checklist](docs/release-checklist.md).

> Release status: native CI packages the platform-specific Python backend with the desktop app.
> Linux, Windows, and macOS installers are built in native CI jobs. Tagged releases require
> Windows Authenticode signing plus macOS Developer ID signing and notarization; clean-machine
> runtime acceptance is still required before publishing the generated draft.

Noto AI is a local desktop recorder built with Tauri 2, React, TypeScript, Vite, Rust, and a local
FastAPI backend. The current product mode is **Solo Mode**: one user records microphone audio and
receives a timestamped transcript.

## Install Noto AI

Until a public GitHub Release is published, signed-in GitHub users can download installers from a
successful [CI workflow run](https://github.com/Hirockpaul/Notly/actions). Open the run, scroll to
**Artifacts**, and download the package for your system. Workflow artifacts expire, so the GitHub
Releases page will become the preferred download location after the first release is published.

### Linux x86_64

Download and extract `noto-ai-linux-x86_64`. On Debian or Ubuntu, install the included `.deb`:

```sh
sudo apt install ./*.deb
```

Alternatively, run the AppImage:

```sh
chmod +x ./*.AppImage
./*.AppImage
```

### macOS Apple Silicon

Download and extract `noto-ai-macos-aarch64`, open the included `.dmg`, and drag Noto AI into the
**Applications** folder.

Branch CI uses an ad-hoc macOS signature for internal testing. Tagged releases use a verified
Developer ID signature and notarization ticket.

### Windows x86_64

Download and extract `noto-ai-windows-x86_64`, then run the included NSIS setup executable.

Only download artifacts produced by this repository. Branch CI artifacts may be unsigned or
ad-hoc signed for testing. Tagged release artifacts pass mandatory platform-signature checks.

## Solo Mode architecture

```text
Microphone → 16 kHz mono PCM16 → local session API → VAD utterances
           → fake provider or NVIDIA hosted Canary ASR → timestamped “You” transcript
```

The backend owns session IDs, validates ordered audio chunks, bounds utterances to 30 seconds,
flushes final speech on stop, and waits for pending transcription before returning the transcript.
While recording, the frontend polls a full transcript snapshot so completed utterances appear
progressively and a missed request can reconnect without gaps or duplicates. The final response is
authoritative. Diarization is not invoked in Solo Mode.

After a session completes, the user can explicitly request structured notes. The backend sends the
unchanged final transcript to a separate fake or OpenAI-compatible notes provider, validates the
structured result, and returns it without modifying the transcript. Notes are never generated
automatically.

## Setup

```sh
cd frontend
npm install
cd ../backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
```

Run the backend and frontend in separate terminals:

```sh
cd backend && source .venv/bin/activate
uvicorn app.main:app --host 127.0.0.1 --port 8765 --reload
```

```sh
cd frontend
npm run dev          # browser frontend
npm run tauri:dev    # desktop application
```

## NVIDIA hosted Canary ASR

Noto uses NVIDIA's official Riva gRPC client and the hosted Canary catalog endpoint. Visit the
[Canary API page](https://build.nvidia.com/nvidia/canary-1b-asr/api), sign in, select **Get API Key**,
and copy the currently displayed Function ID. Configure `backend/.env`:

```dotenv
NOTO_TRANSCRIPTION_PROVIDER=nvidia
NVIDIA_API_KEY=nvapi-your-key
NVIDIA_RIVA_URI=grpc.nvcf.nvidia.com:443
NVIDIA_ASR_FUNCTION_ID=the-function-id-from-the-canary-api-page
NVIDIA_ASR_MODEL=canary-1b-asr
NVIDIA_ASR_LANGUAGE_CODE=en-US
NVIDIA_ASR_TIMEOUT_SECONDS=60
NVIDIA_ASR_MAX_RETRIES=2
```

The API key and Function ID stay in the backend. When NVIDIA is enabled, completed VAD utterances
are uploaded to NVIDIA-hosted infrastructure for transcription. This may consume API credits or
incur charges under the NVIDIA account. Do not record sensitive speech without understanding that
data transfer.

Use `NOTO_TRANSCRIPTION_PROVIDER=fake` for local development and automated tests. Fake mode requires
no credentials and does not perform real speech recognition.

## AI notes provider

Fake notes are enabled by default for development and automated tests. To use a hosted
OpenAI-compatible chat-completions endpoint, configure `backend/.env`:

```dotenv
NOTO_NOTES_PROVIDER=openai_compatible
NOTO_NOTES_API_URL=https://provider.example/v1/chat/completions
NOTO_NOTES_API_KEY=your-backend-only-key
NOTO_NOTES_MODEL=your-model-name
NOTO_NOTES_TIMEOUT_SECONDS=60
```

The URL must be the provider's complete chat-completions endpoint. Noto sends a temperature-zero,
JSON-object request containing only the timestamped transcript and grounding instructions. The
provider must return the structured notes object in `choices[0].message.content`. Credentials stay
in the backend; hosted usage may incur provider charges.

To use notes, complete a recording, review the Transcript view, open **AI Notes**, and click
**Generate Notes**. Use **Regenerate** only when another explicit provider generation is wanted.
Generated sections can be copied individually, copied together as Markdown, or exported as `.md`
and `.txt`.

Packaged Tauri builds store completed transcripts and generated notes in one Rust-owned SQLite
database named `noto.db` inside the platform-specific application-data directory resolved by Tauri.
SQLite is authoritative in desktop mode. Browser development uses a clearly labeled, bounded
localStorage fallback; its records are not mixed with desktop records. Backend transcript and
generation caches remain temporary and are not the persistent source of truth.

On the first packaged launch after this upgrade, Noto validates `noto.completed-sessions.v1`, imports
unique valid records in one SQLite transaction without overwriting existing rows, records the
migration, verifies the imported/skipped count through a second command, and only then removes the
legacy key. Invalid or interrupted migration preserves the original data and blocks normal startup
with a recovery message.

### Manual NVIDIA verification

1. Set the NVIDIA variables above, start the backend, then start the browser or Tauri frontend.
2. Record two short phrases separated by at least a second of silence. Each completed phrase should
   appear while recording, in spoken order, with a recording-relative timestamp.
3. Speak another phrase and press Stop before pausing. The status should show final processing and
   the flushed phrase should appear before completion.
4. Confirm the backend response contains no API key or provider metadata. Repeat once with fake mode
   to distinguish integration behavior from hosted service availability.

This is a manual hosted-service check and requires a valid NVIDIA key, current Function ID, network
access, microphone permission, and any applicable account credits.

### Manual hosted notes verification

1. Configure the hosted notes variables above and restart the backend.
2. Complete a recording containing a clear fact, an explicit decision, and one action item.
3. Confirm no notes appear automatically when recording stops.
4. Open **AI Notes**, click **Generate Notes**, and compare every generated claim with the unchanged
   Transcript view.
5. Test per-section copy, Copy all, `.md`, and `.txt` export, then navigate to **My Notes** and back.
6. Click **Regenerate** and confirm the button cannot be clicked repeatedly while processing.

Real hosted validation requires valid credentials, network access, a compatible model, and any
applicable account credits.

## Verification

```sh
cd frontend
npm run typecheck
npm run lint
npm run format:check
npm test -- --run
npm run build

cd backend
ruff check .
ruff format --check .
pytest -q

cd ../frontend/src-tauri
cargo check
cargo test
```

## Current limitations

- Canary hosted ASR is offline-only; Noto sends completed utterances rather than streaming partials.
- Progressive text represents completed VAD utterances, not word-by-word streaming partials.
- Hosted transcription latency depends on utterance length, network conditions, and NVIDIA service
  availability.
- Solo Mode does not identify or separate multiple speakers.
- The built-in energy VAD is intentionally lightweight and is not a production neural VAD.
- Hosted availability, quotas, Function IDs, and pricing are controlled by NVIDIA.
- Notes quality is limited by transcript accuracy and the configured hosted model. Schema validation
  prevents malformed output but cannot prove every model statement is semantically grounded.
- Desktop SQLite content is local and currently unencrypted at rest. Unix builds restrict the
  database file to the current user where supported, but filesystem permissions are not encryption.
