import {
  UPLOAD_CANCEL_ENDPOINT,
  UPLOAD_ENDPOINT,
  UPLOAD_RESULT_ENDPOINT,
  UPLOAD_STATUS_ENDPOINT
} from '@repo/consts/upload';
import {
  jobIdParamsSchema,
  jobStatusSchema,
  type JobIdParams,
  type JobStatus
} from '@repo/schemas/jobs';
import {
  cancelJobResponseSchema,
  jobResultSchema,
  uploadResponseSchema,
  type CancelJobResponse,
  type JobResult,
  type UploadResponse
} from '@repo/schemas/upload';
import type { EndpointContract } from '../shared/endpoint.js';

/**
 * Upload is multipart/form-data (field `video`), so there is no JSON body
 * schema. Only the response is contract-validated.
 */
export const uploadVideoContract: EndpointContract<UploadResponse> = {
  method: 'POST',
  path: UPLOAD_ENDPOINT,
  responseSchema: uploadResponseSchema
};

export const getJobStatusContract: EndpointContract<
  JobStatus,
  void,
  JobIdParams
> = {
  method: 'GET',
  path: UPLOAD_STATUS_ENDPOINT,
  responseSchema: jobStatusSchema,
  paramsSchema: jobIdParamsSchema
};

export const getJobResultContract: EndpointContract<
  JobResult,
  void,
  JobIdParams
> = {
  method: 'GET',
  path: UPLOAD_RESULT_ENDPOINT,
  responseSchema: jobResultSchema,
  paramsSchema: jobIdParamsSchema
};

export const cancelJobContract: EndpointContract<
  CancelJobResponse,
  void,
  JobIdParams
> = {
  method: 'POST',
  path: UPLOAD_CANCEL_ENDPOINT,
  responseSchema: cancelJobResponseSchema,
  paramsSchema: jobIdParamsSchema
};

// The stream (`UPLOAD_STREAM_ENDPOINT`, `UPLOAD_STREAM_ORIGINAL_ENDPOINT`),
// SSE (`UPLOAD_EVENTS_ENDPOINT`), and preview (`UPLOAD_PREVIEW_*_ENDPOINT`,
// including the `/original` frame variants) endpoints are not JSON contracts: the stream returns binary video with HTTP
// Range support, the SSE endpoint emits server-sent events whose payloads
// follow `jobUpdateSchema` from `@repo/schemas/jobs` (optionally carrying a
// `preview`), and the preview endpoints return cached JPEG frames.
