-- 0084 — T0-SCHEMA · `tenant_id` on the pipeline and people tables (6 of 17).
--
-- ── WHY `NOT NULL DEFAULT 't_default'` AND NOT NULLABLE-THEN-BACKFILL ───────
-- `plan_multitenancy.md` §5g planned these columns "nullable, no REFERENCES,
-- + backfill" with a later slot for "NOT NULL enforcement". That second step
-- does not exist in SQLite: there is no `ALTER TABLE … ALTER COLUMN … SET NOT
-- NULL`, so enforcing it afterwards means REBUILDING ALL SEVENTEEN of these
-- tables — turning §5e's 11 rebuilds into 28. The plan's own §5d measurement is
-- what makes the one-statement form available:
--
--   ALTER TABLE users ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 't_default'
--   → OK, on a table carrying four CHECK constraints
--
-- re-verified inside D1 on the current schema. A CHECK does not force a rebuild
-- and neither does a composite PK; the commonly stated rule is wrong. So the
-- column arrives NOT NULL and the backfill is the DEFAULT applying to every
-- existing row, atomically, with no window in which a row has no owner.
--
-- ── THE PRICE OF THAT DEFAULT, NAMED ────────────────────────────────────────
-- A `DEFAULT` that stays on the column means an INSERT that FORGETS `tenant_id`
-- silently lands in `t_default` instead of failing. For tenant B that is a
-- cross-tenant write, and it is a worse failure than a missing read predicate
-- because nothing in the response looks wrong.
--
-- Two things answer it, and neither is a constraint, because SQLite cannot
-- express "default only for rows that already existed":
--
--   · the ELEVEN tables rebuilt by 0087-0098 take `tenant_id TEXT NOT NULL`
--     with NO default — they are being rebuilt anyway, so the loud form is
--     free there, and `users` is the table where a mis-tenanted INSERT does the
--     most damage;
--   · `test/worker/tenant-scope.test.ts` asserts the WRITE side per table: a
--     row created through the API as tenant B must come back carrying B's
--     tenant_id. That is the check that catches a forgotten bind, and it is the
--     one a T1 session extends.
--
-- The asymmetry between the 17 and the 11 is therefore deliberate and measured,
-- not an oversight. `src/shared/tenant.ts` makes supplying the column
-- mechanical in both cases.
--
-- ── BATCHED BY SUBSYSTEM, which is also the T1 ownership split ──────────────
-- These six are what T1-DECKS, T1-PEOPLE and T1-REPORTS scope. Keeping the
-- batch aligned with the session that has to use it means a session reads one
-- migration, not three.
--
-- `audit_log` is here rather than with configuration for a reason worth stating:
-- it is `edition`-scoped (`0030:22`), and the three pricing `recordAudit` calls
-- (`pricing.ts:518,614,645`) are a PLATFORM owner's edits landing in whichever
-- edition that operator's session happens to carry. Stage 0 accepted that and
-- said it "resolves for free at Stage 4". This is that slot: the column exists
-- from here, and T1-REPORTS binds it.
--
-- No index is touched here. All thirteen `edition`-leading indexes on these
-- tables are re-cut together in 0099, because an index pass split across four
-- migrations is a pass nobody can review.

ALTER TABLE decks                    ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 't_default';
ALTER TABLE messages                 ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 't_default';
ALTER TABLE notifications            ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 't_default';
ALTER TABLE notification_preferences ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 't_default';
ALTER TABLE audit_log                ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 't_default';
ALTER TABLE tickets                  ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 't_default';
