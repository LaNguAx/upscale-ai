import { z } from 'zod';

export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  instance: z.string(),
  detail: z.string().optional(),
  errors: z.array(z.unknown()).optional(),
  traceId: z.string().optional()
});

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
