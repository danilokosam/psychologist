# ADR-0005: Enum-based roles instead of a dynamic RBAC engine for the MVP

**Status:** Accepted
**Date:** 2026-11-09

## Context

The product brief describes a general "Role" concept and future clinics
with "role-based permissions." A fully dynamic RBAC engine (custom roles,
a permissions matrix table, per-organization configurable grants) is a
reasonable thing a mature Clinic-tier product might need — but there is no
validated requirement for it yet, and building it now would be speculative
complexity with no current user.

## Decision

`memberships.role` is a fixed enum: `owner`, `psychologist`, `admin_staff`.
Authorization logic (both in the Express middleware and in RLS policies)
switches on this enum directly. No separate `roles` or `permissions`
tables exist yet.

## Alternatives Considered

- **Full RBAC (roles × permissions matrix, per-org custom roles):**
  deferred — revisit only if a real Clinic-tier customer's workflow
  demonstrates a concrete need for custom roles beyond these three.

## Consequences

- Adding a new fixed role later (e.g. `billing_admin`) is a small enum
  change plus a review of every policy/middleware switch on role — still
  manageable at this scale.
- Migrating to full dynamic RBAC later, if ever needed, is a real
  migration (not free), but is explicitly deferred rather than
  accidentally foreclosed: the `memberships` table and composite-FK
  pattern (ADR-0004) do not need to change shape to support it.
