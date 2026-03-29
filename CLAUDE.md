# Upscale AI — Claude Code Instructions

## CRITICAL: Project Context
**At the start of every session, read `Upscale-Project-Characterization.pdf` in the repo root.** This 26-page document is the complete project specification — it defines the AI architecture, pipeline design, API spec, milestones, and every technical decision. Do not make assumptions about the project without reading it first. Every feature must align with this characterization.

## Project Summary
AI-powered video restoration & super-resolution. B.Sc. CS final project (Deep Learning specialization). Three-package monorepo: `frontend/` (React), `backend/` (NestJS), `ai/` (Python/PyTorch). Full characterization in the PDF above.

## Running the Project
```bash
pnpm -F backend start:dev     # Backend on :3000
pnpm -F frontend dev           # Frontend on :5173
cd ai && python server.py      # AI service on :8000 (optional — mock fallback exists)
```

---

## Code Quality Standards

### General Principles
- **Read before you write.** Always read existing code before modifying it. Understand patterns, conventions, and architecture before suggesting changes.
- **Simplest solution first.** Don't over-engineer. Three similar lines are better than a premature abstraction. Only add complexity when the current task demands it.
- **Do what was asked, nothing more.** A bug fix doesn't need surrounding code cleaned up. A feature doesn't need extra configurability. Don't add docstrings, comments, or type annotations to code you didn't change.
- **Test your work.** Use Playwright MCP for end-to-end browser testing. Use curl for API testing. Build both packages before declaring done. Don't just generate code — verify it works.
- **Don't guess — verify.** If unsure about an API, framework behavior, or existing code pattern, read the source or use Context7 MCP for docs. Don't rely on assumptions.

### Writing Clean Code
- Write code that reads like prose. Clear variable names, obvious control flow, self-documenting structure.
- Functions should do one thing. If you can't name it clearly, it's doing too much.
- Error handling at boundaries only — don't defensively code against impossible states inside trusted internal code.
- No dead code, no commented-out code, no `// TODO` markers unless there's a concrete plan. If something is removed, remove it completely.
- Imports should be clean — no unused imports. Group them logically (stdlib, external, internal).

### TypeScript Conventions
- Strict mode always. `verbatimModuleSyntax: true` means use `import type` for type-only imports.
- Named exports over default exports (except where framework requires it).
- Prefer `interface` for object shapes, `type` for unions/intersections.
- No `any` unless absolutely unavoidable (and explain why).
- Use `const` assertions and literal types where they add clarity.

### React Conventions
- Functional components only. Named exports.
- Side effects in `useEffect`, never in render body. No `setTimeout` in render — use effects.
- State management: local state for UI, Redux for shared/server state, RTK Query for API calls.
- Use `useCallback` for handlers passed as props. Use `useRef` for values that shouldn't trigger re-renders.
- Component files: one component per file, file name matches component name.

### CSS / Styling
- Tailwind CSS v4 with CSS-based config (no `tailwind.config.js`).
- Use `cn()` utility for conditional class merging.
- Mobile-first responsive design (`sm:`, `md:`, `lg:` breakpoints).
- Theme colors via CSS custom properties in oklch color space.
- No inline styles unless dynamically computed.

### NestJS Conventions
- Module pattern: every feature gets its own module with controller + service + DTOs.
- Use class-validator for DTO validation, Swagger decorators for API docs.
- Inject dependencies via constructor — never instantiate services manually.
- Use `ConfigService` for all environment variables — no `process.env` in services.
- Error responses via NestJS built-in exceptions (`NotFoundException`, `BadRequestException`, etc.).

### Python Conventions
- Type hints where practical.
- Clean imports — no duplicate imports, no wildcard imports.
- Functions over classes unless state is needed.
- Use `pathlib.Path` over string path manipulation.
- PyTorch: `torch.no_grad()` for inference, `.eval()` mode, proper device management.

## Architecture Knowledge

### Data Flow
```
Upload: Frontend FormData → Backend Multer → storage/uploads/
Process: Backend → AI Service (NDJSON streaming) → storage/results/
Progress: AI → Backend (NDJSON) → Frontend (SSE)
Playback: Frontend <video> → Backend HTTP Range → storage/results/
```

### Key API Endpoints
- `POST /api/upload` — multipart video upload, returns `{ jobId }`
- `GET /api/upload/status/:jobId` — job state + progress
- `GET /api/upload/result/:jobId` — result metadata
- `GET /api/upload/stream/:jobId` — video streaming (HTTP Range / 206)
- `SSE /api/upload/events/:jobId` — real-time progress

### Environment Variables
- Backend: `PORT`, `AI_SERVICE_URL`, `UPLOAD_DIR`, `RESULT_DIR`, `MAX_FILE_SIZE_MB`, `ALLOWED_VIDEO_EXTENSIONS`
- Frontend: `VITE_API_BASE_URL`

## Hard-Learned Lessons (Do NOT Repeat)
- **Don't use Radix DropdownMenu for hover menus.** Radix portals the content outside the DOM tree, breaking hover chains. Use CSS `group-hover:visible` pattern instead.
- **Don't use RTK Query polling when SSE exists.** The backend has SSE endpoints — use native `EventSource` for real-time updates, not `pollingInterval`.
- **Don't set Content-Type on FormData.** The browser must set the multipart boundary automatically. RTK Query's `fetchBaseQuery` doesn't handle upload progress — use custom `queryFn` with `XMLHttpRequest`.
- **Don't call `setTimeout` in React render body.** This causes state update loops. Always wrap in `useEffect`.
- **Socket.IO is NOT for video streaming.** HTTP Range requests are what `<video>` elements natively support. Socket.IO is for bidirectional messaging (chat, notifications), not binary data transfer.
- **Don't spawn background server processes from Claude Code.** They pile up and cause port conflicts. Let the user manage their own terminals.
- **Cross-origin `<a download>` doesn't work.** For cross-origin file downloads, fetch as blob and create an object URL programmatically.
- **NestJS ValidationPipe doesn't interfere with Multer.** Multipart parsing happens before validation — `forbidNonWhitelisted` is safe with file uploads.

## Git Workflow
- Branch naming: `feature/<name>/<description>` (e.g., `feature/itay/frontend-ui`)
- Create PRs to `main` via `gh pr create`
- Don't commit: `storage/`, `ai/checkpoints/*.pth`, `.claude/settings.local.json`, `.playwright-mcp/`
- GitHub CLI: `export PATH="$PATH:/c/Program Files/GitHub CLI"` needed in this session's shell

## Recommended MCPs
- **Playwright** — End-to-end browser testing. Upload files, click buttons, verify UI states, take screenshots.
- **Context7** — Library documentation lookup. Use for NestJS, React, Tailwind, PyTorch, FastAPI docs.
