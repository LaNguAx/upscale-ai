# UPscale frontend

Vite 8 + React 19 single-page app for UPscale — marketing pages plus the video upscaling flow (upload, live progress, playback, download). Styled with Tailwind CSS 4 and shadcn/ui; state via Redux Toolkit + RTK Query; routing via React Router 7.

Part of the UPscale monorepo — see the root [README](../../README.md) and [AGENTS.md](AGENTS.md) for the full picture.

## Quick start

```bash
pnpm install                # from the repo root
pnpm --filter frontend dev  # http://localhost:5173
```

The backend (`apps/backend`, port 3000) must be running for the upscale flow; for actual processing the AI service (`apps/ai`, port 8000) is needed too. `pnpm dev:web` from the repo root starts frontend + backend together.

## Pages

| Route          | Page                                            |
| -------------- | ------------------------------------------------ |
| `/`            | Home (hero, features, how-it-works)               |
| `/products`    | Video Upscaler — the one working upload flow      |
| `/technology`  | Tech overview (pipeline, architecture, stack)      |
| `/about`       | Project, team, academic context                    |

## Configuration

Copy `.env.development.example` to `.env.development.local` if you need overrides:

| Variable            | Default                 | Notes                             |
| ------------------- | ----------------------- | --------------------------------- |
| `VITE_PORT`         | `5173`                  | Dev/preview server port           |
| `VITE_API_BASE_URL` | `http://localhost:3000` | Backend origin — no `/api` suffix |

## Checks

```bash
pnpm --filter frontend lint
pnpm --filter frontend check-types
pnpm --filter frontend build
```

For architecture details, the upload/SSE flow, and agent conventions, read [AGENTS.md](AGENTS.md).
