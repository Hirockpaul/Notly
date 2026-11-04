from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="NOTO_",
        env_file=".env",
        case_sensitive=False,
        extra="ignore",
        frozen=True,
    )

    app_name: str = "Noto AI Backend"
    api_version: str = "1.0.0"
    api_prefix: str = ""
    allowed_origins: tuple[str, ...] = (
        "http://localhost:1420",
        "http://127.0.0.1:1420",
        "http://tauri.localhost",
        "https://tauri.localhost",
        "tauri://localhost",
    )
    transcription_provider: str = "fake"
    nvidia_api_key: str = Field(default="", validation_alias="NVIDIA_API_KEY")
    nvidia_riva_uri: str = Field(
        default="grpc.nvcf.nvidia.com:443", validation_alias="NVIDIA_RIVA_URI"
    )
    nvidia_asr_function_id: str = Field(default="", validation_alias="NVIDIA_ASR_FUNCTION_ID")
    nvidia_asr_model: str = Field(default="canary-1b-asr", validation_alias="NVIDIA_ASR_MODEL")
    nvidia_asr_language_code: str = Field(
        default="en-US", validation_alias="NVIDIA_ASR_LANGUAGE_CODE"
    )
    nvidia_asr_timeout_seconds: float = Field(
        default=60.0, gt=0, validation_alias="NVIDIA_ASR_TIMEOUT_SECONDS"
    )
    nvidia_asr_max_retries: int = Field(
        default=2, ge=0, le=5, validation_alias="NVIDIA_ASR_MAX_RETRIES"
    )

    @model_validator(mode="after")
    def validate_provider(self) -> "Settings":
        if self.transcription_provider not in {"fake", "nvidia"}:
            raise ValueError("NOTO_TRANSCRIPTION_PROVIDER must be 'fake' or 'nvidia'.")
        if self.transcription_provider == "nvidia":
            missing = []
            if not self.nvidia_api_key:
                missing.append("NVIDIA_API_KEY")
            if not self.nvidia_asr_function_id:
                missing.append("NVIDIA_ASR_FUNCTION_ID")
            if missing:
                raise ValueError(
                    "NVIDIA transcription requires backend environment variables: "
                    + ", ".join(missing)
                )
        return self


settings = Settings()
