import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { NotFoundException, BadRequestException } from '@nestjs/common';

import { UpscaleService } from './upscale.service';

describe('UpscaleService', () => {
  let service: UpscaleService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UpscaleService,
        {
          provide: HttpService,
          useValue: {
            post: jest.fn(),
            get: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue: unknown) => {
              const config: Record<string, unknown> = {
                UPLOAD_DIR: './test-uploads',
                RESULT_DIR: './test-results',
                MAX_FILE_SIZE_MB: 500,
                ALLOWED_VIDEO_EXTENSIONS: '.mp4,.avi,.mkv',
              };
              return config[key] ?? defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<UpscaleService>(UpscaleService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createJob', () => {
    it('should reject files with invalid extensions', async () => {
      const mockFile = {
        originalname: 'test.txt',
        size: 1024,
        mimetype: 'text/plain',
        path: '',
      } as Express.Multer.File;

      await expect(service.createJob(mockFile, 2)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getJobStatus', () => {
    it('should throw NotFoundException for unknown job ID', async () => {
      await expect(service.getJobStatus('non-existent-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getJobResultPath', () => {
    it('should throw NotFoundException for unknown job ID', () => {
      expect(() => service.getJobResultPath('non-existent-id')).toThrow(
        NotFoundException,
      );
    });
  });

  describe('getAllJobs', () => {
    it('should return empty array when no jobs exist', async () => {
      const jobs = await service.getAllJobs();
      expect(jobs).toEqual([]);
    });
  });
});
