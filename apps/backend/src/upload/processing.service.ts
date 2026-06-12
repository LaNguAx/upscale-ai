import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isTerminalJobState, type JobState } from '@repo/schemas/jobs';
import { UploadService } from '@/upload/upload.service';
import type { Env } from '@/utils/env.validation';

interface AIHealthResponse {
  status: string;
  model_loaded?: boolean;
}

interface AIProcessUpdate {
  status: 'processing' | 'completed' | 'failed' | 'cancelled';
  progress?: number;
  error?: string;
}

interface ActiveJob {
  abortController: AbortController;
  outputPath: string;
}

const AI_HEALTH_TIMEOUT_MS = 5000;

@Injectable()
export class ProcessingService {
  private readonly logger = new Logger(ProcessingService.name);
  private readonly aiServiceUrl: string;
  private readonly resultDir: string;
  private readonly activeJobs = new Map<string, ActiveJob>();

  constructor(
    private readonly uploadService: UploadService,
    private readonly configService: ConfigService<Env, true>,
  ) {
    this.aiServiceUrl = this.configService.get('AI_SERVICE_URL', {
      infer: true,
    });
    this.resultDir = path.resolve(
      process.cwd(),
      this.configService.get('RESULT_DIR', { infer: true }),
    );
  }

  async processJob(jobId: string): Promise<void> {
    const existingJob = this.uploadService.getJobRecord(jobId);
    if (!existingJob) {
      this.logger.warn(`Job ${jobId}: record missing before processing start`);
      return;
    }
    if (isTerminalJobState(existingJob.state)) {
      this.logger.log(`Job ${jobId}: already terminal (${existingJob.state}), skipping`);
      return;
    }

    try {
      this.uploadService.updateJob(jobId, 'processing', 0);

      const job = this.uploadService.getJobRecord(jobId);
      if (!job) {
        this.uploadService.updateJob(jobId, 'failed', 0, 'Job record not found');
        return;
      }

      const ext = path.extname(job.storedFilename);
      const outputPath = path.resolve(this.resultDir, `${jobId}_enhanced${ext}`);
      const abortController = new AbortController();
      this.activeJobs.set(jobId, { abortController, outputPath });

      await this.assertAIReady(jobId, abortController);
      if (this.isCancelled(jobId)) {
        return;
      }
      await this.tryAIProcessing(jobId, job.uploadPath, outputPath, abortController);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (!this.isCancelled(jobId)) {
        this.uploadService.updateJob(jobId, 'failed', 0, message);
        this.logger.error(`Job ${jobId}: failed — ${message}`);
      } else {
        this.logger.log(`Job ${jobId}: cancelled`);
      }
    } finally {
      this.activeJobs.delete(jobId);
    }
  }

  async cancelJob(jobId: string): Promise<void> {
    this.uploadService.cancelJob(jobId);

    const activeJob = this.activeJobs.get(jobId);
    if (activeJob) {
      activeJob.abortController.abort();
    }

    try {
      const response = await fetch(`${this.aiServiceUrl}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      if (!response.ok && response.status !== 404) {
        this.logger.warn(
          `Cancel bridge to AI returned ${String(response.status)} for job ${jobId}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Cancel bridge to AI failed for ${jobId}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  private async assertAIReady(
    jobId: string,
    abortController: AbortController,
  ): Promise<void> {
    let response: Response;
    try {
      response = await fetch(`${this.aiServiceUrl}/health`, {
        signal: this.buildSignal(abortController, AI_HEALTH_TIMEOUT_MS),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === 'AbortError' &&
        this.isCancelled(jobId)
      ) {
        return;
      }
      throw new Error('AI service is unavailable. Please start the AI service and try again.');
    }

    if (!response.ok) {
      throw new Error(
        `AI service health check failed (${String(response.status)} ${response.statusText})`,
      );
    }

    const health = (await response.json()) as AIHealthResponse;
    if (health.model_loaded !== true) {
      throw new Error(
        'AI model is not loaded. Ensure the checkpoint is available and restart the AI service.',
      );
    }
  }

  private async tryAIProcessing(
    jobId: string,
    inputPath: string,
    outputPath: string,
    abortController: AbortController,
  ): Promise<void> {
    let response: Response;
    try {
      response = await fetch(`${this.aiServiceUrl}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Sequence length and degradation simulation are owned by the AI
        // engine's checkpoint configuration, so they are not sent here.
        body: JSON.stringify({
          jobId,
          inputPath,
          outputPath,
          scale: 4,
        }),
        signal: abortController.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError' && this.isCancelled(jobId)) {
        return;
      }
      throw new Error('Failed to connect to AI service during inference request.');
    }

    if (!response.ok) {
      throw new Error(
        `AI service returned ${String(response.status)}: ${response.statusText}`,
      );
    }

    if (!response.body) {
      throw new Error('AI service returned no response body');
    }

    // Read NDJSON stream line-by-line
    const reader = response.body.getReader() as ReadableStreamDefaultReader<
      Uint8Array<ArrayBuffer>
    >;
    const decoder = new TextDecoder();
    let buffer = '';

    const processUpdate = (update: AIProcessUpdate) => {
      if (update.status === 'failed') {
        throw new Error(update.error ?? 'AI processing failed');
      }

      if (update.status === 'cancelled') {
        this.uploadService.updateJob(
          jobId,
          'cancelled',
          update.progress ?? 0,
          update.error ?? 'Upscaling cancelled by user',
        );
        return 'cancelled' as const;
      }

      if (update.progress !== undefined) {
        if (this.isCancelled(jobId)) {
          return 'cancelled' as const;
        }
        this.uploadService.updateJob(
          jobId,
          'processing',
          update.progress,
        );
        this.logger.log(`Job ${jobId}: ${String(update.progress)}%`);
      }

      if (update.status === 'completed') {
        if (!fs.existsSync(outputPath)) {
          throw new Error('AI reported completion but no output file was produced.');
        }
        if (this.isCancelled(jobId)) {
          return 'cancelled' as const;
        }
        this.uploadService.setResultPath(jobId, outputPath);
        this.uploadService.updateJob(jobId, 'completed', 100);
        this.logger.log(`Job ${jobId}: completed (AI)`);
        return 'completed' as const;
      }

      return 'continue' as const;
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;

        let update: AIProcessUpdate;
        try {
          update = JSON.parse(line) as AIProcessUpdate;
        } catch {
          throw new Error('AI service returned malformed NDJSON progress payload.');
        }

        const result = processUpdate(update);
        if (result === 'completed' || result === 'cancelled') {
          return;
        }
      }
    }

    if (buffer.trim()) {
      let update: AIProcessUpdate;
      try {
        update = JSON.parse(buffer) as AIProcessUpdate;
      } catch {
        throw new Error('AI service returned malformed NDJSON progress payload.');
      }
      const result = processUpdate(update);
      if (result === 'completed' || result === 'cancelled') {
        return;
      }
    }

    // Every successful path returns from inside the loop (or the trailing
    // buffer handling above), so reaching this point means the stream ended
    // without a terminal event.
    throw new Error(
      'AI processing stream ended without a completion event. Inference did not finish.',
    );
  }

  private isCancelled(jobId: string): boolean {
    const state: JobState | undefined =
      this.uploadService.getJobRecord(jobId)?.state;
    return state === 'cancelled';
  }

  private buildSignal(
    abortController: AbortController,
    timeoutMs: number,
  ): AbortSignal {
    return AbortSignal.any([
      abortController.signal,
      AbortSignal.timeout(timeoutMs),
    ]);
  }
}
