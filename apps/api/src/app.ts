import cors from 'cors';
import express from 'express';
import { healthRouter } from './routes/health';
import { errorHandler } from './middleware/error-handler';

// Exported separately from server.ts so tests can exercise the app with
// supertest without binding a real TCP port.
export function createApp() {
  const app = express();
  // The Next.js app runs on a different origin (port) in local development
  // and calls this API directly from the browser -- without this, the
  // browser blocks the request before it ever reaches Express.
  app.use(cors());
  app.use(express.json());

  app.use(healthRouter);

  // Must be registered after all routes.
  app.use(errorHandler);

  return app;
}
