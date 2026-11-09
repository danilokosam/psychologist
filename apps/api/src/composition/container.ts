import type { Tx } from '../shared/db/tenant-context';
import { PrismaAccountRepository } from '../modules/accounts/infrastructure/prisma-account-repository';
import {
  bootstrapAccount,
  type BootstrapAccountInput,
} from '../modules/accounts/application/use-cases/bootstrap-account';
import { getAccount } from '../modules/accounts/application/use-cases/get-account';

/**
 * The only file allowed to import a concrete infrastructure adapter (ADR-0009).
 * Controllers import from here, never from a module's own infrastructure
 * folder.
 *
 * These are factories rather than pre-built singletons because repositories
 * need the request's transaction client, which doesn't exist until a request
 * arrives and `withTenantContext`/`withUserContext` opens a transaction. That
 * also means an adapter can never be built against a connection outside the
 * RLS context: the only `tx` in scope is the one that just set it.
 */
export function buildAccountsModule(tx: Tx) {
  const accounts = new PrismaAccountRepository(tx);

  return {
    bootstrapAccount: (input: BootstrapAccountInput) => bootstrapAccount(input, { accounts }),
    getAccount: (input: { userId: string }) => getAccount(input, { accounts }),
  };
}
