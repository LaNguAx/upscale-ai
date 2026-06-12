import { ApiProperty } from '@nestjs/swagger';

export class JobResultDto {
  @ApiProperty()
  jobId!: string;

  @ApiProperty({ description: 'URL to stream the processed video' })
  downloadUrl!: string;

  @ApiProperty()
  originalFilename!: string;

  @ApiProperty()
  outputFilename!: string;
}
