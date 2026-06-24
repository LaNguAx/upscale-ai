import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { diskStorage } from 'multer';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { UploadController } from '@/upload/upload.controller';
import { UploadService } from '@/upload/upload.service';
import { ProcessingService } from '@/upload/processing.service';
import { AiClientService } from '@/upload/ai-client.service';
import type { Env } from '@/utils/env.validation';

@Module({
  imports: [
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService<Env, true>) => {
        const uploadDir = path.resolve(
          process.cwd(),
          configService.get('UPLOAD_DIR', { infer: true })
        );
        const maxSizeMb = configService.get('MAX_FILE_SIZE_MB', {
          infer: true
        });
        const allowedExtensions = configService
          .get('ALLOWED_VIDEO_EXTENSIONS', { infer: true })
          .split(',')
          .map((ext) => ext.trim().toLowerCase());

        fs.mkdirSync(uploadDir, { recursive: true });

        return {
          storage: diskStorage({
            destination: uploadDir,
            filename: (_req, file, cb) => {
              const ext = path.extname(file.originalname).toLowerCase();
              cb(null, `${crypto.randomUUID()}${ext}`);
            }
          }),
          limits: {
            fileSize: maxSizeMb * 1024 * 1024
          },
          fileFilter: (
            _req: Express.Request,
            file: Express.Multer.File,
            cb: (error: Error | null, acceptFile: boolean) => void
          ) => {
            const ext = path.extname(file.originalname).toLowerCase();
            if (allowedExtensions.includes(ext)) {
              cb(null, true);
            } else {
              cb(new Error(`File type ${ext} is not allowed`), false);
            }
          }
        };
      }
    })
  ],
  controllers: [UploadController],
  providers: [UploadService, ProcessingService, AiClientService]
})
export class UploadModule {}
