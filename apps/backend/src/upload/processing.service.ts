import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isTerminalJobState, type JobState } from '@repo/schemas/jobs';
import { AiClientService } from '@/upload/ai-client.service';
import { UploadService } from '@/upload/upload.service';
import {
  LATEST_FRAME_KEY,
  ORIGINAL_KEY_SUFFIX,
  resolvePreviewFilePath
} from '@/upload/preview-path.util';
import type {
  AIPreviewUpdate,
  AIProcessUpdate
} from '@/upload/ai-protocol.types';
import type { Env } from '@/utils/env.validation';

interface ActiveJob {
  abortController: AbortController;
  outputPath: string;
  previewDownloadInFlight: boolean;
}

type UpdateOutcome = 'continue' | 'done';

@Injectable()
export class ProcessingService {
  private readonly logger = new Logger(ProcessingService.name);
  private readonly resultDir: string;
  private readonly previewEnabled: boolean;
  private readonly previewDir: string;
  private readonly activeJobs = new Map<string, ActiveJob>();

  constructor(
    private readonly uploadService: UploadService,
    private readonly aiClient: AiClientService,
    private readonly configService: ConfigService<Env, true>
  ) {
    this.resultDir = path.resolve(
      process.cwd(),
      this.configService.get('RESULT_DIR', { infer: true })
    );
    this.previewEnabled = this.configService.get('PREVIEW_ENABLED', {
      infer: true
    });
    this.previewDir = path.resolve(
      process.cwd(),
      this.configService.get('PREVIEW_DIR', { infer: true })
    );
  }

  async processJob(jobId: string): Promise<void> {
    const existingJob = this.uploadService.getJobRecord(jobId);
    if (!existingJob) {
      this.logger.warn(`Job ${jobId}: record missing before processing start`);
      return;
    }
    if (isTerminalJobState(existingJob.state)) {
      this.logger.log(
        `Job ${jobId}: already terminal (${existingJob.state}), skipping`
      );
      return;
    }

    try {
      this.uploadService.updateJob(jobId, 'processing', 0);

      const job = this.uploadService.getJobRecord(jobId);
      if (!job) {
        this.uploadService.updateJob(
          jobId,
          'failed',
          0,
          'Job record not found'
        );
        return;
      }

      // Always .mp4: the AI re-encodes its output to browser-safe H.264.
      const outputPath = path.resolve(this.resultDir, `${jobId}_enhanced.mp4`);
      const abortController = new AbortController();
      this.activeJobs.set(jobId, {
        abortController,
        outputPath,
        previewDownloadInFlight: false
      });

      await this.aiClient.checkHealth(abortController.signal);
      if (this.isCancelled(jobId)) return;

      await this.runInference(
        jobId,
        job.uploadPath,
        outputPath,
        abortController
      );
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

    await this.aiClient.cancel(jobId);
  }

  private async runInference(
    jobId: string,
    inputPath: string,
    outputPath: string,
    abortController: AbortController
  ): Promise<void> {
    try {
      for await (const update of this.aiClient.streamProcess({
        jobId,
        inputPath,
        outputPath,
        signal: abortController.signal
      })) {
        const outcome = await this.handleUpdate(jobId, update, outputPath);
        if (outcome === 'done') return;
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === 'AbortError' &&
        this.isCancelled(jobId)
      ) {
        return;
      }
      throw error;
    }

    // The generator only completes after a terminal line returns 'done', so
    // reaching here means the stream ended without a completion event.
    throw new Error(
      'AI processing stream ended without a completion event. Inference did not finish.'
    );
  }

  private async handleUpdate(
    jobId: string,
    update: AIProcessUpdate,
    outputPath: string
  ): Promise<UpdateOutcome> {
    switch (update.status) {
      case 'processing': {
        if (this.isCancelled(jobId)) return 'done';
        this.uploadService.updateJob(jobId, 'processing', update.progress);
        this.logger.log(`Job ${jobId}: ${String(update.progress)}%`);
        if (update.preview) {
          this.capturePreview(jobId, update.preview);
        }
        return 'continue';
      }
      case 'cancelled': {
        this.uploadService.updateJob(
          jobId,
          'cancelled',
          update.progress ?? 0,
          update.error ?? 'Upscaling cancelled by user'
        );
        return 'done';
      }
      case 'failed': {
        throw new Error(update.error || 'AI processing failed');
      }
      case 'completed': {
        if (this.isCancelled(jobId)) return 'done';

        const signal =
          this.activeJobs.get(jobId)?.abortController.signal ??
          new AbortController().signal;

        if (this.aiClient.transferMode === 'remote') {
          const downloadPath = update.resultDownloadUrl ?? `/result/${jobId}`;
          await this.aiClient.downloadResult({
            downloadPath,
            destPath: outputPath,
            signal
          });
        }

        if (!fs.existsSync(outputPath)) {
          throw new Error(
            'AI reported completion but no output file was produced.'
          );
        }
        if (this.isCancelled(jobId)) return 'done';

        await this.acquireOriginalComparison(jobId, {
          originalDownloadUrl: update.originalDownloadUrl,
          outputPath,
          signal
        });

        this.uploadService.setResultPath(jobId, outputPath);
        this.uploadService.updateJob(jobId, 'completed', 100);
        this.logger.log(`Job ${jobId}: completed (AI)`);
        return 'done';
      }
      default: {
        const exhaustiveCheck: never = update;
        return exhaustiveCheck;
      }
    }
  }

  /**
   * Best-effort acquisition of the browser-safe original comparison video —
   * the job completes without it (the player degrades to enhanced-only).
   */
  private async acquireOriginalComparison(
    jobId: string,
    args: {
      originalDownloadUrl: string | undefined;
      outputPath: string;
      signal: AbortSignal;
    }
  ): Promise<void> {
    const originalPath = path.join(
      path.dirname(args.outputPath),
      `${jobId}_original.mp4`
    );
    try {
      if (this.aiClient.transferMode === 'remote') {
        if (!args.originalDownloadUrl) return;
        await this.aiClient.downloadResult({
          downloadPath: args.originalDownloadUrl,
          destPath: originalPath,
          signal: args.signal
        });
      }
      // Path mode: the AI wrote it next to the enhanced output on shared disk.
      if (fs.existsSync(originalPath)) {
        this.uploadService.setOriginalComparisonPath(jobId, originalPath);
      }
    } catch (error) {
      this.logger.warn(
        `Job ${jobId}: original comparison download failed — ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Fire-and-forget preview capture: never awaited by the NDJSON loop, never
   * fails the job. If a download is already in flight for this job, the new
   * preview is skipped (latest-wins; no backlog).
   */
  private capturePreview(jobId: string, preview: AIPreviewUpdate): void {
    if (!this.previewEnabled) return;
    const activeJob = this.activeJobs.get(jobId);
    if (!activeJob || activeJob.previewDownloadInFlight) return;

    const destPath = resolvePreviewFilePath(
      this.previewDir,
      jobId,
      String(preview.frameIndex)
    );
    const latestPath = resolvePreviewFilePath(
      this.previewDir,
      jobId,
      LATEST_FRAME_KEY
    );
    if (!destPath || !latestPath) {
      this.logger.warn(
        `Job ${jobId}: ignoring preview with unsafe frame index`
      );
      return;
    }

    activeJob.previewDownloadInFlight = true;
    this.downloadAndPublishPreview(jobId, preview, { destPath, latestPath })
      .catch((error: unknown) => {
        this.logger.warn(
          `Job ${jobId}: preview download failed — ${error instanceof Error ? error.message : 'unknown error'}`
        );
      })
      .finally(() => {
        const job = this.activeJobs.get(jobId);
        if (job) job.previewDownloadInFlight = false;
      });
  }

  private async downloadAndPublishPreview(
    jobId: string,
    preview: AIPreviewUpdate,
    paths: { destPath: string; latestPath: string }
  ): Promise<void> {
    const activeJob = this.activeJobs.get(jobId);
    if (!activeJob || this.isCancelled(jobId)) return;
    const signal = activeJob.abortController.signal;

    await fs.promises.mkdir(path.dirname(paths.destPath), { recursive: true });
    await this.aiClient.downloadPreview({
      downloadPath: preview.downloadUrl,
      destPath: paths.destPath,
      signal
    });
    await this.publishLatest(paths.destPath, paths.latestPath);

    // Matching original (input) frame — best-effort; the enhanced preview
    // still ships without it.
    let hasOriginal = false;
    const originalDest = resolvePreviewFilePath(
      this.previewDir,
      jobId,
      `${String(preview.frameIndex)}${ORIGINAL_KEY_SUFFIX}`
    );
    const originalLatest = resolvePreviewFilePath(
      this.previewDir,
      jobId,
      `${LATEST_FRAME_KEY}${ORIGINAL_KEY_SUFFIX}`
    );
    if (preview.originalDownloadUrl && originalDest && originalLatest) {
      try {
        await this.aiClient.downloadPreview({
          downloadPath: preview.originalDownloadUrl,
          destPath: originalDest,
          signal
        });
        await this.publishLatest(originalDest, originalLatest);
        hasOriginal = true;
      } catch (error) {
        this.logger.warn(
          `Job ${jobId}: original preview frame download failed — ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    this.uploadService.setJobPreview(jobId, {
      frameIndex: preview.frameIndex,
      hasOriginal,
      ...(preview.width !== undefined ? { width: preview.width } : {}),
      ...(preview.height !== undefined ? { height: preview.height } : {})
    });
  }

  /** Atomic latest.jpg publish: copy to a temp name, then rename over it. */
  private async publishLatest(srcPath: string, latestPath: string): Promise<void> {
    const tmpLatest = `${latestPath}.tmp`;
    await fs.promises.copyFile(srcPath, tmpLatest);
    await fs.promises.rename(tmpLatest, latestPath);
  }

  private isCancelled(jobId: string): boolean {
    const state: JobState | undefined =
      this.uploadService.getJobRecord(jobId)?.state;
    return state === 'cancelled';
  }
}
