import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '@/app/app.module';
import { configureApp } from '@/bootstrap';
import type { Env } from '@/utils/env.validation';

describe('Preview endpoints (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    app = moduleFixture.createNestApplication();
    const configService = app.get(ConfigService<Env, true>);
    configureApp(app, configService);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 404 ProblemDetails for an unknown job (latest)', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/upload/preview/no-such-job/latest'
    );
    expect(response.status).toBe(404);
    const body = response.body as Record<string, unknown>;
    expect((body['type'] as string).startsWith('/problems/')).toBe(true);
  });

  it('returns 404 for an unknown job (frame index)', () => {
    return request(app.getHttpServer())
      .get('/api/upload/preview/no-such-job/12')
      .expect(404);
  });

  it('returns 400 for a malformed frame index', () => {
    return request(app.getHttpServer())
      .get('/api/upload/preview/no-such-job/not-a-frame')
      .expect(400);
  });

  it('returns 400 for a traversal-looking job id', () => {
    return request(app.getHttpServer())
      .get('/api/upload/preview/a.b/latest')
      .expect(400);
  });
});
