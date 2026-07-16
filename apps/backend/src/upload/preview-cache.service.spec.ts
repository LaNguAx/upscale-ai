import {
  BadGatewayException,
  NotFoundException
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { JobState } from '@repo/schemas/jobs';
import {
  AiPreviewNotFoundError,
  type AiClientService
} from '@/upload/ai-client.service';
import { PreviewCacheService } from '@/upload/preview-cache.service';
import type { UploadService } from '@/upload/upload.service';
import type { Env } from '@/utils/env.validation';

describe('PreviewCacheService', () => {
  let tmpDir: string;
  let downloadPreview: jest.Mock;
  let jobState: JobState | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-cache-'));
    downloadPreview = jest.fn(
      async (args: { destPath: string }): Promise<void> => {
        await fs.promises.writeFile(args.destPath, 'fetched-jpeg-bytes');
      }
    );
    jobState = 'processing';
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeService(previewEnabled = true): PreviewCacheService {
    const values: Record<string, unknown> = {
      PREVIEW_ENABLED: previewEnabled,
      PREVIEW_DIR: tmpDir
    };
    const config = {
      get: (key: string) => values[key]
    } as unknown as ConfigService<Env, true>;
    const uploadService = {
      getJobRecord: (jobId: string) =>
        jobState === undefined ? undefined : { jobId, state: jobState }
    } as unknown as UploadService;
    const aiClient = { downloadPreview } as unknown as AiClientService;
    return new PreviewCacheService(uploadService, aiClient, config);
  }

  function cachePath(jobId: string, frameKey: string): string {
    return path.join(tmpDir, jobId, `${frameKey}.jpg`);
  }

  function preCache(jobId: string, frameKey: string, content: string): void {
    fs.mkdirSync(path.join(tmpDir, jobId), { recursive: true });
    fs.writeFileSync(cachePath(jobId, frameKey), content);
  }

  it('serves a cached frame without contacting the AI', async () => {
    preCache('job1', '42', 'cached-bytes');

    const filePath = await makeService().getPreviewFile('job1', '42');

    expect(fs.readFileSync(filePath, 'utf8')).toBe('cached-bytes');
    expect(downloadPreview).not.toHaveBeenCalled();
  });

  it('fetches an uncached frame from the AI, persists, and serves it', async () => {
    const filePath = await makeService().getPreviewFile('job1', '42');

    expect(downloadPreview).toHaveBeenCalledTimes(1);
    expect(downloadPreview).toHaveBeenCalledWith(
      expect.objectContaining({ downloadPath: '/preview/job1/42' })
    );
    expect(filePath).toBe(cachePath('job1', '42'));
    expect(fs.readFileSync(filePath, 'utf8')).toBe('fetched-jpeg-bytes');
  });

  it('dedupes concurrent requests for the same uncached frame', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    downloadPreview.mockImplementation(
      async (args: { destPath: string }): Promise<void> => {
        await gate;
        await fs.promises.writeFile(args.destPath, 'fetched-jpeg-bytes');
      }
    );

    const service = makeService();
    const first = service.getPreviewFile('job1', '42');
    const second = service.getPreviewFile('job1', '42');
    release();

    await expect(first).resolves.toBe(cachePath('job1', '42'));
    await expect(second).resolves.toBe(cachePath('job1', '42'));
    expect(downloadPreview).toHaveBeenCalledTimes(1);
  });

  it('maps an AI 404 to a public NotFoundException', async () => {
    downloadPreview.mockRejectedValue(new AiPreviewNotFoundError());

    await expect(makeService().getPreviewFile('job1', '42')).rejects.toThrow(
      NotFoundException
    );
  });

  it('maps AI transport failures to BadGatewayException', async () => {
    downloadPreview.mockRejectedValue(new Error('connection refused'));

    await expect(makeService().getPreviewFile('job1', '42')).rejects.toThrow(
      BadGatewayException
    );
  });

  it('returns 404 for an unknown job without contacting the AI', async () => {
    jobState = undefined;

    await expect(makeService().getPreviewFile('nope', '42')).rejects.toThrow(
      NotFoundException
    );
    expect(downloadPreview).not.toHaveBeenCalled();
  });

  it('refuses fetch-through once the job is terminal', async () => {
    jobState = 'completed';

    await expect(makeService().getPreviewFile('job1', '42')).rejects.toThrow(
      NotFoundException
    );
    expect(downloadPreview).not.toHaveBeenCalled();
  });

  it('still serves an already-cached frame after the job is terminal', async () => {
    preCache('job1', '42', 'cached-bytes');
    jobState = 'completed';

    await expect(makeService().getPreviewFile('job1', '42')).resolves.toBe(
      cachePath('job1', '42')
    );
    expect(downloadPreview).not.toHaveBeenCalled();
  });

  it('refuses fetch-through when previews are disabled', async () => {
    await expect(
      makeService(false).getPreviewFile('job1', '42')
    ).rejects.toThrow(NotFoundException);
    expect(downloadPreview).not.toHaveBeenCalled();
  });

  it('refetches latest even when a cached copy exists', async () => {
    preCache('job1', 'latest', 'stale-bytes');

    const filePath = await makeService().getPreviewFile('job1', 'latest');

    expect(downloadPreview).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('fetched-jpeg-bytes');
  });

  it('falls back to the stale cached latest when the refetch fails', async () => {
    preCache('job1', 'latest', 'stale-bytes');
    downloadPreview.mockRejectedValue(new Error('connection refused'));

    const filePath = await makeService().getPreviewFile('job1', 'latest');

    expect(fs.readFileSync(filePath, 'utf8')).toBe('stale-bytes');
  });

  it('deleteJobPreviews removes the job directory and never throws', async () => {
    preCache('job1', '42', 'cached-bytes');
    const service = makeService();

    await service.deleteJobPreviews('job1');
    expect(fs.existsSync(path.join(tmpDir, 'job1'))).toBe(false);

    // Missing directory and unsafe ids are silently ignored.
    await expect(service.deleteJobPreviews('job1')).resolves.toBeUndefined();
    await expect(service.deleteJobPreviews('../evil')).resolves.toBeUndefined();
  });
});
