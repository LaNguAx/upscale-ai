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
