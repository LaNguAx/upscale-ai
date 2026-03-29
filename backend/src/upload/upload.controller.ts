import {
  Controller,
  Post,
  Get,
  Param,
  Req,
  Res,
  Sse,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  StreamableFile,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiConsumes, ApiBody, ApiParam } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { UploadService } from './upload.service';
import { ProcessingService } from './processing.service';
import type { UploadResponseDto } from './dto/upload-response.dto';
import type { JobStatusDto } from './dto/job-status.dto';
import type { JobResultDto } from './dto/job-result.dto';

const MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.wmv': 'video/x-ms-wmv',
};

@ApiTags('upload')
@Controller('upload')
export class UploadController {
  private readonly logger = new Logger(UploadController.name);

  constructor(
    private readonly uploadService: UploadService,
    private readonly processingService: ProcessingService,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor('video'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        video: { type: 'string', format: 'binary' },
        product: { type: 'string' },
      },
      required: ['video'],
    },
  })
  upload(@UploadedFile() file: Express.Multer.File): UploadResponseDto {
    if (!file) {
      throw new BadRequestException('No video file provided');
    }

    const result = this.uploadService.createJob(file);

    // Fire-and-forget: start processing asynchronously
    this.processingService.processJob(result.jobId).catch((err: unknown) => {
      this.logger.error(`Processing failed for job ${result.jobId}`, err);
    });

    return result;
  }

  @Get('status/:jobId')
  @ApiParam({ name: 'jobId', description: 'Job identifier' })
  getStatus(@Param('jobId') jobId: string): JobStatusDto {
    return this.uploadService.getJobStatus(jobId);
  }

  @Get('result/:jobId')
  @ApiParam({ name: 'jobId', description: 'Job identifier' })
  getResult(@Param('jobId') jobId: string): JobResultDto {
    return this.uploadService.getJobResult(jobId);
  }

  @Sse('events/:jobId')
  @ApiParam({ name: 'jobId', description: 'Job identifier' })
  events(@Param('jobId') jobId: string): Observable<MessageEvent> {
    return this.uploadService.getJobUpdates$(jobId);
  }

  @Get('stream/:jobId')
  @ApiParam({ name: 'jobId', description: 'Job identifier' })
  stream(
    @Param('jobId') jobId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): StreamableFile {
    const { filePath, filename } = this.uploadService.getStreamInfo(jobId);
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const ext = path.extname(filename).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';

    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0]!, 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const contentLength = end - start + 1;

      res.status(206);
      res.set({
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': contentLength.toString(),
        'Content-Type': contentType,
      });

      return new StreamableFile(fs.createReadStream(filePath, { start, end }));
    }

    res.set({
      'Accept-Ranges': 'bytes',
      'Content-Length': fileSize.toString(),
      'Content-Type': contentType,
    });

    return new StreamableFile(fs.createReadStream(filePath));
  }
}
