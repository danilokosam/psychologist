import { z } from 'zod';

// Shared contract between apps/api and apps/web for the foundational
// health-check endpoint. This is the simplest possible proof that the
// frontend and backend agree on a request/response shape through one
// shared package, instead of the frontend guessing the backend's shape.
export const healthCheckResponseSchema = z.object({
  status: z.literal('ok'),
  timestamp: z.string(),
});

export type HealthCheckResponse = z.infer<typeof healthCheckResponseSchema>;
