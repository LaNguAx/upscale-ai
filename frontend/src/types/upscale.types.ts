export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface UploadResponse {
  jobId: string;
}

export interface JobStatusResponse {
  id: string;
  status: JobStatus;
  progress: number;
  originalFilename: string;
  fileSize: number;
  upscaleFactor: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
