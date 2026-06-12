import { Injectable } from '@nestjs/common';
import type { HealthResponse } from '@repo/schemas/health';

@Injectable()
export class HealthService {
  getHealth(): HealthResponse {
    return {
      status: 'ok',
      service: 'backend',
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };
  }
}
