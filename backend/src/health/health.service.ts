import { BadRequestException, Injectable } from '@nestjs/common';

@Injectable()
export class HealthService {
  getHealth() {
    const health = Math.random() > 0.5;

    if (!health) {
      throw new BadRequestException('Service is not healthy');
    }

    return {
      ok: health,
      service: 'backend',
      timestamp: new Date().toISOString(),
    };
  }
}
