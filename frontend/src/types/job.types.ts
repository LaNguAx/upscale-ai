export type JobState = 'queued' | 'processing' | 'completed' | 'failed';

export interface JobStatus {
  jobId: string;
  state: JobState;
  progress: number;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface JobResult {
  jobId: string;
  downloadUrl: string;
  originalFilename: string;
  outputFilename: string;
  metadata?: {
    originalResolution: string;
    outputResolution: string;
    duration: number;
    processingTime: number;
  };
}
