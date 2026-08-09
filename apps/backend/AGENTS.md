# backend agent guide

NestJS 11 API on Express. Global prefix `/api`, port 3000 (`PORT`), Swagger at `/docs` in dev only (mounted outside `/api`).

> Doc sync: if you change endpoints, job lifecycle, env vars, or structure here, update this file, `README.md`, the root `AGENTS.md`/`CLAUDE.md`, and `.cursor/rules` in the same change. `CLAUDE.md` in this folder is an `@AGENTS.md` import — edit this file instead.

## Structure

- `src/main.ts` + `src/bootstrap.ts` — app creation and `configureApp()` (helmet with `Cross-Origin-Resource-Policy: cross-origin` so a different-origin frontend can embed preview/stream media, CORS, `/api` prefix, Swagger). The split exists so e2e tests can apply the same config without listening.
- `src/app/app.module.ts` — root module: env validation, env file load order (`.env.{NODE_ENV}.local` → `.env.local` → `.env.{NODE_ENV}` → `.env`), global `ZodValidationPipe` (`APP_PIPE`), `ZodSerializerInterceptor` (`APP_INTERCEPTOR`), `HttpExceptionFilter` (`APP_FILTER`), `RequestIdMiddleware` on all routes.
- `src/health/` — `GET /api/health` returning `{ status, service, uptime, timestamp }`.
- `src/upload/` — the product:
  - `upload.module.ts` — Multer disk storage config (destination, `{uuid}{ext}` filename, size limit, extension filter).
  - `upload.controller.ts` — all upload/job endpoints.
  - `upload.service.ts` — in-memory job `Map<string, JobRecord>`, RxJS `Subject<JobUpdate>` for SSE, job CRUD, stream metadata.
  - `processing.service.ts` — orchestration only: prepares the output path, runs the AI health pre-flight, consumes the AI update stream, records preview metadata (no downloads — see `preview-cache.service.ts`), saves the result (downloading it in remote mode), updates job state, and deletes the job's cached preview frames once it reaches a terminal state. Owns the per-job `AbortController` map and cancel ordering.
  - `ai-client.service.ts` — all HTTP I/O with the Python AI service. Picks the transport from `AI_TRANSFER_MODE` (`path` → `POST /process` with filesystem paths; `remote` → `POST /process-upload` multipart upload + `GET /result/:jobId` download), parses the NDJSON stream into typed updates, and bridges `/cancel`. `downloadPreview` throws a distinguishable `AiPreviewNotFoundError` on 404 so the proxy can map it to a public 404. Adds `Authorization: Bearer <AI_INTERNAL_TOKEN>` when a token is configured (never logged).
  - `preview-cache.service.ts` — cache-through proxy for preview JPEGs: serves from `PREVIEW_DIR` when cached, otherwise fetches the exact frame from the AI (while the job is processing), persists it atomically (uuid `.tmp` + rename, with in-flight dedup per `{jobId}/{frameKey}`), and serves it. `latest` keys are refetched fresh (stale-cached fallback on failure). Also owns `deleteJobPreviews` (terminal-state cleanup, never throws).
  - `ai-protocol.types.ts` — strict internal TS types for the (schema-less) backend↔AI NDJSON protocol: `AIHealthResponse`, `AITransferMode`, and the `AIProcessUpdate` discriminated union (`processing | completed | failed | cancelled`, `completed` carrying an optional `resultDownloadUrl`, `processing` carrying an optional `AIPreviewUpdate` preview object incl. optional `fps`/`stride` pacing metadata).
  - `preview-path.util.ts` — `resolvePreviewFilePath` resolves a cached preview JPEG's on-disk path from `PREVIEW_DIR` + `jobId` + a frame key (`latest` or a decimal frame index), rejecting path traversal; also exports `LATEST_FRAME_KEY`.
  - `preview-url.util.ts` — `resolveAiPreviewUrl` validates an AI-provided `/preview/{jobId}/{frame}` download path against the AI's own origin before the backend fetches it (SSRF / URL-authority-injection defense, mirroring the result-download check).
  - `dto/upload.dto.ts` — `createZodDto` wrappers around `@repo/schemas`.
- `src/filters/http-exception.filter.ts` — global `@Catch()` → RFC 7807 `ProblemDetails`.
- `src/middleware/request-id.middleware.ts` — `x-request-id`: echoes a safe incoming ID (`/^[A-Za-z0-9._-]{1,128}$/`) or generates a UUID; sets `req.id` and the response header.
- `src/utils/env.validation.ts` — Zod schema for ALL env vars; startup fails on invalid env.
- `src/consts/` — error titles, problem `type` URIs, HTTP status→title map used by the filter.
- `test/app.e2e-spec.ts` + `test/preview.e2e-spec.ts` + `test/upload-limit.e2e-spec.ts` — e2e suites; unit specs live next to their sources in `src/` (see Testing).

## Endpoints

| Method | Path                                     | Notes                                                                                                                                         |
| ------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/upload`                            | Multipart, field name `video`. Returns `{ jobId }` (201)                                                                                      |
| GET    | `/api/upload/status/:jobId`              | Full `JobStatus`                                                                                                                              |
| GET    | `/api/upload/result/:jobId`              | `JobResult`; 400 unless state is `completed`                                                                                                  |
| POST   | `/api/upload/cancel/:jobId`              | Returns `{ jobId }` (201)                                                                                                                     |
| SSE    | `/api/upload/events/:jobId`              | `JobUpdate` JSON per message; completes after terminal event                                                                                  |
| GET    | `/api/upload/stream/:jobId`              | Enhanced video (H.264 `.mp4`) with HTTP Range support (206 partial)                                                                            |
| GET    | `/api/upload/stream/:jobId/original`     | Browser-safe original comparison video (H.264), Range support; 404 until downloaded/located                                                                                            |
| GET    | `/api/upload/preview/:jobId/latest`      | Latest preview JPEG; `Cache-Control: no-store`. Cache-through proxy: refetched fresh from the AI while the job processes (stale-cached fallback); 404 for unknown jobs (no AI contact) and after terminal states |
| GET    | `/api/upload/preview/:jobId/latest/original` | Matching original (input) frame of the latest pair; no-store; same proxy semantics                                                        |
| GET    | `/api/upload/preview/:jobId/:frameIndex` | One preview JPEG; `Cache-Control: public, max-age=31536000, immutable` (frame-indexed URLs never change content). Cache-through proxy: served from `PREVIEW_DIR` or fetched on demand from the AI while the job processes; 404 for unknown jobs (no AI contact), unwritten frames, and fetches after terminal states; 502 on AI transport failure |
| GET    | `/api/upload/preview/:jobId/:frameIndex/original` | Matching original (input) frame of a pair; immutable-cacheable; same proxy semantics                                                 |
| GET    | `/api/health`                            | Health check                                                                                                                                  |

Route strings live in the controllers; the matching path constants in `@repo/consts/upload` are consumed by the frontend/contracts. Keep both in sync when changing routes.

## Job lifecycle

States: `queued → processing → completed | failed | cancelled`. Terminal states are sticky — `UploadService.updateJob` ignores any update once a job is terminal.

1. **Upload** — Multer writes `storage/uploads/{uuid}{ext}` (extension checked against `ALLOWED_VIDEO_EXTENSIONS` on the original name, size against `MAX_FILE_SIZE_MB`). `createJob` stores the record as `queued`; **`resultPath` initially equals `uploadPath`**. `processJob` runs fire-and-forget (errors only logged); the client must use SSE or polling.
2. **Processing** (`processing.service.ts` + `ai-client.service.ts`) — output path is always `RESULT_DIR/{jobId}_enhanced.mp4` (the AI re-encodes results to browser-safe H.264 with the original's audio muxed in as AAC when present). Pre-flight `GET {AI_SERVICE_URL}/health` (5s timeout) requires `model_loaded === true`. The transport then depends on `AI_TRANSFER_MODE`:
   - **`path`** (same machine / shared volume, local/dev default): `POST {AI_SERVICE_URL}/process` with `{ jobId, inputPath, outputPath, scale: 4 }` (**`scale` is hardcoded**; seq len/degradation are owned by the AI engine). The AI writes directly to `outputPath`.
   - **`remote`** (two-server, no shared storage): `POST {AI_SERVICE_URL}/process-upload` as multipart (`jobId` + `video` file, streamed from disk via `fs.openAsBlob`). On the `completed` line the backend downloads `GET {AI_SERVICE_URL}{resultDownloadUrl}` and streams it to `outputPath`.
3. **NDJSON consumption** — `ai-client.service.ts` parses the response body line-by-line into `AIProcessUpdate` values; `processing.service.ts` reacts: `failed` throws (job → `failed`); `cancelled` marks the job cancelled; `processing` updates the percent; `completed` (after the remote download, if any) verifies the output file exists, best-effort acquires the `{jobId}_original.mp4` comparison video (remote: downloads `originalDownloadUrl`; path: picks it up from shared disk) via `setOriginalComparisonPath`, calls `setResultPath`, marks `completed` at 100. A stream that ends without a terminal line → `failed`. Malformed JSON → `failed`. The `AIProcessUpdate` shape lives in `ai-protocol.types.ts` — there is still no shared Zod schema for this internal protocol (full message shapes in `apps/ai/AGENTS.md`).
   - A `processing` line may carry an optional `preview: { frameIndex, downloadUrl, originalDownloadUrl?, width?, height?, fps?, stride? }` object (only when the AI actually wrote a sampled JPEG for that frame — never base64-inlined). When present, `capturePreview` records the metadata **without downloading anything**: `UploadService.setJobPreview` attaches a public `preview` (`jobPreviewSchema`: `frameIndex`, `imageUrl` = `/api/upload/preview/{jobId}/{frameIndex}`, `originalImageUrl` = `…/{frameIndex}/original` when the AI announced the pair, optional `width`/`height`/`fps`/`stride`) to the job, surfaced on both the SSE `JobUpdate` and polled `JobStatus`. The frames themselves are pulled lazily by `PreviewCacheService` when the client requests them (cache-through: `PREVIEW_DIR/{jobId}/{frameIndex}.jpg` / `{frameIndex}_in.jpg`), so delivery is client-paced and no announced frame is dropped. Proxy fetches happen over HTTP against the AI service in **both** transports — `path` mode has no filesystem shortcut for previews.
4. **SSE** — `getJobUpdates$` emits the current state immediately (`startWith`), filters by `jobId`, and `takeWhile(..., true)` includes the terminal event before completing the stream.
5. **Cancel** — order matters: mark `cancelled` in memory first, then `abortController.abort()` the in-flight fetch, then `AiClientService.cancel` → `POST {AI_SERVICE_URL}/cancel` (with bearer token when configured; non-OK responses are logged warnings; 404 is acceptable — the AI job may already be done). `isCancelled()` checks during stream handling prevent completing after a user cancel.
6. **Streaming** — `GET /stream/:jobId` serves `job.resultPath` with Range support (`206`, `Content-Range`) and a MIME map by extension. It does **not** require `completed` — before processing finishes it serves the original upload, since `resultPath` starts as `uploadPath`.

## Env vars (`src/utils/env.validation.ts`)

`NODE_ENV` (`development`), `PORT` (`3000`), `CORS_ORIGIN` (`*` → allow all; otherwise comma-separated exact origins), `AI_SERVICE_URL` (`http://localhost:8000`), `AI_TRANSFER_MODE` (`path` | `remote`, default `path`), `AI_INTERNAL_TOKEN` (default empty), `UPLOAD_DIR` (`../../storage/uploads`), `RESULT_DIR` (`../../storage/results`), `MAX_FILE_SIZE_MB` (`500`, recommended in prod too — note file size is a weak proxy for cost: the AI streams frames so RAM no longer scales with clip length, but processing time still does and there is no duration/frame-count guard yet, so a long low-bitrate clip within the cap can occupy the AI service for a very long time; any fronting Nginx needs `client_max_body_size` >= the cap), `ALLOWED_VIDEO_EXTENSIONS` (`.mp4,.avi,.mkv,.mov,.wmv,.webm`), `PREVIEW_ENABLED` (`z.stringbool()`, default `true` — master switch for caching/serving AI preview frames), `PREVIEW_DIR` (`../../storage/previews`). Dirs resolve from `process.cwd()` (normally `apps/backend`) and are created on startup. Examples in `.env.development.example` / `.env.production.example`.

- `AI_TRANSFER_MODE` selects the backend→AI transport. `path` sends absolute filesystem paths to `/process` (backend and AI share a disk — local/dev). `remote` uploads the video to `/process-upload` and downloads the result, for two-server deployments (app server + GPU server) with **no shared storage**.
- `AI_INTERNAL_TOKEN` is the shared secret for internal backend→AI calls. When non-empty, the backend sends `Authorization: Bearer <token>` to the AI's `/process-upload`, `/result`, `/cancel`, and `/preview/...` endpoints; it must match the AI service's `AI_INTERNAL_TOKEN`. Empty disables auth (local dev only). The token is never logged.

## Error handling

- All exceptions → `HttpExceptionFilter` → RFC 7807 `{ type, title, status, instance, detail?, errors?, traceId? }` (`problemDetailsSchema` in `@repo/schemas/errors`). `traceId` comes from the request-id middleware.
- `ZodValidationException` → 400 `/problems/validation-failed` (Zod issues included in dev only); serialization failures and unknown errors → 500 `/problems/internal-error` (sanitized in prod).
- Upload rejections: an oversized file (Multer `LIMIT_FILE_SIZE` → Nest `PayloadTooLargeException`) becomes a **413** whose `detail` names the configured cap (`UPLOAD_TOO_LARGE_DETAIL(MAX_FILE_SIZE_MB)`); a disallowed extension is rejected by the `fileFilter` with an `UnsupportedMediaTypeException` → clean **415**.
- DTOs never define shapes locally — always `createZodDto(schema)` from `@repo/schemas`; controllers use `@ZodResponse` for OpenAPI + response serialization.

## Testing

- `pnpm --filter backend test:e2e` — boots the **real** `AppModule` via `configureApp`. `app.e2e-spec.ts` covers health, 404 ProblemDetails, request-id echo/generation, Swagger availability (dev) / absence (prod, via stubbed ConfigService), helmet headers; `preview.e2e-spec.ts` covers the preview endpoints' 404/400 validation paths (unknown jobs must 404 locally, without contacting the AI); `upload-limit.e2e-spec.ts` covers the Multer rejection paths (413 with the configured cap in `detail`, 415 for a disallowed extension, 400 for no file — all rejected before the controller, so no job is created). **The AI service is not mocked and the upload/processing path is not exercised** — adding such tests requires stubbing `fetch` to `AI_SERVICE_URL`.
- `pnpm --filter backend test` — unit specs beside their sources: `env.validation.spec.ts`, `ai-client.service.spec.ts`, `preview-cache.service.spec.ts` (cache hit/miss, in-flight dedup, 404/502 mapping, terminal refusal, latest refetch/fallback, cleanup), `preview-path.util.spec.ts`, `preview-url.util.spec.ts`, `upload.service.spec.ts`.

## Gotchas

- Jobs live only in memory: lost on restart, never cleaned up (disk files included). No queue — concurrent uploads hit the AI service concurrently. No auth or rate limiting.
- Cached preview JPEGs under `PREVIEW_DIR/{jobId}/` are deleted when the job reaches a terminal state (`processJob`'s `finally` → `deleteJobPreviews`); orphans can remain only after a backend crash mid-job. Uploads/results still have no cleanup (known limitation).
- `result.downloadUrl` is a relative path (`/api/upload/stream/{jobId}`); `outputFilename` is a display name (`{base}_enhanced_by_upscale{ext}`) — the file on disk is `{jobId}_enhanced{ext}`.
- Range parsing does not bounds-check `start`/`end` against the file size.

## Conventions

- Use the `@/` alias for `src/*` imports.
- Thin controllers; business logic in services. Module → Controller → Service per domain feature.

## Commands

- `pnpm --filter backend dev` — watch mode.
- `pnpm --filter backend test:e2e` — e2e suite.
- `pnpm --filter backend lint|check-types|build`.
