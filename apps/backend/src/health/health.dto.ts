import { createZodDto } from 'nestjs-zod';
import { healthResponseSchema } from '@repo/schemas/health';

export class HealthResponseDto extends createZodDto(healthResponseSchema) {}
