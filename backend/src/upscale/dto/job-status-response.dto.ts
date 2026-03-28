import { ApiProperty } from '@nestjs/swagger';
import { JobStatus } from '../enums/job-status.enum';

export class JobStatusResponseDto {
  @ApiProperty({ description: 'Unique job identifier' })
  id!: string;

  @ApiProperty({ enum: JobStatus, description: 'Current job status' })
  status!: JobStatus;

  @ApiProperty({
    description: 'Processing progress (0-100)',
    minimum: 0,
    maximum: 100,
  })
  progress!: number;

  @ApiProperty({ description: 'Original uploaded filename' })
  originalFilename!: string;

  @ApiProperty({ description: 'File size in bytes' })
  fileSize!: number;

  @ApiProperty({ description: 'Upscale factor used' })
  upscaleFactor!: number;

  @ApiProperty({ description: 'Error message if job failed', nullable: true })
  error!: string | null;

  @ApiProperty({ description: 'Job creation timestamp' })
  createdAt!: string;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt!: string;
}
