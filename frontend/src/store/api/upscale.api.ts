import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

import type { JobStatusResponse, UploadResponse } from '@/types/upscale.types';

export const upscaleApi = createApi({
  reducerPath: 'upscaleApi',
  baseQuery: fetchBaseQuery({
    baseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/'
  }),
  tagTypes: ['Job'],
  endpoints: (builder) => ({
    uploadVideo: builder.mutation<UploadResponse, FormData>({
      query: (formData) => ({
        url: 'upload',
        method: 'POST',
        body: formData
      }),
      invalidatesTags: ['Job']
    }),

    getJobStatus: builder.query<JobStatusResponse, string>({
      query: (jobId) => `status/${jobId}`,
      providesTags: (_result, _error, jobId) => [{ type: 'Job', id: jobId }]
    }),

    getAllJobs: builder.query<JobStatusResponse[], void>({
      query: () => 'jobs',
      providesTags: ['Job']
    })
  })
});

export const { useUploadVideoMutation, useGetJobStatusQuery, useGetAllJobsQuery } = upscaleApi;
