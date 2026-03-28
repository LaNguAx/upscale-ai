import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { randomUUID } from 'crypto';
import { firstValueFrom } from 'rxjs';
import * as path from 'path';
import * as fs from 'fs';

import { Job } from './entities/job.entity';
import { JobStatus } from './enums/job-status.enum';
import type { JobStatusResponseDto } from './dto/job-status-response.dto';

@Injectable()
export class UpscaleService {
  private readonly logger = new Logger(UpscaleService.name);
  private readonly jobs = new Map<string, Job>();
  private readonly uploadDir: string;
  private readonly resultDir: string;
  private readonly allowedExtensions: string[];
  private readonly maxFileSize: number;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.uploadDir = path.resolve(
      this.configService.get<string>('UPLOAD_DIR', '../storage/uploads'),
    );
    this.resultDir = path.resolve(
      this.configService.get<string>('RESULT_DIR', '../storage/results'),
    );
    this.allowedExtensions = this.configService
      .get<string>('ALLOWED_VIDEO_EXTENSIONS', '.mp4,.avi,.mkv,.mov,.wmv,.webm')
      .split(',')
      .map((ext) => ext.trim().toLowerCase());
    this.maxFileSize =
      this.configService.get<number>('MAX_FILE_SIZE_MB', 500) * 1024 * 1024;

    // Ensure directories exist
    fs.mkdirSync(this.uploadDir, { recursive: true });
    fs.mkdirSync(this.resultDir, { recursive: true });
  }

  async createJob(
    file: Express.Multer.File,
    upscaleFactor: number = 2,
  ): Promise<string> {
    // Validate file extension
    const ext = path.extname(file.originalname).toLowerCase();
    if (!this.allowedExtensions.includes(ext)) {
      // Remove the uploaded file
      if (file.path) {
        fs.unlinkSync(file.path);
      }
      throw new BadRequestException(
        `Invalid file type: ${ext}. Allowed: ${this.allowedExtensions.join(', ')}`,
      );
    }

    const jobId = randomUUID();
    const filename = `${jobId}${ext}`;
    const inputPath = path.join(this.uploadDir, filename);

    // Move file to upload directory (Multer may have saved it to a temp location)
    if (file.path && file.path !== inputPath) {
      fs.renameSync(file.path, inputPath);
    }

    // Create job record
    const job = new Job({
      id: jobId,
      originalFilename: file.originalname,
      inputPath,
      fileSize: file.size,
      mimeType: file.mimetype,
      upscaleFactor,
    });

    this.jobs.set(jobId, job);
    this.logger.log(
      `Job ${jobId} created: ${file.originalname} (${(file.size / 1024 / 1024).toFixed(1)}MB)`,
    );

    // Call AI service to start processing
    try {
      await firstValueFrom(
        this.httpService.post('/process', {
          job_id: jobId,
          input_path: inputPath,
          upscale_factor: upscaleFactor,
        }),
      );
    } catch (error: unknown) {
      job.status = JobStatus.FAILED;
      job.error = 'AI service unavailable';
      job.updatedAt = new Date();
      this.logger.error(
        `Failed to submit job ${jobId} to AI service: ${String(error)}`,
      );
      throw new ServiceUnavailableException(
        'AI processing service is unavailable. Please try again later.',
      );
    }

    return jobId;
  }

  async getJobStatus(jobId: string): Promise<JobStatusResponseDto> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    // Sync with AI service if job is still active
    if (
      job.status === JobStatus.QUEUED ||
      job.status === JobStatus.PROCESSING
    ) {
      try {
        const response = await firstValueFrom(
          this.httpService.get<{
            status: string;
            progress: number;
            output_path: string | null;
            error: string | null;
            total_frames: number;
            processed_frames: number;
          }>(`/status/${jobId}`),
        );

        const aiJob = response.data;
        job.status = aiJob.status as JobStatus;
        job.progress = aiJob.progress;
        job.error = aiJob.error;
        job.updatedAt = new Date();

        if (aiJob.output_path) {
          job.outputPath = aiJob.output_path;
        }
      } catch {
        // AI service might be temporarily unavailable; return cached status
        this.logger.warn(
          `Could not sync job ${jobId} with AI service, returning cached status`,
        );
      }
    }

    return this.toStatusResponse(job);
  }

  async getAllJobs(): Promise<JobStatusResponseDto[]> {
    const jobs = Array.from(this.jobs.values());

    // Sync active jobs with AI service
    const activeJobs = jobs.filter(
      (j) => j.status === JobStatus.QUEUED || j.status === JobStatus.PROCESSING,
    );

    await Promise.allSettled(
      activeJobs.map(async (job) => {
        try {
          const response = await firstValueFrom(
            this.httpService.get<{
              status: string;
              progress: number;
              output_path: string | null;
              error: string | null;
            }>(`/status/${job.id}`),
          );

          const aiJob = response.data;
          job.status = aiJob.status as JobStatus;
          job.progress = aiJob.progress;
          job.error = aiJob.error;
          job.updatedAt = new Date();

          if (aiJob.output_path) {
            job.outputPath = aiJob.output_path;
          }
        } catch {
          // Silently continue with cached data
        }
      }),
    );

    return jobs
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((job) => this.toStatusResponse(job));
  }

  getJobResultPath(jobId: string): { filePath: string; filename: string } {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    if (job.status !== JobStatus.COMPLETED) {
      throw new BadRequestException(
        `Job ${jobId} is not completed yet (status: ${job.status})`,
      );
    }

    if (!job.outputPath || !fs.existsSync(job.outputPath)) {
      throw new NotFoundException(`Result file not found for job ${jobId}`);
    }

    const ext = path.extname(job.originalFilename) || '.mp4';
    const baseName = path.basename(job.originalFilename, ext);
    const filename = `${baseName}_upscaled${ext}`;

    return { filePath: job.outputPath, filename };
  }

  private toStatusResponse(job: Job): JobStatusResponseDto {
    return {
      id: job.id,
      status: job.status,
      progress: job.progress,
      originalFilename: job.originalFilename,
      fileSize: job.fileSize,
      upscaleFactor: job.upscaleFactor,
      error: job.error,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    };
  }
}
