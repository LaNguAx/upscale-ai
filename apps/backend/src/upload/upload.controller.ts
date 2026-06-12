import {
  BadRequestException,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Req,
  Res,
  Sse,
  StreamableFile,
  UploadedFile,
  UseInterceptors
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiParam, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { JobStatus } from '@repo/schemas/jobs';
import type {
  CancelJobResponse,
  JobResult,
  UploadResponse
} from '@repo/schemas/upload';
import { UploadService } from '@/upload/upload.service';
import { ProcessingService } from '@/upload/processing.service';
import {
  CancelJobResponseDto,
  JobIdParamsDto,
  JobResultDto,
  JobStatusDto,
  UploadResponseDto
} from '@/upload/dto/upload.dto';

const MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.wmv': 'video/x-ms-wmv'
};

@ApiTags('upload')
@Controller('upload')
export class UploadController {
  private readonly logger = new Logger(UploadController.name);

  constructor(
    private readonly uploadService: UploadService,
    private readonly processingService: ProcessingService
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor('video'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        video: { type: 'string', format: 'binary' },
        product: { type: 'string' }
      },
      required: ['video']
    }
  })
  @ZodResponse({
    status: 201,
    description: 'Upload accepted, processing job created',
    type: UploadResponseDto
  })
  upload(
    @UploadedFile() file: Express.Multer.File | undefined
  ): UploadResponse {
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
  @ZodResponse({
    status: 200,
    description: 'Current job state and progress',
    type: JobStatusDto
  })
  getStatus(@Param() params: JobIdParamsDto): JobStatus {
    return this.uploadService.getJobStatus(params.jobId);
  }

  @Get('result/:jobId')
  @ZodResponse({
    status: 200,
    description: 'Download metadata for a completed job',
    type: JobResultDto
  })
  getResult(@Param() params: JobIdParamsDto): JobResult {
    return this.uploadService.getJobResult(params.jobId);
  }

  @Post('cancel/:jobId')
  @ZodResponse({
    status: 201,
    description: 'Cancel a queued or running job',
    type: CancelJobResponseDto
  })
  async cancel(@Param() params: JobIdParamsDto): Promise<CancelJobResponse> {
    await this.processingService.cancelJob(params.jobId);
    return { jobId: params.jobId };
  }

  @Sse('events/:jobId')
  @ApiParam({ name: 'jobId', description: 'Job identifier' })
  events(@Param() params: JobIdParamsDto): Observable<MessageEvent> {
    return this.uploadService.getJobUpdates$(params.jobId);
  }

  @Get('stream/:jobId')
  @ApiParam({ name: 'jobId', description: 'Job identifier' })
  stream(
    @Param() params: JobIdParamsDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): StreamableFile {
    const { filePath, filename } = this.uploadService.getStreamInfo(
      params.jobId
    );
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const ext = path.extname(filename).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';

    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0] ?? '0', 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const contentLength = end - start + 1;

      res.status(206);
      res.set({
        'Content-Range': `bytes ${String(start)}-${String(end)}/${String(fileSize)}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': contentLength.toString(),
        'Content-Type': contentType
      });

      return new StreamableFile(fs.createReadStream(filePath, { start, end }));
    }

    res.set({
      'Accept-Ranges': 'bytes',
      'Content-Length': fileSize.toString(),
      'Content-Type': contentType
    });

    return new StreamableFile(fs.createReadStream(filePath));
  }
}
