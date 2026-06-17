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
}

/** One NDJSON progress line emitted during inference (no `jobId`). */
export interface AIProcessingUpdate {
  status: 'processing';
  progress: number;
  currentFrame?: number;
  totalFrames?: number;
}

/**
 * Terminal NDJSON line on success. `resultDownloadUrl` is present only in
 * `remote` mode (the path to fetch the enhanced file from the AI service).
 */
export interface AICompletedUpdate {
  status: 'completed';
  jobId: string;
  progress: number;
  totalFrames?: number;
  fileSize?: number;
  resultDownloadUrl?: string;
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
