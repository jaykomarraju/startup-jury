-- 0103 — the programme associate can READ the Jury Pipeline.
--
-- **The client, 2026-10-02:** "The program associate should be able to see jury
-- pipeline only as read only."
--
-- ── WHY A MIGRATION AND NOT JUST CODE ──────────────────────────────────────
-- Measured before building: the associate could not reach the screen AT ALL, so
-- the ask resolves to GRANT read, not to withdraw write. Three gates refused
-- them and all three had to move together, because reach is a GATE, not a grant:
--
--   1. `src/shared/nav.ts` — `jurypipeline.roles` did not list them, and
--      `canSeeNav` fails on `roles.includes(role)` before the task is consulted.
--   2. `src/shared/types.ts` — `DEFAULT_ROLE_PERMISSIONS.incubator.jurypipeline`
--      did not list them either.
--   3. **This file.** `0029_role_permissions.sql:95` PERSISTED the cell:
--          ('incubator', 'program_associate', 'jurypipeline', 0)
--      and a persisted row beats the code default — `auth/permissions.ts`
--      resolves the stored override (step 4) before `DEFAULT_ROLE_PERMISSIONS`
--      (step 5). So without this statement the other two edits are INVISIBLE on
--      every workspace that has ever run `0029`, production included, and the
--      associate would still be told "Not available for your role".
--
-- That asymmetry is the point worth remembering: a code default is what a FRESH
-- workspace gets; a seeded grid is what every existing one actually uses.
--
-- ── WHY READ-ONLY NEEDS NOTHING ENFORCING HERE ─────────────────────────────
-- The screen's only transition is `shortlist` (the Action select's "Send to
-- intro calls"), and `performAction`'s role list for it has never included the
-- associate — so the refusal is already the SERVER's, which is what matters.
-- This repo's recurring bug class is a screen gated client-side only
-- (`role-boundary-leaks`), so the guard is stated over the state machine:
-- `test/unit/jury-pipeline-readonly.test.ts` asserts the associate holds NO
-- decision anywhere in the screen's four stages — as a whole set, so granting
-- them any new one later reddens it — and that the jury and the programme
-- manager still hold theirs.
--
-- The one survivor is `shortlisted/schedule_intro`, and it is correct: the
-- associate is the intro-call executor by delegation. The screen never offers
-- it, because a `shortlisted` row draws the "Sent to intro calls" badge where
-- the Action select would be.
--
-- `adminconsole` is untouched. This grants ONE cell.

-- 1. The grant. Scoped to the one cell and the one edition, and written for
--    every tenant: `role_permissions` is keyed `(tenant_id, edition, role,
--    task_id)` since `0091`, so an UPDATE with no tenant predicate is the
--    correct statement here — every workspace gets the same product.
UPDATE role_permissions
   SET granted = 1, updated_at = datetime('now')
 WHERE edition = 'incubator'
   AND role = 'program_associate'
   AND task_id = 'jurypipeline';

-- 2. It landed, and it landed everywhere. A workspace seeded after `0029` but
--    before this file would otherwise keep the 0 silently, and the symptom —
--    one role, one screen, "Not available for your role" — is exactly the kind
--    that goes unreported for weeks.
INSERT INTO _tenancy_assert (id, verdict)
SELECT '0103.program_associate_reads_jury_pipeline',
       CASE WHEN (SELECT count(*) FROM role_permissions
                   WHERE edition = 'incubator'
                     AND role = 'program_associate'
                     AND task_id = 'jurypipeline'
                     AND granted <> 1) = 0
            THEN 'ok'
            ELSE 'FAIL: the program_associate is still refused jurypipeline in '
              || (SELECT count(*) FROM role_permissions
                   WHERE edition = 'incubator' AND role = 'program_associate'
                     AND task_id = 'jurypipeline' AND granted <> 1)
              || ' workspace(s)' END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');
