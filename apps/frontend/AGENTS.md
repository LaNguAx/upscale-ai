# frontend agent guide

Vite 8 + React 19 SPA. Port 5173 (`VITE_PORT`). Tailwind v4 (CSS-config in `src/styles/index.css`), shadcn/ui primitives in `src/ui/shadcn/`, Redux Toolkit + RTK Query, React Router 7.

> Doc sync: if you change the upload flow, routes, state management, or structure here, update this file, `README.md`, the root `AGENTS.md`/`CLAUDE.md`, and `.cursor/rules` in the same change. `CLAUDE.md` in this folder is an `@AGENTS.md` import — edit this file instead.

## Structure

- `src/main.tsx` / `src/App.tsx` — entry (StrictMode, Redux `Provider`) and `RouterProvider`.
- `src/router/index.ts` — routes: Home, Products (the single upload tool, no slug), Technology, About, all nested under `RootLayout` (Navbar + Footer).
- `src/store/` — Redux store; `store/api/upscale.api.ts` is the RTK Query API (upload with XHR progress, status, result, cancel); `store/slices/job.slice.ts` holds `activeJobs` (currently write-only scaffolding — nothing reads it).
- `src/config/api.ts` — `API_ORIGIN` from `VITE_API_BASE_URL` (origin only, no `/api` — it strips a legacy `/api` suffix), plus `buildApiUrl`/`interpolatePath` helpers for contract paths.
- `src/ui/pages|components|layouts` — feature components; `src/ui/shadcn/` is vendored shadcn (lint-relaxed, avoid editing). `cn()` lives at `@/ui/shadcn/lib/utils` (the `components.json` `utils` alias is stale — use the lib path).
- `src/consts/` — frontend-only UI data (navigation, features).
- `src/utils/format.ts` — `formatFileSize` (used), `formatDuration` (currently unused).

## The upscale flow

Everything lives under `/products` — a single page for the one real model the AI service runs (BasicVSR + SPyNet, fixed 4x super-resolution). There used to be a multi-"product" catalog (Denoise/Deblur/Artifacts/Pro) and a `/products/:slug` route, but the backend never read the slug and those tools don't exist in the inference pipeline — they were removed rather than left as misleading marketing.

`src/ui/pages/Products.tsx` orchestrates with a **local** `PageState` machine (`idle | uploading | processing | completed | failed | cancelled`) in `useState` — not Redux. A page refresh loses in-flight job UI state.

1. **Upload** — `VideoUploadForm.tsx` (drag-and-drop, MIME allowlist, 500 MB client cap). `uploadVideo` in `upscale.api.ts` uses a **custom XHR in `queryFn`** because fetch has no upload progress events — do not refactor it to a plain `builder.mutation`/fetch. FormData fields: `video` (file) only. Errors are parsed as RFC 7807 (`detail`/`title`). `Products.tsx` also lifts an object URL of the selected file (`URL.createObjectURL`, tracked in a ref and revoked on replace/reset/unmount) so the live preview slider has an immediate "original" video source; if none is available it falls back to `buildApiUrl(UPLOAD_STREAM_ENDPOINT, { jobId })`.
2. **Live updates** — `JobStatusPanel.tsx` opens a native `EventSource` to `UPLOAD_EVENTS_ENDPOINT` (SSE is **outside** RTK Query). Each message is validated with `jobUpdateSchema`. On SSE failure it falls back to polling `getJobStatusContract.path` every 1s with raw `fetch`, giving up after 30 attempts. Terminal states close the stream and notify the parent. (`useGetJobStatusQuery` exists in the RTK API but is unused by the UI.) `JobStatusPanel` also tracks an optional `preview` (`JobPreview` from `@repo/schemas/jobs`) taken from **both** the SSE `JobUpdate` and the polling `JobStatus` payloads — whichever arrives with a newer frame wins.
3. **Progressive preview** — while `state === 'processing'` and a preview has arrived, `JobStatusPanel` renders `BeforeAfterPreviewSlider.tsx`: a paused, muted `<video>` (the original, seeked to `(progress / 100) * duration`) layered under the latest enhanced preview JPEG, revealed by a pointer-dragged divider via CSS `clip-path`. The preview `<img>` src is built from `UPLOAD_PREVIEW_FRAME_ENDPOINT` (`@repo/consts/upload`) with the reported `frameIndex` — **not** the `latest` endpoint — because frame-indexed URLs are immutable/cacheable (backend serves them with `max-age=31536000, immutable`), so there is no `Date.now()`-style cache-busting and images are preloaded before swap to avoid flicker. This is a still-frame preview sampled during processing, not a live video stream; the final enhanced video is unaffected and only becomes available once the job is `completed` (step 4).
4. **Cancel** — `useCancelJobMutation`; UI sets `isStopping` and waits for SSE/polling to report `cancelled` (the terminal transition is asynchronous).
5. **Result** — `JobResultPanel.tsx` fetches metadata via `useGetJobResultQuery`, plays the video from `buildApiUrl(UPLOAD_STREAM_ENDPOINT, { jobId })` (HTTP Range), and downloads by fetching the stream as a blob named `result.outputFilename`. **The `downloadUrl` field from the API is ignored** — always build the stream URL from `@repo/consts/upload`.

## Conventions

- API paths come from `@repo/consts`/`@repo/contracts`; response types from `@repo/schemas`. Never hardcode `/api/...` strings or duplicate response types.
- Responses are validated with `contract.responseSchema.parse(...)`; SSE payloads with `jobUpdateSchema` from `@repo/schemas/jobs`.
- Backend errors are RFC 7807 — read `detail`/`title` from error payloads. `Product.tsx` also handles RTK `CUSTOM_ERROR` strings from the XHR upload path.
- Use the `@/` alias for `src/*` imports.
- Tailwind v4 is CSS-first: theme tokens in `src/styles/index.css` (`@theme inline`, OKLCH tokens); there is no `tailwind.config.js`. Dark-mode tokens exist but no toggle applies `.dark` anywhere.
- Pages compose `<section className="py-16 sm:py-20">` + `PageContainer` (`max-w-7xl`; product flow uses `max-w-2xl`). Icons are lucide-react.

## Gotchas

- `VITE_API_BASE_URL` must be the backend **origin** (`http://localhost:3000`), never with `/api` — shared path constants already include it.
- Client validates MIME types; the backend validates file **extensions** — the two can disagree on edge cases.
- Native `EventSource` does not send credentials like XHR/fetch do; irrelevant today (no auth) but matters if auth is added.
- Shared `@repo/*` packages export from `dist/` — they must be built for production builds (Turbo `^build` handles this).

## Commands

- `pnpm --filter frontend dev|build|preview|lint|check-types`.
- Env: `VITE_PORT` (5173), `VITE_API_BASE_URL` (`http://localhost:3000`); examples in `.env.development.example`.
