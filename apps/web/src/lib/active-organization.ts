// Which of the caller's organizations the UI is working in. A preference
// only: the API re-verifies membership on every request (resolveOrganization)
// and RLS re-verifies it again, so a stale or tampered value here can never
// grant access -- at worst it yields a 404 and the UI falls back.
const STORAGE_KEY = 'activeOrganizationId';

export function getStoredActiveOrganization(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function setStoredActiveOrganization(organizationId: string) {
  window.localStorage.setItem(STORAGE_KEY, organizationId);
}
