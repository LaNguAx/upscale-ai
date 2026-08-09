@AGENTS.md

## Keeping docs truthful

If you change behavior, structure, endpoints, env vars, schemas, commands, or workflow, update the affected `README.md`, `AGENTS.md`, `CLAUDE.md`, and `.cursor/rules` files in the same change. Per-app `CLAUDE.md` files are `@AGENTS.md` imports — edit the `AGENTS.md`, not the import.

## Environment variables

| App      | Variable                   | Default                            | Source                                             |
| -------- | -------------------------- | ---------------------------------- | -------------------------------------------------- |
| backend  | `NODE_ENV`                 | `development`                      | Zod-validated at startup (`env.validation.ts`)     |
| backend  | `PORT`                     | `3000`                             | Zod-validated at startup                           |
| backend  | `CORS_ORIGIN`              | `*`                                | Zod-validated. Comma-separated allowlist in prod   |
| backend  | `AI_SERVICE_URL`           | `http://localhost:8000`            | Zod-validated                                      |
| backend  | `AI_TRANSFER_MODE`         | `path`                             | Zod enum (`path` \| `remote`)                      |
| backend  | `AI_INTERNAL_TOKEN`        | `` (empty)                         | Zod-validated. Bearer for internal AI calls        |
| backend  | `UPLOAD_DIR`               | `../../storage/uploads`            | Zod-validated, resolved from `apps/backend`        |
| backend  | `RESULT_DIR`               | `../../storage/results`            | Zod-validated, resolved from `apps/backend`        |
| backend  | `MAX_FILE_SIZE_MB`         | `500`                              | Zod-validated                                      |
| backend  | `ALLOWED_VIDEO_EXTENSIONS` | `.mp4,.avi,...`                    | Zod-validated                                      |
| backend  | `PREVIEW_ENABLED`          | `true`                             | Zod-validated (`z.stringbool()`)                   |
| backend  | `PREVIEW_DIR`              | `../../storage/previews`           | Zod-validated, resolved from `apps/backend`        |
| frontend | `VITE_PORT`                | `5173`                             | Read in `vite.config.ts`                           |
| frontend | `VITE_API_BASE_URL`        | `http://localhost:3000`            | Backend origin (no `/api` suffix), `config/api.ts` |
| ai       | `CHECKPOINT_PATH`          | `./checkpoints/vsr_model_best.pth` | Read in `server.py`                                |
| ai       | `DEVICE`                   | auto (`cuda`/`cpu`)                | Read in `server.py`                                |
| ai       | `MAX_INPUT_HEIGHT`         | `480`                              | Read in `server.py`                                |
| ai       | `HIGH_RES_POLICY`          | `reject`                           | Read in `server.py`; reject/downscale/native       |
| ai       | `AI_INTERNAL_TOKEN`        | `` (empty)                         | Read in `server.py`; bearer auth when set          |
| ai       | `WORK_UPLOAD_DIR`          | `../../storage/ai/uploads`         | Read in `server.py` (remote-mode uploads)          |
| ai       | `WORK_RESULT_DIR`          | `../../storage/ai/results`         | Read in `server.py` (remote-mode results)          |
| ai       | `HOST` / `PORT`            | `0.0.0.0` / `8000`                 | Read in `server.py`                                |
| ai       | `PREVIEW_ENABLED`          | `true`                             | Read in `server.py`                                |
| ai       | `PREVIEW_EVERY_N_FRAMES`   | `2`                                | Read in `server.py` (flipbook playback stride)     |
| ai       | `PREVIEW_MAX_WIDTH`        | `640`                              | Read in `server.py`                                |
| ai       | `PREVIEW_JPEG_QUALITY`     | `80`                               | Read in `server.py`                                |
| ai       | `WORK_PREVIEW_DIR`         | `../../storage/ai/previews`        | Read in `server.py` (preview frames)               |

## Verification

Run before claiming work is complete:

```
pnpm lint && pnpm check-types && pnpm build
```

## Code standards

### TypeScript

- Never use `any` — use `unknown` with type guards.
- Use `import type` for type-only imports.
- Use `satisfies` for type validation while preserving literal types.
- Model states with discriminated unions, not optional fields.
- Honor the strict baseline in `packages/typescript-config/base.json` — do not disable `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, or other strict flags.

### Imports and file organization

- Order: external libs → `@repo/*` packages → `@/` local aliases → relative imports.
- One exported concept per file. Kebab-case filenames.
- No barrel files — use `package.json` exports maps instead.
- Max ~300 lines per file. Max 3 function params (use an options object beyond that).

### Dependencies

- Before adding a dependency, check if it exists in the monorepo or can be written in <20 lines.
- Shared deps belong in shared packages, not per-app.
- Use `pnpm` for all package operations. Never hand-edit lock files.

### Zod

- Schemas live in `@repo/schemas`, shared across all apps.
- Infer types from schemas with `z.infer<typeof schema>` — never duplicate types manually.
- Use `z.strictObject()` to reject unknown keys on inputs.

### Python (apps/ai)

- Do not modify `baseline/` model architecture or inference code without an explicit request.
- The AI engine owns inference parameters (sequence length, degradation simulation) — the backend only sends `jobId`, `inputPath`, `outputPath`, `scale`.

### Error handling

- Never swallow errors — every catch must log, rethrow, or handle meaningfully.
- Backend errors are RFC 7807 `ProblemDetails`; frontend error extraction reads `detail`/`title`.
- Always handle promise rejections in async code.
