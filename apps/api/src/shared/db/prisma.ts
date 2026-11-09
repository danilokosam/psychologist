import { PrismaClient } from '@psych/db';

// Single Prisma client for the process. Connecting as `app_runtime` (see
// .env.example): NOBYPASSRLS and not a table owner, so every query this
// client makes is subject to Row Level Security.
//
// IMPORTANT: application code must not query tenant-owned tables through
// this client directly. It goes through withTenantContext/withUserContext
// (see tenant-context.ts), which open a transaction and set the identity
// session variables the RLS policies read. Using this client bare would
// leave those variables unset, and the policies fail closed -- queries
// return zero rows rather than leaking data, but nothing works either.
export const prisma = new PrismaClient();
