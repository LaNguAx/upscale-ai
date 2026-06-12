# backend agent guide

NestJS 11 API on Express. Global prefix `/api`, port 3000 (`PORT`), Swagger at `/docs` in dev only (mounted outside `/api`).

> Doc sync: if you change endpoints, job lifecycle, env vars, or structure here, update this file, `README.md`, the root `AGENTS.md`/`CLAUDE.md`, and `.cursor/rules` in the same change. `CLAUDE.md` in this folder is an `@AGENTS.md` import — edit this file instead.

## Structure

- `src/main.ts` + `src/bootstrap.ts` — app creation and `configureApp()` (helmet, CORS, `/api` prefix, Swagger). The split exists so e2e tests can apply the same config without listening.
- `src/app/app.module.ts` — root module: env validation, env file load order (`.env.{NODE_ENV}.local` → `.env.local` → `.env.{NODE_ENV}` → `.env`), global `ZodValidationPipe` (`APP_PIPE`), `ZodSerializerInterceptor` (`APP_INTERCEPTOR`), `HttpExceptionFilter` (`APP_FILTER`), `RequestIdMiddleware` on all routes.
- `src/health/` — `GET /api/health` returning `{ status, service, uptime, timestamp }`.
- `src/upload/` — the product:
  - `upload.module.ts` — Multer disk storage config (destination, `{uuid}{ext}` filename, size limit, extension filter).
  - `upload.controller.ts` — all upload/job endpoints.
  - `upload.service.ts` — in-memory job `Map<string, JobRecord>`, RxJS `Subject<JobUpdate>` for SSE, job CRUD, stream metadata.
  - `processing.service.ts` — bridge to the Python AI service: health pre-flight, NDJSON `/process` stream consumption, `/cancel` bridge.
  - `dto/upload.dto.ts` — `createZodDto` wrappers around `@repo/schemas`.
- `src/filters/http-exception.filter.ts` — global `@Catch()` → RFC 7807 `ProblemDetails`.
- `src/middleware/request-id.middleware.ts` — `x-request-id`: echoes a safe incoming ID (`/^[A-Za-z0-9._-]{1,128}$/`) or generates a UUID; sets `req.id` and the response header.
- `src/utils/env.validation.ts` — Zod schema for ALL env vars; startup fails on invalid env.
- `src/consts/` — error titles, problem `type` URIs, HTTP status→title map used by the filter.
- `test/app.e2e-spec.ts` — the only test suite (see Testing).

## Endpoints

| Method | Path                        | Notes                                                        |
| ------ | --------------------------- | ------------------------------------------------------------ |
| POST   | `/api/upload`               | Multipart, field name `video`. Returns `{ jobId }` (201)     |
| GET    | `/api/upload/status/:jobId` | Full `JobStatus`                                             |
| GET    | `/api/upload/result/:jobId` | `JobResult`; 400 unless state is `completed`                 |
| POST   | `/api/upload/cancel/:jobId` | Returns `{ jobId }` (201)                                    |
| SSE    | `/api/upload/events/:jobId` | `JobUpdate` JSON per message; completes after terminal event |
| GET    | `/api/upload/stream/:jobId` | Binary video with HTTP Range support (206 partial)           |
| GET    | `/api/health`               | Health check                                                 |

Route strings live in the controllers; the matching path constants in `@repo/consts/upload` are consumed by the frontend/contracts. Keep both in sync when changing routes.

## Job lifecycle

States: `queued → processing → completed | failed | cancelled`. Terminal states are sticky — `UploadService.updateJob` ignores any update once a job is terminal.

1. **Upload** — Multer writes `storage/uploads/{uuid}{ext}` (extension checked against `ALLOWED_VIDEO_EXTENSIONS` on the original name, size against `MAX_FILE_SIZE_MB`). `createJob` stores the record as `queued`; **`resultPath` initially equals `uploadPath`**. `processJob` runs fire-and-forget (errors only logged); the client must use SSE or polling.
2. **Processing** (`processing.service.ts`) — output path is `RESULT_DIR/{jobId}_enhanced{ext}`. Pre-flight `GET {AI_SERVICE_URL}/health` (5s timeout) requires `model_loaded === true`. Then `POST {AI_SERVICE_URL}/process` with `{ jobId, inputPath, outputPath, scale: 4 }` (**`scale` is hardcoded**; seq len/degradation are owned by the AI engine). Paths are absolute — backend and AI must share a filesystem.
3. **NDJSON consumption** — the response body is parsed line-by-line: `failed` throws (job → `failed`); `cancelled` marks the job cancelled; a `progress` field updates `processing` percent; `completed` verifies the output file exists, calls `setResultPath`, marks `completed` at 100. A stream that ends without a terminal line → `failed`. Malformed JSON → `failed`. The `AIProcessUpdate` shape is defined inline in `processing.service.ts` — there is no shared Zod schema for this internal protocol (full message shapes in `apps/ai/AGENTS.md`).
4. **SSE** — `getJobUpdates$` emits the current state immediately (`startWith`), filters by `jobId`, and `takeWhile(..., true)` includes the terminal event before completing the stream.
5. **Cancel** — order matters: mark `cancelled` in memory first, then `abortController.abort()` the in-flight fetch, then `POST {AI_SERVICE_URL}/cancel` (non-OK responses are logged warnings; 404 is acceptable — the AI job may already be done). `isCancelled()` checks during stream handling prevent completing after a user cancel.
6. **Streaming** — `GET /stream/:jobId` serves `job.resultPath` with Range support (`206`, `Content-Range`) and a MIME map by extension. It does **not** require `completed` — before processing finishes it serves the original upload, since `resultPath` starts as `uploadPath`.

## Env vars (`src/utils/env.validation.ts`)

`NODE_ENV` (`development`), `PORT` (`3000`), `CORS_ORIGIN` (`*` → allow all; otherwise comma-separated exact origins), `AI_SERVICE_URL` (`http://localhost:8000`), `UPLOAD_DIR` (`../../storage/uploads`), `RESULT_DIR` (`../../storage/results`), `MAX_FILE_SIZE_MB` (`500`), `ALLOWED_VIDEO_EXTENSIONS` (`.mp4,.avi,.mkv,.mov,.wmv,.webm`). Dirs resolve from `process.cwd()` (normally `apps/backend`) and are created on startup. Examples in `.env.development.example` / `.env.production.example`.

## Error handling

- All exceptions → `HttpExceptionFilter` → RFC 7807 `{ type, title, status, instance, detail?, errors?, traceId? }` (`problemDetailsSchema` in `@repo/schemas/errors`). `traceId` comes from the request-id middleware.
- `ZodValidationException` → 400 `/problems/validation-failed` (Zod issues included in dev only); serialization failures and unknown errors → 500 `/problems/internal-error` (sanitized in prod).
- DTOs never define shapes locally — always `createZodDto(schema)` from `@repo/schemas`; controllers use `@ZodResponse` for OpenAPI + response serialization.

## Testing

- `pnpm --filter backend test:e2e` — boots the **real** `AppModule` via `configureApp`. Covers health, 404 ProblemDetails, request-id echo/generation, Swagger availability (dev) / absence (prod, via stubbed ConfigService), helmet headers. **The AI service is not mocked and the upload/processing path is not exercised** — adding such tests requires stubbing `fetch` to `AI_SERVICE_URL`.
- `pnpm --filter backend test` passes with no tests (none exist).

## Gotchas

- Jobs live only in memory: lost on restart, never cleaned up (disk files included). No queue — concurrent uploads hit the AI service concurrently. No auth or rate limiting.
- `result.downloadUrl` is a relative path (`/api/upload/stream/{jobId}`); `outputFilename` is a display name (`{base}_enhanced_by_upscale{ext}`) — the file on disk is `{jobId}_enhanced{ext}`.
- The Swagger-documented `product` form field on upload is accepted but never read.
- Multer's `fileFilter` rejects via plain `Error`, so a rejected extension may not produce a clean ProblemDetails.
- Range parsing does not bounds-check `start`/`end` against the file size.

## Conventions

- Use the `@/` alias for `src/*` imports.
- Thin controllers; business logic in services. Module → Controller → Service per domain feature.

## Commands

- `pnpm --filter backend dev` — watch mode.
- `pnpm --filter backend test:e2e` — e2e suite.
- `pnpm --filter backend lint|check-types|build`.
