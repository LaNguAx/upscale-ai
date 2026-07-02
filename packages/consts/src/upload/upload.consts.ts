export const UPLOAD_ENDPOINT = '/api/upload' as const;
export const UPLOAD_STATUS_ENDPOINT = '/api/upload/status/:jobId' as const;
export const UPLOAD_RESULT_ENDPOINT = '/api/upload/result/:jobId' as const;
export const UPLOAD_CANCEL_ENDPOINT = '/api/upload/cancel/:jobId' as const;
/** HTTP Range video stream — binary endpoint, no JSON contract. */
export const UPLOAD_STREAM_ENDPOINT = '/api/upload/stream/:jobId' as const;
/** Server-sent events for live job updates — event payloads follow jobUpdateSchema. */
export const UPLOAD_EVENTS_ENDPOINT = '/api/upload/events/:jobId' as const;
/** Latest cached preview frame — binary JPEG endpoint, no JSON contract. Served no-store. */
export const UPLOAD_PREVIEW_LATEST_ENDPOINT =
  '/api/upload/preview/:jobId/latest' as const;
/** Specific cached preview frame — binary JPEG endpoint, immutable-cacheable. */
export const UPLOAD_PREVIEW_FRAME_ENDPOINT =
  '/api/upload/preview/:jobId/:frameIndex' as const;
