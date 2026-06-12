export const UPLOAD_ENDPOINT = '/api/upload' as const;
export const UPLOAD_STATUS_ENDPOINT = '/api/upload/status/:jobId' as const;
export const UPLOAD_RESULT_ENDPOINT = '/api/upload/result/:jobId' as const;
export const UPLOAD_CANCEL_ENDPOINT = '/api/upload/cancel/:jobId' as const;
/** HTTP Range video stream — binary endpoint, no JSON contract. */
export const UPLOAD_STREAM_ENDPOINT = '/api/upload/stream/:jobId' as const;
/** Server-sent events for live job updates — event payloads follow jobUpdateSchema. */
export const UPLOAD_EVENTS_ENDPOINT = '/api/upload/events/:jobId' as const;
