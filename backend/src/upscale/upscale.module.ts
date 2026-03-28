import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

import { UpscaleController } from './upscale.controller';
import { UpscaleService } from './upscale.service';

@Module({
  imports: [
    HttpModule.registerAsync({
      useFactory: (configService: ConfigService) => ({
        baseURL: configService.get<string>(
          'AI_SERVICE_URL',
          'http://localhost:8000',
        ),
        timeout: 30000,
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [UpscaleController],
  providers: [UpscaleService],
})
export class UpscaleModule {}
