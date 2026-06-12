# frontend agent guide

Vite 8 + React 19 SPA. Port 5173 (`VITE_PORT`). Tailwind v4 (CSS-config in `src/styles/index.css`), shadcn/ui primitives in `src/ui/shadcn/`, Redux Toolkit + RTK Query, React Router 7.

## Structure

- `src/router/` — routes: Home, Products, Product (`:slug`), Technology, About.
- `src/store/` — Redux store; `store/api/upscale.api.ts` is the RTK Query API (upload with XHR progress, status, result, cancel).
- `src/config/api.ts` — `API_ORIGIN` from `VITE_API_BASE_URL` (origin only, no `/api`), plus `buildApiUrl`/`interpolatePath` helpers for contract paths.
- `src/ui/pages|components|layouts` — feature components; `src/ui/shadcn/` is vendored shadcn (lint-relaxed, avoid editing).
- `src/consts/` — frontend-only UI data (products, navigation, features).

## Conventions

- API paths come from `@repo/consts`/`@repo/contracts`; response types from `@repo/schemas`. Never hardcode `/api/...` strings or duplicate response types.
- Responses are validated with `contract.responseSchema.parse(...)`; SSE payloads with `jobUpdateSchema`.
- Backend errors are RFC 7807 — read `detail`/`title` from error payloads.
- Use the `@/` alias for `src/*` imports.

## Commands

- `pnpm --filter frontend dev|build|preview|lint|check-types`.
