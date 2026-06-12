import { HEALTH_ENDPOINT } from '@repo/consts/health';
import {
  healthResponseSchema,
  type HealthResponse
} from '@repo/schemas/health';
import type { EndpointContract } from '../shared/endpoint.js';

export const healthContract: EndpointContract<HealthResponse> = {
  method: 'GET',
  path: HEALTH_ENDPOINT,
  responseSchema: healthResponseSchema
};
