# ai agent guide

Python FastAPI inference service for video super-resolution. Port 8000. PyTorch BasicVSR + SPyNet (V3 checkpoint, 4x scale, seq_len 15).

> Doc sync: if you change endpoints, the NDJSON protocol, env vars, or structure here, update this file, `README.md`, the root `AGENTS.md`/`CLAUDE.md`, the backend bridge docs (`apps/backend/AGENTS.md`), and `.cursor/rules` in the same change. `CLAUDE.md` in this folder is an `@AGENTS.md` import — edit this file instead.

## Structure

- `server.py` — FastAPI app: `GET /health`, `POST /process` (path-based NDJSON stream), `POST /process-upload` (multipart remote NDJSON stream), `GET /result/{jobId}` (download enhanced output) + `GET /result/{jobId}/original` (download the browser-safe original comparison video), `POST /cancel`, `GET /preview/{jobId}/latest` + `GET /preview/{jobId}/{frameIndex}` (download a sampled preview JPEG; append the `_in` file-key suffix for the matching original/input frame). Shared inference/streaming logic is factored into `run_inference_stream(...)`.
- `security.py` — pure, dependency-free helpers (no torch/FastAPI): `is_valid_job_id` (path-traversal guard), `safe_extension` (extension allowlist), `token_matches` (constant-time bearer check). `server.py` wraps these into FastAPI dependencies.
- `test_security.py` — lightweight unit tests for `security.py`. Run with `pytest` or directly: `python test_security.py` (no torch/GPU needed).
- `baseline/__init__.py` — V3 constants (`SCALE = 4`, `SEQ_LEN = 15`, feature/block counts) and re-exports.
- `baseline/model_architecture.py` — BasicVSR + SPyNet model definition. **Do not modify without an explicit request.** SPyNet auto-downloads pretrained weights from OpenMMLab on first init (needs network).
- `baseline/vsr_inference.py` — `VSRInferenceEngine` (frame loop, cancellation, progress callbacks).
- `ARCHITECTURE.md` — deep dive into the network (layers, SPyNet, loss function, V3 training recipe from `baseline/Model_v3.ipynb`).
- `checkpoints/` — model weights (`vsr_model_best.pth`, gitignored, ~21 MB). Without it the server boots with `model_loaded: false` and `/process` returns 503.

## Two transports

The service supports two ways for the backend to hand it work:

- **path** (`POST /process`): the backend sends absolute filesystem paths. Requires backend and AI to share a disk (same machine or volume). Historical local/dev mode.
- **remote** (`POST /process-upload` + `GET /result/{jobId}`): the backend uploads the video over multipart HTTP, then downloads the enhanced result. For two-server deployments (app server + GPU server) with **no shared storage**.

All mutating/result endpoints (`/process`, `/process-upload`, `/result`, `/cancel`, `/preview`) require the bearer token when `AI_INTERNAL_TOKEN` is set; only `/health` is always open.

Remote-mode files live under `WORK_UPLOAD_DIR`/`WORK_RESULT_DIR`: uploads at `{jobId}{ext}`, outputs at `{jobId}_enhanced{ext}`. `jobId` is validated (`^[A-Za-z0-9_-]{1,128}$`) and extensions are allow-listed, so request input can never escape those directories.

## Endpoints and the NDJSON protocol

This protocol is consumed by `apps/backend/src/upload/ai-client.service.ts` (typed in `ai-protocol.types.ts`). There is **no shared Zod/Pydantic schema** for it — any change here must be mirrored in the backend (and in these docs).

- `GET /health` → `{ "status": "ok", "device": "<cuda|cpu>", "model_loaded": <bool> }`. Always unauthenticated. Note: this shape is different from the backend's `/api/health` schema in `@repo/schemas/health` — do not conflate them.
- `POST /process` (path mode) and `POST /process-upload` (remote mode, multipart `jobId` + `video`) both return `application/x-ndjson` `StreamingResponse`, one JSON object per line:
  - Progress (emitted only when the integer percent changes; no `jobId`):
    `{ "status": "processing", "progress": 42, "currentFrame": 210, "totalFrames": 500 }`
    When `PREVIEW_ENABLED` and a sampled preview JPEG was just written (frame 1, then every `PREVIEW_EVERY_N_FRAMES`th frame — its own cadence, independent of the percent-change dedup above), the same line carries an extra `preview` object: `{ "status": "processing", "progress": 42, "currentFrame": 210, "totalFrames": 500, "preview": { "frameIndex": 210, "width": 640, "height": 360, "downloadUrl": "/preview/{jobId}/210", "originalDownloadUrl": "/preview/{jobId}/210_in" } }`. The matching original (input) frame is written next to the enhanced one and referenced via `originalDownloadUrl` (omitted if that write failed). `preview` is only present when the enhanced JPEG was actually written for that frame — never base64-inlined, never on every line.
  - Completed (terminal): `{ "status": "completed", "jobId", "progress": 100, "totalFrames", "fileSize" }`. In remote mode this line also carries `"resultDownloadUrl": "/result/{jobId}"` and, when the comparison encode succeeded, `"originalDownloadUrl": "/result/{jobId}/original"`. Before this line is emitted, the raw output is re-encoded to browser-safe H.264/yuv420p MP4 (`_finalize_outputs`) and a `{jobId}_original.mp4` comparison video is encoded from the input at the inference resolution — both best-effort (a failed transcode logs a warning and degrades, never fails the job).
  - Cancelled (terminal): `{ "status": "cancelled", "jobId", "progress", "error": "Upscaling cancelled by user" }`
  - Failed (terminal): `{ "status": "failed", "jobId", "error": "<exception message>" }`
  - Non-stream errors: 503 if no model loaded, 400 if `inputPath` does not exist (path mode) or `jobId` is invalid (remote mode).
- `GET /result/{jobId}` → the enhanced video (H.264 `.mp4`) as a `FileResponse` from `WORK_RESULT_DIR`, or 404 if missing. `GET /result/{jobId}/original` serves the `{jobId}_original.mp4` comparison video the same way. No filesystem path is accepted from the caller. Authenticated.
- `POST /cancel` with `{ "jobId" }` → `{ "status": "cancelled", "jobId" }`, or 404 if the job is not active (the backend tolerates the 404). Works for both `/process` and `/process-upload` jobs (both register a cancel event by `jobId`). Authenticated.
- `GET /preview/{jobId}/latest` and `GET /preview/{jobId}/{frameIndex}` → one cached preview JPEG (`image/jpeg`) from `WORK_PREVIEW_DIR/{jobId}/`, or 404 if missing. File keys accept an optional `_in` suffix (`latest_in`, `{frameIndex}_in`) for the matching original/input frame of the pair. `jobId` and file keys are validated (`^(latest|\d{1,9})(_in)?$`) so no filesystem path is accepted from the caller. Authenticated.

### Auth

`/process`, `/process-upload`, `/result/{jobId}`, `/cancel`, and `/preview/{jobId}/...` require `Authorization: Bearer <AI_INTERNAL_TOKEN>` **when `AI_INTERNAL_TOKEN` is set** (constant-time check). When the token is empty the check is a no-op (local dev), so `/process` works unauthenticated on a shared-disk dev box. `/health` is always unauthenticated. The token is never logged or returned.

`ProcessRequest` accepts `jobId`, `inputPath`, `outputPath`, plus `scale`, `seqLen`, `simulateLq`, `maxFrames` — **the last four are accepted but unused at runtime**. The engine uses its constructor values (`SEQ_LEN`, `SCALE` from `baseline/__init__.py`), and degradation simulation is a training-time concept only — inference upscales the input as-is. The backend sends only `jobId`, `inputPath`, `outputPath`, `scale: 4` in path mode, or `jobId` + the uploaded `video` in remote mode.

## Inference behavior (`VSRInferenceEngine`)

- Loads the checkpoint as a raw `state_dict`; falls back to CPU if CUDA is unavailable.
- Reads video with OpenCV; if decoding fails, transcodes via **ffmpeg** (must be on PATH) to a temp H.264 file and retries.
- Frames taller than `MAX_INPUT_HEIGHT` are downscaled (aspect preserved) before inference.
- **All frames are loaded into RAM** before processing — long/high-res videos can OOM.
- Per output frame, a 15-frame sliding window centered on the frame is run through the model (padded with the last frame near the end). The writer produces an OpenCV `mp4v` intermediate at the input FPS, 4x resolution — then `server.py` re-encodes it to H.264/yuv420p `+faststart` `.mp4` in place (browsers cannot decode mp4v) and encodes a `{jobId}_original.mp4` comparison video from the input at the inference (LR) resolution.
- `progress_callback(current, total)` fires after each frame; `server.py` dedupes to integer percent changes.
- `preview_callback(current_frame, total_frames, frame_bgr, input_bgr)` is an optional parameter on `process_video(...)`: the engine calls it with every enhanced frame's raw BGR array plus the matching input (LR) frame if provided, and does nothing extra if not. **All sampling policy — which frames to keep, downscale width, JPEG quality, on-disk layout — lives in `server.py`, not the engine**; this keeps `VSRInferenceEngine` free of I/O/format concerns.

## Cancellation

Per-job `threading.Event` in `active_cancellations` (lock-guarded). `/cancel` sets the event; the inference loop checks it each frame and raises `InferenceCancelledError`, which deletes the partial output file, the `{jobId}_original.mp4` comparison video (if present), and that job's `WORK_PREVIEW_DIR/{jobId}/` directory (when preview generation was active), then emits the `cancelled` NDJSON line. Inference runs in a daemon thread; the async generator polls a `queue.Queue` every 30ms and streams lines until a `None` sentinel.

## Conventions

- Python deps live in `requirements.txt`; the `package.json` exists only to wire uvicorn into Turborepo (`pnpm --filter ai dev`). Turbo skips this app for build/lint/check-types.
- The engine owns inference parameters (sequence length, scale). The backend sends only `jobId`, `inputPath`, `outputPath`, `scale`. Likewise, preview **sampling policy** (cadence, size, quality) is owned by `server.py` — the engine only exposes the generic `preview_callback` hook.
- Env vars: `CHECKPOINT_PATH` (`./checkpoints/vsr_model_best.pth`), `DEVICE` (auto `cuda`/`cpu`), `MAX_INPUT_HEIGHT` (`480`), `HOST`/`PORT` (`0.0.0.0`/`8000`, only when run as `__main__`), `AI_INTERNAL_TOKEN` (default empty — required for auth in remote mode, must match the backend), `WORK_UPLOAD_DIR` (`../../storage/ai/uploads`), `WORK_RESULT_DIR` (`../../storage/ai/results`, both resolved relative to `apps/ai` and created at startup), `PREVIEW_ENABLED` (default `true` — master switch for sampling/writing preview JPEGs), `PREVIEW_EVERY_N_FRAMES` (`15`), `PREVIEW_MAX_WIDTH` (`640`, aspect-preserving downscale, never upscales), `PREVIEW_JPEG_QUALITY` (`80`), `WORK_PREVIEW_DIR` (`../../storage/ai/previews`, resolved relative to `apps/ai` and created at startup). See `.env.development.example` / `.env.production.example`.
- External runtime deps not in `requirements.txt`: **ffmpeg on PATH is required** (H.264 finalize of every result + original comparison encode + decode fallback; without it results stay mp4v and are not browser-playable), CUDA optional (~8 GB VRAM recommended for 720p output).

## Setup

```
pnpm --filter ai run setup # pip install -r requirements.txt
pnpm --filter ai dev # uvicorn with reload
```
