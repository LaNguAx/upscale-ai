import { z } from 'zod';

export const uploadResponseSchema = z.object({
  jobId: z.string()
});

export type UploadResponse = z.infer<typeof uploadResponseSchema>;

export const jobResultSchema = z.object({
  jobId: z.string(),
  downloadUrl: z.string(),
  originalFilename: z.string(),
  outputFilename: z.string()
});

export type JobResult = z.infer<typeof jobResultSchema>;

export const cancelJobResponseSchema = z.object({
  jobId: z.string()
});

export type CancelJobResponse = z.infer<typeof cancelJobResponseSchema>;
