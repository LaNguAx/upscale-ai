import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { jobUpdateSchema } from '@repo/schemas/jobs';
import type { JobUpdate } from '@repo/schemas/jobs';
import { UploadService } from '@/upload/upload.service';
import type { Env } from '@/utils/env.validation';

describe('UploadService preview propagation', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-service-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeService(): UploadService {
    const values: Partial<Env> = {
      UPLOAD_DIR: path.join(tmpDir, 'uploads'),
      RESULT_DIR: path.join(tmpDir, 'results'),
      PREVIEW_DIR: path.join(tmpDir, 'previews')
    };
    const config = {
      get: (key: keyof Env) => values[key]
    } as unknown as ConfigService<Env, true>;
    return new UploadService(config);
  }

  function createJob(service: UploadService): string {
    const file = {
      originalname: 'clip.mp4',
      filename: 'stored.mp4',
      path: path.join(tmpDir, 'uploads', 'stored.mp4')
    } as Express.Multer.File;
    return service.createJob(file).jobId;
  }

  it('exposes the preview with a public imageUrl in job status', () => {
    const service = makeService();
    const jobId = createJob(service);
    service.updateJob(jobId, 'processing', 10);

    service.setJobPreview(jobId, { frameIndex: 42, width: 640, height: 360 });

    expect(service.getJobStatus(jobId).preview).toEqual({
      frameIndex: 42,
      imageUrl: `/api/upload/preview/${jobId}/42`,
      width: 640,
      height: 360
    });
  });

  it('passes fps and stride through to the public preview', () => {
    const service = makeService();
    const jobId = createJob(service);
    service.updateJob(jobId, 'processing', 10);

    service.setJobPreview(jobId, { frameIndex: 42, fps: 29.97, stride: 2 });

    const preview = service.getJobStatus(jobId).preview;
    expect(preview?.fps).toBe(29.97);
    expect(preview?.stride).toBe(2);
  });

  it('exposes the original frame URL only when the pair was cached', () => {
    const service = makeService();
    const jobId = createJob(service);
    service.updateJob(jobId, 'processing', 10);

    service.setJobPreview(jobId, { frameIndex: 15, hasOriginal: true });
    expect(service.getJobStatus(jobId).preview?.originalImageUrl).toBe(
      `/api/upload/preview/${jobId}/15/original`
    );

    service.setJobPreview(jobId, { frameIndex: 30 });
    expect(service.getJobStatus(jobId).preview?.originalImageUrl).toBeUndefined();
  });

  it('emits schema-valid JobUpdates carrying the preview and ignores previews after terminal', () => {
    const service = makeService();
    const jobId = createJob(service);
    service.updateJob(jobId, 'processing', 10);

    const updates: JobUpdate[] = [];
    const sub = service.getJobUpdates$(jobId).subscribe((event) => {
      const raw = (event as unknown as { data: string }).data;
      updates.push(jobUpdateSchema.parse(JSON.parse(raw)));
    });

    service.setJobPreview(jobId, { frameIndex: 15 });
    service.updateJob(jobId, 'completed', 100);
    service.setJobPreview(jobId, { frameIndex: 30 });
    sub.unsubscribe();

    // The sticky-terminal guard must leave the record untouched, not just
    // unemitted (takeWhile completed the stream at the terminal update, so
    // the emission count alone cannot detect a broken guard).
    expect(service.getJobStatus(jobId).preview?.frameIndex).toBe(15);

    // startWith (no preview) → preview(15) → completed (still preview 15).
    expect(updates).toHaveLength(3);
    expect(updates[0]?.preview).toBeUndefined();
    expect(updates[1]?.preview?.frameIndex).toBe(15);
    expect(updates[1]?.preview?.imageUrl).toBe(`/api/upload/preview/${jobId}/15`);
    expect(updates[2]?.state).toBe('completed');
    expect(updates[2]?.preview?.frameIndex).toBe(15);
  });
});
