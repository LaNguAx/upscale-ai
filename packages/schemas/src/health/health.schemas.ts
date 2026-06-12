import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'error']),
  service: z.string(),
  uptime: z.number(),
  timestamp: z.string()
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
