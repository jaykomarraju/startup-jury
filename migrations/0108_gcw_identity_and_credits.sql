-- 0108 — the pilot customer's workspace stops reading as somebody else's, and
-- stops being able to run out of evaluations mid-demo.
--
-- Two data facts, not a schema change. They are a MIGRATION rather than a console
-- click or a `wrangler d1 execute --remote` for one reason: both have to be true in
-- production before the customer's administrator is first walked through the
-- product, and a migration is the only path to production D1 that is reviewed,
-- re-runnable, recorded in `d1_migrations`, and applied by the same command that
-- ships the code. `0102` set the precedent for a data-only migration in this repo
-- and its header explains why an assertion belongs with it.
--
-- ── 1. THE WORKSPACE IS NAMED AFTER A DIFFERENT REAL COMPANY ────────────────
--
-- `0020_seed_demo_refresh.sql:732` wrote
--   branding_json = '{"orgName":"Anthill Ventures Incubator", …}'   (incubator)
--   branding_json = '{"orgName":"Anthill Capital", …}'              (vc)
-- as demo dressing, and `scripts/clear-deck-data.sql:16` lists `org_settings` under
-- "WHAT IS DELIBERATELY NOT TOUCHED", so the 30-Sep production clear-down left both
-- in place. Anthill Ventures is a live Hyderabad accelerator. It is not us and it is
-- not the customer.
--
-- That string is not decoration. Measured readers:
--   · `src/client/routes/AccountPage.tsx:73-86`   — the "Workspace" row
--   · `src/server/billing/invoice.ts:478-485`     — `buyerName` on EVERY invoice
--   · `src/server/email/outbox.ts:627`, `:564`    — the invite and founder emails
--   · `src/server/resubmit.ts:249`                — `orgNameInScope`
--
-- `json_set` rather than a rewrite of the blob: `branding_json` also carries
-- `orgType` and `accent`, and replacing the document would silently drop whatever
-- the customer has configured. Both editions move. The VC workspace is out of scope
-- per the 2026-10-01 decision, but out of scope means "do not build on it", not
-- "leave another company's name in it" — and `e2e/vc-intake.spec.ts`, the tripwire
-- for that decision, asserts nothing about this string (grepped: the only
-- "Anthill" left in the tree is a fixture literal inside
-- `test/worker/outbox.test.ts`, which builds its own branding and never reads this
-- row).
--
-- `organizations.name` moved separately, in `0106`. The two are different things
-- and `0083:98-99` says so: `organizations.name` is what the PLATFORM calls this
-- customer, `branding_json.orgName` is what the CUSTOMER calls themselves and is
-- the one that reaches their screens and their invoices.
--
-- ── 2. THE BALANCE IS ZERO, AND ONE UPLOAD IS ONE CREDIT ────────────────────
--
-- Measured against production: `GET /api/config/summary` returned
-- `creditsBalance: 0` for (t_default, incubator). `routes/decks.ts:2393` reserves a
-- credit BEFORE the file is stored or the model is reached, so at zero every upload
-- is `402 no_credits` and the client refuses before it even sends
-- (`UploadPage.tsx:325`). The customer is about to populate this workspace with
-- decks; a zero balance blocks that on the first one.
--
-- Note a local database disagrees and will mislead anyone checking there:
-- `0007_config_plans_credits.sql:12` is an UNSCOPED `UPDATE org_settings SET
-- credits_balance = 50`, so a freshly migrated local D1 reads 50. Production's 0 is
-- the number that matters.
--
-- 2500 is chosen, not inferred, and the number matters in a way the first draft of
-- this file got wrong. `routes/config.ts` caps the balance at `MAX_CREDIT_BALANCE`
-- (5000, now in `src/shared/plans.ts`), and that cap is on the BALANCE because the
-- console's control SETS a value rather than adding one. Seeding the balance AT the
-- cap therefore makes the Plan & credits field unusable: the administrator's next
-- Save is `400 credits_above_max`, which is a credit constraint invented by the very
-- migration meant to remove one — and it would land on the screen they are walked
-- through on the onboarding call. Measured: `test/worker/audit.test.ts:181` tops up
-- by +25 and started failing the moment the seed was 5000.
--
-- So: 2500. Roughly a hundred times the pilot's 23 decks, and it leaves an equal
-- amount of headroom so the console still works. A credit costs nothing until an
-- evaluation spends it. `GREATEST` does not exist in SQLite, so the `WHERE` clause
-- does the work: a workspace already above 2500 is left alone rather than quietly
-- cut down.

-- 1. The customer's own name, on both of their workspaces.
UPDATE org_settings
   SET branding_json = json_set(COALESCE(branding_json, '{}'), '$.orgName', 'Global Carbon Warriors')
 WHERE tenant_id = 't_default';

-- 2. Enough evaluations that the pilot cannot run dry.
--
--    THE LEDGER MOVES FIRST, and it has to: `src/server/billing/ledger.ts:7` states
--    the invariant this file would otherwise break — "`org_settings.credits_balance`
--    is the authority; the ledger explains it" — and
--    `test/worker/schema-w1b.test.ts:378` holds the tree to it with
--    `SUM(credit_ledger.delta) = credits_balance`, per edition. A balance moved with
--    no movement behind it is precisely the books-vs-gate disagreement that
--    `routes/config.ts`'s silent-write bug produced, and shipping it from a
--    migration would be worse: nothing would be left to explain where 5000 credits
--    came from.
--
--    `reason = 'adjustment'` is the CHECK-permitted value for an operator grant
--    that is not a purchase and carries no money (`amount_minor` stays NULL — §8 Q1,
--    ruled 2026-09-11: there is no per-deck rate, and this is not a sale).
--    `actor_id` is NULL because no user did this; the migration did, and the
--    `reference` says so, so the row is self-explaining in the Credits & billing
--    usage history the customer can actually read.
INSERT INTO credit_ledger (id, tenant_id, edition, delta, reason, amount_minor, currency, reference, note, actor_id)
SELECT 'cl_0108_' || o.edition,
       o.tenant_id,
       o.edition,
       2500 - o.credits_balance,
       'adjustment',
       NULL,
       NULL,
       'migration:0108',
       'Pilot grant — Global Carbon Warriors',
       NULL
  FROM org_settings o
 WHERE o.tenant_id = 't_default'
   AND o.credits_balance < 2500
ON CONFLICT (id) DO NOTHING;

--    …and only then the balance it explains.
UPDATE org_settings
   SET credits_balance = 2500
 WHERE tenant_id = 't_default'
   AND credits_balance < 2500;

-- 3. Both took. Asserted rather than assumed: a `WHERE` that matches nothing looks
--    exactly like success, and this file IS the two statements above.
INSERT INTO _tenancy_assert (id, verdict)
SELECT '0108.gcw_workspace_named',
       CASE WHEN (SELECT count(*) FROM org_settings
                   WHERE tenant_id = 't_default'
                     AND json_extract(branding_json, '$.orgName') <> 'Global Carbon Warriors') = 0
            THEN 'ok'
            ELSE 'FAIL: ' || (SELECT count(*) FROM org_settings
                               WHERE tenant_id = 't_default'
                                 AND json_extract(branding_json, '$.orgName') <> 'Global Carbon Warriors')
              || ' workspace(s) still carry another name' END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');

-- 4. And the ledger still explains the balance. This is the assertion that would
--    have caught the first draft of this file, which moved the balance alone.
INSERT INTO _tenancy_assert (id, verdict)
SELECT '0108.ledger_still_explains_the_balance',
       CASE WHEN (SELECT count(*) FROM org_settings o
                   WHERE o.credits_balance <> (SELECT COALESCE(SUM(l.delta), 0) FROM credit_ledger l
                                                WHERE l.tenant_id = o.tenant_id AND l.edition = o.edition)) = 0
            THEN 'ok'
            ELSE 'FAIL: ' || (SELECT count(*) FROM org_settings o
                               WHERE o.credits_balance <> (SELECT COALESCE(SUM(l.delta), 0) FROM credit_ledger l
                                                            WHERE l.tenant_id = o.tenant_id AND l.edition = o.edition))
              || ' workspace(s) have a balance the ledger does not account for' END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');

INSERT INTO _tenancy_assert (id, verdict)
SELECT '0108.gcw_has_credits',
       CASE WHEN (SELECT COALESCE(min(credits_balance), -1) FROM org_settings
                   WHERE tenant_id = 't_default') >= 2500
            THEN 'ok'
            ELSE 'FAIL: lowest balance is ' || (SELECT COALESCE(min(credits_balance), -1)
                                                  FROM org_settings WHERE tenant_id = 't_default') END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');
