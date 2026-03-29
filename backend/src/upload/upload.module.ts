import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { diskStorage } from 'multer';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { ProcessingService } from './processing.service';

@Module({
  imports: [
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const uploadDir = path.resolve(
          process.cwd(),
          configService.get<string>('UPLOAD_DIR', '../storage/uploads'),
        );
        const maxSizeMb = configService.get<number>('MAX_FILE_SIZE_MB', 500);
        const allowedExtensions = configService
          .get<string>('ALLOWED_VIDEO_EXTENSIONS', '.mp4,.avi,.mkv,.mov,.wmv,.webm')
          .split(',')
          .map((ext) => ext.trim().toLowerCase());

        fs.mkdirSync(uploadDir, { recursive: true });

        return {
          storage: diskStorage({
            destination: uploadDir,
            filename: (_req, file, cb) => {
              const ext = path.extname(file.originalname).toLowerCase();
              cb(null, `${crypto.randomUUID()}${ext}`);
            },
          }),
          limits: {
            fileSize: maxSizeMb * 1024 * 1024,
          },
          fileFilter: (
            _req: Express.Request,
            file: Express.Multer.File,
            cb: (error: Error | null, acceptFile: boolean) => void,
          ) => {
            const ext = path.extname(file.originalname).toLowerCase();
            if (allowedExtensions.includes(ext)) {
              cb(null, true);
            } else {
              cb(new Error(`File type ${ext} is not allowed`), false);
            }
          },
        };
      },
    }),
  ],
  controllers: [UploadController],
  providers: [UploadService, ProcessingService],
})
export class UploadModule {}
