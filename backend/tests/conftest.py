import os

# Unit tests never inherit provider selection or secrets from backend/.env.
os.environ["NOTO_TRANSCRIPTION_PROVIDER"] = "fake"
os.environ["NOTO_NOTES_PROVIDER"] = "fake"
os.environ["NOTO_BACKEND_TOKEN"] = ""
