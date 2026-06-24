# Two-Server AI Transport Refactor

Summary of the `feat/two-server-ai-transport-refactor` work: what changed, why,
how to run/verify it, and the remaining (infrastructure) next steps.

- Branch: `feat/two-server-ai-transport-refactor`
- PR: https://github.com/LaNguAx/upscale-ai/pull/24 (into `main`)

## Why

The backend used to hand work to the AI service by sending **absolute
filesystem paths** to `POST /process`. That only works when the backend and AI
share a disk. The real deployment is two machines with **no shared storage**:

- App server — frontend, backend, Nginx, PM2, upload/result storage.
- GPU server — FastAPI/PyTorch AI service (RTX 4090), port 8000.

So we added a transport that uploads the video to the AI service and downloads
the result back, without ever sharing a filesystem.

## What changed (code)

Selectable transport via the new `AI_TRANSFER_MODE` env var:

- **`path`** (default): existing `/process` with filesystem paths. Same machine
  / shared volume. Local/dev.
- **`remote`**: backend uploads the video to `/process-upload` (multipart),
  consumes the NDJSON progress stream, then downloads `/result/:jobId` and saves
  it locally. Two-server deployments.

```
Browser → frontend → backend (/api) → [path | remote] → AI service (GPU)
                         ↘ storage/uploads, storage/results
remote: backend --multipart--> AI /process-upload
        backend <--NDJSON----- AI
        backend --GET--------> AI /result/:jobId  (then saved locally)
frontend always streams the result from the backend, never from the GPU server.
```

### Backend (`apps/backend`)

- `src/utils/env.validation.ts` — added `AI_TRANSFER_MODE` (`path` | `remote`,
  default `path`) and `AI_INTERNAL_TOKEN` (default empty).
- `src/upload/ai-protocol.types.ts` (new) — strict internal types for the
  schema-less NDJSON protocol (`AIProcessUpdate` discriminated union, etc.).
- `src/upload/ai-client.service.ts` (new) — owns all AI HTTP I/O: health,
  `path`/`remote` process streams, NDJSON parsing, result download, cancel.
  Streams uploads from disk via `fs.openAsBlob`; downloads via
  `Readable.fromWeb` + `pipeline`. Sends `Authorization: Bearer` only when a
  token is set (never logged). Validates the result URL is a same-origin
  `/result/<jobId>` path (anti-SSRF).
- `src/upload/processing.service.ts` — slimmed to orchestration; in `remote`
  mode downloads + saves the result after `completed`.
- `src/upload/upload.module.ts` — registers `AiClientService`.
- Tests: `ai-client.service.spec.ts`, `env.validation.spec.ts`.

### AI service (`apps/ai`)

- `security.py` (new) — pure, dependency-free helpers: `is_valid_job_id`
  (traversal guard), `safe_extension` (allowlist), `token_matches`
  (constant-time). Unit-tested in `test_security.py` (no torch/GPU needed).
- `server.py` — added `POST /process-upload` (multipart) and
  `GET /result/{jobId}` (`FileResponse`, no caller path); extended `/cancel`;
  token-guards all mutating/result endpoints when `AI_INTERNAL_TOKEN` is set;
  `/health` stays open. Shared inference/streaming factored into
  `run_inference_stream(...)`. Files live under `WORK_UPLOAD_DIR` /
  `WORK_RESULT_DIR`.
- `requirements.txt` — added `python-multipart` (needed by FastAPI for
  `UploadFile`/`Form`).

### Docs

`README.md`, root `AGENTS.md` + `CLAUDE.md`, `apps/backend/AGENTS.md`,
`apps/ai/AGENTS.md`, and all four `.env.*.example` files.

## Public API: unchanged

`POST /api/upload`, `GET /api/upload/status/:jobId`,
`GET /api/upload/result/:jobId`, `POST /api/upload/cancel/:jobId`,
`SSE /api/upload/events/:jobId`, `GET /api/upload/stream/:jobId`.
The frontend was not modified.

## Environment variables

| App | Var | Default | Notes |
| --- | --- | --- | --- |
| backend | `AI_TRANSFER_MODE` | `path` | `path` \| `remote` |
| backend | `AI_INTERNAL_TOKEN` | `` (empty) | Bearer for internal AI calls; match AI |
| ai | `AI_INTERNAL_TOKEN` | `` (empty) | Must match the backend |
| ai | `WORK_UPLOAD_DIR` | `../../storage/ai/uploads` | Remote-mode uploads |
| ai | `WORK_RESULT_DIR` | `../../storage/ai/results` | Remote-mode results |

When `AI_INTERNAL_TOKEN` is empty, auth is disabled (local dev). When set, the
AI requires `Authorization: Bearer <token>` on `/process`, `/process-upload`,
`/result`, and `/cancel`. `/health` is always open.

## Verification performed

Run from the repo root (`pnpm install` first):

- `pnpm --filter backend lint` / `check-types` / `build` / `test` (14 tests) — pass
- `pnpm --filter frontend check-types` / `build` — pass
- `pnpm check-types` / `pnpm build` (root, Turbo) — pass
- `python -m py_compile apps/ai/server.py apps/ai/security.py` — pass
- `python apps/ai/test_security.py` (4 tests) — pass
- Security review run on the diff; both medium findings fixed (unauthenticated
  `/process` on an exposed host; `resultDownloadUrl` SSRF).

Known pre-existing issues (NOT introduced here; no frontend/`package.json`/lockfile changes):

- `pnpm --filter frontend lint` fails: `eslint-plugin-react-hooks@7.0.1` can't
  resolve `zod-validation-error/v4` under pnpm strict hoisting.
- `pnpm format:check` flags files repo-wide due to CRLF working-tree line
  endings on Windows (git normalizes to LF on commit via `core.autocrlf=true`).

## Local manual test (single machine, simulating remote mode)

Requires Python deps installed (`pnpm --filter ai setup`) and the checkpoint at
`apps/ai/checkpoints/vsr_model_best.pth`.

1. AI: set `AI_INTERNAL_TOKEN=dev-secret`, run `pnpm --filter ai dev`; confirm
   `GET http://localhost:8000/health` shows `model_loaded: true`.
2. Backend: set `AI_TRANSFER_MODE=remote`, `AI_INTERNAL_TOKEN=dev-secret`,
   `AI_SERVICE_URL=http://localhost:8000`; run `pnpm --filter backend dev`.
3. Frontend: `pnpm --filter frontend dev`; upload a small (<20MB) video.
4. Confirm: backend POSTs `/process-upload`, AI streams NDJSON, backend
   downloads `/result/:jobId` and saves locally, frontend streams the result,
   and Cancel works mid-job. `POST /process-upload` without the bearer header
   returns 401.

## Next steps (out of scope here — infrastructure agents)

This change is code + docs only. The following are deliberately NOT done here:

1. App server (`10.10.248.133`, `upscale.cs.colman.ac.il`): Nginx reverse proxy,
   PM2 process management, SSL/TLS, firewall, storage dirs, production `.env`.
   Set `AI_TRANSFER_MODE=remote`, `AI_SERVICE_URL=http://<gpu-internal-ip>:8000`,
   a strong `AI_INTERNAL_TOKEN`, and a small `MAX_FILE_SIZE_MB` (e.g. 20).
2. GPU server (`10.10.248.31`): Python env + checkpoint, run the AI service under
   a process manager on port 8000, set the **same** `AI_INTERNAL_TOKEN`, and
   `WORK_UPLOAD_DIR`/`WORK_RESULT_DIR`.
3. Network: restrict the AI port to the app server only; prefer HTTPS/mTLS for
   the internal hop (the SSRF guard assumes the link is not freely MITM-able).
4. Generate and distribute the real `AI_INTERNAL_TOKEN` secret (never commit it).

## Known limitations (carried forward)

- Jobs are in-memory (lost on restart); no DB persistence.
- No cleanup of old jobs/files (uploads, results, AI work dirs grow unbounded).
- No shared storage between servers (the reason `remote` mode exists).
- Recommended demo upload cap is 20MB.
