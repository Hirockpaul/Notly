# Noto AI

Noto AI is a local desktop recorder built with Tauri 2, React, TypeScript, Vite, Rust, and a local
FastAPI backend. The current product mode is **Solo Mode**: one user records microphone audio and
receives a timestamped transcript.

## Solo Mode architecture

```text
Microphone → 16 kHz mono PCM16 → local session API → VAD utterances
           → fake provider or NVIDIA hosted Canary ASR → timestamped “You” transcript
```

The backend owns session IDs, validates ordered audio chunks, bounds utterances to 30 seconds,
flushes final speech on stop, and waits for pending transcription before returning the transcript.
Diarization is not invoked in Solo Mode.

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
```

## Current limitations

- Canary hosted ASR is offline-only; Noto sends completed utterances rather than streaming partials.
- Transcripts appear after recording is stopped.
- Solo Mode does not identify or separate multiple speakers.
- The built-in energy VAD is intentionally lightweight and is not a production neural VAD.
- Hosted availability, quotas, Function IDs, and pricing are controlled by NVIDIA.
