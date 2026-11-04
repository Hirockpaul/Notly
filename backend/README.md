# Noto AI Backend

Local FastAPI session and audio-ingestion service for Noto AI Solo Mode. Audio remains in memory;
detected utterances are sent to the selected transcription provider and released after completion.

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

## Quality checks

```bash
pytest
ruff check .
ruff format --check .
```
