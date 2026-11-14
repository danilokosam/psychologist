import type { Tx } from '../shared/db/tenant-context';
import { PrismaAccountRepository } from '../modules/accounts/infrastructure/prisma-account-repository';
import {
  bootstrapAccount,
  type BootstrapAccountInput,
} from '../modules/accounts/application/use-cases/bootstrap-account';
import { getAccount } from '../modules/accounts/application/use-cases/get-account';
import { updateLocale } from '../modules/accounts/application/use-cases/update-locale';
import { PrismaInvitationRepository } from '../modules/organizations/infrastructure/prisma-invitation-repository';
import { cryptoInvitationTokens } from '../modules/organizations/infrastructure/crypto-invitation-tokens';
import { createInvitation } from '../modules/organizations/application/use-cases/create-invitation';
import { acceptInvitation } from '../modules/organizations/application/use-cases/accept-invitation';
import {
  listInvitations,
  revokeInvitation,
} from '../modules/organizations/application/use-cases/manage-invitations';

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
    updateLocale: (input: Parameters<typeof updateLocale>[0]) => updateLocale(input, { accounts }),
  };
}

/** Invitations (ADR-0013). Same request-scoped factory pattern as above. */
export function buildOrganizationsModule(tx: Tx) {
  const invitations = new PrismaInvitationRepository(tx);
  const accounts = new PrismaAccountRepository(tx);
  const tokens = cryptoInvitationTokens;

  return {
    createInvitation: (input: Parameters<typeof createInvitation>[0]) =>
      createInvitation(input, { invitations, tokens }),
    listInvitations: (input: Parameters<typeof listInvitations>[0]) =>
      listInvitations(input, { invitations }),
    revokeInvitation: (input: Parameters<typeof revokeInvitation>[0]) =>
      revokeInvitation(input, { invitations }),
    acceptInvitation: (input: Parameters<typeof acceptInvitation>[0]) =>
      acceptInvitation(input, { invitations, accounts, tokens }),
  };
}
