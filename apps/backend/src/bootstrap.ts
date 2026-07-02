import type { INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import type { Env } from '@/utils/env.validation';

export function configureApp(
  app: INestApplication,
  configService: ConfigService<Env, true>
): void {
  const isProduction =
    configService.get('NODE_ENV', { infer: true }) === 'production';

  // Default helmet includes a strict CSP. We can keep it on because Swagger UI
  // (which ships inline scripts/styles) is never mounted in production.
  // Cross-Origin-Resource-Policy must be relaxed from helmet's `same-origin`
  // default: the frontend may run on a different origin (e.g. Vite dev on
  // 5173, or a separate host configured via VITE_API_BASE_URL) and embeds the
  // preview JPEGs and video streams as <img>/<video> media — browsers block
  // those with ERR_BLOCKED_BY_RESPONSE.NotSameOrigin under `same-origin`.
  // Which sites may *fetch* the API is still governed by CORS below.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: resolveCorsOrigin(
      configService.get('CORS_ORIGIN', { infer: true })
    ),
    credentials: true
  });

  if (!isProduction) {
    mountSwagger(app);
  }
}

function mountSwagger(app: INestApplication): void {
  const swaggerConfig = new DocumentBuilder()
    .setTitle('UPscale API')
    .setDescription(
      'Backend API for the UPscale video super-resolution project'
    )
    .setVersion('1.0.0')
    .build();

  const openApiDoc = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, cleanupOpenApiDoc(openApiDoc));
}

function resolveCorsOrigin(raw: string): true | string[] {
  if (raw === '*') return true;
  const origins = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return origins.length > 0 ? origins : true;
}
