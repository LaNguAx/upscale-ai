import {
  BadRequestException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Subject, filter, map, startWith, takeWhile } from 'rxjs';
import type { Observable } from 'rxjs';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  isTerminalJobState,
  type JobPreview,
  type JobState,
  type JobStatus,
  type JobUpdate
} from '@repo/schemas/jobs';
import type { JobResult, UploadResponse } from '@repo/schemas/upload';
import type { Env } from '@/utils/env.validation';

/** Internal preview metadata; the public URLs are derived on emission. */
export interface JobPreviewMetadata {
  frameIndex: number;
  width?: number;
  height?: number;
  /** True when the AI announced a matching original (input) frame. */
  hasOriginal?: boolean;
  /** Source-video frames per second — lets the client pace flipbook playback. */
  fps?: number;
  /** Sampling stride: a preview frame exists every `stride` source frames. */
  stride?: number;
}

interface JobRecord {
  jobId: string;
  state: JobState;
  progress: number;
  originalFilename: string;
  storedFilename: string;
  uploadPath: string;
  resultPath: string;
  /** Browser-safe original comparison video, once downloaded/located. */
  originalComparisonPath?: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
  preview?: JobPreviewMetadata;
}

@Injectable()
export class UploadService {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly jobUpdates$ = new Subject<JobUpdate>();
  private readonly uploadDir: string;
  private readonly resultDir: string;
  private readonly previewDir: string;

  constructor(private readonly configService: ConfigService<Env, true>) {
    this.uploadDir = path.resolve(
      process.cwd(),
      this.configService.get('UPLOAD_DIR', { infer: true })
    );
    this.resultDir = path.resolve(
      process.cwd(),
      this.configService.get('RESULT_DIR', { infer: true })
    );
    this.previewDir = path.resolve(
      process.cwd(),
      this.configService.get('PREVIEW_DIR', { infer: true })
    );

    fs.mkdirSync(this.uploadDir, { recursive: true });
    fs.mkdirSync(this.resultDir, { recursive: true });
    fs.mkdirSync(this.previewDir, { recursive: true });
  }

  createJob(file: Express.Multer.File): UploadResponse {
    const jobId = crypto.randomUUID();
    const now = new Date().toISOString();

    const record: JobRecord = {
      jobId,
      state: 'queued',
      progress: 0,
      originalFilename: file.originalname,
      storedFilename: file.filename,
      uploadPath: file.path,
      resultPath: file.path,
      createdAt: now,
      updatedAt: now
    };

    this.jobs.set(jobId, record);

    return { jobId };
  }

  private toJobPreview(job: JobRecord): JobPreview | undefined {
    if (!job.preview) return undefined;
    const frameBase = `/api/upload/preview/${job.jobId}/${String(job.preview.frameIndex)}`;
    return {
      frameIndex: job.preview.frameIndex,
      imageUrl: frameBase,
      originalImageUrl: job.preview.hasOriginal
        ? `${frameBase}/original`
        : undefined,
      width: job.preview.width,
      height: job.preview.height,
      fps: job.preview.fps,
      stride: job.preview.stride
    };
  }

  private toJobUpdate(job: JobRecord): JobUpdate {
    return {
      jobId: job.jobId,
      state: job.state,
      progress: job.progress,
      updatedAt: job.updatedAt,
      error: job.error,
      preview: this.toJobPreview(job)
    };
  }

  updateJob(
    jobId: string,
    state: JobState,
    progress: number,
    error?: string
  ): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    if (isTerminalJobState(job.state)) return;

    const now = new Date().toISOString();
    job.state = state;
    job.progress = progress;
    job.updatedAt = now;
    if (error !== undefined) job.error = error;

    this.jobUpdates$.next(this.toJobUpdate(job));
  }

  getJobUpdates$(jobId: string): Observable<MessageEvent> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    const currentState: JobUpdate = this.toJobUpdate(job);

    return this.jobUpdates$.pipe(
      filter((u) => u.jobId === jobId),
      startWith(currentState),
      takeWhile((u) => !isTerminalJobState(u.state), true),
      map((u) => ({ data: JSON.stringify(u) }) as unknown as MessageEvent)
    );
  }

  getJobStatus(jobId: string): JobStatus {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    return {
      jobId: job.jobId,
      state: job.state,
      progress: job.progress,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      error: job.error,
      preview: this.toJobPreview(job)
    };
  }

  getJobResult(jobId: string): JobResult {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }
    if (job.state !== 'completed') {
      throw new BadRequestException(
        `Job ${jobId} is not completed yet (state: ${job.state})`
      );
    }

    const ext = path.extname(job.originalFilename);
    const name = path.basename(job.originalFilename, ext);

    return {
      jobId: job.jobId,
      downloadUrl: `/api/upload/stream/${job.jobId}`,
      originalStreamUrl: job.originalComparisonPath
        ? `/api/upload/stream/${job.jobId}/original`
        : undefined,
      originalFilename: job.originalFilename,
      // The enhanced result is always re-encoded to browser-safe H.264 MP4.
      outputFilename: `${name}_enhanced_by_upscale.mp4`
    };
  }

  getStreamInfo(jobId: string): { filePath: string; filename: string } {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    return {
      filePath: job.resultPath,
      filename: job.originalFilename
    };
  }

  getOriginalStreamInfo(jobId: string): { filePath: string; filename: string } {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }
    if (!job.originalComparisonPath || !fs.existsSync(job.originalComparisonPath)) {
      throw new NotFoundException('Original comparison video not available');
    }

    return {
      filePath: job.originalComparisonPath,
      filename: `${job.jobId}_original.mp4`
    };
  }

  getJobRecord(jobId: string): JobRecord | undefined {
    return this.jobs.get(jobId);
  }

  setResultPath(jobId: string, resultPath: string): void {
    const job = this.jobs.get(jobId);
    if (job && job.state === 'processing') {
      job.resultPath = resultPath;
    }
  }

  setOriginalComparisonPath(jobId: string, filePath: string): void {
    const job = this.jobs.get(jobId);
    if (job && job.state === 'processing') {
      job.originalComparisonPath = filePath;
    }
  }

  setJobPreview(jobId: string, preview: JobPreviewMetadata): void {
    const job = this.jobs.get(jobId);
    if (!job || isTerminalJobState(job.state)) return;

    job.preview = preview;
    job.updatedAt = new Date().toISOString();
    this.jobUpdates$.next(this.toJobUpdate(job));
  }

  cancelJob(jobId: string, reason = 'Upscaling cancelled by user'): void {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }
    if (isTerminalJobState(job.state)) {
      return;
    }

    this.updateJob(jobId, 'cancelled', job.progress, reason);
  }
}
