# upscale-ai — Claude Code Instructions

## Project Overview
AI-powered image upscaling web application. pnpm monorepo with three packages:
- `backend/` — NestJS 11 REST API (TypeScript)
- `frontend/` — React 19 + Vite + Redux Toolkit + shadcn/ui (TypeScript)
- `ai/` — AI processing package (to be built)

## Commands

### Root
```bash
pnpm install          # install all workspace dependencies
```

### Backend (`backend/`)
```bash
pnpm run start:dev    # dev server with watch (port 3000)
pnpm run build        # compile TypeScript
pnpm run test         # unit tests (Jest)
pnpm run test:e2e     # e2e tests
pnpm run lint         # ESLint --fix
pnpm run typecheck    # tsc --noEmit
```

### Frontend (`frontend/`)
```bash
pnpm run dev          # Vite dev server (port 5173)
pnpm run build        # production build
pnpm run lint         # ESLint
```

## Architecture

### Backend
- Global prefix: `/api`
- Swagger docs: `http://localhost:3000/docs`
- Config: environment-aware (`NODE_ENV` → `.env.development` / `.env.production`)
- Validation: `class-validator` + `class-transformer` with global `ValidationPipe`
- Module pattern: feature modules (e.g. `HealthModule`) imported into `AppModule`

### Frontend
- Router: React Router v7 (`createBrowserRouter`)
- State: Redux Toolkit + RTK Query for API calls
- UI: shadcn/ui components (in `src/ui/shadcn/`) + Tailwind CSS v4
- Alias: `@/` maps to `src/`
- Structure: `src/ui/pages/`, `src/ui/components/`, `src/ui/layouts/`, `src/store/`

## Code Style

### TypeScript (both packages)
- Strict TypeScript — no `any`, no `// @ts-ignore` without explanation
- Use `const` over `let` wherever possible
- Prefer explicit return types on public functions/methods
- Prettier config: see `backend/.prettierrc` and `frontend/.prettierrc`
- ESLint enforced — run `pnpm run lint` before committing

### NestJS Backend
- One module per feature (controllers, services, module file in same folder)
- Use DTOs with `class-validator` decorators for all request bodies
- Use `@nestjs/config` / `ConfigService` for all env var access — no direct `process.env`
- Decorate controllers with `@ApiTags`, `@ApiOperation` for Swagger docs
- Unit test every service; e2e test every controller endpoint

### React Frontend
- Functional components only, hooks for state
- RTK Query for all server data fetching — no raw `fetch`/`axios`
- shadcn/ui for UI primitives — don't build custom buttons/inputs from scratch
- Keep components small and focused; extract logic into custom hooks
- Co-locate component tests next to the component file

## Security Rules
- **Never commit `.env` files** — a pre-commit hook will block this automatically
- Store secrets in `.env.*.local` files (gitignored)
- Validate all user input at the controller layer with DTOs
- Never log sensitive values (tokens, passwords)
- Add auth guards before exposing any non-health endpoint

## Git Conventions
- Branch format: `type/author/short-description` (e.g. `feat/itay/image-upload`)
- Commit messages: imperative mood, present tense (`add`, `fix`, `update`)
- PRs target `main`; squash-merge preferred

## Environment Variables
- Backend env files: `backend/.env`, `backend/.env.development`, `backend/.env.production`
- Copy from `backend/.env.development.example` / `backend/.env.production.example`
- Required vars documented in the example files

## Context Management Tips
- Use Context7 MCP (`use context7`) to pull up-to-date NestJS / React docs
- Use Sequential Thinking MCP for complex multi-step architecture decisions
- Use GitHub MCP for PR reviews and issue tracking
- Use Playwright MCP for browser-based testing of the frontend
