# Speech provider evaluation

Last verified: 2026-11-04

## Active decision: Solo Mode

Noto processes one local microphone through 16 kHz mono PCM16 capture, energy VAD, and offline
utterance transcription. Diarization is not constructed or called. The existing transcript schema
retains `speaker`, so Solo Mode uses the fixed label `You`.

## NVIDIA hosted Canary 1B ASR

The official [Canary API catalog page](https://build.nvidia.com/nvidia/canary-1b-asr/api) currently
offers hosted `canary-1b-asr` through the Riva gRPC API. Its documented example uses:

- `grpc.nvcf.nvidia.com:443` with TLS.
- `authorization: Bearer <NVIDIA_API_KEY>` gRPC metadata.
- `function-id: <catalog Function ID>` gRPC metadata.
- The official `nvidia-riva-client` package and `ASRService.offline_recognize`.
- Mono, 16-bit WAV, OPUS, or FLAC input in the file example; Noto sends validated 16 kHz mono
  LINEAR_PCM through the underlying Riva recognition contract.
- `en-US` as the documented English language code.

NVIDIA's [Canary Speech NIM documentation](https://docs.nvidia.com/nim/speech/latest/asr/deploy-asr-models/canary.html)
states that Canary supports offline mode only. Noto therefore sends completed, bounded VAD
utterances and does not fabricate streaming partials or word timestamps.

The catalog Function ID is configuration rather than source code because hosted deployments can
change. Obtain its current value and an API key from the catalog page. Hosted use transfers speech
audio to NVIDIA and may consume credits or incur account charges.

## Provider behavior

- `fake` remains the default for development and tests.
- `nvidia` is enabled only with explicit backend configuration.
- Missing credentials fail backend startup with the missing variable names.
- Authentication and invalid-audio failures are not retried.
- transient unavailable, deadline, internal, and rate-limit failures use bounded exponential retry.
- Errors returned to the frontend contain safe provider summaries, never credentials or audio.
- Empty NVIDIA transcripts are omitted from the final aligned segment list.
- At most two utterances are transcribed concurrently within a session; additional completed
  utterances wait in the bounded worker gate rather than starting another provider call.
- Progressive UI updates use polling of a full transcript snapshot. They are completed utterances,
  not NVIDIA streaming recognition results.
- Segment timestamps come from accumulated 16 kHz PCM frame durations at the local VAD boundary.
  Results are sorted by those timestamps, so provider completion order cannot reorder the transcript.
- Finishing flushes active speech and waits for pending provider calls. Per-utterance failures are
  returned beside all successful segments instead of invalidating the session.

No OpenAI, local NeMo, CUDA, PyTorch, GPU runtime, or diarization dependency is part of this mode.
