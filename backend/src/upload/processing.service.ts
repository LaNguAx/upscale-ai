import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'node:path';
import { UploadService } from './upload.service';

const MOCK_PROGRESS_STEPS = [10, 25, 50, 75, 90, 100];
const MOCK_STEP_DELAY_MS = 800;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class ProcessingService {
  private readonly logger = new Logger(ProcessingService.name);
  private readonly aiServiceUrl: string;
  private readonly resultDir: string;

  constructor(
    private readonly uploadService: UploadService,
    private readonly configService: ConfigService,
  ) {
    this.aiServiceUrl = this.configService.get<string>(
      'AI_SERVICE_URL',
      'http://localhost:8000',
    );
    this.resultDir = path.resolve(
      process.cwd(),
      this.configService.get<string>('RESULT_DIR', '../storage/results'),
    );
  }

  async processJob(jobId: string): Promise<void> {
    try {
      this.uploadService.updateJob(jobId, 'processing', 0);

      const job = this.uploadService.getJobRecord(jobId);
      if (!job) {
        this.uploadService.updateJob(jobId, 'failed', 0, 'Job record not found');
        return;
      }

      const ext = path.extname(job.storedFilename);
      const outputPath = path.resolve(this.resultDir, `${jobId}_enhanced${ext}`);

      const aiAvailable = await this.tryAIProcessing(
        jobId,
        job.uploadPath,
        outputPath,
      );

      if (!aiAvailable) {
        this.logger.warn(
          `AI service unavailable — falling back to mock processing for job ${jobId}`,
        );
        await this.mockProcessing(jobId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.uploadService.updateJob(jobId, 'failed', 0, message);
      this.logger.error(`Job ${jobId}: failed — ${message}`);
    }
  }

  private async tryAIProcessing(
    jobId: string,
    inputPath: string,
    outputPath: string,
  ): Promise<boolean> {
    let response: Response;
    try {
      response = await fetch(`${this.aiServiceUrl}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputPath,
          outputPath,
          scale: 4,
          seqLen: 5,
          simulateLq: true,
        }),
      });
    } catch {
      // AI service not running — ECONNREFUSED
      return false;
    }

    if (response.status === 503) {
      // Model not loaded
      return false;
    }

    if (!response.ok) {
      throw new Error(`AI service returned ${response.status}: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('AI service returned no response body');
    }

    // Read NDJSON stream line-by-line
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;

        const update = JSON.parse(line) as {
          status: string;
          progress?: number;
          error?: string;
        };

        if (update.status === 'failed') {
          throw new Error(update.error ?? 'AI processing failed');
        }

        if (update.progress !== undefined) {
          this.uploadService.updateJob(jobId, 'processing', update.progress);
          this.logger.log(`Job ${jobId}: ${update.progress}%`);
        }

        if (update.status === 'completed') {
          this.uploadService.setResultPath(jobId, outputPath);
          this.uploadService.updateJob(jobId, 'completed', 100);
          this.logger.log(`Job ${jobId}: completed (AI)`);
          return true;
        }
      }
    }

    // Stream ended without explicit completed status — treat as completed
    this.uploadService.setResultPath(jobId, outputPath);
    this.uploadService.updateJob(jobId, 'completed', 100);
    this.logger.log(`Job ${jobId}: completed (AI, stream ended)`);
    return true;
  }

  private async mockProcessing(jobId: string): Promise<void> {
    for (const progress of MOCK_PROGRESS_STEPS) {
      await delay(MOCK_STEP_DELAY_MS);
      this.uploadService.updateJob(jobId, 'processing', progress);
      this.logger.log(`Job ${jobId}: ${progress}% (mock)`);
    }

    this.uploadService.updateJob(jobId, 'completed', 100);
    this.logger.log(`Job ${jobId}: completed (mock)`);
  }
}
