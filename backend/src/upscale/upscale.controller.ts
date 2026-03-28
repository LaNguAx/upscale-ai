import {
  Controller,
  Get,
  Param,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import type { Response } from 'express';

import { UpscaleService } from './upscale.service';
import { CreateJobDto } from './dto/create-job.dto';
import type { JobStatusResponseDto } from './dto/job-status-response.dto';

@ApiTags('upscale')
@Controller()
export class UpscaleController {
  constructor(private readonly upscaleService: UpscaleService) {}

  @Post('upload')
  @ApiOperation({ summary: 'Upload a video for AI-powered upscaling' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Video file to upscale',
    schema: {
      type: 'object',
      properties: {
        video: {
          type: 'string',
          format: 'binary',
          description: 'Video file (mp4, avi, mkv, mov, wmv, webm)',
        },
        upscaleFactor: {
          type: 'integer',
          minimum: 1,
          maximum: 4,
          default: 2,
          description: 'Upscale factor',
        },
      },
      required: ['video'],
    },
  })
  @ApiResponse({ status: 201, description: 'Job created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid file type or size' })
  @ApiResponse({ status: 503, description: 'AI service unavailable' })
  @UseInterceptors(
    FileInterceptor('video', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const uploadDir = path.resolve('../storage/uploads');
          fs.mkdirSync(uploadDir, { recursive: true });
          cb(null, uploadDir);
        },
        filename: (_req, file, cb) => {
          const ext = path.extname(file.originalname).toLowerCase();
          cb(null, `temp-${randomUUID()}${ext}`);
        },
      }),
      limits: {
        fileSize: 500 * 1024 * 1024, // 500MB
      },
    }),
  )
  async uploadVideo(
    @UploadedFile() file: Express.Multer.File,
    @Body() createJobDto: CreateJobDto,
  ): Promise<{ jobId: string }> {
    const upscaleFactor = createJobDto.upscaleFactor ?? 2;
    const jobId = await this.upscaleService.createJob(file, upscaleFactor);
    return { jobId };
  }

  @Get('status/:jobId')
  @ApiOperation({ summary: 'Get the status and progress of a processing job' })
  @ApiParam({ name: 'jobId', description: 'Unique job identifier' })
  @ApiOkResponse({ description: 'Job status retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async getJobStatus(
    @Param('jobId') jobId: string,
  ): Promise<JobStatusResponseDto> {
    return this.upscaleService.getJobStatus(jobId);
  }

  @Get('jobs')
  @ApiOperation({ summary: 'List all processing jobs' })
  @ApiOkResponse({ description: 'All jobs retrieved successfully' })
  async getAllJobs(): Promise<JobStatusResponseDto[]> {
    return this.upscaleService.getAllJobs();
  }

  @Get('result/:jobId')
  @ApiOperation({ summary: 'Download the enhanced video result' })
  @ApiParam({ name: 'jobId', description: 'Unique job identifier' })
  @ApiOkResponse({ description: 'Enhanced video file' })
  @ApiResponse({ status: 400, description: 'Job not completed yet' })
  @ApiResponse({ status: 404, description: 'Job or result not found' })
  getResult(
    @Param('jobId') jobId: string,
    @Res({ passthrough: true }) res: Response,
  ): StreamableFile {
    const { filePath, filename } = this.upscaleService.getJobResultPath(jobId);

    res.set({
      'Content-Type': 'video/mp4',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });

    const fileStream = fs.createReadStream(filePath);
    return new StreamableFile(fileStream);
  }
}
