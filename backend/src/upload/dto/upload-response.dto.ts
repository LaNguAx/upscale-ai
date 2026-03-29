import { ApiProperty } from '@nestjs/swagger';

export class UploadResponseDto {
  @ApiProperty({ description: 'Unique identifier for the processing job' })
  jobId!: string;
}
