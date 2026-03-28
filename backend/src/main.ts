import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix('api');

  app.enableCors({
    origin: true,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('UPscale Backend API')
    .setDescription('Backend API for the UPscale project')
    .setVersion('1.0.0')
    .addTag('health')
    .addTag('upscale', 'Video upload and processing')
    .build();

  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument);

  const port = configService.get<number>('PORT', 3000);

  await app.listen(port);

  logger.log(`Backend running on http://localhost:${port}/api`);
  logger.log(`Swagger docs available at http://localhost:${port}/docs`);

  logger.log(
    `Environment: ${configService.get<string>('NODE_ENV', 'development')}`,
  );
}

void bootstrap();
