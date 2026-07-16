import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '@/app/app.module';
import { configureApp } from '@/bootstrap';
import { validateEnv } from '@/utils/env.validation';
import type { Env } from '@/utils/env.validation';

/**
 * Upload rejection paths. Both rejections happen inside Multer, before the
 * controller runs — no job is created and the (unmocked) AI service is never
 * contacted. The 1 MB cap is injected by overriding ConfigService (Multer's
 * `limits.fileSize` and the filter's 413 detail both read it via DI).
 */
describe('Upload limit and rejection paths (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const env = validateEnv({ ...process.env, MAX_FILE_SIZE_MB: '1' });
    const configStub = {
      get: (key: keyof Env) => env[key]
    } as unknown as ConfigService<Env, true>;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule]
    })
      .overrideProvider(ConfigService)
      .useValue(configStub)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app, configStub);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects an oversized upload with a friendly 413 ProblemDetails', async () => {
    const twoMegabytes = Buffer.alloc(2 * 1024 * 1024, 1);
    const response = await request(app.getHttpServer())
      .post('/api/upload')
      .attach('video', twoMegabytes, 'clip.mp4');

    expect(response.status).toBe(413);
    const body = response.body as Record<string, unknown>;
    expect((body['type'] as string).startsWith('/problems/')).toBe(true);
    expect(body['detail']).toContain('1 MB');
  });

  it('rejects a disallowed extension with a 415 ProblemDetails (not a 500)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/upload')
      .attach('video', Buffer.from('not a video'), 'notes.txt');

    expect(response.status).toBe(415);
    const body = response.body as Record<string, unknown>;
    expect((body['type'] as string).startsWith('/problems/')).toBe(true);
    expect(body['detail']).toContain('.txt');
  });

  it('keeps rejecting uploads without a file as 400', () => {
    return request(app.getHttpServer()).post('/api/upload').expect(400);
  });
});
