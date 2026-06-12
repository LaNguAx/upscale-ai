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
- `apps/backend` — NestJS 11 API under `/api` prefix (port 3000 via `PORT`, Swagger UI at `/docs` in dev). Multer disk uploads, SSE job updates, HTTP Range streaming. Bridges to the AI service over HTTP NDJSON. See `apps/backend/AGENTS.md`.
- `apps/ai` — Python FastAPI + PyTorch BasicVSR/SPyNet inference service (port 8000). Managed via `requirements.txt`; the `package.json` only wraps uvicorn for Turborepo. Run `pnpm --filter ai setup` once to install Python deps. See `apps/ai/AGENTS.md`.

### Shared packages

- `@repo/consts` — endpoint path strings (`/api/health`, `/api/upload`, status/result/cancel/stream/events) and app constants. Leaf package.
- `@repo/schemas` — Zod 4 schemas and inferred types. Subpaths: `/health`, `/jobs` (`JobState`, `JobStatus`, `JobUpdate`, `isTerminalJobState`), `/upload` (`UploadResponse`, `JobResult`, `CancelJobResponse`), `/errors` (RFC 7807 `problemDetailsSchema`).
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
backend ── HTTP NDJSON ──▶ ai service (8000)
backend ⇄ storage/uploads, storage/results (disk, gitignored)
```

- The backend sends the AI service **absolute filesystem paths** (`inputPath`, `outputPath`). Both services must run on the same machine or share a volume.
- Job state lives in an in-memory `Map` in `UploadService` — it does not survive a backend restart, and there is no cleanup of old jobs or files (known limitations).

## Job lifecycle

States (`@repo/schemas/jobs`): `queued → processing → completed | failed | cancelled`. Terminal states are **sticky** — `updateJob` ignores further updates once a job is terminal.

1. `POST /api/upload` (multipart field `video`) → Multer writes `storage/uploads/{uuid}{ext}`, job created as `queued`, processing starts fire-and-forget, `{ jobId }` returned immediately.
2. Backend checks AI `GET /health` (requires `model_loaded: true`), then `POST /process` with `{ jobId, inputPath, outputPath, scale: 4 }` and consumes the NDJSON progress stream, pushing each update to the per-job SSE stream (`/api/upload/events/:jobId`).
3. On the AI's `completed` line the backend verifies the output file exists at `storage/results/{jobId}_enhanced{ext}` and marks the job `completed`.
4. Cancel (`POST /api/upload/cancel/:jobId`): backend marks the job `cancelled` in memory first, aborts the in-flight fetch, then calls AI `POST /cancel` (404 from the AI is tolerated). The AI deletes its partial output.
5. `GET /api/upload/result/:jobId` (completed only) returns metadata; `GET /api/upload/stream/:jobId` streams the video with HTTP Range support.

NDJSON message shapes are documented in `apps/ai/AGENTS.md` and implemented in `apps/backend/src/upload/processing.service.ts` + `apps/ai/server.py`. There is **no shared Zod schema** for this internal protocol — changing it requires updating both files (and the docs).

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
- Look up library docs via Context7 MCP before writing framework-specific code.
- Verify with `pnpm lint && pnpm check-types && pnpm build` before claiming work is complete.
