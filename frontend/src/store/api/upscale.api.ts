import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type { JobStatus, JobResult } from '@/types/job.types';

const API_BASE = import.meta.env.VITE_API_BASE_URL as string;

interface UploadArgs {
  formData: FormData;
  onProgress?: (percent: number) => void;
}

function uploadWithProgress(
  args: UploadArgs
): Promise<{ jobId: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/upload`);
    xhr.withCredentials = true;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && args.onProgress) {
        args.onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText) as { jobId: string });
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(args.formData);
  });
}

export const upscaleApi = createApi({
  reducerPath: 'upscaleApi',
  baseQuery: fetchBaseQuery({ baseUrl: API_BASE }),
  tagTypes: ['Job'],
  endpoints: (builder) => ({
    uploadVideo: builder.mutation<{ jobId: string }, UploadArgs>({
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
      query: (jobId) => `/upload/status/${jobId}`,
      providesTags: (_result, _error, jobId) => [{ type: 'Job', id: jobId }]
    }),
    getJobResult: builder.query<JobResult, string>({
      query: (jobId) => `/upload/result/${jobId}`,
      providesTags: (_result, _error, jobId) => [{ type: 'Job', id: jobId }]
    })
  })
});

export const { useUploadVideoMutation, useGetJobStatusQuery, useGetJobResultQuery } = upscaleApi;
