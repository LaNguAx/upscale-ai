import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import type { HealthResponse } from '@repo/schemas/health';
import { HealthResponseDto } from '@/health/health.dto';
import { HealthService } from '@/health/health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ZodResponse({
    status: 200,
    description: 'Service health status',
    type: HealthResponseDto
  })
  getHealth(): HealthResponse {
    return this.healthService.getHealth();
  }
}
