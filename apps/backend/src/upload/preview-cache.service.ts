import {
  BadRequestException,
  BadGatewayException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isTerminalJobState } from '@repo/schemas/jobs';
import {
  AiClientService,
  AiPreviewNotFoundError
} from '@/upload/ai-client.service';
import { UploadService } from '@/upload/upload.service';
import {
  LATEST_FRAME_KEY,
  resolvePreviewFilePath
} from '@/upload/preview-path.util';
import type { Env } from '@/utils/env.validation';

const PREVIEW_FETCH_TIMEOUT_MS = 10_000;

/**
 * Cache-through proxy for preview JPEGs: serves frames from `PREVIEW_DIR`
 * when cached, otherwise fetches the exact frame from the AI service (while
 * the job is still processing), persists it, and serves it. Delivery is
 * self-pacing — the client only requests frames it is about to play — which
 * replaces the old eager download-and-drop policy, in both transports.
 */
@Injectable()
export class PreviewCacheService {
  private readonly logger = new Logger(PreviewCacheService.name);
  private readonly previewEnabled: boolean;
  private readonly previewDir: string;
  /** Dedup of concurrent fetches, keyed `${jobId}/${frameKey}`. */
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly uploadService: UploadService,
    private readonly aiClient: AiClientService,
    private readonly configService: ConfigService<Env, true>
  ) {
    this.previewEnabled = this.configService.get('PREVIEW_ENABLED', {
      infer: true
    });
    this.previewDir = path.resolve(
      process.cwd(),
      this.configService.get('PREVIEW_DIR', { infer: true })
    );
  }

  /**
   * Cache-through lookup. Frame-indexed keys are immutable — a cache hit is
   * served without touching the AI. `latest` keys are refetched while the job
   * processes (falling back to a stale cached copy on fetch failure). Throws
   * 404 for unknown jobs (without contacting the AI), missing frames, and
   * anything requested after a terminal state; 502 on AI transport failures.
   */
  async getPreviewFile(jobId: string, frameKey: string): Promise<string> {
    const job = this.uploadService.getJobRecord(jobId);
    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    const filePath = resolvePreviewFilePath(this.previewDir, jobId, frameKey);
    if (!filePath) {
      // DTO grammar already rejects malformed public input — defense in depth.
      throw new BadRequestException('Invalid preview request');
    }

    const isLatest = frameKey.startsWith(LATEST_FRAME_KEY);
    const cached = fs.existsSync(filePath);
    const canFetch = this.previewEnabled && job.state === 'processing';

    if (cached && (!isLatest || !canFetch)) return filePath;
    if (!canFetch) {
      throw new NotFoundException('Preview not found');
    }

    try {
      await this.fetchThrough(jobId, frameKey, filePath);
    } catch (error) {
      // A stale `latest` beats an error while the AI is racing ahead.
      if (isLatest && cached) return filePath;
      throw error;
    }
    return filePath;
  }

  /** Removes a job's cached preview frames. Best-effort — never throws. */
  async deleteJobPreviews(jobId: string): Promise<void> {
    const anyFrame = resolvePreviewFilePath(
      this.previewDir,
      jobId,
      LATEST_FRAME_KEY
    );
    if (!anyFrame) return;
    try {
      await fs.promises.rm(path.dirname(anyFrame), {
        recursive: true,
        force: true
      });
    } catch (error) {
      this.logger.warn(
        `Job ${jobId}: preview cleanup failed — ${error instanceof Error ? error.message : 'unknown error'}`
      );
    }
  }

  private fetchThrough(
    jobId: string,
    frameKey: string,
    destPath: string
  ): Promise<void> {
    const key = `${jobId}/${frameKey}`;
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const task = this.downloadToCache(jobId, frameKey, destPath).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, task);
    return task;
  }

  private async downloadToCache(
    jobId: string,
    frameKey: string,
    destPath: string
  ): Promise<void> {
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    const tmpPath = `${destPath}.${crypto.randomUUID()}.tmp`;
    try {
      await this.aiClient.downloadPreview({
        // The path shape is validated again inside `downloadPreview` via
        // `resolveAiPreviewUrl` (same-origin `/preview/...` only).
        downloadPath: `/preview/${jobId}/${frameKey}`,
        destPath: tmpPath,
        signal: AbortSignal.timeout(PREVIEW_FETCH_TIMEOUT_MS)
      });
      // Re-check before publishing: never resurrect a preview directory the
      // terminal-state cleanup just removed.
      const job = this.uploadService.getJobRecord(jobId);
      if (!job || isTerminalJobState(job.state)) {
        throw new NotFoundException('Preview not found');
      }
      await fs.promises.rename(tmpPath, destPath);
    } catch (error) {
      await fs.promises.rm(tmpPath, { force: true });
      if (error instanceof AiPreviewNotFoundError) {
        throw new NotFoundException('Preview not found');
      }
      if (error instanceof HttpException) throw error;
      this.logger.warn(
        `Job ${jobId}: preview fetch for frame ${frameKey} failed — ${error instanceof Error ? error.message : 'unknown error'}`
      );
      throw new BadGatewayException('Preview fetch from AI service failed');
    }
  }
}
