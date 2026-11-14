# Personal Data Inventory

Produced early (Milestone 0), not deferred, so that an actual lawyer/DPO
has a concrete artifact to review before any real patient data is
processed — see the project's standing rule below. This inventory is a
development-team working document, **not** a substitute for professional
legal/DPO review, and every "TBD" below must be resolved by one before
Milestone 6 (real-data pilot).

## Standing rule

**No real patient data is processed until this inventory has been
reviewed by qualified legal/DPO counsel and a DPIA has been completed.**
All development, testing, and demos use synthetic, fictional patient
records and clinical notes — enforced as team practice, not just a
suggestion. See `docs/ROADMAP.md` Milestone 6.

## Inventory

| Table.Field | Category | Purpose | Legal basis | Retention | Notes |
|---|---|---|---|---|---|
| `profiles.full_name`, `.phone` | Personal | Identify the professional/staff user | TBD — legal/DPO | TBD | Tied to account lifecycle — `full_name` is collected at sign-up and, because sign-up has no session yet (email confirmation), it also sits in Supabase Auth's `auth.users.raw_user_meta_data.full_name` (Supabase-managed, same lifecycle as the auth user). Only the first bootstrap reads it; `profiles` is the source of truth afterwards |
| `profiles.locale` | Internal (preference) | UI language | N/A | Account lifetime | Not personal/sensitive data |
| `invitations.email` | Personal | Address a team invitation to a specific person, and bind acceptance to that person's verified email ([ADR-0013](decisions/0013-organization-invitations.md)) | TBD — likely legitimate interest / contract with the inviting practice | TBD — accepted and revoked rows are kept as an audit trail of who was granted access by whom; whether to purge or pseudonymize them after a period is an open question for the legal review | Only the invitee's address and the role offered; the link token is never stored (hash only). The invitee has not yet consented to anything when the row is created. |
| `patients.full_name`, `.phone`, `.email` | Personal | Identify and contact the patient | TBD — Art. 6, pending confirmation of basis | TBD — pending retention-period research (see open question below). Patients are **archived, never deleted** until this is answered ([ADR-0014](decisions/0014-patients-archived-not-deleted.md)) | Minimum needed to run a practice. Only `full_name` is required; `email` stored lower-cased. Implemented M2 |
| `patients.date_of_birth` | Personal | Clinical context | TBD | TBD | Optional, a calendar date (no time). Implemented M2 |
| `patients.emergency_contact_name`, `.emergency_contact_phone` | Personal (optional, a **third party's** data) | Safety in a crisis | TBD — note this is data about someone other than the patient | TBD | Optional, justified by patient safety. Implemented M2 |
| `patients.status`, `.archived_at`, `.created_by`, `.created_at`, `.updated_at` | Internal (record lifecycle) | Working list vs archive; accountability | N/A | Same as the patient row | Not additional personal data about the patient |
| `patients.assigned_professional_id`, `.consent_recorded_at`, free-text notes | — | — | — | — | **Not collected (M2)** — no feature uses them yet; the consent timestamp depends on open question 2; a notes field would expose clinical content to `admin_staff` (ADR-0014) |
| `patients.national_id` | — | — | — | — | **Deliberately not collected** — no MVP feature justifies it; see [ADR](decisions/0004-composite-foreign-keys.md) sibling decisions and `docs/DATABASE.md`. Revisit only if a specific feature (e.g. formal tax invoicing) needs it. |
| `appointments.scheduled_start`, `.scheduled_end`, `.status`, `.modality`, `.patient_id`, `.professional_id` | **Likely special category (health)** — that a named person sees a psychologist, when, and whether they attended, can itself reveal health information | Scheduling the practice's work | TBD — likely the same basis as clinical records; **legal review** | TBD — cancelled appointments are kept (never deleted, [ADR-0015](decisions/0015-appointment-conflicts-per-organization.md)) as the record payments rely on; retention follows the patient's | Implemented M3. Readable by `admin_staff` (they schedule) — which is why no free-text notes field exists here. No reason for cancellation is stored |
| `clinical_sessions.*` (started_at, duration, patient, professional, appointment link) | Special category (health) | Record that a session occurred | TBD — likely Art. 9(2)(h) (healthcare provision) pending confirmation | TBD — never deleted through the app | Implemented M4. Metadata only, readable by `admin_staff` for billing; no clinical content |
| `clinical_notes` / `clinical_note_versions.content` | **Special category (health), highest sensitivity** | Clinical record-keeping | TBD — Art. 9(2)(h) vs. explicit consent Art. 9(2)(a); **changes patient-intake consent UX — needs legal guidance, not a default assumption** | TBD — likely governed by a professional retention obligation (Spanish psychology deontological code vs. medical-record law — unresolved, see open question) | Implemented M4. Append-only, immutable rows ([ADR-0006](decisions/0006-append-only-clinical-note-versions.md), [ADR-0016](decisions/0016-clinical-notes-immutable-rows.md)); readable by owner/psychologist only, written only by the author; every access audited; never logged, cached (`no-store`) or sent to spell-check services |
| `payments.*` | Personal (financial) | Track what a patient owes/paid | TBD | TBD | Ledger only — not a payment processor; no card data stored |
| `audit_logs.actor_user_id`, `.action`, `.resource_id`, `.created_at` | Personal (who accessed which clinical note, when) | Accountability for access to health data (F-012) | Legitimate interest / legal obligation (likely) — legal review | TBD — must be at least as long as the records it protects | Implemented M4. INSERT-only for the app (no SELECT). `metadata` holds version numbers only — never content |
| `audit_logs.ip_address` | — | — | — | — | **Not collected (M4)** — data minimization; whether security needs it is a question for the M6 legal review |

## Open questions requiring professional legal/DPO guidance (do not assume answers)

1. Exact retention period for psychological clinical records in Spain —
   Ley 41/2002 governs sanitary centers' *historia clínica*; private
   psychology practice may fall under different Colegio Oficial de
   Psicólogos deontological rules. Unverified.
2. Which Art. 9 legal basis applies to clinical note storage — determines
   whether an explicit consent-capture workflow is required at patient
   intake.
3. Supabase's current DPA terms and EU hosting/subprocessor status must
   be re-verified at the time of real launch, not assumed from this
   document's date.
4. How GDPR's right-to-erasure interacts with any confirmed retention
   obligation — expected resolution is soft-delete + a defined retention
   clock, not immediate hard deletion on request, but the clock length
   depends on (1).
5. Whether a DPIA (GDPR Art. 35) is formally required — very likely yes,
   given special-category data at scale, but should be confirmed and
   conducted as its own deliverable before Milestone 6.

> Update this table whenever a new personal-data-bearing field is added
> to the schema — it must stay synchronized with `docs/DATABASE.md`.
