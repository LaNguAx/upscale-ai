import { z } from 'zod';

export const jobStateSchema = z.enum([
  'queued',
  'processing',
  'completed',
  'failed',
  'cancelled'
]);

export type JobState = z.infer<typeof jobStateSchema>;

export const jobStatusSchema = z.object({
  jobId: z.string(),
  state: jobStateSchema,
  progress: z.number().min(0).max(100),
  createdAt: z.string(),
  updatedAt: z.string(),
  error: z.string().optional()
});

export type JobStatus = z.infer<typeof jobStatusSchema>;

/** Payload of each server-sent event on the job events endpoint. */
export const jobUpdateSchema = z.object({
  jobId: z.string(),
  state: jobStateSchema,
  progress: z.number().min(0).max(100),
  updatedAt: z.string(),
  error: z.string().optional()
});

export type JobUpdate = z.infer<typeof jobUpdateSchema>;

export const jobIdParamsSchema = z.strictObject({
  jobId: z.string().min(1)
});

export type JobIdParams = z.infer<typeof jobIdParamsSchema>;

export function isTerminalJobState(state: JobState): boolean {
  return state === 'completed' || state === 'failed' || state === 'cancelled';
}
