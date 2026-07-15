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

1. **Upload** — `VideoUploadForm.tsx` (drag-and-drop, MIME allowlist, 500 MB client cap). `uploadVideo` in `upscale.api.ts` uses a **custom XHR in `queryFn`** because fetch has no upload progress events — do not refactor it to a plain `builder.mutation`/fetch. FormData fields: `video` (file) only. Errors are parsed as RFC 7807 (`detail`/`title`). The whole product flow is wrapped in `ProductErrorBoundary.tsx` (a small class component) so a render crash shows an alert + reset instead of a white page.
2. **Live updates** — `JobStatusPanel.tsx` opens a native `EventSource` to `UPLOAD_EVENTS_ENDPOINT` (SSE is **outside** RTK Query). Each message is validated with `jobUpdateSchema`. On SSE failure it falls back to polling `getJobStatusContract.path` every 1s with raw `fetch`, giving up after 30 attempts. Terminal states close the stream and notify the parent. (`useGetJobStatusQuery` exists in the RTK API but is unused by the UI.) `JobStatusPanel` forwards each optional `preview` (`JobPreview` from `@repo/schemas/jobs`) from **both** the SSE `JobUpdate` and the polling `JobStatus` payloads up to `Products.tsx` via `onPreview`, where a freshest-frame guard keeps the newest `frameIndex` (a slow poll can resolve after a newer SSE update).
3. **ComparisonPlayer** — `Products.tsx` keeps ONE `ComparisonPlayer.tsx` mounted across `processing → completed` (no component swap on completion). While processing it plays a buffered **flipbook** of the pixel-aligned original/enhanced JPEG pairs via the `usePreviewPlayback` hook (`use-preview-playback.ts`): frame pairs are prefetched and decoded ahead of the playhead (`PREFETCH_CONCURRENCY` = 3, `PREFETCH_AHEAD_SECONDS` = 5), playback starts once `BUFFER_TARGET_SECONDS` (3) of runway exist, a rAF clock advances at the source pace (`fps`/`stride` from `jobPreviewSchema`) while staying `SAFETY_LAG_SECONDS` (2) behind the newest announced frame, and underruns hold the last frame with a "Buffering preview…" badge until the buffer refills (frames behind the playhead are evicted after `EVICT_BEHIND_SECONDS`). Frame URLs come from `UPLOAD_PREVIEW_FRAME_ENDPOINT` + `…_ORIGINAL_FRAME_ENDPOINT` (immutable/cacheable, no `Date.now()` cache-busting; the sampled-frame sequence is derived from `fps`/`stride`, so missed SSE announcements don't create gaps); without `fps`/`stride` (older backend) the hook falls back to the legacy latest-still behavior. The two layers are split by a pointer-dragged CSS `clip-path` divider, which keeps working over moving frames. On completion it swaps (once the first video frame decodes) to the H.264 enhanced `<video>` (`UPLOAD_STREAM_ENDPOINT`) with the original comparison video (`UPLOAD_STREAM_ORIGINAL_ENDPOINT`, present when `jobResult.originalStreamUrl` is set) synced underneath, and custom controls: play/pause, seek, elapsed/total time, volume + mute (enhanced only), fullscreen — buffered flipbook frames keep playing until that first video frame decodes, so the handoff is seamless. Whenever an original layer is unavailable the player degrades to enhanced-only and hides the divider (a single failed original frame keeps the last good original layer instead). The flipbook runs behind real time by design (delayed broadcast); the final video only exists after `completed`.
4. **Cancel** — `useCancelJobMutation`; UI sets `isStopping` and waits for SSE/polling to report `cancelled` (the terminal transition is asynchronous).
5. **Result** — playback lives in the ComparisonPlayer (step 3); `JobResultPanel.tsx` is actions-only: fetches metadata via `useGetJobResultQuery` and downloads the stream as a blob named `result.outputFilename`. **The `downloadUrl`/`originalStreamUrl` fields are used for presence checks only** — URLs are always built from `@repo/consts/upload`.

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
