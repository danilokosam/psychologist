# ADR-0013: Organization invitations — link token bound to the invitee's verified email

**Status:** Accepted
**Date:** 2026-11-14

## Context

Milestone 1 (`docs/ROADMAP.md`) includes an invite flow. `docs/FEATURES.md`
(F-003) had classified it as Extended MVP, because a solo-practice pilot never
needs a second member. **It was pulled into Milestone 1 by explicit product
decision (2026-11-14)**, for three reasons:

1. Without it, `psychologist` and `admin_staff` — two of the three roles the
   whole authorization design (ADR-0005, ADR-0010) exists for — can never
   actually occur in a real organization, so `requireRole` and the
   role-aware RLS policies would only ever be exercised by tests.
2. Milestone 1's definition of done asks for cross-tenant isolation tests
   over two seeded organizations; an organization with more than one member
   and more than one role makes those tests meaningful rather than trivial.
3. It is the first write path where one user grants another user access to
   tenant data. Getting it right while the schema is small is cheaper than
   retrofitting it once patients and clinical notes exist.

Constraints that shaped the design:

- The invitee may not have an account yet, so there is no `user_id` to put in
  a `memberships` row — and `memberships.user_id` is a non-null FK to
  `profiles`.
- There is no email provider yet (Resend is Post-MVP), so the system cannot
  deliver an invitation itself.
- The API deliberately holds no Supabase secret key (ADR-0008), so Supabase's
  `inviteUserByEmail` admin API is not available — and adopting it would
  mean giving the API a key that bypasses RLS on the auth side.

## Decision

A separate `invitations` table, and an accept step that requires **two**
independent proofs.

- An `owner` (permission `organization.manage`) invites an email address with
  role `psychologist` or `admin_staff`. Inviting a second `owner` is rejected
  in the API and by a `CHECK` constraint: ownership transfer is a different,
  higher-stakes operation and is not built.
- The API generates a 256-bit random token, stores **only its SHA-256 hash**,
  and returns the token exactly once, as a link the owner shares out of band.
  The link carries the token in the URL **fragment** (`#token=`), which
  browsers never send to a server, so it does not end up in proxy, CDN or
  access logs or in a `Referer` header.
- Accepting requires (1) possession of the token **and** (2) that the email in
  the caller's verified access token equals the invited address. A leaked link
  is useless to anyone else; knowing someone's email without the link is
  useless too.
- The invitee's verified email is passed to Postgres as identity
  (`app.current_user_email`), alongside `app.current_user_id` — identity
  only, never an authorization conclusion (ADR-0003). RLS then independently
  enforces that:
  - only an active `owner` of the declared organization sees, creates or
    revokes its invitations;
  - an invitee sees only pending invitations addressed to their own email;
  - a membership can be self-inserted only when a pending, unexpired
    invitation exists for the caller's email, for that organization, with
    exactly that role (`app_private.has_pending_invitation`, a SECURITY
    DEFINER helper for the same recursion reason as ADR-0012).
- Column-level grants: `app_runtime` can update only `status`,
  `accepted_by`, `accepted_at` and `revoked_at` on `invitations` — never the
  email, role, organization or token hash of an existing invitation — and has
  no `DELETE` at all. Revoking is a status change; the history is kept.
- Invitations expire after 7 days. At most one *pending* invitation per
  (organization, email) — a partial unique index.
- Every failure to accept — unknown token, wrong email, expired, revoked,
  already used — returns the same `404`, so the endpoint cannot be used to
  probe which tokens or addresses exist.
- `memberships.status = 'invited'` stays unused. It cannot represent an
  invitee who has no profile yet; the enum value is kept rather than migrated
  away, since a later "suspend/reinstate" flow may want a non-active state
  anyway.

## Alternatives Considered

- **Token only (no email binding)** — simpler, and what many products do.
  Rejected: the link is shared over channels we do not control (WhatsApp,
  email forwards), and for an application holding Article 9 data a forwarded
  link should not be enough to join an organization.
- **Email only (no token): any user whose verified email matches sees a
  pending invitation on login.** Attractive UX and no secret to manage.
  Rejected as the *only* control, because it makes the whole flow depend on
  the Supabase project's "confirm email" setting being on; a project
  misconfiguration would let anyone register an address and join. With the
  token as well, that misconfiguration alone is not enough.
- **Supabase `auth.admin.inviteUserByEmail`** — would deliver the email for
  us, but requires the secret/service key in the API (see Context).
- **Reuse `memberships` with `status = 'invited'`** — impossible without a
  user id, and would mean a placeholder `profiles` row for someone who has not
  agreed to anything.
- **Do the whole accept inside a SECURITY DEFINER function** — fewer
  policies, but it would put a privileged *write* outside RLS. The definer
  helper here only returns a boolean, matching the constraint set in
  ADR-0012.

## Consequences

- New personal-data field: `invitations.email` (see
  `docs/DATA-INVENTORY.md`). Accepted and revoked rows keep it, as an audit
  trail of who was granted access by whom; retention is an open question
  for the Milestone 6 legal review, like the rest of the inventory.
- **Deployment assumption:** the Supabase project must have "Confirm email"
  enabled, so that the `email` claim is a verified address. The token makes a
  misconfiguration non-exploitable on its own, but the email binding is only
  as strong as that setting. Added to the Milestone 6 hardening checklist.
- An invitee who opens the dashboard *before* accepting gets their own solo
  practice from `/auth/bootstrap` (as any new user does) and simply belongs
  to two organizations. The accept page creates the profile itself, so an
  invitee who goes straight to the link does not get a spurious practice.
- Until an email provider exists, the owner shares the link manually. When
  Resend lands, it only changes how the link is delivered, not this design.
