import { createZodDto } from 'nestjs-zod';
import { jobIdParamsSchema, jobStatusSchema } from '@repo/schemas/jobs';
import {
  cancelJobResponseSchema,
  jobResultSchema,
  uploadResponseSchema
} from '@repo/schemas/upload';

export class UploadResponseDto extends createZodDto(uploadResponseSchema) {}

export class JobStatusDto extends createZodDto(jobStatusSchema) {}

export class JobResultDto extends createZodDto(jobResultSchema) {}

export class CancelJobResponseDto extends createZodDto(
  cancelJobResponseSchema
) {}

export class JobIdParamsDto extends createZodDto(jobIdParamsSchema) {}
