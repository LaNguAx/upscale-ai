import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '@/app/app.module';
import { configureApp } from '@/bootstrap';
import type { Env } from '@/utils/env.validation';

describe('Backend bootstrap (e2e)', () => {
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

  it('serves the health endpoint under the /api prefix', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);

    const body = response.body as Record<string, unknown>;
    expect(body['status']).toBe('ok');
    expect(body['service']).toBe('backend');
    expect(typeof body['uptime']).toBe('number');
    expect(typeof body['timestamp']).toBe('string');
  });

  it('does not serve anything at / (global /api prefix in effect)', () => {
    return request(app.getHttpServer()).get('/').expect(404);
  });

  it('echoes x-request-id from the RequestIdMiddleware', async () => {
    const incoming = 'trace-abc-123';
    const response = await request(app.getHttpServer())
      .get('/api/health')
      .set('x-request-id', incoming);

    expect(response.headers['x-request-id']).toBe(incoming);
  });

  it('generates a UUID when x-request-id is missing', async () => {
    const response = await request(app.getHttpServer()).get('/api/health');
    expect(typeof response.headers['x-request-id']).toBe('string');
    expect(response.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('returns a ProblemDetails payload with traceId for an unknown job', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/upload/status/no-such-job')
      .set('x-request-id', 'trace-xyz');

    expect(response.status).toBe(404);
    const body = response.body as Record<string, unknown>;
    expect(typeof body['type']).toBe('string');
    expect((body['type'] as string).startsWith('/problems/')).toBe(true);
    expect(typeof body['title']).toBe('string');
    expect(body['status']).toBe(404);
    expect(body['instance']).toBe('/api/upload/status/no-such-job');
    expect(body['traceId']).toBe('trace-xyz');
  });

  it('serves Swagger UI at /docs in non-production mode', async () => {
    const response = await request(app.getHttpServer()).get('/docs');
    expect([200, 301]).toContain(response.status);
  });

  it('sets a strict Content-Security-Policy header (helmet default CSP)', async () => {
    const response = await request(app.getHttpServer()).get('/api/health');
    expect(response.headers['content-security-policy']).toBeDefined();
    expect(response.headers['content-security-policy']).toContain(
      "default-src 'self'"
    );
  });
});

describe('Backend bootstrap (e2e, production mode)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    app = moduleFixture.createNestApplication();
    const realConfig = app.get(ConfigService<Env, true>);
    const prodConfig = {
      get: (key: keyof Env) =>
        key === 'NODE_ENV' ? 'production' : realConfig.get(key, { infer: true })
    } as unknown as ConfigService<Env, true>;
    configureApp(app, prodConfig);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('does NOT serve Swagger UI in production', async () => {
    const response = await request(app.getHttpServer()).get('/docs');
    expect(response.status).toBe(404);
  });

  it('still serves the API under /api in production', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);
    const body = response.body as Record<string, unknown>;
    expect(body['status']).toBe('ok');
  });
});
