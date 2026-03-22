import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './health/health.module';

const nodeEnv = process.env.NODE_ENV ?? 'development';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`.env.${nodeEnv}.local`, `.env.${nodeEnv}`, '.env'],
      expandVariables: true,
    }),
    HealthModule,
  ],
})
export class AppModule {}
