import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Subject, Observable, filter, map, takeWhile, startWith } from 'rxjs';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { JobStatusDto } from './dto/job-status.dto';
import type { JobResultDto } from './dto/job-result.dto';
import type { UploadResponseDto } from './dto/upload-response.dto';

type JobState = 'queued' | 'processing' | 'completed' | 'failed';

interface JobRecord {
  jobId: string;
  state: JobState;
  progress: number;
  originalFilename: string;
  storedFilename: string;
  uploadPath: string;
  resultPath: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

interface JobUpdate {
  jobId: string;
  state: JobState;
  progress: number;
  updatedAt: string;
  error?: string;
}

@Injectable()
export class UploadService {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly jobUpdates$ = new Subject<JobUpdate>();
  private readonly uploadDir: string;
  private readonly resultDir: string;

  constructor(private readonly configService: ConfigService) {
    this.uploadDir = path.resolve(
      process.cwd(),
      this.configService.get<string>('UPLOAD_DIR', '../storage/uploads'),
    );
    this.resultDir = path.resolve(
      process.cwd(),
      this.configService.get<string>('RESULT_DIR', '../storage/results'),
    );

    fs.mkdirSync(this.uploadDir, { recursive: true });
    fs.mkdirSync(this.resultDir, { recursive: true });
  }

  createJob(file: Express.Multer.File): UploadResponseDto {
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
      updatedAt: now,
    };

    this.jobs.set(jobId, record);

    return { jobId };
  }

  updateJob(
    jobId: string,
    state: JobState,
    progress: number,
    error?: string,
  ): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    const now = new Date().toISOString();
    job.state = state;
    job.progress = progress;
    job.updatedAt = now;
    if (error !== undefined) job.error = error;

    this.jobUpdates$.next({
      jobId,
      state,
      progress,
      updatedAt: now,
      error,
    });
  }

  getJobUpdates$(jobId: string): Observable<MessageEvent> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    const currentState: JobUpdate = {
      jobId: job.jobId,
      state: job.state,
      progress: job.progress,
      updatedAt: job.updatedAt,
      error: job.error,
    };

    return this.jobUpdates$.pipe(
      filter((u) => u.jobId === jobId),
      startWith(currentState),
      takeWhile(
        (u) => u.state !== 'completed' && u.state !== 'failed',
        true,
      ),
      map(
        (u) =>
          ({ data: JSON.stringify(u) }) as unknown as MessageEvent,
      ),
    );
  }

  getJobStatus(jobId: string): JobStatusDto {
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
    };
  }

  getJobResult(jobId: string): JobResultDto {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }
    if (job.state !== 'completed') {
      throw new BadRequestException(
        `Job ${jobId} is not completed yet (state: ${job.state})`,
      );
    }

    const ext = path.extname(job.originalFilename);
    const name = path.basename(job.originalFilename, ext);

    return {
      jobId: job.jobId,
      downloadUrl: `/api/upload/stream/${job.jobId}`,
      originalFilename: job.originalFilename,
      outputFilename: `${name}_enhanced_by_upscale${ext}`,
    };
  }

  getStreamInfo(jobId: string): { filePath: string; filename: string } {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    return {
      filePath: job.resultPath,
      filename: job.originalFilename,
    };
  }

  getJobRecord(jobId: string) {
    return this.jobs.get(jobId);
  }

  setResultPath(jobId: string, resultPath: string): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.resultPath = resultPath;
    }
  }
}
