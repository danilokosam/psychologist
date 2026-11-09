# ADR-0007: English-first internationalization with next-intl

**Status:** Accepted
**Date:** 2026-11-09

## Context

The product's initial commercial market is Spain, but the application is
to be built English-first (`en` default) with Spanish (`es`) as a
secondary, user-selectable language, switchable from user
settings/preferences. All user-facing text must go through translation
catalogs; no hardcoded UI strings; database values must remain
language-independent.

This is an authenticated, dashboard-style SaaS app, not a
content/marketing site — per-locale SEO and static rendering of
public pages are not a priority.

## Decision

- Use **next-intl** for the Next.js frontend.
- **Locale resolution without URL path prefixes** (no `/en/...`,
  `/es/...` segments): resolved from, in order, (1) the authenticated
  user's stored preference (`profiles.locale`), (2) a locale cookie for
  unauthenticated/pre-login pages, (3) `Accept-Language` header, (4)
  fallback to `en`.
- Message catalogs: `apps/web/messages/en.json` and
  `apps/web/messages/es.json`, structured by feature/namespace
  (e.g. `patients.title`, `appointments.status.scheduled`).
- Database status/enum values remain language-independent codes
  (e.g. `scheduled`, `no_show`); translation happens only at the UI layer,
  via a lookup from code → translation key.
- Dates, times, currency, and number formatting use `Intl.DateTimeFormat` /
  `Intl.NumberFormat` driven by the resolved locale, with organization-level
  defaults (timezone, currency) stored in `organizations.settings` (jsonb)
  for values that are an organization property rather than a per-user
  preference (e.g. the currency a practice bills in).
- The language switcher lives in user settings/preferences and persists to
  `profiles.locale`, so the preference follows the user across devices,
  not just a browser cookie.

## Alternatives Considered

- **Locale-prefixed routing (`/en/...`, `/es/...`):** next-intl's more
  fully-featured mode (better static optimization), but the benefit is
  mostly about public/SEO pages — irrelevant for an authenticated
  dashboard where nearly every page is dynamic and personalized anyway.
  Rejected in favor of simpler URLs.
- **Browser-cookie-only locale, no DB persistence:** simpler, but loses
  the preference across devices — rejected since the brief explicitly
  wants the switcher in durable user settings.

## Consequences

- `profiles` gains a `locale` column (`varchar`, default `'en'`).
- Every new user-facing string must be added to **both** `en.json` and
  `es.json` before a feature can be marked COMPLETED in
  `docs/FEATURES.md` — missing Spanish strings are a review blocker, not
  an afterthought.
