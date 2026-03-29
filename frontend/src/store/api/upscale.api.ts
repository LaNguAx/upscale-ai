import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type { JobStatus, JobResult } from '@/types/job.types';

export const upscaleApi = createApi({
  reducerPath: 'upscaleApi',
  baseQuery: fetchBaseQuery({
    baseUrl: import.meta.env.VITE_API_BASE_URL as string
  }),
  tagTypes: ['Job'],
  endpoints: (builder) => ({
    uploadVideo: builder.mutation<{ jobId: string }, FormData>({
      query: (formData) => ({
        url: '/upload',
        method: 'POST',
        body: formData
      }),
      invalidatesTags: ['Job']
    }),
    getJobStatus: builder.query<JobStatus, string>({
      query: (jobId) => `/status/${jobId}`,
      providesTags: (_result, _error, jobId) => [{ type: 'Job', id: jobId }]
    }),
    getJobResult: builder.query<JobResult, string>({
      query: (jobId) => `/result/${jobId}`,
      providesTags: (_result, _error, jobId) => [{ type: 'Job', id: jobId }]
    })
  })
});

export const { useUploadVideoMutation, useGetJobStatusQuery, useGetJobResultQuery } = upscaleApi;
