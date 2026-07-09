/**
 * Internal backend-to-AI protocol types.
 *
 * This protocol is NOT a public contract and has no shared Zod schema — it is
 * implemented on the AI side in `apps/ai/server.py`. Any change here must be
 * mirrored there (and in the docs). See `apps/ai/AGENTS.md` for the canonical
 * NDJSON message shapes.
 */

/** Transport used to hand work to the AI service. */
export type AITransferMode = 'path' | 'remote';

/** Shape of the AI service `GET /health` response. */
export interface AIHealthResponse {
  status: string;
  device?: string;
  model_loaded?: boolean;
  /** Filename of the loaded checkpoint, or null when no model is loaded. */
  checkpoint?: string | null;
}

/** Preview frame metadata optionally attached to a `processing` line. */
export interface AIPreviewUpdate {
  frameIndex: number;
  width?: number;
  height?: number;
  /** AI-relative download path, e.g. `/preview/{jobId}/{frameIndex}`. */
  downloadUrl: string;
  /** Matching original (input) frame, e.g. `/preview/{jobId}/{frameIndex}_in`. */
  originalDownloadUrl?: string;
}

/** One NDJSON progress line emitted during inference (no `jobId`). */
export interface AIProcessingUpdate {
  status: 'processing';
  progress: number;
  currentFrame?: number;
  totalFrames?: number;
  preview?: AIPreviewUpdate;
}

/**
 * Terminal NDJSON line on success. `resultDownloadUrl` (and, when the
 * comparison encode succeeded, `originalDownloadUrl`) are present only in
 * `remote` mode (paths to fetch the files from the AI service).
 */
export interface AICompletedUpdate {
  status: 'completed';
  jobId: string;
  progress: number;
  totalFrames?: number;
  fileSize?: number;
  resultDownloadUrl?: string;
  originalDownloadUrl?: string;
}

/** Terminal NDJSON line when inference fails. */
export interface AIFailedUpdate {
  status: 'failed';
  jobId: string;
  error: string;
}

/** Terminal NDJSON line when a job is cancelled by the user. */
export interface AICancelledUpdate {
  status: 'cancelled';
  jobId: string;
  progress?: number;
  error?: string;
}

/** Discriminated union of every NDJSON line the AI service can emit. */
export type AIProcessUpdate =
  | AIProcessingUpdate
  | AICompletedUpdate
  | AIFailedUpdate
  | AICancelledUpdate;
