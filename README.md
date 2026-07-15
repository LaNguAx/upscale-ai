<p align="center">
  <img src="apps/frontend/public/upscale-logo.png" alt="UPscale Logo" width="260"/>
</p>

# UPscale

AI-powered video restoration and super-resolution. B.Sc. Computer Science final project (Deep Learning specialization).

A pnpm + Turborepo monorepo with three apps and a shared full-stack contract chain:

```text
apps/
├── frontend    Vite 8 + React 19 SPA (Tailwind v4, shadcn/ui, RTK Query)   :5173
├── backend     NestJS 11 API under /api (uploads, jobs, SSE, streaming)    :3000
└── ai          Python FastAPI + PyTorch inference service                  :8000
packages/
├── consts      Endpoint path strings and app constants
├── schemas     Zod 4 schemas + inferred types (single source of truth)
├── contracts   Typed EndpointContract objects (consts + schemas)
├── eslint-config       Shared ESLint 9 flat-config presets
└── typescript-config   Shared strict tsconfig presets
```

## How it works

1. The frontend uploads a video (`POST /api/upload`, multipart, XHR progress) and receives a `jobId`.
2. The backend stores the file on disk (Multer), tracks the job in memory, and hands it to the AI service, consuming an NDJSON progress stream. The transport depends on `AI_TRANSFER_MODE` (see below).
3. The AI service runs BasicVSR + SPyNet (V3 checkpoint, 4x scale) over the video frames, sampling original+enhanced preview JPEG pairs as it goes (first frame, then every `PREVIEW_EVERY_N_FRAMES`th — default 2, dense enough for playback — with `fps`/`stride` pacing metadata on each announcement) and finishing with an ffmpeg re-encode to browser-safe H.264 (plus a small original-comparison video). The backend saves the enhanced output to `storage/results` (downloading it from the AI service in `remote` mode) and proxies preview frames cache-through: `GET /api/upload/preview/...` serves from `storage/previews` or fetches the exact frame from the AI over HTTP on demand — in **both** transports, since there's no shared disk to rely on.
4. The frontend follows progress over SSE (`/api/upload/events/:jobId`, with polling fallback) and plays a buffered "flipbook" before/after comparison from the sampled frame pairs (`GET /api/upload/preview/:jobId/:frameIndex` + `…/original`) while the job runs — like a delayed live broadcast: it buffers a few seconds of frames, plays them as motion at the source pace while staying safely behind the newest frame, and holds with a "Buffering preview…" state when it catches up. On completion the same player switches seamlessly to the enhanced video (`/api/upload/stream/:jobId`, HTTP Range) with the synced original comparison underneath (`…/original`) and custom play/seek/volume/fullscreen controls. The final enhanced MP4 is only ever available after completion.
5. Jobs can be cancelled end-to-end (`POST /api/upload/cancel/:jobId` bridges to the AI service). Both sides delete their cached preview frames for a job once it reaches any terminal state.

### Single-server vs two-server (`AI_TRANSFER_MODE`)

The backend↔AI transport is selectable so the same code runs locally and across two machines:

- **`path`** (default): the backend sends absolute filesystem paths to the AI's `/process` endpoint. Requires the backend and AI service to share a disk (same machine or volume). Ideal for local development.
- **`remote`**: the backend uploads the video to the AI's `/process-upload` endpoint over multipart HTTP and downloads the finished result from `/result/:jobId`. This supports the real deployment — an **app server** (frontend, backend, upload/result storage) and a separate **GPU server** running the AI service, with **no shared storage** between them. The two services authenticate internal calls with a shared `AI_INTERNAL_TOKEN`; the frontend always talks only to the backend, never to the GPU server. The public API and frontend UX are identical in both modes.

Errors follow RFC 7807 (ProblemDetails) with a `traceId` from the request-id middleware. All request/response shapes live in `@repo/schemas`; the backend wraps them with `nestjs-zod` DTOs and the frontend validates responses against `@repo/contracts`.

## Prerequisites

- Node >= 24 (see `.nvmrc`)
- pnpm 10 (`corepack enable` or `npm i -g pnpm`)
- Python 3.11+ with pip (for the AI service)
- The model checkpoint at `apps/ai/checkpoints/vsr_model_best.pth` (not in git)

## Getting started

```bash
pnpm install

# one-time Python setup
pnpm --filter ai run setup

# copy env examples (optional — sane defaults exist)
cp apps/backend/.env.development.example apps/backend/.env.development
cp apps/frontend/.env.development.example apps/frontend/.env.development

# start everything (frontend 5173, backend 3000, ai 8000)
pnpm dev
```

Swagger UI is served at `http://localhost:3000/docs` in development.

## Commands

| Command               | Purpose                                            |
| --------------------- | -------------------------------------------------- |
| `pnpm dev`            | Start all apps in watch mode                       |
| `pnpm dev:web`        | Start frontend + backend only (no AI service)      |
| `pnpm dev:ai`         | Start the AI inference service only                |
| `pnpm build`          | Build all packages and apps (bottom-up, cached)    |
| `pnpm preview`        | Build, then run in local production-rehearsal mode |
| `pnpm preview:web`    | Build, then run frontend + backend only            |
| `pnpm preview:ai`     | Run the AI service in production mode (no reload)  |
| `pnpm start:prod`     | Build, then run in pure production mode            |
| `pnpm start:prod:web` | Build, then run frontend + backend in prod mode    |
| `pnpm start:prod:ai`  | Run the AI service in production mode              |
| `pnpm lint`           | Lint everything (`--max-warnings 0`)               |
| `pnpm check-types`    | Type-check everything                              |
| `pnpm format`         | Prettier-format the repo                           |

Filter to one app: `pnpm --filter backend dev`, `pnpm --filter backend test:e2e`, etc.

## Environment variables

Each app commits `.env.development.example` / `.env.production.example`. Backend env is Zod-validated at startup (`apps/backend/src/utils/env.validation.ts`) — see `CLAUDE.md` for the full table. Key ones:

- backend: `PORT`, `CORS_ORIGIN`, `AI_SERVICE_URL`, `AI_TRANSFER_MODE` (`path` | `remote`), `AI_INTERNAL_TOKEN`, `UPLOAD_DIR`, `RESULT_DIR`, `MAX_FILE_SIZE_MB`, `ALLOWED_VIDEO_EXTENSIONS`, `PREVIEW_ENABLED`, `PREVIEW_DIR`
- frontend: `VITE_PORT`, `VITE_API_BASE_URL` (backend **origin**, no `/api` suffix)
- ai: `CHECKPOINT_PATH`, `DEVICE`, `MAX_INPUT_HEIGHT`, `HOST`, `PORT`, `AI_INTERNAL_TOKEN`, `WORK_UPLOAD_DIR`, `WORK_RESULT_DIR`, `PREVIEW_ENABLED`, `PREVIEW_EVERY_N_FRAMES`, `PREVIEW_MAX_WIDTH`, `PREVIEW_JPEG_QUALITY`, `WORK_PREVIEW_DIR`

For a two-server deployment set `AI_TRANSFER_MODE=remote`, point `AI_SERVICE_URL` at the GPU server's internal address, and set the **same** `AI_INTERNAL_TOKEN` on both the backend and the AI service. Keep the demo upload cap small (e.g. `MAX_FILE_SIZE_MB=20`). The concrete server addresses, domain, Nginx/PM2/SSL setup are handled by infrastructure tooling, not this repo.

## The AI model

`apps/ai/baseline/` contains the V3 architecture: **BasicVSR with a SPyNet optical-flow backbone** (sequence length 15, 4x upscale). `vsr_inference.py` exposes `VSRInferenceEngine` with frame-window batching, progress callbacks, and cooperative cancellation. Training artifacts live in `Model_v3.ipynb`. Inference parameters are owned by the engine/checkpoint — the backend does not override them.

There is **no mock fallback**: if the AI service is down or the checkpoint is missing, jobs fail with a clear error.

## Demo degradation pipeline

`scripts/create_degraded_demo.py` turns a clean video into a synthetic low-resolution input for demoing the x4 model, using ffmpeg (must be on PATH). Place a source video at `demo/input/demo1.mp4`, then run:

```
python scripts/create_degraded_demo.py
```

This writes:

- `demo/degraded/demo1_dirty_lr.mp4` — downscaled x4, mild blur, mild noise, strong compression; the model input.
- `demo/degraded/demo1_dirty_preview_x4.mp4` — the above upscaled back x4 with nearest-neighbor only, for visual before/after comparison (not a model output).

Pass a different path as an argument to use another source video: `python scripts/create_degraded_demo.py path/to/video.mp4`. `demo/input`, `demo/degraded`, and `demo/output` are gitignored (except `.gitkeep`) — none of these video files are committed.

## YouTube-style degradation and V4 fine-tuning

The V3 checkpoint was trained on per-frame image degradations only (blur/noise/JPEG), so it under-performs on real codec-compressed videos (YouTube-style macroblocking, temporal artifacts). Two scripts close that gap without touching `Model_v3.ipynb` or the V3 workspace:

- `scripts/degrade_clip_video.py` — per-**clip** degradation ending in a real H.264 encode/decode round-trip (random CRF 23–38, optional second encode to mimic re-upload). All parameters are sampled once per clip, so the LR data has temporally consistent degradation. Video mode (`python scripts/degrade_clip_video.py demo/input/demo3.mp4 --preview`) writes `demo/degraded/<stem>_youtube_lr.mp4` (+ a nearest-neighbor x4 preview); directory mode takes a folder of HR PNG frames and writes `hr_frames/` + `lr_frames/` (more with `--variants N`). Sampled parameters are printed per clip.
- `scripts/finetune_v4_youtube.py` — standalone V4 training entrypoint, meant to run in the training environment that built the V3 splits (copy it there together with `degrade_clip_video.py` and `apps/ai/baseline/model_architecture.py`). It builds a new split tree under `vsr_workspace/experiments/model_v4_finetune_youtube/` (HR frames symlinked from V3, new codec LR generated per clip, a replay subset keeping the old V3 LR against catastrophic forgetting, plus `val_old`/`val_codec` sets), then fine-tunes the V3 checkpoint with SPyNet frozen at LR `2.5e-5`, checkpointing on the best combined old+codec val loss. Start with `--data-only --max-clips 5` to build and visually inspect the degraded LR frames before spending GPU time; resume is automatic from the V4 `training_state.pth` — including mid-epoch: the full training state (model, optimizer, scheduler, RNG states, batch position, running loss counters) is snapshotted atomically every `--save-every` train batches (default 500) and at the train/val boundary, so a crash or environment reset resumes from the last saved batch instead of replaying the whole epoch. The V3 experiment directory is only ever read.

The fine-tuned weights (`vsr_model_v4_best_combined.pth`) are drop-in for the app: copy into `apps/ai/checkpoints/` and point `CHECKPOINT_PATH` at them.

Operational guide for running the fine-tune on a temporary GPU environment (required files, start/restart procedure, crash diagnosis): `scripts/GPU_TRAINING_RUNBOOK.md`.

## Known limitations

- Job state is in-memory; a backend restart loses all jobs. No DB persistence.
- No automatic cleanup of old jobs or files (uploads, results, and AI work dirs grow until cleared manually). Cached preview frames are the exception — both servers delete them per job at terminal states.
- Single-node disk storage per server (`storage/`, gitignored); there is no shared storage between the app and GPU servers — `remote` mode exists precisely because of this.
- The recommended public-demo upload cap is small (`MAX_FILE_SIZE_MB=20`).
- Deploy script builds the frontend but static hosting must be configured separately (see `deploy-upscale-ai.sh`).

## Deployment

`deploy-upscale-ai.sh` (triggered via `.github/workflows/deploy.yml` over SSH) pulls `main`, runs `pnpm install && pnpm build`, and restarts the backend and AI service under PM2. See the script header for the remaining manual steps.

## Project documentation

The full project characterization (architecture decisions, pipeline design, milestones) lives in `docs/Upscale-Project-Characterization.pdf`. Agent-facing guides: `AGENTS.md` (root and per-app) and `CLAUDE.md`.
