import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@/app/app.module';
import { configureApp } from '@/bootstrap';
import type { Env } from '@/utils/env.validation';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService<Env, true>);

  configureApp(app, configService);

  const port = configService.get('PORT', { infer: true });
  const nodeEnv = configService.get('NODE_ENV', { infer: true });
  await app.listen(port);

  const baseUrl = `http://localhost:${String(port)}`;
  const logger = new Logger('Bootstrap');
  logger.log('UPscale backend is up');
  logger.log(`   env       ${nodeEnv}`);
  logger.log(`   api       ${baseUrl}/api`);
  if (nodeEnv !== 'production') {
    logger.log(`   swagger   ${baseUrl}/docs`);
  }
}

void bootstrap();
