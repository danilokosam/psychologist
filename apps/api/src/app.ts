import cors from 'cors';
import express from 'express';
import { healthRouter } from './routes/health';
import { accountsRouter } from './modules/accounts/delivery/http/accounts.routes';
import { invitationsRouter } from './modules/organizations/delivery/http/invitations.routes';
import { patientsRouter } from './modules/patients/delivery/http/patients.routes';
import { appointmentsRouter } from './modules/appointments/delivery/http/appointments.routes';
import { clinicalRouter } from './modules/clinical/delivery/http/clinical.routes';
import { membersRouter } from './modules/organizations/delivery/http/members.routes';
import { AppError, errorHandler } from './shared/middleware/error-handler';

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
  app.use(accountsRouter);
  app.use(invitationsRouter);
  app.use(membersRouter);
  app.use(patientsRouter);
  app.use(appointmentsRouter);
  app.use(clinicalRouter);

  // Unknown routes answer in the same JSON error shape as everything else
  // (docs/API.md), not Express's default HTML page -- which also named the
  // framework and echoed the method/path back.
  app.use((_req, _res, next) => next(new AppError(404, 'Not found', 'NOT_FOUND')));

  // Must be registered after all routes.
  app.use(errorHandler);

  return app;
}
