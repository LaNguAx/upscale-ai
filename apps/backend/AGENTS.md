# backend agent guide

NestJS 11 API on Express. Global prefix `/api`, port 3000 (`PORT`), Swagger at `/docs` in dev only.

## Structure

- `src/main.ts` + `src/bootstrap.ts` — app creation and configuration (helmet, CORS, prefix, Swagger).
- `src/app/app.module.ts` — root module: env validation, global `ZodValidationPipe`, `ZodSerializerInterceptor`, `HttpExceptionFilter`, `RequestIdMiddleware`.
- `src/health/` — health check (status, uptime, timestamp).
- `src/upload/` — the product: multipart upload (Multer disk storage), in-memory job store, SSE job updates, HTTP Range streaming, and `processing.service.ts` which bridges to the Python AI service via NDJSON streaming.
- `src/filters/` — RFC 7807 ProblemDetails exception filter.
- `src/middleware/` — request-id middleware (`x-request-id`).
- `src/utils/env.validation.ts` — Zod schema for ALL env vars; startup fails on invalid env.

## Conventions

- DTOs are `createZodDto(schema)` wrappers around `@repo/schemas` — never define response/request shapes locally.
- Use the `@/` alias for `src/*` imports.
- Endpoints: `POST /api/upload`, `GET /api/upload/{status,result,stream}/:jobId`, `SSE /api/upload/events/:jobId`, `POST /api/upload/cancel/:jobId`, `GET /api/health`.

## Commands

- `pnpm --filter backend dev` — watch mode.
- `pnpm --filter backend test:e2e` — e2e suite (boots the real AppModule).
- `pnpm --filter backend lint|check-types|build`.
