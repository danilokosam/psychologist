import { Router } from 'express';
import { healthCheckResponseSchema, type HealthCheckResponse } from '@psych/types';

// Deliberately not a domain "module" (see docs/ARCHITECTURE.md) -- there is
// no business entity called "health". This is operational infrastructure,
// so it lives directly under routes/ rather than modules/.
export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  const body: HealthCheckResponse = { status: 'ok', timestamp: new Date().toISOString() };
  // Validate our own response against the shared schema -- cheap insurance
  // that the API and the frontend's expectations can never silently drift.
  res.json(healthCheckResponseSchema.parse(body));
});
