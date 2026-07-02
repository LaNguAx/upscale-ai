# Progressive preview comparison — design spec

- **Date:** 2026-07-02
- **Branch:** `feat/progressive-preview-comparison`
- **Status:** Approved design, pending implementation plan

## Context and problem

Today the user sees only a progress percentage while the AI processes a video. The
enhanced output is invisible until the entire final MP4 is finished, because the AI
writes it with OpenCV `VideoWriter` (only valid after release), emits the terminal
`completed` NDJSON line after full processing, and the backend downloads/saves the
result only then.

Deployment is two VMs with no shared filesystem: an app server (Nginx + frontend +
NestJS backend + storage, public at `https://upscale.cs.colman.ac.il`) and an internal
GPU server (FastAPI + PyTorch at `http://10.10.248.31:8000`, bearer-token protected via
`AI_INTERNAL_TOKEN`). The browser never talks to the GPU server.

## Goal

While a job is processing, the user sees:

- progress percentage (unchanged),
- the latest enhanced preview frame before completion,
- an original-vs-enhanced comparison with a draggable slider,
- the final video player/download on completion (unchanged).

Flow: the AI writes sampled enhanced JPEG preview frames during inference and emits
preview metadata on the existing NDJSON stream → the backend downloads each preview
over internal HTTP and caches it locally → the backend includes a public preview URL in
the existing SSE job updates → the frontend renders a before/after comparison slider.

## Non-goals

No HLS, no fragmented MP4, no Media Source Extensions, no playing the partially
written final MP4, no replacement of the final video pipeline, no direct
frontend-to-GPU calls, no database persistence, no queue system, no committed secrets
or generated artifacts.

## Resolved design decisions

1. **Uniform preview transport in both `AI_TRANSFER_MODE`s.** The AI always writes
   previews to `WORK_PREVIEW_DIR` and always emits `downloadUrl`; the backend always
   fetches previews over HTTP from the AI, in both `path` and `remote` modes. One code
   path; in `path` mode the AI's HTTP endpoint is on localhost anyway.
2. **`latest.jpg` is an atomic copy, not a symlink**, on both AI and backend sides.
   Dev runs on Windows where symlinks need privileges; write-tmp-then-rename is
   portable and race-safe.
3. **Preview downloads never backpressure the NDJSON loop.** The backend starts the
   download without awaiting it inside `handleUpdate`, guarded by a per-job in-flight
   flag: if a download is already running, the new preview is skipped (latest-wins, no
   queue growth). Download failures log a warning; the job continues.
4. **Sampling policy lives in `server.py`, not the engine.** `process_video()` calls
   `preview_callback(frame_idx, total, sr_bgr)` for every frame; `server.py` decides
   cadence (`PREVIEW_EVERY_N_FRAMES`, first frame ASAP). The engine stays free of
   preview policy.
5. **No `Date.now()` cache-busting.** The frontend loads previews from the
   frame-indexed URL, an immutable cache key. `latest` exists per the requirements but
   is served `no-store` and is mainly a convenience/debug endpoint.
6. **Frontend builds preview URLs from `@repo/consts`** (using `frameIndex` from the
   SSE payload), matching the existing convention where `result.downloadUrl` is ignored
   in favor of consts. The SSE payload still carries `imageUrl` for API completeness.
7. **Original side of the slider (user-selected):** a muted, paused `<video>` from a
   local object URL of the uploaded file (fallback: backend stream URL, which serves
   the original upload before completion). On each preview update it seeks to
   `(progress / 100) * duration` for rough frame alignment — no fps knowledge needed,
   no exact frame sync in this branch.

## AI service changes (`apps/ai`)

### Engine (`baseline/vsr_inference.py`)

`process_video()` gains one optional parameter:

```python
preview_callback: Optional[Callable[[int, int, np.ndarray], None]] = None
```

Invoked once per frame right after `sr_bgr` is produced, with `(i + 1, n, sr_bgr)` —
the same 1-based indexing as `progress_callback`. No duplication of the inference
loop; no model-architecture changes; `stream_video`, cancellation, progress callback,
and final MP4 writing are unchanged.

### New env vars (with safe defaults)

| Variable                 | Default                      | Meaning                                  |
| ------------------------ | ---------------------------- | ---------------------------------------- |
| `PREVIEW_ENABLED`        | `true`                       | Master switch for preview generation     |
| `PREVIEW_EVERY_N_FRAMES` | `15`                         | Sampling cadence                         |
| `PREVIEW_MAX_WIDTH`      | `640`                        | Downscale-only max width (aspect kept)   |
| `PREVIEW_JPEG_QUALITY`   | `80`                         | `cv2.imencode` JPEG quality              |
| `WORK_PREVIEW_DIR`       | `../../storage/ai/previews`  | Resolved via `_resolve_work_dir`, created at startup |

Production value: `WORK_PREVIEW_DIR=/opt/upscale/storage/ai/previews`.

### Preview writer (`server.py`, inside `run_inference_stream`)

- Samples frame 1 (first preview as early as practical), then every
  `PREVIEW_EVERY_N_FRAMES` frames.
- Downscales to `PREVIEW_MAX_WIDTH` (never upscales, aspect preserved), encodes with
  `cv2.imencode('.jpg', …, IMWRITE_JPEG_QUALITY)`.
- Writes `WORK_PREVIEW_DIR/{jobId}/{frameIndex}.jpg` and `latest.jpg` atomically
  (tmp file + `os.replace`).
- `jobId` is checked with `is_valid_job_id` before any preview path is built (both
  transports).
- Any exception in preview generation is caught and logged — it can never fail
  inference.
- After a successful write, enqueues an additional NDJSON `processing` line carrying
  the current percent plus preview metadata (see Data contracts). Percent-change
  progress lines are unchanged; preview lines are additional `processing` lines on
  their own cadence. Images are never base64-encoded into NDJSON.

### New endpoints

```http
GET /preview/{jobId}/latest
GET /preview/{jobId}/{frameIndex}
```

Both `Depends(require_token)` (enforced when `AI_INTERNAL_TOKEN` is set). `jobId`
validated with `is_valid_job_id`; `frameIndex` a constrained int path param; the
resolved path must stay inside `WORK_PREVIEW_DIR` (same containment check as
`/result/{jobId}`); `FileResponse` with `image/jpeg`; 404 when missing. No
caller-supplied filesystem paths, ever.

Pure helpers (frame-index validation, preview path resolution) go in `security.py` so
`test_security.py` covers them without torch.

### Cancellation

On `InferenceCancelledError` the job's preview directory is deleted best-effort
alongside the existing partial-output deletion.

## Backend changes (`apps/backend`)

### Env (`src/utils/env.validation.ts`)

| Variable          | Default                   | Notes                                             |
| ----------------- | ------------------------- | ------------------------------------------------- |
| `PREVIEW_ENABLED` | `true`                    | Zod 4 `z.stringbool()` — plain `z.coerce.boolean()` would turn the string `"false"` into `true` |
| `PREVIEW_DIR`     | `../../storage/previews`  | Resolved from `process.cwd()`, created at startup |

Production value: `PREVIEW_DIR=/opt/upscale/storage/previews`.

### Protocol types (`src/upload/ai-protocol.types.ts`)

```ts
export interface AIPreviewUpdate {
  frameIndex: number;
  width?: number;
  height?: number;
  downloadUrl: string;
}
```

`AIProcessingUpdate` gains `preview?: AIPreviewUpdate`. The protocol remains
schema-less and internal; both sides and the docs are updated together.

### `AiClientService`

New `downloadPreview({ downloadPath, destPath, signal })` mirroring `downloadResult`:

- `resolvePreviewUrl()` resolves the AI-provided path against `AI_SERVICE_URL` and
  requires same origin plus pathname
  `^/preview/[A-Za-z0-9_-]{1,128}/(latest|\d{1,9})$` — the same URL-authority-injection
  / SSRF defense as `resolveResultUrl`.
- Sends the bearer token; streams the image response to the local file.
- The AI URL is never exposed to the frontend.

### `ProcessingService`

In the `processing` branch of `handleUpdate`, after the normal progress update: if the
update carries `preview` and `PREVIEW_ENABLED` is true, start a non-awaited,
flag-guarded download to `PREVIEW_DIR/{jobId}/{frameIndex}.jpg`, copy atomically to
`PREVIEW_DIR/{jobId}/latest.jpg`, then call `UploadService.setJobPreview(...)`. The
in-flight flag lives on the job's `ActiveJob` entry. Failures: warn and continue —
percentage updates are unaffected, the job never fails because of a preview.

### `UploadService`

- `JobRecord` gains `preview?: { frameIndex: number; width?: number; height?: number }`.
- New `setJobPreview(jobId, preview)`: stores it on the record and emits a `JobUpdate`
  (current state/progress plus `preview` with
  `imageUrl: /api/upload/preview/{jobId}/{frameIndex}` — the same relative-URL
  precedent as `JobResult.downloadUrl`), respecting sticky terminal states (no
  emission once terminal).
- Because `getJobUpdates$` uses `startWith(currentState)`, a reconnecting SSE client
  immediately receives the latest preview.
- `getJobStatus` includes the preview too, so the SSE-to-polling fallback keeps
  previews working.

### `UploadController` — new public endpoints

```http
GET /api/upload/preview/:jobId/latest
GET /api/upload/preview/:jobId/:frameIndex
```

(`latest` route declared first so it wins over `:frameIndex`.)

- Zod-validated params: existing `jobId` rules; `frameIndex` must match `^\d{1,9}$`.
- The job must exist in the in-memory map — previews are only exposed for known jobs.
- Resolved file path must stay inside `PREVIEW_DIR`; 404 when missing; no filesystem
  paths in error responses.
- `Content-Type: image/jpeg`.
- Cache headers: `latest` → `Cache-Control: no-store`; indexed frame →
  `Cache-Control: public, max-age=31536000, immutable`.
- No AI token involved — these are public browser-facing endpoints.

## Shared package changes

### `@repo/schemas/jobs`

```ts
export const jobPreviewSchema = z.object({
  frameIndex: z.number().int().nonnegative(),
  imageUrl: z.string(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional()
});
```

Added as `preview: jobPreviewSchema.optional()` to **both** `jobUpdateSchema` and
`jobStatusSchema`. Backward-compatible: payloads without `preview` still parse; types
are inferred, never duplicated. Note `exactOptionalPropertyTypes` when constructing
updates (spread-conditional pattern, no explicit `undefined`).

### `@repo/consts/upload`

```ts
export const UPLOAD_PREVIEW_LATEST_ENDPOINT = '/api/upload/preview/:jobId/latest' as const;
export const UPLOAD_PREVIEW_FRAME_ENDPOINT = '/api/upload/preview/:jobId/:frameIndex' as const;
```

### `@repo/contracts`

Previews are binary endpoints like the video stream — documented in the comment block
in `upload.contracts.ts`; no JSON contract objects. Existing endpoint constants and
`/api/upload/stream/:jobId` (final video) are unchanged.

## Frontend changes (`apps/frontend`)

### `Products.tsx`

On upload, create `URL.createObjectURL(file)` and keep it in page state (the `File`
currently lives only in `VideoUploadForm`, which unmounts when processing starts).
Revoke on reset and unmount. Pass down as `originalSrc` to `JobStatusPanel`.

### `JobStatusPanel.tsx`

Tracks the latest `preview` from each `JobUpdate` (SSE and the polling fallback both
carry it). While `processing`:

- no preview yet → "Preparing first enhanced preview…" placeholder;
- preview present → render `BeforeAfterPreviewSlider`.

Progress bar, stop button, and terminal handling unchanged.

### `BeforeAfterPreviewSlider.tsx` (new, dependency-free)

- Container sized by the enhanced frame's aspect ratio.
- Bottom layer: muted, paused, `playsInline` `<video src={originalSrc}>`; on each new
  preview it seeks to `(progress / 100) * duration`. Fallback `originalSrc`:
  `buildApiUrl(UPLOAD_STREAM_ENDPOINT, { jobId })` (serves the original upload before
  completion because `resultPath` starts as `uploadPath`).
- Top layer: enhanced `<img>` clipped with `clip-path: inset(...)` at the slider
  percentage.
- Draggable divider driven by pointer events; responsive; labels "Original" and
  "Enhanced preview"; shows the latest `frameIndex` and progress percent as metadata
  (`totalFrames` stays internal to the NDJSON protocol and is not in `JobUpdate`).
- Preview URL built from `UPLOAD_PREVIEW_FRAME_ENDPOINT` + `jobId` +
  `preview.frameIndex`.
- Flicker avoidance: preload each new frame-indexed URL with an `Image()` and swap
  `src` only on load (URLs are immutable-cached).
- Loading state handled; no new dependencies.

### Unchanged

`JobResultPanel` and the completed state render exactly as today; upload API, XHR
progress, and cancel flow untouched.

## Data contracts

AI NDJSON `processing` line with preview (preview is optional; lines without it remain
valid):

```json
{
  "status": "processing",
  "progress": 42,
  "currentFrame": 210,
  "totalFrames": 500,
  "preview": {
    "frameIndex": 210,
    "width": 640,
    "height": 360,
    "downloadUrl": "/preview/{jobId}/210"
  }
}
```

Frontend-visible SSE `JobUpdate` when a preview is available (`preview` optional;
existing clients keep working without it):

```json
{
  "jobId": "abc",
  "state": "processing",
  "progress": 42,
  "updatedAt": "2026-07-02T...",
  "preview": {
    "frameIndex": 210,
    "imageUrl": "/api/upload/preview/abc/210",
    "width": 640,
    "height": 360
  }
}
```

## Security requirements

- AI preview endpoints: internal, token-protected (`AI_INTERNAL_TOKEN` when set),
  `jobId`/`frameIndex` validated, containment inside `WORK_PREVIEW_DIR`, no
  caller-supplied paths.
- Backend preview endpoints: public, but only serve locally cached previews for known
  jobs; params Zod-validated; containment inside `PREVIEW_DIR`; traversal rejected.
- Backend preview download: same-origin + path-pattern check (SSRF / URL-authority
  injection defense), bearer token attached, token never logged.
- The GPU server URL (`http://10.10.248.31:8000` or any AI origin) never appears in
  browser-visible payloads.
- Never log `AI_INTERNAL_TOKEN` or full Authorization headers; no sensitive
  filesystem internals in user-facing errors.
- Nothing committed: secrets, `.env`, previews, videos, results, checkpoints,
  `node_modules`, `dist`, `.turbo`, `__pycache__` (verify `storage/` gitignore covers
  the new preview dirs).

## Error handling

- Preview generation failure (AI): log, skip that preview, inference continues.
- Preview download failure (backend): log warning, skip, job and progress unaffected.
- Preview endpoints: RFC 7807 problem details via the existing global filter (backend);
  plain 400/404 HTTPException (AI), consistent with existing endpoints.
- Terminal job states remain sticky; preview updates after a terminal state are
  ignored.

## Testing

- **Backend:** typecheck + build; e2e additions where the structure allows (preview
  404 for unknown job, 400 for invalid `frameIndex`); unit tests for pure helpers
  (preview URL resolution, preview path resolution, env validation additions, optional
  preview schema parsing). Existing e2e suite must still pass.
- **AI:** `python -m py_compile server.py security.py`; `python test_security.py`
  extended with preview path safety, invalid job IDs, invalid frame indexes. No GPU
  required for automated tests.
- **Frontend:** `pnpm --filter frontend check-types && pnpm --filter frontend build`;
  slider compiles cleanly.
- **Full repo:** `pnpm install --frozen-lockfile && pnpm lint && pnpm check-types &&
  pnpm build` plus the AI checks above.

### Manual test plan

Start AI, backend (`AI_TRANSFER_MODE=remote` against the GPU box, or local
equivalent), frontend. Upload a small video (< 20 MB) and confirm: upload works;
percentage updates; AI emits preview metadata before completion; backend downloads and
re-hosts previews at `/api/upload/preview/:jobId/...`; SSE updates include optional
`preview`; the before/after slider renders; the final video still appears on
completion; `/api/upload/stream/:jobId` still works; cancel still works; the browser
never calls the GPU host and no GPU URL appears in any browser-visible payload.

## Documentation updates (same branch)

- Root `README.md`, `AGENTS.md`, `CLAUDE.md` (env table, runtime data flow, job
  lifecycle).
- `apps/backend/AGENTS.md`, `apps/ai/AGENTS.md`, `apps/frontend/AGENTS.md` (endpoints,
  NDJSON protocol shapes with the no-shared-schema warning, env vars, upload-flow
  description).
- `.env.development.example` / `.env.production.example` for backend and AI.
- `.cursor/rules` if conventions changed.

Docs must state: progress percentage still exists; previews appear during processing;
the final MP4 is still only available after completion; this is not live video
streaming; the frontend talks only to the backend; the backend pulls internal previews
from the AI; AI preview endpoints are token-protected; backend preview endpoints
expose cached local previews; preview storage grows until manually cleaned (no cleanup
in this branch — matches the existing uploads/results limitation).

## Acceptance criteria

- Existing upload → AI processing → final result flow still works, including
  percentage progress, cancel, and `/api/upload/stream/:jobId`.
- A preview frame appears in the UI before job completion; the before/after slider is
  usable.
- The backend never exposes GPU URLs to the frontend; AI token auth still works; path
  traversal is prevented on both preview stores.
- No secrets or generated artifacts committed.
- TypeScript checks, lint, and builds pass; Python syntax + security tests pass.
- All listed docs updated in the same branch.

## Known limitations

- Preview storage (AI and backend side) grows until manually cleaned, like uploads and
  results today.
- Original/enhanced alignment is approximate (progress-fraction seek), not exact frame
  sync.
- Job state (including previews' in-memory metadata) does not survive a backend
  restart; orphaned preview files may remain on disk.
- In-flight preview downloads are skipped rather than queued, so under very fast
  cadence some sampled frames never reach the backend (by design).
