# Architecture Decision Records

This directory records the architectural decisions that should **not** be
changed without a deliberate discussion, because they were chosen after
evaluating real alternatives and trade-offs — not arbitrarily.

Each ADR follows: Context → Decision → Alternatives Considered → Consequences.
Status is one of `Proposed`, `Accepted`, `Superseded`, `Deprecated`.

| ADR | Title | Status |
|---|---|---|
| [0001](0001-separate-express-backend.md) | Separate Express API instead of Next.js-only backend | Accepted |
| [0002](0002-prisma-with-manual-rls-context.md) | Prisma ORM with manually propagated RLS session context | Accepted |
| [0003](0003-defense-in-depth-tenant-isolation.md) | Defense-in-depth tenant isolation: app-layer scoping + RLS with identity-only session variables | Accepted |
| [0004](0004-composite-foreign-keys.md) | Composite foreign keys to prevent cross-organization relationships | Accepted |
| [0005](0005-enum-based-roles-for-mvp.md) | Enum-based roles instead of a dynamic RBAC engine for the MVP | Accepted |
| [0006](0006-append-only-clinical-note-versions.md) | Append-only versioning for clinical notes | Accepted |
| [0007](0007-english-first-i18n.md) | English-first internationalization with next-intl | Accepted |
| [0008](0008-supabase-auth-independent-verification.md) | Supabase Auth with independent JWT verification in Express; non-bypassing runtime DB role | Accepted |
| [0009](0009-module-internal-ports-and-adapters.md) | Lightweight Ports-and-Adapters within each module; composition root uses request-scoped factory functions | Accepted |
| [0010](0010-role-permission-matrix.md) | Role permission matrix for clinical and administrative resources | Accepted |
| [0011](0011-profiles-auth-fk-via-privileged-connection.md) | `profiles` → `auth.users` FK applied via the privileged admin connection, not Prisma | Accepted |

When a decision here needs to change, add a new ADR that supersedes the old
one and update its status — don't silently edit history.
