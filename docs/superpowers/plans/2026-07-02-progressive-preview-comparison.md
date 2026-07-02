# Progressive Preview Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show users a live before/after comparison of sampled enhanced frames while the AI is still processing their video, without touching the final MP4 pipeline.

**Architecture:** The AI writes sampled JPEG previews during inference and attaches metadata to its existing NDJSON progress stream; the backend downloads each preview over internal HTTP (token-guarded), caches it locally, and includes a public preview URL in the existing SSE job updates; the frontend renders a draggable before/after slider (paused original video layer under the latest enhanced JPEG). Spec: `docs/superpowers/specs/2026-07-02-progressive-preview-comparison-design.md`.

**Tech Stack:** FastAPI + OpenCV (`cv2.imencode`), NestJS 11 (`StreamableFile`, RxJS `Subject`), Zod 4 (`z.stringbool()`), React 19 (pointer events, `clip-path`), pnpm + Turborepo.

**Branch:** `feat/progressive-preview-comparison` (already created; spec committed).

## Global Constraints

- Never use `any`; strict TS baseline (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`) must stay intact.
- Import order: external libs → `@repo/*` → `@/` aliases → relative. Kebab-case filenames. No barrel files. Max ~300 lines/file, max 3 function params (options object beyond that).
- Zod schemas live in `@repo/schemas`; types via `z.infer`, never duplicated. `z.strictObject()` for inputs.
- Errors: never swallow — log, rethrow, or handle. Backend errors are RFC 7807 ProblemDetails.
- `apps/ai/baseline/` is normally off-limits; the ONLY authorized change is the `preview_callback` parameter in `process_video` (explicitly requested — Task 3). Do not touch `model_architecture.py`.
- Never log `AI_INTERNAL_TOKEN` or Authorization headers. No GPU-server URL may reach browser-visible payloads.
- Commit after every task. Never commit `.env`, storage artifacts, previews, or checkpoints (`storage` and `.env.*` are gitignored — keep it that way).
- Doc-sync mandate: behavior/endpoint/env changes must update `README.md`, `AGENTS.md`, `CLAUDE.md`, per-app `AGENTS.md`, and `.cursor/rules` in the same branch (Task 13).
- Verification before completion: `pnpm lint && pnpm check-types && pnpm build` plus AI `py_compile`/`test_security.py` and backend jest suites (Task 14).

## Research Notes (pre-implementation, per spec mandate)

| Checked | Conclusion | Impact |
| --- | --- | --- |
| Installed Zod version (`node_modules/zod` = 4.3.6) | `z.stringbool()` exists; parses `"true"/"1"/"yes"/"on"` → `true`, `"false"/"0"/"no"/"off"` → `false`, rejects garbage; `.default(true)` applies when the var is unset | Use for `PREVIEW_ENABLED` (plain `z.coerce.boolean()` would turn `"false"` into `true`) |
| FastAPI file serving | `FileResponse(path=..., media_type="image/jpeg")` — same pattern already used by `/result/{job_id}` in `server.py`; Starlette matches routes in declaration order, so the literal `/latest` route must be declared before `/{frame_index}` | AI preview endpoints copy the `/result` pattern |
| OpenCV JPEG encode | `cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, q])` returns `(ok, ndarray)`; write bytes to a tmp file + `os.replace` for an atomic publish | `_write_preview_files` implementation |
| Browser caching of changing previews | Frame-indexed URLs are immutable cache keys → `Cache-Control: public, max-age=31536000, immutable`; `latest` → `no-store`. No `?t=Date.now()` busting needed; preload with `new Image()` before swapping `src` to avoid flicker | Backend cache headers + slider component |
| Before/after slider patterns | CSS layered media + `clip-path: inset(0 0 0 X%)` on the top layer + pointer events (`setPointerCapture`) is the standard dependency-free approach | `BeforeAfterPreviewSlider` needs no library |
| Backend jest config (`apps/backend/package.json`) | Unit tests: `rootDir: src`, `*.spec.ts`, `@/` and `@repo/schemas/*` mapped to source. e2e: `test/jest-e2e.json` picks up `test/*.e2e-spec.ts` | Unit specs live next to sources; new e2e file `test/preview.e2e-spec.ts` |
| `.gitignore` | `storage` entry covers `storage/previews` and `storage/ai/previews`; `.env.*` ignored except `*.example` | No gitignore changes needed |

---

### Task 1: Shared contract surface (`@repo/schemas`, `@repo/consts`, `@repo/contracts`)

**Files:**
- Modify: `packages/schemas/src/jobs/job.schemas.ts`
- Modify: `packages/consts/src/upload/upload.consts.ts`
- Modify: `packages/contracts/src/upload/upload.contracts.ts` (trailing comment only)

**Interfaces:**
- Consumes: nothing (leaf change).
- Produces (used by Tasks 8, 10, 12): `jobPreviewSchema`, `type JobPreview`, optional `preview` on `jobUpdateSchema`/`jobStatusSchema`, `previewLatestParamsSchema`/`type PreviewLatestParams`, `previewFrameParamsSchema`/`type PreviewFrameParams`, `UPLOAD_PREVIEW_LATEST_ENDPOINT`, `UPLOAD_PREVIEW_FRAME_ENDPOINT`.

There is no test runner in `packages/*`; the verify cycle is build + repo-wide type-check (consumers compile against the new shapes in later tasks).

- [ ] **Step 1: Add the preview schema and params schemas to `job.schemas.ts`**

Insert after the `jobStateSchema` block (before `jobStatusSchema`):

```ts
/** Latest enhanced preview frame cached by the backend for a job. */
export const jobPreviewSchema = z.object({
  frameIndex: z.number().int().nonnegative(),
  /** Public backend path, e.g. `/api/upload/preview/{jobId}/{frameIndex}`. */
  imageUrl: z.string(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional()
});

export type JobPreview = z.infer<typeof jobPreviewSchema>;
```

Add `preview: jobPreviewSchema.optional()` to **both** `jobStatusSchema` and `jobUpdateSchema` (after their `error` field):

```ts
  error: z.string().optional(),
  preview: jobPreviewSchema.optional()
```

Insert after `jobIdParamsSchema`:

```ts
/** Job ids that can safely appear in filesystem paths (traversal-proof). */
const strictJobIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

export const previewLatestParamsSchema = z.strictObject({
  jobId: strictJobIdSchema
});

export type PreviewLatestParams = z.infer<typeof previewLatestParamsSchema>;

export const previewFrameParamsSchema = z.strictObject({
  jobId: strictJobIdSchema,
  frameIndex: z.string().regex(/^\d{1,9}$/)
});

export type PreviewFrameParams = z.infer<typeof previewFrameParamsSchema>;
```

- [ ] **Step 2: Add endpoint constants to `upload.consts.ts`**

Append:

```ts
/** Latest cached preview frame — binary JPEG endpoint, no JSON contract. Served no-store. */
export const UPLOAD_PREVIEW_LATEST_ENDPOINT =
  '/api/upload/preview/:jobId/latest' as const;
/** Specific cached preview frame — binary JPEG endpoint, immutable-cacheable. */
export const UPLOAD_PREVIEW_FRAME_ENDPOINT =
  '/api/upload/preview/:jobId/:frameIndex' as const;
```

- [ ] **Step 3: Update the non-JSON-endpoint comment in `upload.contracts.ts`**

Replace the trailing comment block with:

```ts
// The stream (`UPLOAD_STREAM_ENDPOINT`), SSE (`UPLOAD_EVENTS_ENDPOINT`), and
// preview (`UPLOAD_PREVIEW_LATEST_ENDPOINT` / `UPLOAD_PREVIEW_FRAME_ENDPOINT`)
// endpoints are not JSON contracts: the stream returns binary video with HTTP
// Range support, the SSE endpoint emits server-sent events whose payloads
// follow `jobUpdateSchema` from `@repo/schemas/jobs` (optionally carrying a
// `preview`), and the preview endpoints return cached JPEG frames.
```

- [ ] **Step 4: Verify build + types across the repo**

Run: `pnpm --filter @repo/schemas --filter @repo/consts --filter @repo/contracts build`
Expected: all three build without errors.

Run: `pnpm check-types`
Expected: PASS everywhere (the new fields are optional, so no consumer breaks).

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/jobs/job.schemas.ts packages/consts/src/upload/upload.consts.ts packages/contracts/src/upload/upload.contracts.ts
git commit -m "feat(schemas): add optional job preview schema and preview endpoint consts"
```

---

### Task 2: AI security helpers (TDD)

**Files:**
- Modify: `apps/ai/security.py`
- Test: `apps/ai/test_security.py`

**Interfaces:**
- Consumes: existing `is_valid_job_id`, `JOB_ID_PATTERN`.
- Produces (used by Tasks 4–5): `LATEST_FRAME_KEY = "latest"`, `is_valid_frame_index(frame_key: str) -> bool`, `resolve_preview_path(preview_dir: Path, job_id: str, frame_key: str) -> Path | None`.

- [ ] **Step 1: Write the failing tests**

Update the import at the top of `apps/ai/test_security.py`:

```python
from pathlib import Path

from security import (
    is_valid_frame_index,
    is_valid_job_id,
    resolve_preview_path,
    safe_extension,
    token_matches,
)
```

Append the new tests (keep the existing ones):

```python
def test_valid_frame_index():
    assert is_valid_frame_index("1")
    assert is_valid_frame_index("0")
    assert is_valid_frame_index("999999999")


def test_invalid_frame_index():
    assert not is_valid_frame_index("")
    assert not is_valid_frame_index("-1")
    assert not is_valid_frame_index("1.5")
    assert not is_valid_frame_index("1" * 10)
    assert not is_valid_frame_index("latest")
    assert not is_valid_frame_index("../1")


def test_resolve_preview_path_valid_frame():
    base = Path("previews")
    resolved = resolve_preview_path(base, "job-1", "42")
    assert resolved == (base / "job-1" / "42.jpg").resolve()


def test_resolve_preview_path_latest():
    base = Path("previews")
    resolved = resolve_preview_path(base, "job-1", "latest")
    assert resolved == (base / "job-1" / "latest.jpg").resolve()


def test_resolve_preview_path_rejects_unsafe_input():
    base = Path("previews")
    assert resolve_preview_path(base, "../evil", "1") is None
    assert resolve_preview_path(base, "a/b", "latest") is None
    assert resolve_preview_path(base, "a.b", "latest") is None
    assert resolve_preview_path(base, "job-1", "..") is None
    assert resolve_preview_path(base, "job-1", "1/2") is None
    assert resolve_preview_path(base, "job-1", "") is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `apps/ai`): `python test_security.py`
Expected: `ImportError: cannot import name 'is_valid_frame_index' from 'security'`

- [ ] **Step 3: Implement the helpers in `security.py`**

Append after `is_valid_job_id`:

```python
FRAME_INDEX_PATTERN = re.compile(r"^\d{1,9}$")
LATEST_FRAME_KEY = "latest"


def is_valid_frame_index(frame_key: str) -> bool:
    """True only for plain decimal frame indexes (no signs, dots, or paths)."""
    return bool(FRAME_INDEX_PATTERN.fullmatch(frame_key))


def resolve_preview_path(preview_dir: Path, job_id: str, frame_key: str) -> Path | None:
    """Return the absolute path of a preview JPEG, or ``None`` if unsafe.

    ``frame_key`` is either ``"latest"`` or a decimal frame index. The result
    is guaranteed to stay inside ``preview_dir`` — callers never supply paths.
    """
    if not is_valid_job_id(job_id):
        return None
    if frame_key != LATEST_FRAME_KEY and not is_valid_frame_index(frame_key):
        return None
    base = preview_dir.resolve()
    candidate = (base / job_id / f"{frame_key}.jpg").resolve()
    if base not in candidate.parents:
        return None
    return candidate
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `apps/ai`): `python test_security.py`
Expected: `All 9 security tests passed` (4 existing + 5 new).

Run: `python -m py_compile server.py security.py`
Expected: no output (success).

- [ ] **Step 5: Commit**

```bash
git add apps/ai/security.py apps/ai/test_security.py
git commit -m "feat(ai): add frame-index and preview-path security helpers"
```

---

### Task 3: AI engine — optional preview callback

**Files:**
- Modify: `apps/ai/baseline/vsr_inference.py` (ONLY `process_video` — this specific change is explicitly authorized by the feature request; touch nothing else in `baseline/`)

**Interfaces:**
- Produces (used by Task 4): `process_video(..., preview_callback: Optional[Callable[[int, int, np.ndarray], None]] = None)`; the callback is invoked **for every frame** as `preview_callback(i + 1, n, sr_bgr)` (1-based index, total count, enhanced BGR frame). Sampling cadence is the caller's job.

No unit test is possible without torch; the verify cycle is `py_compile` plus review.

- [ ] **Step 1: Extend the `process_video` signature**

Change the parameter list to:

```python
    def process_video(
        self,
        input_path: str,
        output_path: str,
        max_height: int = 480,
        progress_callback: Optional[Callable[[int, int], None]] = None,
        should_cancel: Optional[Callable[[], bool]] = None,
        preview_callback: Optional[Callable[[int, int, np.ndarray], None]] = None,
    ) -> dict:
```

Extend the docstring body with:

```python
        preview_callback, when provided, receives (frame_number, total_frames,
        enhanced_bgr_frame) for every frame after it is written; sampling and
        any I/O are the caller's responsibility.
```

- [ ] **Step 2: Invoke the callback in the frame loop**

In the `for i in range(n):` loop, after the existing `progress_callback` call (so a preview line built by the caller carries the up-to-date percent):

```python
                if progress_callback:
                    progress_callback(i + 1, n)

                if preview_callback:
                    preview_callback(i + 1, n, sr_bgr)
```

- [ ] **Step 3: Verify it compiles**

Run (from `apps/ai`): `python -m py_compile baseline/vsr_inference.py`
Expected: no output (success).

- [ ] **Step 4: Commit**

```bash
git add apps/ai/baseline/vsr_inference.py
git commit -m "feat(ai): add optional per-frame preview callback to process_video"
```

---

### Task 4: AI server — preview config, writer, NDJSON emission, cancel cleanup

**Files:**
- Modify: `apps/ai/server.py`

**Interfaces:**
- Consumes: `resolve_preview_path`/`LATEST_FRAME_KEY`/`is_valid_job_id` (Task 2), `preview_callback` engine hook (Task 3).
- Produces: env-configured globals `PREVIEW_ENABLED`, `PREVIEW_EVERY_N_FRAMES`, `PREVIEW_MAX_WIDTH`, `PREVIEW_JPEG_QUALITY`, `WORK_PREVIEW_DIR`; `_write_preview_files(job_id: str, frame_index: int, frame_bgr) -> tuple[int, int] | None`; NDJSON `processing` lines that optionally carry `preview: { frameIndex, width, height, downloadUrl }` (consumed by Task 7's backend types); preview dir cleanup on cancel.

- [ ] **Step 1: Add imports and preview configuration**

Add to the imports block: `import shutil` (with the other stdlib imports) and:

```python
import cv2
import numpy as np
```

Update the `security` import line:

```python
from security import (
    LATEST_FRAME_KEY,
    is_valid_job_id,
    resolve_preview_path,
    safe_extension,
    token_matches,
)
```

After the `WORK_RESULT_DIR` block, add:

```python
def _env_flag(name: str, default: str = "true") -> bool:
    """Parse a boolean-ish env var ("false"/"0"/"no"/"off" disable)."""
    return os.environ.get(name, default).strip().lower() not in {"0", "false", "no", "off"}


# Progressive preview generation (sampled enhanced JPEG frames during inference).
PREVIEW_ENABLED = _env_flag("PREVIEW_ENABLED")
PREVIEW_EVERY_N_FRAMES = max(1, int(os.environ.get("PREVIEW_EVERY_N_FRAMES", "15")))
PREVIEW_MAX_WIDTH = int(os.environ.get("PREVIEW_MAX_WIDTH", "640"))
PREVIEW_JPEG_QUALITY = int(os.environ.get("PREVIEW_JPEG_QUALITY", "80"))
WORK_PREVIEW_DIR = _resolve_work_dir(
    os.environ.get("WORK_PREVIEW_DIR", "../../storage/ai/previews")
)
WORK_PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
```

- [ ] **Step 2: Add the atomic preview writer**

Add above `run_inference_stream`:

```python
def _write_preview_files(
    job_id: str, frame_index: int, frame_bgr: np.ndarray
) -> tuple[int, int] | None:
    """Write ``{frameIndex}.jpg`` and ``latest.jpg`` atomically.

    Downscales to ``PREVIEW_MAX_WIDTH`` (aspect preserved, never upscales) and
    returns the written (width, height), or ``None`` if encoding failed.
    """
    height, width = frame_bgr.shape[:2]
    if width > PREVIEW_MAX_WIDTH:
        scale = PREVIEW_MAX_WIDTH / width
        width = PREVIEW_MAX_WIDTH
        height = max(1, round(height * scale))
        frame_bgr = cv2.resize(frame_bgr, (width, height), interpolation=cv2.INTER_AREA)

    ok, encoded = cv2.imencode(
        ".jpg", frame_bgr, [cv2.IMWRITE_JPEG_QUALITY, PREVIEW_JPEG_QUALITY]
    )
    if not ok:
        return None

    job_dir = WORK_PREVIEW_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    data = encoded.tobytes()
    for name in (f"{frame_index}.jpg", f"{LATEST_FRAME_KEY}.jpg"):
        tmp_path = job_dir / f".{name}.tmp"
        tmp_path.write_bytes(data)
        os.replace(tmp_path, job_dir / name)
    return width, height
```

- [ ] **Step 3: Wire the preview callback into `run_inference_stream`**

Inside `run_inference_stream`, after the existing `progress_callback` definition, add:

```python
    preview_active = PREVIEW_ENABLED and is_valid_job_id(job_id)

    def preview_callback(current_frame: int, total_frames: int, frame_bgr: np.ndarray) -> None:
        if current_frame != 1 and current_frame % PREVIEW_EVERY_N_FRAMES != 0:
            return
        try:
            size = _write_preview_files(job_id, current_frame, frame_bgr)
            if size is None:
                return
            width, height = size
            progress_queue.put(json.dumps({
                "status": "processing",
                "progress": max(last_percent[0], 0),
                "currentFrame": current_frame,
                "totalFrames": total_frames,
                "preview": {
                    "frameIndex": current_frame,
                    "width": width,
                    "height": height,
                    "downloadUrl": f"/preview/{job_id}/{current_frame}",
                },
            }))
        except Exception as e:  # previews must never fail inference
            logger.warning(
                f"Preview generation failed for job {job_id} frame {current_frame}: {e}"
            )
```

In `inference_thread`, pass it to the engine:

```python
            result = engine.process_video(
                input_path=input_path,
                output_path=output_path,
                max_height=MAX_INPUT_HEIGHT,
                progress_callback=progress_callback,
                should_cancel=cancel_event.is_set,
                preview_callback=preview_callback if preview_active else None,
            )
```

- [ ] **Step 4: Delete the preview dir on cancellation**

In the `except InferenceCancelledError:` branch, after the partial-output removal:

```python
            if preview_active:
                shutil.rmtree(WORK_PREVIEW_DIR / job_id, ignore_errors=True)
```

- [ ] **Step 5: Verify and commit**

Run (from `apps/ai`): `python -m py_compile server.py security.py && python test_security.py`
Expected: compile clean; `All 9 security tests passed`.

```bash
git add apps/ai/server.py
git commit -m "feat(ai): generate sampled preview JPEGs and emit NDJSON preview metadata"
```

---

### Task 5: AI server — internal preview endpoints

**Files:**
- Modify: `apps/ai/server.py`

**Interfaces:**
- Consumes: `resolve_preview_path`, `LATEST_FRAME_KEY` (Task 2), `WORK_PREVIEW_DIR` (Task 4), existing `require_token`.
- Produces: `GET /preview/{job_id}/latest` and `GET /preview/{job_id}/{frame_index}` (consumed by Task 7's `downloadPreview`). Token-guarded like `/result`.

- [ ] **Step 1: Add the endpoints**

Add after the `get_result` endpoint. **Declaration order matters:** the literal `latest` route MUST come before the `{frame_index}` route (Starlette matches in order).

```python
def _serve_preview(job_id: str, frame_key: str) -> FileResponse:
    """Serve one preview JPEG from ``WORK_PREVIEW_DIR``; no path input accepted."""
    preview_path = resolve_preview_path(WORK_PREVIEW_DIR, job_id, frame_key)
    if preview_path is None:
        raise HTTPException(status_code=400, detail="Invalid preview request")
    if not preview_path.exists():
        raise HTTPException(status_code=404, detail="Preview not found")
    return FileResponse(path=str(preview_path), media_type="image/jpeg")


@app.get("/preview/{job_id}/latest", dependencies=[Depends(require_token)])
def get_preview_latest(job_id: str):
    return _serve_preview(job_id, LATEST_FRAME_KEY)


@app.get("/preview/{job_id}/{frame_index}", dependencies=[Depends(require_token)])
def get_preview_frame(job_id: str, frame_index: str):
    return _serve_preview(job_id, frame_index)
```

- [ ] **Step 2: Verify**

Run (from `apps/ai`): `python -m py_compile server.py security.py && python test_security.py`
Expected: compile clean; all tests pass.

Optional smoke test (works without a checkpoint — the model is not needed for preview routes): `python server.py` in one terminal, then `curl -i http://localhost:8000/preview/no-such-job/latest` → `404`, `curl -i http://localhost:8000/preview/a.b/latest` → `400`, `curl -i "http://localhost:8000/preview/job/12x"` → `400`. Stop the server afterwards.

- [ ] **Step 3: Commit**

```bash
git add apps/ai/server.py
git commit -m "feat(ai): add token-guarded preview download endpoints"
```

---

### Task 6: Backend env vars + preview path util (TDD)

**Files:**
- Modify: `apps/backend/src/utils/env.validation.ts`
- Create: `apps/backend/src/upload/preview-path.util.ts`
- Test: `apps/backend/src/utils/env.validation.spec.ts`, `apps/backend/src/upload/preview-path.util.spec.ts`

**Interfaces:**
- Produces (used by Tasks 9, 10): `Env.PREVIEW_ENABLED: boolean`, `Env.PREVIEW_DIR: string`; `LATEST_FRAME_KEY = 'latest'` and `resolvePreviewFilePath(previewDir: string, jobId: string, frameKey: string): string | null` from `@/upload/preview-path.util`.

- [ ] **Step 1: Write the failing tests**

Create `apps/backend/src/utils/env.validation.spec.ts`:

```ts
import { validateEnv } from '@/utils/env.validation';

describe('validateEnv preview vars', () => {
  it('defaults PREVIEW_ENABLED to true and PREVIEW_DIR to the shared storage dir', () => {
    const env = validateEnv({});
    expect(env.PREVIEW_ENABLED).toBe(true);
    expect(env.PREVIEW_DIR).toBe('../../storage/previews');
  });

  it('parses PREVIEW_ENABLED=false as boolean false', () => {
    expect(validateEnv({ PREVIEW_ENABLED: 'false' }).PREVIEW_ENABLED).toBe(false);
  });

  it('rejects non-boolean PREVIEW_ENABLED values', () => {
    expect(() => validateEnv({ PREVIEW_ENABLED: 'banana' })).toThrow(
      /PREVIEW_ENABLED/
    );
  });
});
```

Create `apps/backend/src/upload/preview-path.util.spec.ts`:

```ts
import * as path from 'node:path';
import { resolvePreviewFilePath } from '@/upload/preview-path.util';

describe('resolvePreviewFilePath', () => {
  const base = path.resolve('previews');

  it('resolves a frame-indexed preview inside the preview dir', () => {
    expect(resolvePreviewFilePath('previews', 'job-1', '42')).toBe(
      path.join(base, 'job-1', '42.jpg')
    );
  });

  it('resolves latest.jpg', () => {
    expect(resolvePreviewFilePath('previews', 'job-1', 'latest')).toBe(
      path.join(base, 'job-1', 'latest.jpg')
    );
  });

  it('rejects traversal and malformed input', () => {
    expect(resolvePreviewFilePath('previews', '../evil', '1')).toBeNull();
    expect(resolvePreviewFilePath('previews', 'a/b', 'latest')).toBeNull();
    expect(resolvePreviewFilePath('previews', 'job.1', 'latest')).toBeNull();
    expect(resolvePreviewFilePath('previews', 'job-1', '..')).toBeNull();
    expect(resolvePreviewFilePath('previews', 'job-1', '-1')).toBeNull();
    expect(resolvePreviewFilePath('previews', 'job-1', '1.5')).toBeNull();
    expect(resolvePreviewFilePath('previews', 'job-1', '1234567890')).toBeNull();
    expect(resolvePreviewFilePath('previews', 'job-1', '')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter backend test`
Expected: FAIL — `env.validation.spec.ts` fails on missing `PREVIEW_ENABLED` property; `preview-path.util.spec.ts` fails with "Cannot find module '@/upload/preview-path.util'".

- [ ] **Step 3: Implement**

In `env.validation.ts`, add to the schema after `ALLOWED_VIDEO_EXTENSIONS`:

```ts
  /**
   * Master switch for caching/serving AI preview frames. Accepts
   * true/false-style strings ("true", "false", "1", "0", "yes", "no", ...).
   */
  PREVIEW_ENABLED: z.stringbool().default(true),
  /** Local cache of AI preview frames, resolved from the backend working dir. */
  PREVIEW_DIR: z.string().default('../../storage/previews')
```

Create `apps/backend/src/upload/preview-path.util.ts`:

```ts
import * as path from 'node:path';

const JOB_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const FRAME_INDEX_PATTERN = /^\d{1,9}$/;

export const LATEST_FRAME_KEY = 'latest';

/**
 * Resolves the on-disk path of a cached preview JPEG, or null when the input
 * is unsafe. `frameKey` is either `latest` or a decimal frame index; the
 * result is guaranteed to stay inside `previewDir` (path-traversal defense —
 * job ids and frame keys may originate from URL params or the AI stream).
 */
export function resolvePreviewFilePath(
  previewDir: string,
  jobId: string,
  frameKey: string
): string | null {
  if (!JOB_ID_PATTERN.test(jobId)) return null;
  if (frameKey !== LATEST_FRAME_KEY && !FRAME_INDEX_PATTERN.test(frameKey)) {
    return null;
  }
  const base = path.resolve(previewDir);
  const candidate = path.resolve(base, jobId, `${frameKey}.jpg`);
  if (!candidate.startsWith(base + path.sep)) return null;
  return candidate;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter backend test`
Expected: PASS (2 suites, 6 tests).

Run: `pnpm --filter backend check-types`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/utils/env.validation.ts apps/backend/src/utils/env.validation.spec.ts apps/backend/src/upload/preview-path.util.ts apps/backend/src/upload/preview-path.util.spec.ts
git commit -m "feat(backend): add preview env vars and safe preview path resolution"
```

---

### Task 7: Backend AI protocol types + preview URL util + `downloadPreview` (TDD)

**Files:**
- Modify: `apps/backend/src/upload/ai-protocol.types.ts`
- Create: `apps/backend/src/upload/preview-url.util.ts`
- Modify: `apps/backend/src/upload/ai-client.service.ts`
- Test: `apps/backend/src/upload/preview-url.util.spec.ts`

**Interfaces:**
- Consumes: AI NDJSON preview shape (Task 4).
- Produces (used by Task 9): `AIPreviewUpdate { frameIndex: number; width?: number; height?: number; downloadUrl: string }`, `AIProcessingUpdate.preview?: AIPreviewUpdate`; `resolveAiPreviewUrl(aiServiceUrl: string, downloadPath: string): URL` (throws on unsafe input); `AiClientService.downloadPreview(args: { downloadPath: string; destPath: string; signal: AbortSignal }): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/upload/preview-url.util.spec.ts`:

```ts
import { resolveAiPreviewUrl } from '@/upload/preview-url.util';

describe('resolveAiPreviewUrl', () => {
  const base = 'http://ai.internal:8000';

  it('accepts frame and latest preview paths on the AI origin', () => {
    expect(resolveAiPreviewUrl(base, '/preview/job-1/42').href).toBe(
      'http://ai.internal:8000/preview/job-1/42'
    );
    expect(resolveAiPreviewUrl(base, '/preview/job-1/latest').pathname).toBe(
      '/preview/job-1/latest'
    );
  });

  it('rejects other origins and URL-authority injection', () => {
    expect(() =>
      resolveAiPreviewUrl(base, 'http://evil.test/preview/job-1/1')
    ).toThrow(/unexpected URL/);
    expect(() => resolveAiPreviewUrl(base, '//evil.test/preview/job-1/1')).toThrow(
      /unexpected URL/
    );
  });

  it('rejects non-preview and malformed paths', () => {
    expect(() => resolveAiPreviewUrl(base, '/result/job-1')).toThrow();
    expect(() => resolveAiPreviewUrl(base, '/preview/job-1/1.5')).toThrow();
    expect(() => resolveAiPreviewUrl(base, '/preview/../etc/1')).toThrow();
    expect(() => resolveAiPreviewUrl(base, '/preview/job-1/1/extra')).toThrow();
    expect(() => resolveAiPreviewUrl(base, '/preview/job-1/1234567890')).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter backend test`
Expected: FAIL with "Cannot find module '@/upload/preview-url.util'".

- [ ] **Step 3: Implement the util, types, and client method**

Create `apps/backend/src/upload/preview-url.util.ts`:

```ts
const AI_PREVIEW_PATH_PATTERN = /^\/preview\/[A-Za-z0-9_-]{1,128}\/(latest|\d{1,9})$/;

/**
 * Resolves an AI-provided preview download path against the AI service base
 * URL. Throws unless the result stays on the AI origin and matches the
 * expected `/preview/{jobId}/{frame}` shape — the path originates from the
 * AI's NDJSON stream and is untrusted (SSRF / URL-authority-injection
 * defense, mirroring the result-download check).
 */
export function resolveAiPreviewUrl(
  aiServiceUrl: string,
  downloadPath: string
): URL {
  const base = new URL(aiServiceUrl);
  let target: URL;
  try {
    target = new URL(downloadPath, base);
  } catch {
    throw new Error('AI returned an invalid preview download URL.');
  }
  if (
    target.origin !== base.origin ||
    !AI_PREVIEW_PATH_PATTERN.test(target.pathname)
  ) {
    throw new Error('Refusing to download preview from an unexpected URL.');
  }
  return target;
}
```

In `ai-protocol.types.ts`, add before `AIProcessingUpdate`:

```ts
/** Preview frame metadata optionally attached to a `processing` line. */
export interface AIPreviewUpdate {
  frameIndex: number;
  width?: number;
  height?: number;
  /** AI-relative download path, e.g. `/preview/{jobId}/{frameIndex}`. */
  downloadUrl: string;
}
```

and extend `AIProcessingUpdate`:

```ts
export interface AIProcessingUpdate {
  status: 'processing';
  progress: number;
  currentFrame?: number;
  totalFrames?: number;
  preview?: AIPreviewUpdate;
}
```

In `ai-client.service.ts`: add `import { resolveAiPreviewUrl } from '@/upload/preview-url.util';` (in the `@/` import group), add next to `DownloadResultArgs`:

```ts
interface DownloadPreviewArgs {
  downloadPath: string;
  destPath: string;
  signal: AbortSignal;
}
```

and add the method after `downloadResult`:

```ts
  /** Downloads one preview JPEG from the AI service and writes it to disk. */
  async downloadPreview(args: DownloadPreviewArgs): Promise<void> {
    // Like result downloads, the path comes from the AI's NDJSON stream and
    // is untrusted — resolve and validate before fetching.
    const target = resolveAiPreviewUrl(this.aiServiceUrl, args.downloadPath);

    let response: Response;
    try {
      response = await fetch(target, {
        headers: this.authHeaders(),
        signal: args.signal
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new Error('Failed to download preview from AI service.');
    }

    if (!response.ok) {
      throw new Error(
        `AI preview download failed (${String(response.status)} ${response.statusText})`
      );
    }
    if (!response.body) {
      throw new Error('AI preview download returned no response body.');
    }

    await pipeline(
      Readable.fromWeb(response.body as unknown as NodeWebReadableStream<Uint8Array>),
      createWriteStream(args.destPath)
    );
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter backend test && pnpm --filter backend check-types`
Expected: PASS (3 suites now).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/upload/ai-protocol.types.ts apps/backend/src/upload/preview-url.util.ts apps/backend/src/upload/preview-url.util.spec.ts apps/backend/src/upload/ai-client.service.ts
git commit -m "feat(backend): typed AI preview metadata and SSRF-guarded preview download"
```

---

### Task 8: Backend `UploadService` — preview state and propagation (TDD)

**Files:**
- Modify: `apps/backend/src/upload/upload.service.ts`
- Test: `apps/backend/src/upload/upload.service.spec.ts`

**Interfaces:**
- Consumes: `JobPreview`/`jobUpdateSchema` (Task 1).
- Produces (used by Tasks 9, 10, 12): `interface JobPreviewMetadata { frameIndex: number; width?: number; height?: number }` (exported), `UploadService.setJobPreview(jobId: string, preview: JobPreviewMetadata): void`. Every emitted `JobUpdate` and every `JobStatus` now carries the stored preview (with `imageUrl: /api/upload/preview/{jobId}/{frameIndex}`) once one exists; terminal states stay sticky.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/upload/upload.service.spec.ts`:

```ts
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { jobUpdateSchema } from '@repo/schemas/jobs';
import type { JobUpdate } from '@repo/schemas/jobs';
import { UploadService } from '@/upload/upload.service';
import type { Env } from '@/utils/env.validation';

describe('UploadService preview propagation', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-service-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeService(): UploadService {
    const values: Partial<Env> = {
      UPLOAD_DIR: path.join(tmpDir, 'uploads'),
      RESULT_DIR: path.join(tmpDir, 'results'),
      PREVIEW_DIR: path.join(tmpDir, 'previews')
    };
    const config = {
      get: (key: keyof Env) => values[key]
    } as unknown as ConfigService<Env, true>;
    return new UploadService(config);
  }

  function createJob(service: UploadService): string {
    const file = {
      originalname: 'clip.mp4',
      filename: 'stored.mp4',
      path: path.join(tmpDir, 'uploads', 'stored.mp4')
    } as Express.Multer.File;
    return service.createJob(file).jobId;
  }

  it('exposes the preview with a public imageUrl in job status', () => {
    const service = makeService();
    const jobId = createJob(service);
    service.updateJob(jobId, 'processing', 10);

    service.setJobPreview(jobId, { frameIndex: 42, width: 640, height: 360 });

    expect(service.getJobStatus(jobId).preview).toEqual({
      frameIndex: 42,
      imageUrl: `/api/upload/preview/${jobId}/42`,
      width: 640,
      height: 360
    });
  });

  it('emits schema-valid JobUpdates carrying the preview and ignores previews after terminal', () => {
    const service = makeService();
    const jobId = createJob(service);
    service.updateJob(jobId, 'processing', 10);

    const updates: JobUpdate[] = [];
    const sub = service.getJobUpdates$(jobId).subscribe((event) => {
      const raw = (event as unknown as { data: string }).data;
      updates.push(jobUpdateSchema.parse(JSON.parse(raw)));
    });

    service.setJobPreview(jobId, { frameIndex: 15 });
    service.updateJob(jobId, 'completed', 100);
    service.setJobPreview(jobId, { frameIndex: 30 });
    sub.unsubscribe();

    // startWith (no preview) → preview(15) → completed (still preview 15).
    expect(updates).toHaveLength(3);
    expect(updates[0]?.preview).toBeUndefined();
    expect(updates[1]?.preview?.frameIndex).toBe(15);
    expect(updates[1]?.preview?.imageUrl).toBe(`/api/upload/preview/${jobId}/15`);
    expect(updates[2]?.state).toBe('completed');
    expect(updates[2]?.preview?.frameIndex).toBe(15);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter backend test`
Expected: FAIL — `setJobPreview` does not exist / `PREVIEW_DIR` unused / `preview` missing from status.

- [ ] **Step 3: Implement in `upload.service.ts`**

Update the `@repo/schemas` import to include `JobPreview` and `JobUpdate` types:

```ts
import {
  isTerminalJobState,
  type JobPreview,
  type JobState,
  type JobStatus,
  type JobUpdate
} from '@repo/schemas/jobs';
```

Add above `JobRecord`:

```ts
/** Internal preview metadata; the public imageUrl is derived on emission. */
export interface JobPreviewMetadata {
  frameIndex: number;
  width?: number;
  height?: number;
}
```

Add `preview?: JobPreviewMetadata;` to `JobRecord` (after `error?`).

In the constructor, resolve and create the preview dir alongside the others:

```ts
    this.previewDir = path.resolve(
      process.cwd(),
      this.configService.get('PREVIEW_DIR', { infer: true })
    );
    fs.mkdirSync(this.previewDir, { recursive: true });
```

with the field `private readonly previewDir: string;` next to `uploadDir`/`resultDir` (Task 10 serves files from it).

Add the emission helpers (private, above `updateJob`):

```ts
  private toJobPreview(job: JobRecord): JobPreview | undefined {
    if (!job.preview) return undefined;
    return {
      frameIndex: job.preview.frameIndex,
      imageUrl: `/api/upload/preview/${job.jobId}/${String(job.preview.frameIndex)}`,
      width: job.preview.width,
      height: job.preview.height
    };
  }

  private toJobUpdate(job: JobRecord): JobUpdate {
    return {
      jobId: job.jobId,
      state: job.state,
      progress: job.progress,
      updatedAt: job.updatedAt,
      error: job.error,
      preview: this.toJobPreview(job)
    };
  }
```

(Zod-inferred optionals accept explicit `undefined`, and `JSON.stringify` drops it from SSE payloads.)

Rewire the existing emitters to go through `toJobUpdate` so every update carries the latest preview:

- In `updateJob`, replace the `this.jobUpdates$.next({...})` literal with `this.jobUpdates$.next(this.toJobUpdate(job));`
- In `getJobUpdates$`, replace the `currentState` literal with `const currentState: JobUpdate = this.toJobUpdate(job);`
- In `getJobStatus`, add `preview: this.toJobPreview(job)` to the returned object.

Add the new method after `setResultPath`:

```ts
  setJobPreview(jobId: string, preview: JobPreviewMetadata): void {
    const job = this.jobs.get(jobId);
    if (!job || isTerminalJobState(job.state)) return;

    job.preview = preview;
    job.updatedAt = new Date().toISOString();
    this.jobUpdates$.next(this.toJobUpdate(job));
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter backend test && pnpm --filter backend check-types && pnpm --filter backend test:e2e`
Expected: unit PASS (4 suites), types PASS, existing e2e PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/upload/upload.service.ts apps/backend/src/upload/upload.service.spec.ts
git commit -m "feat(backend): store job previews and carry them on every job update"
```

---

### Task 9: Backend `ProcessingService` — preview download orchestration

**Files:**
- Modify: `apps/backend/src/upload/processing.service.ts`

**Interfaces:**
- Consumes: `AIPreviewUpdate` + `AiClientService.downloadPreview` (Task 7), `resolvePreviewFilePath`/`LATEST_FRAME_KEY` (Task 6), `UploadService.setJobPreview` (Task 8), `Env.PREVIEW_ENABLED`/`Env.PREVIEW_DIR` (Task 6).
- Produces: previews cached at `PREVIEW_DIR/{jobId}/{frameIndex}.jpg` + `latest.jpg`; `setJobPreview` fired on success. Fire-and-forget with a per-job in-flight skip; failures are warnings only.

- [ ] **Step 1: Implement**

Add imports (respecting group order):

```ts
import { LATEST_FRAME_KEY, resolvePreviewFilePath } from '@/upload/preview-path.util';
import type { AIPreviewUpdate, AIProcessUpdate } from '@/upload/ai-protocol.types';
```

Extend `ActiveJob`:

```ts
interface ActiveJob {
  abortController: AbortController;
  outputPath: string;
  previewDownloadInFlight: boolean;
}
```

Add fields + constructor init next to `resultDir`:

```ts
  private readonly previewEnabled: boolean;
  private readonly previewDir: string;
```

```ts
    this.previewEnabled = this.configService.get('PREVIEW_ENABLED', {
      infer: true
    });
    this.previewDir = path.resolve(
      process.cwd(),
      this.configService.get('PREVIEW_DIR', { infer: true })
    );
```

Update the `activeJobs.set` call in `processJob`:

```ts
      this.activeJobs.set(jobId, {
        abortController,
        outputPath,
        previewDownloadInFlight: false
      });
```

In `handleUpdate`, extend the `processing` case:

```ts
      case 'processing': {
        if (this.isCancelled(jobId)) return 'done';
        this.uploadService.updateJob(jobId, 'processing', update.progress);
        this.logger.log(`Job ${jobId}: ${String(update.progress)}%`);
        if (update.preview) {
          this.capturePreview(jobId, update.preview);
        }
        return 'continue';
      }
```

Add the two private methods after `handleUpdate`:

```ts
  /**
   * Fire-and-forget preview capture: never awaited by the NDJSON loop, never
   * fails the job. If a download is already in flight for this job, the new
   * preview is skipped (latest-wins; no backlog).
   */
  private capturePreview(jobId: string, preview: AIPreviewUpdate): void {
    if (!this.previewEnabled) return;
    const activeJob = this.activeJobs.get(jobId);
    if (!activeJob || activeJob.previewDownloadInFlight) return;

    const destPath = resolvePreviewFilePath(
      this.previewDir,
      jobId,
      String(preview.frameIndex)
    );
    const latestPath = resolvePreviewFilePath(
      this.previewDir,
      jobId,
      LATEST_FRAME_KEY
    );
    if (!destPath || !latestPath) {
      this.logger.warn(`Job ${jobId}: ignoring preview with unsafe frame index`);
      return;
    }

    activeJob.previewDownloadInFlight = true;
    this.downloadAndPublishPreview(jobId, preview, { destPath, latestPath })
      .catch((error: unknown) => {
        this.logger.warn(
          `Job ${jobId}: preview download failed — ${error instanceof Error ? error.message : 'unknown error'}`
        );
      })
      .finally(() => {
        const job = this.activeJobs.get(jobId);
        if (job) job.previewDownloadInFlight = false;
      });
  }

  private async downloadAndPublishPreview(
    jobId: string,
    preview: AIPreviewUpdate,
    paths: { destPath: string; latestPath: string }
  ): Promise<void> {
    const activeJob = this.activeJobs.get(jobId);
    if (!activeJob || this.isCancelled(jobId)) return;

    await fs.promises.mkdir(path.dirname(paths.destPath), { recursive: true });
    await this.aiClient.downloadPreview({
      downloadPath: preview.downloadUrl,
      destPath: paths.destPath,
      signal: activeJob.abortController.signal
    });

    // Atomic latest.jpg publish: copy to a temp name, then rename over it.
    const tmpLatest = `${paths.latestPath}.tmp`;
    await fs.promises.copyFile(paths.destPath, tmpLatest);
    await fs.promises.rename(tmpLatest, paths.latestPath);

    this.uploadService.setJobPreview(jobId, {
      frameIndex: preview.frameIndex,
      width: preview.width,
      height: preview.height
    });
  }
```

(`JobPreviewMetadata`'s optionals come from a plain interface — if `exactOptionalPropertyTypes` rejects `width: preview.width`, declare them as `width?: number | undefined; height?: number | undefined` in Task 8's interface; the test contract is unaffected.)

- [ ] **Step 2: Verify**

Run: `pnpm --filter backend test && pnpm --filter backend check-types && pnpm --filter backend test:e2e`
Expected: all PASS (no behavior change is observable without an AI service; this task is covered end-to-end by the manual test in Task 14).

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/upload/processing.service.ts
git commit -m "feat(backend): download and cache AI preview frames during processing"
```

---

### Task 10: Backend public preview endpoints (TDD via e2e)

**Files:**
- Modify: `apps/backend/src/upload/upload.service.ts` (add `getPreviewStreamInfo`)
- Modify: `apps/backend/src/upload/dto/upload.dto.ts`
- Modify: `apps/backend/src/upload/upload.controller.ts`
- Test: `apps/backend/test/preview.e2e-spec.ts`

**Interfaces:**
- Consumes: `previewLatestParamsSchema`/`previewFrameParamsSchema` (Task 1), `resolvePreviewFilePath`/`LATEST_FRAME_KEY` (Task 6), `previewDir` on `UploadService` (Task 8).
- Produces (used by Task 12): `GET /api/upload/preview/:jobId/latest` (no-store) and `GET /api/upload/preview/:jobId/:frameIndex` (immutable) serving `image/jpeg`; `UploadService.getPreviewStreamInfo(jobId: string, frameKey: string): { filePath: string }`.

- [ ] **Step 1: Write the e2e tests**

Create `apps/backend/test/preview.e2e-spec.ts`:

```ts
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '@/app/app.module';
import { configureApp } from '@/bootstrap';
import type { Env } from '@/utils/env.validation';

describe('Preview endpoints (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    app = moduleFixture.createNestApplication();
    const configService = app.get(ConfigService<Env, true>);
    configureApp(app, configService);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 404 ProblemDetails for an unknown job (latest)', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/upload/preview/no-such-job/latest'
    );
    expect(response.status).toBe(404);
    const body = response.body as Record<string, unknown>;
    expect((body['type'] as string).startsWith('/problems/')).toBe(true);
  });

  it('returns 404 for an unknown job (frame index)', () => {
    return request(app.getHttpServer())
      .get('/api/upload/preview/no-such-job/12')
      .expect(404);
  });

  it('returns 400 for a malformed frame index', () => {
    return request(app.getHttpServer())
      .get('/api/upload/preview/no-such-job/not-a-frame')
      .expect(400);
  });

  it('returns 400 for a traversal-looking job id', () => {
    return request(app.getHttpServer())
      .get('/api/upload/preview/a.b/latest')
      .expect(400);
  });
});
```

- [ ] **Step 2: Run e2e to verify the new expectations fail**

Run: `pnpm --filter backend test:e2e`
Expected: the two **400** tests FAIL (they currently get route-not-found 404s). The two 404 tests pass trivially pre-implementation — the 400s are the real gate, and the 404 assertions become meaningful once the routes exist (they then exercise the known-job check instead of route matching).

- [ ] **Step 3: Implement**

`upload.service.ts` — add after `getStreamInfo` (imports for `resolvePreviewFilePath` go in the `@/` group):

```ts
  getPreviewStreamInfo(jobId: string, frameKey: string): { filePath: string } {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    const filePath = resolvePreviewFilePath(this.previewDir, jobId, frameKey);
    if (!filePath || !fs.existsSync(filePath)) {
      throw new NotFoundException('Preview not found');
    }
    return { filePath };
  }
```

`dto/upload.dto.ts` — extend the `@repo/schemas/jobs` import with `previewFrameParamsSchema, previewLatestParamsSchema` and add:

```ts
export class PreviewLatestParamsDto extends createZodDto(
  previewLatestParamsSchema
) {}

export class PreviewFrameParamsDto extends createZodDto(
  previewFrameParamsSchema
) {}
```

`upload.controller.ts` — add `LATEST_FRAME_KEY` to the `@/upload/preview-path.util` import group, add the DTOs to the dto import, and add after the `stream` handler. **`latest` must be declared before `:frameIndex`** (Nest matches in declaration order):

```ts
  @Get('preview/:jobId/latest')
  @ApiParam({ name: 'jobId', description: 'Job identifier' })
  previewLatest(
    @Param() params: PreviewLatestParamsDto,
    @Res({ passthrough: true }) res: Response
  ): StreamableFile {
    const { filePath } = this.uploadService.getPreviewStreamInfo(
      params.jobId,
      LATEST_FRAME_KEY
    );
    res.set({
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'no-store'
    });
    return new StreamableFile(fs.createReadStream(filePath));
  }

  @Get('preview/:jobId/:frameIndex')
  @ApiParam({ name: 'jobId', description: 'Job identifier' })
  @ApiParam({ name: 'frameIndex', description: 'Sampled preview frame index' })
  previewFrame(
    @Param() params: PreviewFrameParamsDto,
    @Res({ passthrough: true }) res: Response
  ): StreamableFile {
    const { filePath } = this.uploadService.getPreviewStreamInfo(
      params.jobId,
      params.frameIndex
    );
    res.set({
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable'
    });
    return new StreamableFile(fs.createReadStream(filePath));
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter backend test:e2e && pnpm --filter backend test && pnpm --filter backend check-types`
Expected: all PASS (both e2e suites).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/upload/upload.service.ts apps/backend/src/upload/dto/upload.dto.ts apps/backend/src/upload/upload.controller.ts apps/backend/test/preview.e2e-spec.ts
git commit -m "feat(backend): serve cached preview frames with safe params and cache headers"
```

---

### Task 11: Frontend `BeforeAfterPreviewSlider` component

**Files:**
- Create: `apps/frontend/src/ui/components/product/BeforeAfterPreviewSlider.tsx`

**Interfaces:**
- Produces (used by Task 12): `BeforeAfterPreviewSlider` with props `{ originalSrc: string; previewImageUrl: string; frameIndex: number; progress: number }`. `previewImageUrl` is a fully built absolute URL; `originalSrc` is an object URL or the backend stream URL.

The frontend has no test runner; the verify cycle is lint + check-types + build.

- [ ] **Step 1: Create the component**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/ui/shadcn/lib/utils';

interface BeforeAfterPreviewSliderProps {
  originalSrc: string;
  previewImageUrl: string;
  frameIndex: number;
  progress: number;
}

/**
 * Live before/after comparison shown while a job is processing: the original
 * video (muted, paused, roughly seeked to the enhanced frame's position via
 * the progress fraction) under the latest enhanced preview JPEG, split by a
 * draggable divider. Frame-indexed preview URLs are immutable, so images are
 * preloaded and swapped only once decoded to avoid flicker.
 */
export function BeforeAfterPreviewSlider({
  originalSrc,
  previewImageUrl,
  frameIndex,
  progress
}: BeforeAfterPreviewSliderProps) {
  const [sliderPercent, setSliderPercent] = useState(50);
  const [loadedPreviewUrl, setLoadedPreviewUrl] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const draggingRef = useRef(false);
  const progressRef = useRef(progress);

  useEffect(() => {
    progressRef.current = progress;
  });

  const seekToProgress = useCallback(() => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
      return;
    }
    video.currentTime = (progressRef.current / 100) * video.duration;
  }, []);

  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      setLoadedPreviewUrl(previewImageUrl);
      seekToProgress();
    };
    image.src = previewImageUrl;
    return () => {
      image.onload = null;
    };
  }, [previewImageUrl, seekToProgress]);

  const updateSliderFromPointer = useCallback((clientX: number) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const percent = ((clientX - rect.left) / rect.width) * 100;
    setSliderPercent(Math.min(100, Math.max(0, percent)));
  }, []);

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="relative aspect-video w-full cursor-ew-resize touch-none select-none overflow-hidden rounded-lg border border-border bg-muted/30"
        onPointerDown={(e) => {
          draggingRef.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          updateSliderFromPointer(e.clientX);
        }}
        onPointerMove={(e) => {
          if (draggingRef.current) updateSliderFromPointer(e.clientX);
        }}
        onPointerUp={(e) => {
          draggingRef.current = false;
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
      >
        <video
          ref={videoRef}
          src={originalSrc}
          muted
          playsInline
          preload="auto"
          onLoadedMetadata={seekToProgress}
          className="absolute inset-0 size-full object-contain"
        />

        {loadedPreviewUrl && (
          <img
            src={loadedPreviewUrl}
            alt={`Enhanced preview, frame ${String(frameIndex)}`}
            draggable={false}
            className="absolute inset-0 size-full object-contain"
            style={{ clipPath: `inset(0 0 0 ${String(sliderPercent)}%)` }}
          />
        )}

        <div
          className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-primary shadow"
          style={{ left: `${String(sliderPercent)}%` }}
        >
          <div className="absolute top-1/2 left-1/2 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border bg-background shadow" />
        </div>

        <span className="absolute top-2 left-2 rounded bg-background/80 px-2 py-0.5 text-xs font-medium text-foreground">
          Original
        </span>
        <span className="absolute top-2 right-2 rounded bg-background/80 px-2 py-0.5 text-xs font-medium text-foreground">
          Enhanced preview
        </span>

        <div
          className={cn(
            'absolute inset-0 flex items-center justify-center bg-muted/60 text-sm text-muted-foreground',
            loadedPreviewUrl && 'hidden'
          )}
        >
          Loading preview…
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Latest enhanced frame: {frameIndex} · {progress}%
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `pnpm --filter frontend lint && pnpm --filter frontend check-types && pnpm --filter frontend build`
Expected: all PASS (component is not yet imported anywhere — that is fine for lint since it exports one concept).

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/ui/components/product/BeforeAfterPreviewSlider.tsx
git commit -m "feat(frontend): add dependency-free before/after preview slider"
```

---

### Task 12: Frontend wiring — `Products.tsx` + `JobStatusPanel.tsx`

**Files:**
- Modify: `apps/frontend/src/ui/pages/Products.tsx`
- Modify: `apps/frontend/src/ui/components/product/JobStatusPanel.tsx`

**Interfaces:**
- Consumes: `BeforeAfterPreviewSlider` (Task 11), `UPLOAD_PREVIEW_FRAME_ENDPOINT`/`UPLOAD_STREAM_ENDPOINT` consts + `JobPreview` type (Task 1), preview field on SSE/status payloads (Tasks 8, 10).
- Produces: `JobStatusPanelProps.originalSrc: string | null`.

- [ ] **Step 1: Keep an object URL of the uploaded file in `Products.tsx`**

Add `useEffect`/`useRef` to the react import, then inside the component:

```tsx
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const originalUrlRef = useRef<string | null>(null);

  const replaceOriginalUrl = useCallback((file: File | null) => {
    if (originalUrlRef.current) URL.revokeObjectURL(originalUrlRef.current);
    const next = file ? URL.createObjectURL(file) : null;
    originalUrlRef.current = next;
    setOriginalUrl(next);
  }, []);

  useEffect(
    () => () => {
      if (originalUrlRef.current) URL.revokeObjectURL(originalUrlRef.current);
    },
    []
  );
```

In `handleUpload`, first line of the function body: `replaceOriginalUrl(file);` (before `setPageState('uploading')`). Add `replaceOriginalUrl` to the `useCallback` dependency array of `handleUpload`.

In `handleReset`, add `replaceOriginalUrl(null);` and add `replaceOriginalUrl` to its dependency array.

Pass it to the panel:

```tsx
          <JobStatusPanel
            jobId={jobId}
            originalSrc={originalUrl}
            ...
```

- [ ] **Step 2: Track and render the preview in `JobStatusPanel.tsx`**

Imports — extend the existing groups:

```tsx
import {
  UPLOAD_EVENTS_ENDPOINT,
  UPLOAD_PREVIEW_FRAME_ENDPOINT,
  UPLOAD_STREAM_ENDPOINT
} from '@repo/consts/upload';
import type { JobPreview, JobState, JobUpdate } from '@repo/schemas/jobs';
import { BeforeAfterPreviewSlider } from '@/ui/components/product/BeforeAfterPreviewSlider';
```

Props:

```tsx
interface JobStatusPanelProps {
  jobId: string;
  originalSrc: string | null;
  onCompleted: () => void;
  onCancelled: (reason?: string) => void;
  onFailed: (reason?: string) => void;
  onStop: () => void;
  isStopping: boolean;
}
```

(and add `originalSrc` to the destructured props.)

State, next to `status`:

```tsx
  const [preview, setPreview] = useState<JobPreview | null>(null);
```

In `es.onmessage`, right after `setStatus(data);`:

```tsx
      if (data.preview) setPreview(data.preview);
```

In the polling interval, right after its `setStatus(data);`:

```tsx
          if (data.preview) setPreview(data.preview);
```

Render block — inside `<CardContent>`, between the progress block and the stop `<Button>`:

```tsx
        {status.state === 'processing' &&
          (preview ? (
            <BeforeAfterPreviewSlider
              originalSrc={
                originalSrc ?? buildApiUrl(UPLOAD_STREAM_ENDPOINT, { jobId })
              }
              previewImageUrl={buildApiUrl(UPLOAD_PREVIEW_FRAME_ENDPOINT, {
                jobId,
                frameIndex: String(preview.frameIndex)
              })}
              frameIndex={preview.frameIndex}
              progress={status.progress}
            />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 text-sm text-muted-foreground">
              Preparing first enhanced preview…
            </div>
          ))}
```

(The stream-URL fallback works because `resultPath` starts as `uploadPath` — before completion the backend streams the original upload.)

- [ ] **Step 3: Verify**

Run: `pnpm --filter frontend lint && pnpm --filter frontend check-types && pnpm --filter frontend build`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/ui/pages/Products.tsx apps/frontend/src/ui/components/product/JobStatusPanel.tsx
git commit -m "feat(frontend): show live before/after preview during processing"
```

---

### Task 13: Documentation and env examples (doc-sync mandate)

**Files:**
- Modify: `README.md`, `AGENTS.md`, `CLAUDE.md` (root), `apps/backend/AGENTS.md`, `apps/ai/AGENTS.md`, `apps/frontend/AGENTS.md`
- Modify: `apps/backend/.env.development.example`, `apps/backend/.env.production.example`, `apps/ai/.env.development.example`, `apps/ai/.env.production.example`

**Interfaces:** none — pure documentation, but treated as a bug if skipped.

- [ ] **Step 1: Env example files**

Append to `apps/backend/.env.development.example`:

```
# Progressive preview frames cached from the AI service during processing.
# PREVIEW_ENABLED accepts true/false-style strings; PREVIEW_DIR resolves
# relative to apps/backend (absolute paths also work).
PREVIEW_ENABLED=true
PREVIEW_DIR=../../storage/previews
```

Append to `apps/backend/.env.production.example`:

```
# Progressive preview frames cached from the AI service during processing.
PREVIEW_ENABLED=true
PREVIEW_DIR=/opt/upscale/storage/previews
```

Append to `apps/ai/.env.development.example`:

```
# Progressive preview frames written during inference (sampled enhanced JPEGs).
PREVIEW_ENABLED=true
PREVIEW_EVERY_N_FRAMES=15
PREVIEW_MAX_WIDTH=640
PREVIEW_JPEG_QUALITY=80
WORK_PREVIEW_DIR=../../storage/ai/previews
```

Append to `apps/ai/.env.production.example`:

```
# Progressive preview frames written during inference (sampled enhanced JPEGs).
PREVIEW_ENABLED=true
PREVIEW_EVERY_N_FRAMES=15
PREVIEW_MAX_WIDTH=640
PREVIEW_JPEG_QUALITY=80
WORK_PREVIEW_DIR=/opt/upscale/storage/ai/previews
```

- [ ] **Step 2: Root docs**

`CLAUDE.md` env table — add rows (backend then ai sections, matching the existing format):

```
| backend  | `PREVIEW_ENABLED`          | `true`                             | Zod-validated (`z.stringbool()`)                   |
| backend  | `PREVIEW_DIR`              | `../../storage/previews`           | Zod-validated, resolved from `apps/backend`        |
| ai       | `PREVIEW_ENABLED`          | `true`                             | Read in `server.py`                                |
| ai       | `PREVIEW_EVERY_N_FRAMES`   | `15`                               | Read in `server.py`                                |
| ai       | `PREVIEW_MAX_WIDTH`        | `640`                              | Read in `server.py`                                |
| ai       | `PREVIEW_JPEG_QUALITY`     | `80`                               | Read in `server.py`                                |
| ai       | `WORK_PREVIEW_DIR`         | `../../storage/ai/previews`        | Read in `server.py` (preview frames)               |
```

`AGENTS.md` (root) — update: the ai app description (add `/preview/:jobId/:frameIndex` + `/preview/:jobId/latest` to its endpoint list); the runtime data flow (backend also pulls preview JPEGs from the AI in **both** transports); the job lifecycle (step 2 gains: sampled preview JPEGs are written on the AI, downloaded by the backend to `PREVIEW_DIR/{jobId}/`, and surfaced as an optional `preview` on `JobUpdate`/`JobStatus` with a public `/api/upload/preview/...` URL); the `@repo/schemas` blurb (`jobPreviewSchema`); and known limitations (preview storage grows until manually cleaned; this is progressive *frame* preview, not live video streaming; final MP4 still only after completion).

`README.md` — locate the endpoint/flow/env sections and mirror the same facts: two new public endpoints, the preview flow sentence, and the new env vars in whatever env table exists.

- [ ] **Step 3: App docs**

`apps/backend/AGENTS.md`: endpoint table gains `GET /api/upload/preview/:jobId/latest` (no-store) and `GET /api/upload/preview/:jobId/:frameIndex` (immutable-cacheable); structure section mentions `preview-path.util.ts` and `preview-url.util.ts`; the NDJSON consumption section documents the optional `preview` object on `processing` lines and the fire-and-forget, skip-if-in-flight download that never fails the job; env section adds `PREVIEW_ENABLED`/`PREVIEW_DIR`; gotchas note that preview files are never cleaned up.

`apps/ai/AGENTS.md`: endpoints section adds `GET /preview/{jobId}/latest|{frameIndex}` (authenticated) and documents the extended `processing` NDJSON line with the optional `preview: { frameIndex, width, height, downloadUrl }` object (only present when a sampled JPEG was written; never base64); env list adds the five preview vars; cancellation section notes the preview dir is deleted; the "engine owns inference params" note stays true — preview sampling policy lives in `server.py`, the engine only exposes `preview_callback`.

`apps/frontend/AGENTS.md`: the upscale flow section documents the preview tracking in `JobStatusPanel`, the `BeforeAfterPreviewSlider` (layered paused video + clipped JPEG, progress-fraction seek), the object-URL lifting in `Products.tsx`, and that preview URLs are built from `UPLOAD_PREVIEW_FRAME_ENDPOINT` (frame-indexed = stable cache key, no `Date.now()` busting).

- [ ] **Step 4: Check `.cursor/rules`**

Run: `grep -ril "upload/stream\|/api/upload" .cursor/rules`
Expected: if any rule file enumerates upload endpoints, add the preview endpoints there; conventions themselves are unchanged, so most likely no edits are needed.

- [ ] **Step 5: Verify and commit**

Run: `pnpm format:check` (fix with `pnpm format` if needed).

```bash
git add README.md AGENTS.md CLAUDE.md apps/backend/AGENTS.md apps/ai/AGENTS.md apps/frontend/AGENTS.md apps/backend/.env.development.example apps/backend/.env.production.example apps/ai/.env.development.example apps/ai/.env.production.example
git commit -m "docs: document progressive preview flow, endpoints, and env vars"
```

(Include any `.cursor/rules` file you edited in the `git add`.)

---

### Task 14: Full verification + manual test

**Files:** none (fixes only, if checks fail).

- [ ] **Step 1: Full automated suite**

Run from the repo root:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm check-types
pnpm build
pnpm --filter backend test
pnpm --filter backend test:e2e
```

Expected: every command exits 0 with zero warnings.

Run from `apps/ai`:

```bash
python -m py_compile server.py security.py baseline/vsr_inference.py
python test_security.py
```

Expected: compile clean; `All 9 security tests passed`.

- [ ] **Step 2: Hygiene checks**

```bash
git status --short
git log --oneline main..HEAD
```

Expected: clean tree; only intentional commits. Confirm no `storage/`, `.env`, checkpoint, or generated JPEG/video files are tracked: `git diff --stat main..HEAD` must show only source/docs/test files.

- [ ] **Step 3: Manual test (requires the AI env with a checkpoint; on the dev box use `path` mode via `pnpm dev`, or point at the GPU server with `AI_TRANSFER_MODE=remote`)**

1. Start everything: `pnpm dev` (frontend 5173, backend 3000, ai 8000).
2. Upload a tiny video (< 20 MB) at `/products`.
3. Confirm: upload works; percentage climbs; within ~15 frames the "Preparing first enhanced preview…" placeholder is replaced by the slider; dragging the divider compares layers; DevTools Network shows only `localhost:3000` (or the public domain) — never the AI host; `GET /api/upload/preview/{jobId}/{frameIndex}` returns `image/jpeg` with the immutable cache header; the SSE stream (`/api/upload/events/{jobId}`) payloads carry `preview`; on completion the final player/download appears exactly as before; cancel mid-job still works and the job page returns to the cancelled state.
4. Negative checks: `curl -i http://localhost:3000/api/upload/preview/{jobId}/999999` → 404; `curl -i http://localhost:8000/preview/{jobId}/latest` without a token succeeds only because dev has no token — set `AI_INTERNAL_TOKEN` on both sides and confirm it returns 401 without the header.

- [ ] **Step 4: Commit any fixes and hand off**

If checks surfaced fixes, commit them (`fix: ...`). Then follow the superpowers:finishing-a-development-branch skill to choose merge/PR (a PR to `main` titled "feat: progressive preview comparison" is the expected outcome, with the spec + plan linked).
