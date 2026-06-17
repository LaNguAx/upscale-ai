import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /**
   * CORS allowed origins. `*` allows all (dev default). For production, set a
   * comma-separated list of exact origins, e.g. `https://upscale.example.com`.
   */
  CORS_ORIGIN: z.string().default('*'),
  /** Base URL of the Python FastAPI inference service. */
  AI_SERVICE_URL: z.url().default('http://localhost:8000'),
  /**
   * Transport used to hand work to the AI service:
   * - `path`: send absolute filesystem paths to `/process` (same machine or
   *   shared volume — the historical default for local/dev).
   * - `remote`: upload the video to `/process-upload` over multipart HTTP and
   *   download the result back, for two-server deployments with no shared
   *   storage.
   */
  AI_TRANSFER_MODE: z.enum(['path', 'remote']).default('path'),
  /**
   * Shared secret for internal backend-to-AI calls. When set, the backend
   * sends `Authorization: Bearer <token>` to the AI's mutating/result
   * endpoints. Empty disables auth (local dev only). Never log this value.
   */
  AI_INTERNAL_TOKEN: z.string().default(''),
  /** Upload/result directories, resolved against the backend working directory. */
  UPLOAD_DIR: z.string().default('../../storage/uploads'),
  RESULT_DIR: z.string().default('../../storage/results'),
  MAX_FILE_SIZE_MB: z.coerce.number().int().positive().default(500),
  /** Comma-separated list of allowed upload extensions (with leading dots). */
  ALLOWED_VIDEO_EXTENSIONS: z.string().default('.mp4,.avi,.mkv,.mov,.wmv,.webm')
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : 'env';
        return `${path}: ${issue.message}`;
      })
      .join(', ');

    throw new Error(`Environment validation failed: ${issues}`);
  }

  return result.data;
}
