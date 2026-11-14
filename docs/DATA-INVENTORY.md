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
| `profiles.full_name`, `.phone` | Personal | Identify the professional/staff user | TBD — legal/DPO | TBD | Tied to account lifecycle |
| `profiles.locale` | Internal (preference) | UI language | N/A | Account lifetime | Not personal/sensitive data |
| `invitations.email` | Personal | Address a team invitation to a specific person, and bind acceptance to that person's verified email ([ADR-0013](decisions/0013-organization-invitations.md)) | TBD — likely legitimate interest / contract with the inviting practice | TBD — accepted and revoked rows are kept as an audit trail of who was granted access by whom; whether to purge or pseudonymize them after a period is an open question for the legal review | Only the invitee's address and the role offered; the link token is never stored (hash only). The invitee has not yet consented to anything when the row is created. |
| `patients.full_name`, `.phone`, `.email` | Personal | Identify and contact the patient | TBD — Art. 6, pending confirmation of basis | TBD — pending retention-period research (see open question below) | Minimum needed to run a practice |
| `patients.date_of_birth` | Personal | Clinical context | TBD | TBD | Kept — relevant to clinical practice |
| `patients.emergency_contact_*` | Personal (optional) | Safety in a crisis | TBD | TBD | Optional field, justified by patient safety |
| `patients.national_id` | — | — | — | — | **Deliberately not collected** — no MVP feature justifies it; see [ADR](decisions/0004-composite-foreign-keys.md) sibling decisions and `docs/DATABASE.md`. Revisit only if a specific feature (e.g. formal tax invoicing) needs it. |
| `clinical_sessions.*` | Special category (health) | Record that a session occurred | TBD — likely Art. 9(2)(h) (healthcare provision) pending confirmation | TBD | |
| `clinical_notes` / `clinical_note_versions.content` | **Special category (health), highest sensitivity** | Clinical record-keeping | TBD — Art. 9(2)(h) vs. explicit consent Art. 9(2)(a); **changes patient-intake consent UX — needs legal guidance, not a default assumption** | TBD — likely governed by a professional retention obligation (Spanish psychology deontological code vs. medical-record law — unresolved, see open question) | Append-only versioning, see [ADR-0006](decisions/0006-append-only-clinical-note-versions.md) |
| `payments.*` | Personal (financial) | Track what a patient owes/paid | TBD | TBD | Ledger only — not a payment processor; no card data stored |
| `audit_logs.ip_address`, `.actor_user_id` | Personal | Security/accountability | Legitimate interest (likely) | TBD | IP address is personal data under GDPR |

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
