import { Injectable } from '@nestjs/common';

@Injectable()
export class HealthService {
  getHealth(): { ok: boolean; service: string; timestamp: string } {
    return {
      ok: true,
      service: 'backend',
      timestamp: new Date().toISOString(),
    };
  }
}
