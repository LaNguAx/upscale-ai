import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createWriteStream } from 'node:fs';
import { openAsBlob } from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';
import type { Env } from '@/utils/env.validation';
import type {
  AIHealthResponse,
  AIProcessUpdate,
  AITransferMode
} from '@/upload/ai-protocol.types';
import { resolveAiPreviewUrl } from '@/upload/preview-url.util';

interface StreamProcessArgs {
  jobId: string;
  inputPath: string;
  outputPath: string;
  signal: AbortSignal;
}

interface DownloadResultArgs {
  downloadPath: string;
  destPath: string;
  signal: AbortSignal;
}

interface DownloadPreviewArgs {
  downloadPath: string;
  destPath: string;
  signal: AbortSignal;
}

const AI_HEALTH_TIMEOUT_MS = 5000;
const PROCESS_SCALE = 4;

/**
 * Thrown when the AI service has no such preview frame (404) — distinguishable
 * from transport failures so the preview proxy can map it to a public 404.
 */
export class AiPreviewNotFoundError extends Error {
  constructor() {
    super('AI service has no such preview frame.');
    this.name = 'AiPreviewNotFoundError';
  }
}

/**
 * Owns all HTTP communication with the Python AI service. Supports two
 * transports selected by `AI_TRANSFER_MODE`:
 * - `path`: `POST /process` with absolute filesystem paths (same machine).
 * - `remote`: `POST /process-upload` multipart upload + `GET /result/:jobId`
 *   download (two-server deployments with no shared storage).
 *
 * When `AI_INTERNAL_TOKEN` is set, mutating/result calls carry a bearer token.
 */
@Injectable()
export class AiClientService {
  private readonly logger = new Logger(AiClientService.name);
  private readonly aiServiceUrl: string;
  private readonly token: string;
  readonly transferMode: AITransferMode;

  constructor(private readonly configService: ConfigService<Env, true>) {
    this.aiServiceUrl = this.configService.get('AI_SERVICE_URL', {
      infer: true
    });
    this.transferMode = this.configService.get('AI_TRANSFER_MODE', {
      infer: true
    });
    this.token = this.configService.get('AI_INTERNAL_TOKEN', { infer: true });
  }

  async checkHealth(signal: AbortSignal): Promise<void> {
    let response: Response;
    try {
      response = await fetch(`${this.aiServiceUrl}/health`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(AI_HEALTH_TIMEOUT_MS)])
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new Error(
        'AI service is unavailable. Please start the AI service and try again.'
      );
    }

    if (!response.ok) {
      throw new Error(
        `AI service health check failed (${String(response.status)} ${response.statusText})`
      );
    }

    const health = (await response.json()) as AIHealthResponse;
    if (health.model_loaded !== true) {
      throw new Error(
        'AI model is not loaded. Ensure the checkpoint is available and restart the AI service.'
      );
    }
  }

  /**
   * Streams NDJSON progress updates from the AI service. Dispatches to the
   * path-based or multipart-upload endpoint based on `transferMode`.
   */
  streamProcess(args: StreamProcessArgs): AsyncGenerator<AIProcessUpdate> {
    return this.transferMode === 'remote'
      ? this.streamRemoteProcess(args)
      : this.streamPathProcess(args);
  }

  private async *streamPathProcess(
    args: StreamProcessArgs
  ): AsyncGenerator<AIProcessUpdate> {
    const response = await this.postProcess(`${this.aiServiceUrl}/process`, {
      headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
      // Sequence length and degradation simulation are owned by the AI engine's
      // checkpoint configuration, so they are not sent here.
      body: JSON.stringify({
        jobId: args.jobId,
        inputPath: args.inputPath,
        outputPath: args.outputPath,
        scale: PROCESS_SCALE
      }),
      signal: args.signal
    });
    yield* this.parseNdjson(response);
  }

  private async *streamRemoteProcess(
    args: StreamProcessArgs
  ): AsyncGenerator<AIProcessUpdate> {
    // Stream the uploaded file directly from disk via a file-backed Blob so the
    // whole video is never buffered in memory. `fetch` sets the multipart
    // boundary itself — do not set Content-Type manually.
    const fileBlob = await openAsBlob(args.inputPath);
    const form = new FormData();
    form.append('jobId', args.jobId);
    form.append('video', fileBlob, path.basename(args.inputPath));

    const response = await this.postProcess(
      `${this.aiServiceUrl}/process-upload`,
      {
        headers: this.authHeaders(),
        body: form,
        signal: args.signal
      }
    );
    yield* this.parseNdjson(response);
  }

  /** Downloads a completed result from the AI service and writes it to disk. */
  async downloadResult(args: DownloadResultArgs): Promise<void> {
    // `downloadPath` originates from the AI's NDJSON stream, so it is untrusted.
    // Resolve it against the configured base and require a same-origin
    // `/result/<jobId>` path to prevent URL-authority injection / SSRF.
    const target = this.resolveResultUrl(args.downloadPath);

    let response: Response;
    try {
      response = await fetch(target, {
        headers: this.authHeaders(),
        signal: args.signal
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new Error('Failed to download result from AI service.');
    }

    if (!response.ok) {
      throw new Error(
        `AI result download failed (${String(response.status)} ${response.statusText})`
      );
    }
    if (!response.body) {
      throw new Error('AI result download returned no response body.');
    }

    await pipeline(
      Readable.fromWeb(response.body as unknown as NodeWebReadableStream<Uint8Array>),
      createWriteStream(args.destPath)
    );
  }

  /** Downloads one preview JPEG from the AI service and writes it to disk. */
  async downloadPreview(args: DownloadPreviewArgs): Promise<void> {
    // Like result downloads, the path comes from the AI's NDJSON stream and
    // is untrusted — resolve and validate before fetching.
    const target = resolveAiPreviewUrl(this.aiServiceUrl, args.downloadPath);

    let response: Response;
    try {
      response = await fetch(target, {
        headers: this.authHeaders(),
        signal: args.signal
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new Error('Failed to download preview from AI service.');
    }

    if (response.status === 404) {
      throw new AiPreviewNotFoundError();
    }
    if (!response.ok) {
      throw new Error(
        `AI preview download failed (${String(response.status)} ${response.statusText})`
      );
    }
    if (!response.body) {
      throw new Error('AI preview download returned no response body.');
    }

    await pipeline(
      Readable.fromWeb(response.body as unknown as NodeWebReadableStream<Uint8Array>),
      createWriteStream(args.destPath)
    );
  }

  /** Best-effort cancellation bridge to the AI service. */
  async cancel(jobId: string): Promise<void> {
    try {
      const response = await fetch(`${this.aiServiceUrl}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
        body: JSON.stringify({ jobId })
      });
      if (!response.ok && response.status !== 404) {
        this.logger.warn(
          `Cancel bridge to AI returned ${String(response.status)} for job ${jobId}`
        );
      }
    } catch (error) {
      this.logger.warn(
        `Cancel bridge to AI failed for ${jobId}: ${error instanceof Error ? error.message : 'unknown error'}`
      );
    }
  }

  private resolveResultUrl(downloadPath: string): URL {
    const base = new URL(this.aiServiceUrl);
    let target: URL;
    try {
      target = new URL(downloadPath, base);
    } catch {
      throw new Error('AI returned an invalid result download URL.');
    }
    if (
      target.origin !== base.origin ||
      !/^\/result\/[A-Za-z0-9_-]{1,128}(\/original)?$/.test(target.pathname)
    ) {
      throw new Error('Refusing to download result from an unexpected URL.');
    }
    return target;
  }

  private async postProcess(
    url: string,
    init: RequestInit
  ): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(url, { method: 'POST', ...init });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new Error(
        'Failed to connect to AI service during inference request.'
      );
    }

    if (!response.ok) {
      throw new Error(
        `AI service returned ${String(response.status)}: ${response.statusText}`
      );
    }
    return response;
  }

  private async *parseNdjson(
    response: Response
  ): AsyncGenerator<AIProcessUpdate> {
    if (!response.body) {
      throw new Error('AI service returned no response body');
    }

    const reader = response.body.getReader() as ReadableStreamDefaultReader<
      Uint8Array<ArrayBuffer>
    >;
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.trim()) yield parseLine(line);
        }
      }

      if (buffer.trim()) yield parseLine(buffer);
    } finally {
      reader.releaseLock();
    }
  }

  private authHeaders(): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }
}

function parseLine(line: string): AIProcessUpdate {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error('AI service returned malformed NDJSON progress payload.');
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { status?: unknown }).status !== 'string'
  ) {
    throw new Error('AI service returned an NDJSON line without a status.');
  }

  return parsed as AIProcessUpdate;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
