import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { UploadService } from './upload.service';

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
    const existingJob = this.uploadService.getJobRecord(jobId);
    if (!existingJob) {
      this.logger.warn(`Job ${jobId}: record missing before processing start`);
      return;
    }
    if (this.isTerminalState(existingJob.state)) {
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
        this.logger.warn(`Cancel bridge to AI returned ${response.status} for job ${jobId}`);
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
        `AI service health check failed (${response.status} ${response.statusText})`,
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
        body: JSON.stringify({
          jobId,
          inputPath,
          outputPath,
          scale: 4,
          seqLen: 5,
          simulateLq: true,
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
      throw new Error(`AI service returned ${response.status}: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('AI service returned no response body');
    }

    // Read NDJSON stream line-by-line
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let completed = false;

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
        this.logger.log(`Job ${jobId}: ${update.progress}%`);
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
        completed = true;
        return 'completed' as const;
      }

      if (update.status !== 'processing') {
        throw new Error(`AI service returned unknown status "${update.status}".`);
      }

      return 'continue' as const;
    };

    while (true) {
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

    if (!completed) {
      throw new Error(
        'AI processing stream ended without a completion event. Inference did not finish.',
      );
    }
  }

  private isCancelled(jobId: string): boolean {
    return this.uploadService.getJobRecord(jobId)?.state === 'cancelled';
  }

  private isTerminalState(state: string): boolean {
    return state === 'completed' || state === 'failed' || state === 'cancelled';
  }

  private buildSignal(
    abortController: AbortController,
    timeoutMs: number,
  ): AbortSignal {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const anySignal = (
      AbortSignal as typeof AbortSignal & {
        any?: (signals: AbortSignal[]) => AbortSignal;
      }
    ).any;
    return anySignal
      ? anySignal([abortController.signal, timeoutSignal])
      : abortController.signal;
  }
}
