# ai agent guide

Python FastAPI inference service for video super-resolution. Port 8000. PyTorch BasicVSR + SPyNet (V3 checkpoint, 4x scale, seq_len 15).

> Doc sync: if you change endpoints, the NDJSON protocol, env vars, or structure here, update this file, `README.md`, the root `AGENTS.md`/`CLAUDE.md`, the backend bridge docs (`apps/backend/AGENTS.md`), and `.cursor/rules` in the same change. `CLAUDE.md` in this folder is an `@AGENTS.md` import — edit this file instead.

## Structure

- `server.py` — FastAPI app: `GET /health`, `POST /process` (NDJSON progress stream), `POST /cancel`.
- `baseline/__init__.py` — V3 constants (`SCALE = 4`, `SEQ_LEN = 15`, feature/block counts) and re-exports.
- `baseline/model_architecture.py` — BasicVSR + SPyNet model definition. **Do not modify without an explicit request.** SPyNet auto-downloads pretrained weights from OpenMMLab on first init (needs network).
- `baseline/vsr_inference.py` — `VSRInferenceEngine` (frame loop, cancellation, progress callbacks).
- `checkpoints/` — model weights (`vsr_model_best.pth`, gitignored, ~21 MB). Without it the server boots with `model_loaded: false` and `/process` returns 503.

## Endpoints and the NDJSON protocol

This protocol is consumed by `apps/backend/src/upload/processing.service.ts`. There is **no shared Zod/Pydantic schema** for it — any change here must be mirrored in the backend (and in these docs).

- `GET /health` → `{ "status": "ok", "device": "<cuda|cpu>", "model_loaded": <bool> }`. Note: this shape is different from the backend's `/api/health` schema in `@repo/schemas/health` — do not conflate them.
- `POST /process` → `application/x-ndjson` `StreamingResponse`, one JSON object per line:
  - Progress (emitted only when the integer percent changes; no `jobId`):
    `{ "status": "processing", "progress": 42, "currentFrame": 210, "totalFrames": 500 }`
  - Completed (terminal): `{ "status": "completed", "jobId", "progress": 100, "totalFrames", "fileSize" }`
  - Cancelled (terminal): `{ "status": "cancelled", "jobId", "progress", "error": "Upscaling cancelled by user" }`
  - Failed (terminal): `{ "status": "failed", "jobId", "error": "<exception message>" }`
  - Non-stream errors: 503 if no model loaded, 400 if `inputPath` does not exist.
- `POST /cancel` with `{ "jobId" }` → `{ "status": "cancelled", "jobId" }`, or 404 if the job is not active (the backend tolerates the 404).

`ProcessRequest` accepts `jobId`, `inputPath`, `outputPath`, plus `scale`, `seqLen`, `simulateLq`, `maxFrames` — **the last four are accepted but unused at runtime**. The engine uses its constructor values (`SEQ_LEN`, `SCALE` from `baseline/__init__.py`), and degradation simulation is a training-time concept only — inference upscales the input as-is. The backend sends only `jobId`, `inputPath`, `outputPath`, `scale: 4`. Paths are absolute: backend and AI must share a filesystem.

## Inference behavior (`VSRInferenceEngine`)

- Loads the checkpoint as a raw `state_dict`; falls back to CPU if CUDA is unavailable.
- Reads video with OpenCV; if decoding fails, transcodes via **ffmpeg** (must be on PATH) to a temp H.264 file and retries.
- Frames taller than `MAX_INPUT_HEIGHT` are downscaled (aspect preserved) before inference.
- **All frames are loaded into RAM** before processing — long/high-res videos can OOM.
- Per output frame, a 15-frame sliding window centered on the frame is run through the model (padded with the last frame near the end). Output is written with OpenCV `mp4v` fourcc at the input FPS, 4x resolution.
- `progress_callback(current, total)` fires after each frame; `server.py` dedupes to integer percent changes.

## Cancellation

Per-job `threading.Event` in `active_cancellations` (lock-guarded). `/cancel` sets the event; the inference loop checks it each frame and raises `InferenceCancelledError`, which deletes the partial output file and emits the `cancelled` NDJSON line. Inference runs in a daemon thread; the async generator polls a `queue.Queue` every 30ms and streams lines until a `None` sentinel.

## Conventions

- Python deps live in `requirements.txt`; the `package.json` exists only to wire uvicorn into Turborepo (`pnpm --filter ai dev`). Turbo skips this app for build/lint/check-types.
- The engine owns inference parameters (sequence length, scale). The backend sends only `jobId`, `inputPath`, `outputPath`, `scale`.
- Env vars: `CHECKPOINT_PATH` (`./checkpoints/vsr_model_best.pth`), `DEVICE` (auto `cuda`/`cpu`), `MAX_INPUT_HEIGHT` (`480`), `HOST`/`PORT` (`0.0.0.0`/`8000`, only when run as `__main__`). See `.env.development.example`.
- External runtime deps not in `requirements.txt`: ffmpeg (decode fallback), CUDA optional (~8 GB VRAM recommended for 720p output).

## Setup

```
pnpm --filter ai setup # pip install -r requirements.txt
pnpm --filter ai dev # uvicorn with reload
```
