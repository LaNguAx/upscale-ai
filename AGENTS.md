# UPscale agent guide

## Purpose

AI-powered video restoration and super-resolution (B.Sc. CS final project, Deep Learning specialization). A pnpm + Turborepo monorepo: React frontend, NestJS backend, and a Python PyTorch inference service.

## Keeping docs truthful (mandatory)

If you change behavior, structure, endpoints, env vars, schemas, commands, or workflow, you MUST update the affected documentation **in the same change**:

- The root `README.md`, `AGENTS.md`, and `CLAUDE.md`.
- The app-level `AGENTS.md`, `CLAUDE.md`, and `README.md` of every app you touched.
- The matching `.cursor/rules/*.mdc` files when standards or conventions change.

Stale docs are treated as bugs. Per-app `CLAUDE.md` files are one-line `@AGENTS.md` imports — keep them that way and edit the `AGENTS.md` instead.

## Workspace map

### Apps

- `apps/frontend` — Vite 8 + React 19 SPA (port 5173 via `VITE_PORT`). Tailwind v4, shadcn/ui, Redux Toolkit + RTK Query, React Router 7. See `apps/frontend/AGENTS.md`.
- `apps/backend` — NestJS 11 API under `/api` prefix (port 3000 via `PORT`, Swagger UI at `/docs` in dev). Multer disk uploads, SSE job updates, HTTP Range streaming. Bridges to the AI service over HTTP NDJSON in either `path` or `remote` transport mode (`AI_TRANSFER_MODE`). See `apps/backend/AGENTS.md`.
- `apps/ai` — Python FastAPI + PyTorch BasicVSR/SPyNet inference service (port 8000). Exposes `/health`, path-based `/process`, multipart `/process-upload`, `/result/:jobId`, `/cancel`, and `/preview/:jobId/latest` + `/preview/:jobId/:frameIndex` (token-guarded internal endpoints). Managed via `requirements.txt`; the `package.json` only wraps uvicorn for Turborepo. Run `pnpm --filter ai run setup` once (the explicit `run` matters — pnpm 10 otherwise invokes its builtin `setup` command) to install Python deps. See `apps/ai/AGENTS.md`.

### Shared packages

- `@repo/consts` — endpoint path strings (`/api/health`, `/api/upload`, status/result/cancel/stream/events) and app constants. Leaf package.
- `@repo/schemas` — Zod 4 schemas and inferred types. Subpaths: `/health`, `/jobs` (`JobState`, `JobStatus`, `JobUpdate`, `isTerminalJobState`, `jobPreviewSchema`), `/upload` (`UploadResponse`, `JobResult`, `CancelJobResponse`), `/errors` (RFC 7807 `problemDetailsSchema`).
- `@repo/contracts` — typed `EndpointContract<TResponse, TBody, TParams, TQuery>` objects combining consts + schemas. The binary stream and SSE endpoints are path-only (documented in `upload.contracts.ts`).
- `@repo/eslint-config` — ESLint 9 flat configs: `base`, `node`, `react-internal`.
- `@repo/typescript-config` — TS presets: `base.json`, `node.json`, `vite.json` (plus `nextjs.json`/`react-library.json` kept for parity with the upstream starter).

### Dependency flow

```
@repo/consts (leaf)
  └─▶ @repo/schemas (+ zod)
        └─▶ @repo/contracts
              └─▶ apps/frontend
backend consumes @repo/schemas directly (via nestjs-zod DTOs)
```

Packages build bottom-up; Turbo orders tasks via `^build`. Shared packages export from `dist/` via `package.json` exports maps (no barrel files), so they must be built before production runs — Turbo handles this.

### Runtime data flow

```
frontend (5173) ── REST + SSE + XHR upload ──▶ backend (3000, /api)
backend ── HTTP NDJSON (path or multipart) ──▶ ai service (8000)
backend ── HTTP preview JPEG downloads ──▶ ai service (8000)
backend ⇄ storage/uploads, storage/results, storage/previews (disk, gitignored)
```

- The backend→AI transport is selected by `AI_TRANSFER_MODE` (see `apps/backend/AGENTS.md`):
  - **`path`** (default, local/dev): the backend sends **absolute filesystem paths** (`inputPath`, `outputPath`) to `/process`. Both services must run on the same machine or share a volume.
  - **`remote`** (two-server deployment, no shared storage): the backend uploads the video to `/process-upload` and downloads the result from `/result/:jobId`. Designed for an app server (frontend + backend + storage) and a separate GPU server running the AI service. The two communicate over an internal network with a bearer token (`AI_INTERNAL_TOKEN`); the frontend never talks to the GPU server directly.
  - Progressive preview frames are pulled by the backend over HTTP from the AI's `/preview/:jobId/...` endpoints in **both** transports (there is no filesystem shortcut, even in `path` mode) — the frontend only ever sees the backend's own `/api/upload/preview/...` URLs, never the AI service's address.
- Job state lives in an in-memory `Map` in `UploadService` — it does not survive a backend restart, and there is no cleanup of old jobs or files, including cached preview frames under `storage/previews` (known limitations).

## Job lifecycle

States (`@repo/schemas/jobs`): `queued → processing → completed | failed | cancelled`. Terminal states are **sticky** — `updateJob` ignores further updates once a job is terminal.

1. `POST /api/upload` (multipart field `video`) → Multer writes `storage/uploads/{uuid}{ext}`, job created as `queued`, processing starts fire-and-forget, `{ jobId }` returned immediately.
2. Backend checks AI `GET /health` (requires `model_loaded: true`), then hands off work per `AI_TRANSFER_MODE`: in `path` mode `POST /process` with `{ jobId, inputPath, outputPath, scale: 4 }`; in `remote` mode `POST /process-upload` with the `video` file (multipart). Either way it consumes the NDJSON progress stream and pushes each update to the per-job SSE stream (`/api/upload/events/:jobId`). Along the way, sampled enhanced preview JPEGs are written on the AI (frame 1, then every `PREVIEW_EVERY_N_FRAMES`th frame) and referenced on `processing` lines; the backend downloads each one, fire-and-forget, to `PREVIEW_DIR/{jobId}/`, and surfaces it as an optional `preview` object (`jobPreviewSchema`, with a public `/api/upload/preview/:jobId/:frameIndex` URL) on `JobUpdate`/`JobStatus`. A preview download failure is logged and never fails the job.
3. On the AI's `completed` line: in `path` mode the backend verifies the output file the AI wrote; in `remote` mode it first downloads `GET /result/:jobId` from the AI and saves it locally. Either way the local result is at `storage/results/{jobId}_enhanced{ext}` and the job is marked `completed`. The final enhanced video only ever becomes available at this point — progressive previews are still-frame snapshots during processing, not a live video stream, and never substitute for the completed result.
4. Cancel (`POST /api/upload/cancel/:jobId`): backend marks the job `cancelled` in memory first, aborts the in-flight fetch, then calls AI `POST /cancel` (404 from the AI is tolerated). The AI deletes its partial output, including its cached preview frames for that job.
5. `GET /api/upload/result/:jobId` (completed only) returns metadata; `GET /api/upload/stream/:jobId` streams the video with HTTP Range support; `GET /api/upload/preview/:jobId/latest` (`Cache-Control: no-store`) and `GET /api/upload/preview/:jobId/:frameIndex` (public, `max-age=31536000, immutable`) serve cached preview JPEGs for known jobs (404 otherwise).

NDJSON message shapes are documented in `apps/ai/AGENTS.md`, typed in `apps/backend/src/upload/ai-protocol.types.ts`, and implemented in `apps/backend/src/upload/ai-client.service.ts` + `apps/ai/server.py`. There is **no shared Zod schema** for this internal protocol — changing it requires updating both sides (and the docs). Internal AI endpoints `/process-upload`, `/result/:jobId`, `/cancel`, and `/preview/:jobId/...` require `Authorization: Bearer <AI_INTERNAL_TOKEN>` when that secret is set.

## Integration pattern

1. `@repo/consts` defines endpoint paths.
2. `@repo/schemas` defines Zod schemas; types are inferred, never duplicated.
3. `@repo/contracts` combines them into `EndpointContract` objects.
4. Backend: DTOs extend `createZodDto(schema)` from `nestjs-zod`. Global `ZodValidationPipe` validates params/bodies, `ZodSerializerInterceptor` validates responses, `HttpExceptionFilter` emits RFC 7807 `ProblemDetails` with `traceId` from the request-id middleware.
5. Frontend: RTK Query endpoints build URLs from contract paths (`interpolatePath`) and validate responses with `contract.responseSchema.parse(...)`. The API origin comes from `VITE_API_BASE_URL` (no `/api` suffix — paths carry it).

## Non-negotiables

- Preserve shared TypeScript, ESLint, and Prettier baselines — never weaken per-app.
- Prefer changes in shared packages over per-app drift.
- Do not rename `@repo/*` scopes.
- Do not touch `apps/ai/baseline/` model code or the checkpoint without an explicit request.
- When structure or workflow changes, update `README.md`, `AGENTS.md`, `CLAUDE.md`, and `.cursor/rules` in the same change (see "Keeping docs truthful" above).

## Commands

| Command               | Scope | Purpose                                                                        |
| --------------------- | ----- | ------------------------------------------------------------------------------ |
| `pnpm dev`            | all   | Start all apps in watch mode via Turbo (frontend 5173, backend 3000, ai 8000)  |
| `pnpm dev:web`        | web   | Start frontend + backend only (5173, 3000); includes shared `@repo/*` watchers |
| `pnpm dev:ai`         | ai    | Start the Python AI service only (8000)                                        |
| `pnpm build`          | all   | Build all packages and apps (bottom-up)                                        |
| `pnpm preview`        | all   | Build, then run apps in local production rehearsal mode                        |
| `pnpm preview:web`    | web   | Build, then run frontend + backend only                                        |
| `pnpm preview:ai`     | ai    | Run the AI service in production mode (no reload)                              |
| `pnpm start:prod`     | all   | Build, then run apps in pure production mode                                   |
| `pnpm start:prod:web` | web   | Build, then run frontend + backend in prod mode                                |
| `pnpm start:prod:ai`  | ai    | Run the AI service in production mode                                          |
| `pnpm lint`           | all   | Lint everything (zero warnings enforced)                                       |
| `pnpm check-types`    | all   | Type-check everything                                                          |
| `pnpm format`         | all   | Format all files with Prettier                                                 |
| `pnpm format:check`   | all   | Check formatting without writing                                               |

Single app: `pnpm --filter <name> <script>` (e.g. `pnpm --filter backend dev`).
Backend tests: `pnpm --filter backend test:e2e` (boots the real `AppModule`; does **not** mock or exercise the AI processing path).
The AI app defines `dev`, `preview`, `start:prod`, and `setup` — Turbo skips it for build/lint/check-types. Shared packages define only `build`/`dev`.

## Working style

- Use app-local `@/` alias for imports from `src/*` in frontend and backend.
- Import order: external libs → `@repo/*` packages → `@/` aliases → relative imports.
- Kebab-case filenames; no barrel files — packages use `package.json` exports maps.
- Look up library docs via Context7 MCP (and Tavily MCP for current web research when Context7 is insufficient) before writing framework-specific code — e.g. NestJS, FastAPI, Node `fetch`/`FormData`/streams, Vite.
- Verify with `pnpm lint && pnpm check-types && pnpm build` before claiming work is complete.
