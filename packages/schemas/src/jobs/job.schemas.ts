import { z } from 'zod';

export const jobStateSchema = z.enum([
  'queued',
  'processing',
  'completed',
  'failed',
  'cancelled'
]);

export type JobState = z.infer<typeof jobStateSchema>;

/** Latest preview frame pair cached by the backend for a job. */
export const jobPreviewSchema = z.object({
  frameIndex: z.number().int().nonnegative(),
  /** Enhanced frame — public backend path, e.g. `/api/upload/preview/{jobId}/{frameIndex}`. */
  imageUrl: z.string(),
  /** Matching original (input) frame, e.g. `/api/upload/preview/{jobId}/{frameIndex}/original`. */
  originalImageUrl: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional()
});

export type JobPreview = z.infer<typeof jobPreviewSchema>;

export const jobStatusSchema = z.object({
  jobId: z.string(),
  state: jobStateSchema,
  progress: z.number().min(0).max(100),
  createdAt: z.string(),
  updatedAt: z.string(),
  error: z.string().optional(),
  preview: jobPreviewSchema.optional()
});

export type JobStatus = z.infer<typeof jobStatusSchema>;

/** Payload of each server-sent event on the job events endpoint. */
export const jobUpdateSchema = z.object({
  jobId: z.string(),
  state: jobStateSchema,
  progress: z.number().min(0).max(100),
  updatedAt: z.string(),
  error: z.string().optional(),
  preview: jobPreviewSchema.optional()
});

export type JobUpdate = z.infer<typeof jobUpdateSchema>;

export const jobIdParamsSchema = z.strictObject({
  jobId: z.string().min(1)
});

export type JobIdParams = z.infer<typeof jobIdParamsSchema>;

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

export function isTerminalJobState(state: JobState): boolean {
  return state === 'completed' || state === 'failed' || state === 'cancelled';
}
