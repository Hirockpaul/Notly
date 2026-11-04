import asyncio
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

import grpc

from app.processing.models import TranscriptionResult, Utterance

MAX_UTTERANCE_SECONDS = 30.0


class NvidiaAsrError(RuntimeError):
    """Safe provider error whose message never contains credentials or audio."""


class NvidiaAuthenticationError(NvidiaAsrError):
    pass


class NvidiaRateLimitError(NvidiaAsrError):
    pass


class NvidiaInvalidResponseError(NvidiaAsrError):
    pass


class NvidiaRivaClient(Protocol):
    def recognize(self, pcm16: bytes, timeout_seconds: float) -> object: ...


@dataclass(frozen=True, slots=True)
class NvidiaAsrConfig:
    api_key: str
    uri: str
    function_id: str
    model: str
    language_code: str
    timeout_seconds: float
    max_retries: int


class RivaGrpcClient:
    def __init__(self, config: NvidiaAsrConfig) -> None:
        import riva.client

        auth = riva.client.Auth(
            use_ssl=True,
            uri=config.uri,
            metadata_args=[
                ["function-id", config.function_id],
                ["authorization", f"Bearer {config.api_key}"],
            ],
        )
        self._service = riva.client.ASRService(auth)
        self._recognition_config = riva.client.RecognitionConfig(
            encoding=riva.client.AudioEncoding.LINEAR_PCM,
            sample_rate_hertz=16000,
            language_code=config.language_code,
            max_alternatives=1,
            enable_automatic_punctuation=True,
            enable_word_time_offsets=False,
        )

    def recognize(self, pcm16: bytes, timeout_seconds: float) -> object:
        future = self._service.offline_recognize(pcm16, self._recognition_config, future=True)
        return future.result(timeout=timeout_seconds)


class NvidiaTranscriptionProvider:
    def __init__(
        self,
        config: NvidiaAsrConfig,
        client_factory: Callable[[NvidiaAsrConfig], NvidiaRivaClient] = RivaGrpcClient,
    ) -> None:
        self._config = config
        self._client = client_factory(config)

    async def transcribe(self, utterance: Utterance) -> TranscriptionResult:
        if utterance.sample_rate != 16000:
            raise NvidiaAsrError("NVIDIA ASR requires 16 kHz audio.")
        if len(utterance.pcm16) % 2:
            raise NvidiaAsrError("NVIDIA ASR requires PCM16 audio.")
        if utterance.end - utterance.start > MAX_UTTERANCE_SECONDS + 0.001:
            raise NvidiaAsrError("Utterance exceeds the NVIDIA request duration limit.")

        response = await self._recognize_with_retry(utterance.pcm16)
        text = self._extract_text(response)
        return TranscriptionResult(
            session_id=utterance.session_id,
            utterance_id=utterance.utterance_id,
            text=text,
            start=utterance.start,
            end=utterance.end,
        )

    async def _recognize_with_retry(self, pcm16: bytes) -> object:
        for attempt in range(self._config.max_retries + 1):
            try:
                return await asyncio.to_thread(
                    self._client.recognize, pcm16, self._config.timeout_seconds
                )
            except grpc.RpcError as error:
                code = error.code()
                if code in {grpc.StatusCode.UNAUTHENTICATED, grpc.StatusCode.PERMISSION_DENIED}:
                    raise NvidiaAuthenticationError(
                        "NVIDIA rejected the configured credentials or Function ID."
                    ) from error
                if code == grpc.StatusCode.RESOURCE_EXHAUSTED:
                    if attempt >= self._config.max_retries:
                        raise NvidiaRateLimitError(
                            "NVIDIA ASR rate limit was exceeded. Try again later."
                        ) from error
                elif code not in {
                    grpc.StatusCode.UNAVAILABLE,
                    grpc.StatusCode.DEADLINE_EXCEEDED,
                    grpc.StatusCode.INTERNAL,
                }:
                    raise NvidiaAsrError("NVIDIA ASR rejected the audio request.") from error
                elif attempt >= self._config.max_retries:
                    raise NvidiaAsrError("NVIDIA ASR is temporarily unavailable.") from error
                await asyncio.sleep(0.2 * (2**attempt))
        raise NvidiaAsrError("NVIDIA ASR is temporarily unavailable.")

    @staticmethod
    def _extract_text(response: object) -> str:
        try:
            results = response.results
            transcripts = [
                result.alternatives[0].transcript.strip()
                for result in results
                if result.alternatives
            ]
        except (AttributeError, IndexError, TypeError) as error:
            raise NvidiaInvalidResponseError("NVIDIA ASR returned an invalid response.") from error
        return " ".join(text for text in transcripts if text).strip()
