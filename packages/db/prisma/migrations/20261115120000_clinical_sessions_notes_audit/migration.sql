-- Clinical sessions, clinical notes (append-only versions) and the audit log
-- (F-008, F-009, F-012; ADR-0006 as amended by ADR-0016). Generated DDL
-- first, then manual constraints, grants and RLS below.
--
-- Requires app_private.has_active_role / is_active_clinician /
-- is_active_member from packages/db/sql/rls-helpers.sql (apply it first).

-- CreateTable
CREATE TABLE "clinical_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "professional_id" UUID NOT NULL,
    "appointment_id" UUID,
    "started_at" TIMESTAMPTZ NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinical_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "clinical_session_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinical_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical_note_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "clinical_note_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinical_note_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" UUID NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clinical_sessions_appointment_id_key" ON "clinical_sessions"("appointment_id");

-- CreateIndex
CREATE INDEX "clinical_sessions_organization_id_patient_id_started_at_idx" ON "clinical_sessions"("organization_id", "patient_id", "started_at");

-- CreateIndex
CREATE INDEX "clinical_sessions_organization_id_professional_id_idx" ON "clinical_sessions"("organization_id", "professional_id");

-- CreateIndex
CREATE INDEX "clinical_sessions_organization_id_created_by_idx" ON "clinical_sessions"("organization_id", "created_by");

-- CreateIndex
CREATE UNIQUE INDEX "clinical_sessions_id_organization_id_key" ON "clinical_sessions"("id", "organization_id");

-- CreateIndex
CREATE INDEX "clinical_notes_organization_id_author_id_idx" ON "clinical_notes"("organization_id", "author_id");

-- CreateIndex
CREATE UNIQUE INDEX "clinical_notes_id_organization_id_key" ON "clinical_notes"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "clinical_notes_clinical_session_id_author_id_key" ON "clinical_notes"("clinical_session_id", "author_id");

-- CreateIndex
CREATE INDEX "clinical_note_versions_organization_id_created_by_idx" ON "clinical_note_versions"("organization_id", "created_by");

-- CreateIndex
CREATE UNIQUE INDEX "clinical_note_versions_clinical_note_id_version_key" ON "clinical_note_versions"("clinical_note_id", "version");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_resource_type_resource_id_create_idx" ON "audit_logs"("organization_id", "resource_type", "resource_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_actor_user_id_created_at_idx" ON "audit_logs"("organization_id", "actor_user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_id_organization_id_patient_id_key" ON "appointments"("id", "organization_id", "patient_id");

-- AddForeignKey
ALTER TABLE "clinical_sessions" ADD CONSTRAINT "clinical_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_sessions" ADD CONSTRAINT "clinical_sessions_patient_id_organization_id_fkey" FOREIGN KEY ("patient_id", "organization_id") REFERENCES "patients"("id", "organization_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_sessions" ADD CONSTRAINT "clinical_sessions_organization_id_professional_id_fkey" FOREIGN KEY ("organization_id", "professional_id") REFERENCES "memberships"("organization_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_sessions" ADD CONSTRAINT "clinical_sessions_organization_id_created_by_fkey" FOREIGN KEY ("organization_id", "created_by") REFERENCES "memberships"("organization_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_sessions" ADD CONSTRAINT "clinical_sessions_appointment_id_organization_id_patient_i_fkey" FOREIGN KEY ("appointment_id", "organization_id", "patient_id") REFERENCES "appointments"("id", "organization_id", "patient_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_clinical_session_id_organization_id_fkey" FOREIGN KEY ("clinical_session_id", "organization_id") REFERENCES "clinical_sessions"("id", "organization_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_organization_id_author_id_fkey" FOREIGN KEY ("organization_id", "author_id") REFERENCES "memberships"("organization_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_note_versions" ADD CONSTRAINT "clinical_note_versions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_note_versions" ADD CONSTRAINT "clinical_note_versions_clinical_note_id_organization_id_fkey" FOREIGN KEY ("clinical_note_id", "organization_id") REFERENCES "clinical_notes"("id", "organization_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_note_versions" ADD CONSTRAINT "clinical_note_versions_organization_id_created_by_fkey" FOREIGN KEY ("organization_id", "created_by") REFERENCES "memberships"("organization_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;




-- ===========================================================================
-- Manual additions below (not generated by `prisma migrate diff`).
-- ===========================================================================

-- Integrity --------------------------------------------------------------

ALTER TABLE "clinical_sessions" ADD CONSTRAINT "clinical_sessions_duration_valid"
  CHECK (duration_minutes BETWEEN 1 AND 720);

ALTER TABLE "clinical_note_versions" ADD CONSTRAINT "clinical_note_versions_version_positive"
  CHECK (version >= 1);

-- Non-blank, and bounded so a runaway client cannot store megabytes per
-- version (versions are never pruned, ADR-0006). "Non-blank" = contains a
-- non-whitespace character: btrim() strips only spaces, so a note of bare
-- newlines passed an earlier draft of this CHECK (caught by the suite).
ALTER TABLE "clinical_note_versions" ADD CONSTRAINT "clinical_note_versions_content_valid"
  CHECK (content ~ '[^[:space:]]' AND char_length(content) <= 50000);

-- Machine-readable vocabulary only ("clinical_note.read"); never free text,
-- which is how clinical content could leak into the trail.
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_vocabulary"
  CHECK (action ~ '^[a-z_]+\.[a-z_]+$' AND resource_type ~ '^[a-z_]+$');

-- Grants -----------------------------------------------------------------
-- The narrowest grants in the schema. Nothing here is ever deleted through
-- the application.
--   clinical_sessions: only the time and duration can be corrected.
--   clinical_notes: fully immutable -- the text lives in versions.
--   clinical_note_versions: append-only (ADR-0006).
--   audit_logs: INSERT only. Not even SELECT: the application can write the
--     trail but can neither read it back nor alter it. (Reviewing it is a
--     privileged, out-of-band operation until an owner-facing view exists.)
REVOKE UPDATE, DELETE ON "clinical_sessions" FROM app_runtime;
GRANT UPDATE ("started_at", "duration_minutes", "updated_at") ON "clinical_sessions" TO app_runtime;
REVOKE UPDATE, DELETE ON "clinical_notes" FROM app_runtime;
REVOKE UPDATE, DELETE ON "clinical_note_versions" FROM app_runtime;
REVOKE SELECT, UPDATE, DELETE ON "audit_logs" FROM app_runtime;

-- Row Level Security -----------------------------------------------------
-- Every policy: the declared organization AND a role re-derived from
-- memberships by the database (ADR-0003, ADR-0012) -- never a role passed in
-- by the application. CLINICAL = an active owner or psychologist.

ALTER TABLE "clinical_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clinical_sessions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "clinical_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clinical_notes" FORCE ROW LEVEL SECURITY;
ALTER TABLE "clinical_note_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clinical_note_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;

-- clinical_sessions: metadata readable by every member (admin_staff bills
-- from it); written only by clinicians (SECURITY.md matrix).
CREATE POLICY "clinical_sessions_select" ON "clinical_sessions"
  FOR SELECT
  USING (
    organization_id = (select app_private.current_org_id())
    AND app_private.is_active_member(organization_id)
  );

-- As yourself, a clinician, for a clinician professional, never for an
-- archived patient (ADR-0014).
CREATE POLICY "clinical_sessions_insert" ON "clinical_sessions"
  FOR INSERT
  WITH CHECK (
    organization_id = (select app_private.current_org_id())
    AND app_private.has_active_role(organization_id, ARRAY['owner', 'psychologist'])
    AND created_by = (select app_private.current_user_id())
    AND app_private.is_active_clinician(organization_id, professional_id)
    AND EXISTS (
      SELECT 1 FROM patients p
      WHERE p.id = clinical_sessions.patient_id
        AND p.organization_id = clinical_sessions.organization_id
        AND p.status <> 'archived'
    )
  );

CREATE POLICY "clinical_sessions_update" ON "clinical_sessions"
  FOR UPDATE
  USING (
    organization_id = (select app_private.current_org_id())
    AND app_private.has_active_role(organization_id, ARRAY['owner', 'psychologist'])
  )
  WITH CHECK (
    organization_id = (select app_private.current_org_id())
    AND app_private.has_active_role(organization_id, ARRAY['owner', 'psychologist'])
  );

-- clinical_notes: invisible to admin_staff -- not filtered, invisible: for
-- them the table is empty, whatever the application asks (ADR-0010).
CREATE POLICY "clinical_notes_select" ON "clinical_notes"
  FOR SELECT
  USING (
    organization_id = (select app_private.current_org_id())
    AND app_private.has_active_role(organization_id, ARRAY['owner', 'psychologist'])
  );

-- A clinician opens their own note, naming themselves as its author.
CREATE POLICY "clinical_notes_insert" ON "clinical_notes"
  FOR INSERT
  WITH CHECK (
    organization_id = (select app_private.current_org_id())
    AND app_private.has_active_role(organization_id, ARRAY['owner', 'psychologist'])
    AND author_id = (select app_private.current_user_id())
  );
-- No UPDATE/DELETE policies (and no grants): notes are immutable.

-- clinical_note_versions: same read rule as notes.
CREATE POLICY "clinical_note_versions_select" ON "clinical_note_versions"
  FOR SELECT
  USING (
    organization_id = (select app_private.current_org_id())
    AND app_private.has_active_role(organization_id, ARRAY['owner', 'psychologist'])
  );

-- The author-only rule (F-009): a version can be added only to a note whose
-- author is the caller, by the caller. Another psychologist -- who can READ
-- the note -- cannot write to it, even bypassing the application. The
-- clinical_notes sub-select runs under the caller's own notes policy.
CREATE POLICY "clinical_note_versions_insert" ON "clinical_note_versions"
  FOR INSERT
  WITH CHECK (
    organization_id = (select app_private.current_org_id())
    AND app_private.has_active_role(organization_id, ARRAY['owner', 'psychologist'])
    AND created_by = (select app_private.current_user_id())
    AND EXISTS (
      SELECT 1 FROM clinical_notes n
      WHERE n.id = clinical_note_versions.clinical_note_id
        AND n.organization_id = clinical_note_versions.organization_id
        AND n.author_id = (select app_private.current_user_id())
    )
  );
-- No UPDATE/DELETE policies (and no grants): append-only.

-- audit_logs: any active member records their OWN actions in the declared
-- organization. No SELECT policy (and no SELECT grant).
CREATE POLICY "audit_logs_insert" ON "audit_logs"
  FOR INSERT
  WITH CHECK (
    organization_id = (select app_private.current_org_id())
    AND app_private.is_active_member(organization_id)
    AND actor_user_id = (select app_private.current_user_id())
  );
