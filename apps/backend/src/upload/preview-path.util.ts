import * as path from 'node:path';

const JOB_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
// 'latest' or a frame index, each optionally with the '_in' (original/input
// frame) suffix — e.g. '42', '42_in', 'latest', 'latest_in'.
const PREVIEW_FILE_KEY_PATTERN = /^(latest|\d{1,9})(_in)?$/;

export const LATEST_FRAME_KEY = 'latest';
/** File-key suffix marking the original (input) frame of a preview pair. */
export const ORIGINAL_KEY_SUFFIX = '_in';

/**
 * Resolves the on-disk path of a cached preview JPEG, or null when the input
 * is unsafe. `frameKey` is `latest` or a decimal frame index, optionally with
 * the `_in` (original frame) suffix; the result is guaranteed to stay inside
 * `previewDir` (path-traversal defense — job ids and frame keys may originate
 * from URL params or the AI stream).
 */
export function resolvePreviewFilePath(
  previewDir: string,
  jobId: string,
  frameKey: string
): string | null {
  if (!JOB_ID_PATTERN.test(jobId)) return null;
  if (!PREVIEW_FILE_KEY_PATTERN.test(frameKey)) {
    return null;
  }
  const base = path.resolve(previewDir);
  const candidate = path.resolve(base, jobId, `${frameKey}.jpg`);
  if (!candidate.startsWith(base + path.sep)) return null;
  return candidate;
}
