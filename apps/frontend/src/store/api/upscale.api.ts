import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import {
  cancelJobContract,
  getJobResultContract,
  getJobStatusContract,
  uploadVideoContract
} from '@repo/contracts/upload';
import { problemDetailsSchema } from '@repo/schemas/errors';
import type { JobStatus } from '@repo/schemas/jobs';
import type {
  CancelJobResponse,
  JobResult,
  UploadResponse
} from '@repo/schemas/upload';
import { API_ORIGIN, buildApiUrl, interpolatePath } from '@/config/api';

export interface UploadArgs {
  formData: FormData;
  onProgress?: (percent: number) => void;
}

function extractProblemDetail(responseText: string): string | null {
  try {
    const problem = problemDetailsSchema
      .partial()
      .parse(JSON.parse(responseText));
    return problem.detail ?? problem.title ?? null;
  } catch {
    return null;
  }
}

function uploadWithProgress(args: UploadArgs): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(uploadVideoContract.method, buildApiUrl(uploadVideoContract.path));
    xhr.withCredentials = true;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && args.onProgress) {
        args.onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(
            uploadVideoContract.responseSchema.parse(
              JSON.parse(xhr.responseText)
            )
          );
        } catch {
          reject(new Error('Upload succeeded but the response was malformed'));
        }
      } else {
        reject(
          new Error(
            extractProblemDetail(xhr.responseText) ??
              `Upload failed with status ${String(xhr.status)}`
          )
        );
      }
    };

    xhr.onerror = () => {
      reject(new Error('Network error during upload'));
    };
    xhr.send(args.formData);
  });
}

export const upscaleApi = createApi({
  reducerPath: 'upscaleApi',
  baseQuery: fetchBaseQuery({
    baseUrl: API_ORIGIN,
    credentials: 'include'
  }),
  tagTypes: ['Job'],
  endpoints: (builder) => ({
    uploadVideo: builder.mutation<UploadResponse, UploadArgs>({
      queryFn: async (args) => {
        try {
          const data = await uploadWithProgress(args);
          return { data };
        } catch (err) {
          return {
            error: {
              status: 'CUSTOM_ERROR' as const,
              error: err instanceof Error ? err.message : 'Upload failed'
            }
          };
        }
      },
      invalidatesTags: ['Job']
    }),
    getJobStatus: builder.query<JobStatus, string>({
      query: (jobId) => interpolatePath(getJobStatusContract.path, { jobId }),
      transformResponse: (data: unknown) =>
        getJobStatusContract.responseSchema.parse(data),
      providesTags: (_result, _error, jobId) => [{ type: 'Job', id: jobId }]
    }),
    cancelJob: builder.mutation<CancelJobResponse, string>({
      query: (jobId) => ({
        url: interpolatePath(cancelJobContract.path, { jobId }),
        method: cancelJobContract.method
      }),
      transformResponse: (data: unknown) =>
        cancelJobContract.responseSchema.parse(data),
      invalidatesTags: (_result, _error, jobId) => [{ type: 'Job', id: jobId }]
    }),
    getJobResult: builder.query<JobResult, string>({
      query: (jobId) => interpolatePath(getJobResultContract.path, { jobId }),
      transformResponse: (data: unknown) =>
        getJobResultContract.responseSchema.parse(data),
      providesTags: (_result, _error, jobId) => [{ type: 'Job', id: jobId }]
    })
  })
});

export const {
  useUploadVideoMutation,
  useGetJobStatusQuery,
  useCancelJobMutation,
  useGetJobResultQuery
} = upscaleApi;
