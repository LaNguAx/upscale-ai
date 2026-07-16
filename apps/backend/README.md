# UPscale backend

NestJS 11 API that accepts video uploads, orchestrates super-resolution jobs against the Python AI service, and streams results back to the frontend. Runs on port 3000 under the `/api` global prefix. Swagger UI is available at `/docs` in development.

Part of the UPscale monorepo — see the root [README](../../README.md) and [AGENTS.md](AGENTS.md) for the full picture.

## Quick start

```bash
pnpm install               # from the repo root
pnpm --filter backend dev  # watch mode on http://localhost:3000
```

The AI service (`apps/ai`, port 8000) must be running with its model checkpoint loaded for processing to succeed; uploads themselves work without it (jobs fail at the AI health pre-flight).

## Endpoints

| Method | Path                        | Purpose                                  |
| ------ | --------------------------- | ---------------------------------------- |
| POST   | `/api/upload`               | Multipart upload (field `video`) → jobId |
| GET    | `/api/upload/status/:jobId` | Job status snapshot                      |
| SSE    | `/api/upload/events/:jobId` | Live job updates                         |
| POST   | `/api/upload/cancel/:jobId` | Cancel a running job                     |
| GET    | `/api/upload/result/:jobId` | Result metadata (completed jobs only)    |
| GET    | `/api/upload/stream/:jobId` | Video streaming with HTTP Range support  |
| GET    | `/api/health`               | Health check                             |

Errors follow RFC 7807 ProblemDetails with an `x-request-id`-derived `traceId`.

## Configuration

Copy `.env.development.example` to `.env.development.local` and adjust as needed. All env vars are Zod-validated at startup (`src/utils/env.validation.ts`):

| Variable                    | Default                           |
| --------------------------- | --------------------------------- |
| `PORT`                      | `3000`                            |
| `CORS_ORIGIN`               | `*`                               |
| `AI_SERVICE_URL`            | `http://localhost:8000`           |
| `UPLOAD_DIR` / `RESULT_DIR` | `../../storage/{uploads,results}` |
| `MAX_FILE_SIZE_MB`          | `500` (recommended prod: `100`)   |
| `ALLOWED_VIDEO_EXTENSIONS`  | `.mp4,.avi,.mkv,.mov,.wmv,.webm`  |

## Testing and checks

```bash
pnpm --filter backend test:e2e     # boots the real AppModule
pnpm --filter backend lint
pnpm --filter backend check-types
pnpm --filter backend build
```

## Known limitations

- Job state is held in an in-memory `Map` — it does not survive a restart, and old jobs/files are never cleaned up.
- No authentication or rate limiting.
- The backend and AI service must share a filesystem (absolute paths are exchanged).

For architecture details, the job lifecycle, and agent conventions, read [AGENTS.md](AGENTS.md).
