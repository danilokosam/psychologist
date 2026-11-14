import { createHash, randomBytes } from 'node:crypto';
import type { InvitationTokens } from '../application/ports/invitation-repository';

/**
 * 256 bits from the OS CSPRNG, base64url so it is safe in a URL fragment.
 * Only the SHA-256 hash is persisted: a database dump or a leaked backup does
 * not contain usable invitation links. A plain (unsalted, fast) hash is
 * appropriate here, unlike for passwords -- the input is already 256 bits of
 * randomness, so there is nothing to brute-force.
 */
export const cryptoInvitationTokens: InvitationTokens = {
  generate() {
    const token = randomBytes(32).toString('base64url');
    return { token, tokenHash: this.hash(token) };
  },
  hash(token) {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  },
};
