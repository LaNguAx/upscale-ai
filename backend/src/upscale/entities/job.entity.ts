import { JobStatus } from '../enums/job-status.enum';

export class Job {
  id: string;
  status: JobStatus;
  progress: number;
  originalFilename: string;
  inputPath: string;
  outputPath: string | null;
  fileSize: number;
  mimeType: string;
  upscaleFactor: number;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;

  constructor(params: {
    id: string;
    originalFilename: string;
    inputPath: string;
    fileSize: number;
    mimeType: string;
    upscaleFactor: number;
  }) {
    this.id = params.id;
    this.status = JobStatus.QUEUED;
    this.progress = 0;
    this.originalFilename = params.originalFilename;
    this.inputPath = params.inputPath;
    this.outputPath = null;
    this.fileSize = params.fileSize;
    this.mimeType = params.mimeType;
    this.upscaleFactor = params.upscaleFactor;
    this.error = null;
    this.createdAt = new Date();
    this.updatedAt = new Date();
  }
}
