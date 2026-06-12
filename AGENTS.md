# UPscale agent guide

## Purpose

AI-powered video restoration and super-resolution (B.Sc. CS final project, Deep Learning specialization). A pnpm + Turborepo monorepo: React frontend, NestJS backend, and a Python PyTorch inference service.

## Workspace map

### Apps

- `apps/frontend` — Vite 8 + React 19 SPA (port 5173 via `VITE_PORT`). Tailwind v4, shadcn/ui, Redux Toolkit + RTK Query, React Router 7.
- `apps/backend` — NestJS 11 API under `/api` prefix (port 3000 via `PORT`, Swagger UI at `/docs` in dev). Multer disk uploads, SSE job updates, HTTP Range streaming. Bridges to the AI service over HTTP NDJSON.
- `apps/ai` — Python FastAPI + PyTorch BasicVSR/SPyNet inference service (port 8000). Managed via `requirements.txt`; the `package.json` only wraps uvicorn for Turborepo. Run `pnpm --filter ai setup` once to install Python deps.

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

Packages build bottom-up; Turbo orders tasks via `^build`.

### Runtime data flow

```
frontend (5173) ── REST + SSE + XHR upload ──▶ backend (3000, /api)
backend ── HTTP NDJSON ──▶ ai service (8000)
backend ⇄ storage/uploads, storage/results (disk, gitignored)
```

Job state lives in an in-memory `Map` in `UploadService` — it does not survive a backend restart (known limitation).

### Integration pattern

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
- When structure or workflow changes, update `README.md`, `AGENTS.md`, `CLAUDE.md`, and `.cursor/rules` in the same change.

## Commands

| Command             | Scope | Purpose                                                                       |
| ------------------- | ----- | ----------------------------------------------------------------------------- |
| `pnpm dev`          | all   | Start all apps in watch mode via Turbo (frontend 5173, backend 3000, ai 8000) |
| `pnpm build`        | all   | Build all packages and apps (bottom-up)                                       |
| `pnpm preview`      | all   | Build, then run apps in local production rehearsal mode                       |
| `pnpm start:prod`   | all   | Build, then run apps in pure production mode                                  |
| `pnpm lint`         | all   | Lint everything (zero warnings enforced)                                      |
| `pnpm check-types`  | all   | Type-check everything                                                         |
| `pnpm format`       | all   | Format all files with Prettier                                                |
| `pnpm format:check` | all   | Check formatting without writing                                              |

Single app: `pnpm --filter <name> <script>` (e.g. `pnpm --filter backend dev`).
Backend tests: `pnpm --filter backend test:e2e`.
The AI app only defines `dev`, `start:prod`, and `setup` — Turbo skips it for build/lint/check-types.

## Working style

- Use app-local `@/` alias for imports from `src/*` in frontend and backend.
- Import order: external libs → `@repo/*` packages → `@/` aliases → relative imports.
- Kebab-case filenames; no barrel files — packages use `package.json` exports maps.
- Look up library docs via Context7 MCP before writing framework-specific code.
