-- 0107 — out of office, with delegation.
--
-- **The client, 2026-10-05** (lane brief §6): "a user sets an OOO window and
-- names a delegate; their pending evaluation assignments surface to the delegate
-- for the window. Keep it minimal and real — do not build a calendar."
--
-- Three columns and one partial index. That is the whole change.
--
-- ══ WHY COLUMNS ON `users` AND NOT A TABLE ═════════════════════════════════
--
-- A `user_out_of_office` table is the instinctive shape and it is the wrong one
-- here, for four reasons, the first of which is decisive and was measured:
--
--   1. **A new tenant-keyed table has a registry, and the registry is not this
--      lane's file.** `src/shared/tenant.ts`'s `TENANT_KEYED_TABLES` is iterated
--      by `test/worker/tenant-scope.test.ts:919`, which asserts its fixture map
--      equals that list EXACTLY. A table carrying `tenant_id` that is absent
--      from the list reddens that suite; a table in the list with no fixture
--      reddens it too. Both files belong to other lanes, so a new keyed table
--      could only land here broken.
--   2. The relationship is 1:0..1 and the row already exists. An absence is a
--      property of a person, like `evaluation_capacity` (`0058`) and
--      `must_change_password` (`0044`), both of which are columns on this table
--      for the same reason.
--   3. `users` is already tenant-keyed — `UNIQUE (tenant_id, email)` since
--      `0087` — already soft-deleted, and already read in one place by
--      `ROSTER_COLUMNS` (`routes/users.ts:93`). So the console's "out until the
--      12th" indicator costs no join and no second query, and every read of it
--      inherits a scope that is applied once.
--   4. There is no history to keep. The lane brief forbids recurrence, and an
--      audit row is written on every set and clear (`team` /
--      `out_of_office_set`), so the trail lives where the other team events do
--      rather than in a table of superseded windows nobody reads.
--
-- ══ WHY DATES AND NOT TIMESTAMPS ═══════════════════════════════════════════
--
-- `YYYY-MM-DD`, inclusive at both ends, because that is what a person means by
-- "out Monday to Friday". ISO dates compare lexicographically, so
-- `date('now') BETWEEN out_of_office_from AND out_of_office_to` is the entire
-- test — and `isOutOn()` in `src/shared/outOfOffice.ts` is the same comparison
-- in TypeScript rather than a second implementation of it.
--
-- UTC, deliberately. A per-user timezone would be a second source of truth of
-- exactly the class this repo keeps paying for (four low-credit thresholds; an
-- AI gate threshold that was configured, saved and then ignored). The cost of
-- the simple answer is that cover can begin or end a few hours early.
--
-- ══ THE TWO GUARDS, AND WHAT EACH ONE DOES NOT COVER ═══════════════════════
--
-- `REFERENCES users (id) ON DELETE SET NULL` is declared and is NOT the answer,
-- and saying so is the point: this product SOFT-deletes users
-- (`routes/users.ts` stamps `deleted_at`, clears `active` and renames the
-- address), so the foreign key will essentially never fire. It is declared
-- because a dangling id is still wrong and a hard delete should not leave one.
-- The guard that actually holds is on the READ side: both
-- `delegatedAssigneePairsSql()` and the coverage read in `routes/users.ts` join
-- the delegate's own row and require `active = 1`, `deleted_at IS NULL` and the
-- same `(tenant_id, edition)` as the absentee — so deactivating a delegate ends
-- their cover on the next request, without a sweep and without a cron job.
--
-- `CHECK (out_of_office_delegate IS NULL OR out_of_office_delegate <> id)`
-- refuses self-delegation in the schema as well as in the route. Measured on
-- SQLite 3.51 before it was written here: `ALTER TABLE ... ADD COLUMN` accepts a
-- CHECK that references another column of the same row, and the constraint does
-- fire — `UPDATE users SET out_of_office_delegate = 'u1' WHERE id = 'u1'`
-- returned `CHECK constraint failed`. It is not decorative: "delegate to
-- yourself" would otherwise put a deck in your own queue twice through the
-- UNION arm, with no error anywhere.
--
-- Three nullable columns and no NOT NULL, so SQLite needs no DEFAULT and nothing
-- is written to any existing row. Production holds GCW's real team; after this
-- applies, every one of them is simply not out of office.
--
-- ══ THE INDEX ══════════════════════════════════════════════════════════════
--
-- `idx_users_ooo_delegate` is PARTIAL — `WHERE out_of_office_delegate IS NOT
-- NULL`. The only query that filters on this column is "whose work am I
-- covering?", which runs on every load of My account, and on a roster where
-- almost nobody is out at any moment the full index would be a table-length list
-- of NULLs. (It is an ordinary index, not UNIQUE, so the partial-index-with-
-- `ON CONFLICT` trap recorded against `0099` does not apply: nothing upserts
-- through this key.)

ALTER TABLE users ADD COLUMN out_of_office_from TEXT;
ALTER TABLE users ADD COLUMN out_of_office_to TEXT;
ALTER TABLE users ADD COLUMN out_of_office_delegate TEXT
  REFERENCES users (id) ON DELETE SET NULL
  CHECK (out_of_office_delegate IS NULL OR out_of_office_delegate <> id);

CREATE INDEX IF NOT EXISTS idx_users_ooo_delegate
  ON users (out_of_office_delegate)
  WHERE out_of_office_delegate IS NOT NULL;

-- ══ ASSERTIONS ═════════════════════════════════════════════════════════════
--
-- `_tenancy_assert` (`0088:39`) admits only the verdict 'ok', so a failing
-- assertion fails the migration and the chain stops with the reason in the error
-- text. `ON CONFLICT DO UPDATE` rather than `DO NOTHING`, so a re-apply
-- re-checks instead of skipping.

-- 1. All three columns landed. A partially-applied ALTER sequence is the one way
--    this file can leave the table in a shape the roster's single column list
--    (`ROSTER_COLUMNS`) cannot read, and the symptom would be every admin
--    console screen 500-ing at once.
INSERT INTO _tenancy_assert (id, verdict)
SELECT '0107.out_of_office_columns_exist',
       CASE WHEN (SELECT count(*) FROM pragma_table_info('users')
                   WHERE name IN ('out_of_office_from', 'out_of_office_to',
                                  'out_of_office_delegate')) = 3
            THEN 'ok'
            ELSE 'FAIL 0107: users is missing one of the three out-of-office columns ('
              || (SELECT count(*) FROM pragma_table_info('users')
                   WHERE name IN ('out_of_office_from', 'out_of_office_to',
                                  'out_of_office_delegate'))
              || ' of 3 present)' END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');

-- 2. Nobody delegates to themselves, and nobody delegates across a workspace
--    boundary. Trivially true on the day this applies — nothing is set yet — and
--    that is exactly why it is worth writing: a re-apply of the chain against a
--    database that has been RUNNING this feature re-checks the invariant the
--    UNION arm's correctness rests on. A cross-workspace delegate would hand one
--    customer's decks to another customer's user.
INSERT INTO _tenancy_assert (id, verdict)
SELECT '0107.no_self_or_cross_workspace_delegate',
       CASE WHEN (SELECT count(*) FROM users a
                   LEFT JOIN users d ON d.id = a.out_of_office_delegate
                  WHERE a.out_of_office_delegate IS NOT NULL
                    AND (a.out_of_office_delegate = a.id
                         OR d.id IS NULL
                         OR d.tenant_id <> a.tenant_id
                         OR d.edition <> a.edition)) = 0
            THEN 'ok'
            ELSE 'FAIL 0107: '
              || (SELECT count(*) FROM users a
                   LEFT JOIN users d ON d.id = a.out_of_office_delegate
                  WHERE a.out_of_office_delegate IS NOT NULL
                    AND (a.out_of_office_delegate = a.id
                         OR d.id IS NULL
                         OR d.tenant_id <> a.tenant_id
                         OR d.edition <> a.edition))
              || ' user(s) name a delegate that is themselves, missing, or in another workspace' END
ON CONFLICT (id) DO UPDATE SET verdict = excluded.verdict, at = datetime('now');
