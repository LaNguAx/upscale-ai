import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('App (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health returns ok', () => {
    return request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect((res: request.Response) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(res.body.ok).toBe(true);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(res.body.service).toBe('backend');
      });
  });

  it('GET /api/jobs returns array', () => {
    return request(app.getHttpServer())
      .get('/api/jobs')
      .expect(200)
      .expect((res: request.Response) => {
        expect(Array.isArray(res.body)).toBe(true);
      });
  });

  it('GET /api/status/:id returns 404 for unknown job', () => {
    return request(app.getHttpServer())
      .get('/api/status/non-existent-id')
      .expect(404);
  });
});
