import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthService } from 'src/health/health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Health check' })
  @ApiOkResponse({
    description: 'Backend service is healthy',
    schema: {
      example: {
        ok: true,
        service: 'backend',
        timestamp: '2026-03-22T21:30:00.000Z',
      },
    },
  })
  getHealth() {
    return this.healthService.getHealth();
  }
}
