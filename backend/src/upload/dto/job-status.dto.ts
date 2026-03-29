import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class JobStatusDto {
  @ApiProperty()
  jobId!: string;

  @ApiProperty({ enum: ['queued', 'processing', 'completed', 'failed'] })
  state!: 'queued' | 'processing' | 'completed' | 'failed';

  @ApiProperty({ description: 'Processing progress from 0 to 100' })
  progress!: number;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;

  @ApiPropertyOptional()
  error?: string;
}
