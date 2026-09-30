# F-FOUL — the deck-file precondition. Handoff.

Closes Sep-2026 client feedback rows **8** and **12**. Branch `screening/F-FOUL`,
worktree `../sj-F-FOUL`, cut from `main` at `1579eb1` (after the pre-wave ceiling
commit). Migration slot **0081**, used.

Gate, measured on this branch:

| | baseline (`main`) | this branch |
|---|---|---|
| `npm test` | 2540 passed, 1 failed, 1 skipped | **2556 passed, 0 failed, 1 skipped** |
| `npm run typecheck` | pass | pass |
| `npm run lint` | pass | pass |
| `npm run build` | pass | pass |

The baseline failure is **not** mine and **not** the guard: `test/worker/billing.test.ts:391`
asserts a serialised row does not contain `"123"`, and it had drawn the payment id
`pi_6123e5ca-…`. It passed on the next run. A latent random-UUID flake in a file
no screening session owns — see *Findings to escalate* below.

`npm run parity:nav` (ok, 72 known gaps — unchanged) and `npm run parity:tokens`
(27/27) also pass. Both need the split prototypes in place first:
`python3 docs/prototype/tools/split-prototypes.py`. Without it they die with
`ENOENT` on `$TMPDIR/sj-prototype-split/...`, which looks like a failure and is
not one — macOS clears that directory.

`npm run test:e2e`, `playwright` and `npm run roles` were **not** run, per the prompt.

---

## 1. What the client saw, and what was actually wrong

Verified against a fresh local D1, not inferred:

* **34** seeded decks, **all** with `r2_key` NULL. **648** `scores` rows and **80**
  `evaluations` rows across **30** of them. `deck_versions` held **0** rows.
* The 30 decks carrying evaluation data and the 30 needing a file are **the same
  set** — the four with no evaluation data are exactly the four that must stay
  fileless. Nothing had to be judged.
* **Zero** orphaned rows, structurally: both FKs are `ON DELETE CASCADE`. Row 8's
  literal reading is impossible while FKs are on. Not re-audited.
* `INSERT INTO decks` still has exactly **one** call site (`storeDeck`,
  `routes/decks.ts:1490`) and it writes the R2 object **before** the row. **No API
  path creates a fileless deck.** Do not tell the client otherwise; §4.5 has the
  wording.

So the defect was the missing question, and it is now asked in four places.

## 2. The guard

| Path | Check | Where |
|---|---|---|
| `POST /api/decks/:id/assign` | column + `DECKS.head()` | `routes/pipeline.ts` |
| `POST /api/decks/:id/transition`, action-keyed | column + `head()` | `routes/pipeline.ts` |
| `POST /api/assignments` (bulk) | **column only** | `routes/assignments.ts` |
| `POST /api/decks/:id/evaluate` | column + `head()` | `routes/pipeline.ts` |

All four demonstrated over HTTP against a real `e2e:serve` dev server, both
branches (`no_key` and `no_object`), plus the happy path streaming 6891 bytes of
`application/pdf`. Refusals reuse **`no_pdf`** with a `reason` and a `message`;
`ApiError` already prefers `body.message`, so no client file changed.

The asymmetry on the bulk path is deliberate (`MAX_DECKS` is 100; 100 sequential
`head()`s per confirmation) and is pinned by a test that asserts a dangling-key
deck **passes** bulk assign and is then refused at evaluate. Do not "tidy" the
two functions into one — `src/server/decks/deckFile.ts` says why, twice.

## 3. Production is still unreadable — and §4.3's diagnosis is wrong

```
npx wrangler d1 execute startup-jury-db --remote --json --command "SELECT ..."
→ 7403: The given account is not valid or is not authorized to access this service
```

§4.3 attributes this to a token with **no D1 scope**. That is no longer true:
`wrangler whoami` now lists **`d1 (write)`**, and the query still fails. The only
scope Wrangler reports missing is `challenge-widgets.write`, which is unrelated.
So this is an **account authorization** problem, not a scope problem, and
`wrangler login` may well not fix it. Whoever picks this up should expect to check
which account owns database `6353d3a9-e2f0-459a-9acc-411373197232` against
account `74223469d1ec184c084925a8d120d93b`.

No write was attempted and no other credential was tried. The three SELECTs, for
the user to run once production is readable:

```sql
SELECT COUNT(*) total, SUM(r2_key IS NULL) no_file FROM decks;
SELECT status, COUNT(*) n FROM decks WHERE r2_key IS NULL GROUP BY status ORDER BY n DESC;
SELECT COUNT(DISTINCT e.deck_id) evaluated_no_file
  FROM evaluations e JOIN decks d ON d.id = e.deck_id WHERE d.r2_key IS NULL;
```

Locally the third one now answers **0**. It answered 30 before this branch.

**Deploy order is not optional** (and §7.8 step 4 already says so): apply `0081`
remotely, **then** `npm run seed:deck-assets:remote`. In between, those 30 rows
have keys with nothing behind them — which is the one state worse than NULL,
because a column-only check starts passing. The bulk assign path is column-only,
so that window is real, not theoretical.

## 4. What the integration session must look at first

### The one e2e change, as a patch
`docs/parity-requests/f-foul.patch` — `e2e/evaluate-workbench.spec.ts:41`.
`git apply --check` passes as of this commit.

That line asserts `"No PDF stored for this deck"` for `inc_deck_taxpilot`, which
now **has** a PDF. **That is the seed fix working and the spec's premise expiring —
rewrite the spec, do not revert the seed** (§7.8 step 2 predicted exactly this).
The patch asserts the viewer's `Open PDF` link instead, which is present in both
the `ready` and `error` states, so a pdf.js hiccup in CI cannot turn into a
failure about deck files. The empty state is still covered by the four fixtures
that keep it.

### `e2e/assign.spec.ts` should go GREEN, and that is the point
`:27` and `:75` assign `inc_deck_greengrid` by name. It is one of the 30, so it now
has a file and the guard passes. **This is the spec that would have gone red had
the guard landed without the seed fix.** If it *is* red, the asset bootstrap did
not run — check that `e2e:serve` reached `npm run seed:deck-assets` before `vite`.

### The other e2e specs naming a now-filed seed deck
Run in this order; none is expected to move, all four read a filed deck:
`e2e/evaluate-stage-report.spec.ts` · `e2e/scoring-framework.spec.ts` ·
`e2e/agreements.spec.ts` · `e2e/signup-config.spec.ts`.

Twenty-five test/e2e files name one of the twelve incubator seed decks that now
have files. The nineteen under `test/` are green on this branch, so they need no
attention; the six under `e2e/` are the list above plus the two named already.

## 5. Where I went outside the plan, and why

1. **The key is `decks/<id>.pdf`, not `decks/<id>_v1.pdf`.** §7.1 says both
   "`decks/<id>_v1.pdf`" and "MATCH `versionKey` at routes/decks.ts:1473 exactly",
   and those two instructions contradict each other: `versionKey` is
   `version <= 1 ? "decks/${id}.pdf" : ...` (`decks/versions.ts:49`), so version 1
   takes **no suffix**. I followed `versionKey`, which is the instruction that
   matters — a `_v1` key would not be the key the product itself writes, and
   `storeDeck` would collide with it on a re-upload.

2. **`0081` also backfills `deck_versions`**, 30 rows, which the plan does not
   mention. `0016_automation.sql:55-60` states its own intent — one v1 row per
   deck "that already has a stored PDF, so the history view is never empty for a
   deck that has one" — and inserted **zero** rows because every seeded `r2_key`
   was NULL. Giving the decks a file without the history row would leave the
   Versions view empty for a deck that visibly shows a PDF, and a re-upload
   computing its next version off nothing.

3. **Six `test/worker/` files I do not own.** The guard reddened 12 tests across
   six files (`assignments`, `audit`, `evaluate-w7d`, `notifications`,
   `schema-w1b`, `vc-pipeline`), every one of them a fixture that named an
   `r2_key` with no object behind it — the exact state the client called a Foul,
   in test-land. **None of the seven files I touched is claimed by any live plan**
   — checked by name against `plan_screening.md`, `plan_multitenancy.md`,
   `plan_myaccount.md` and `plan_roles_incubator.md`; the only plans that mention
   them are `plan_parity.md` and `plan_v3_superuser.md`, both shipped. So there is
   no collision. The edits are one or two lines each (`audit.test.ts` itself
   needed none — the setup-file fix below covers it):
   * `apply-migrations.ts` — the shared worker setup now puts an object behind
     every key `0081` wrote. **This is the important one**: the pool's D1 is
     isolated, so `0081` runs there but `seed-deck-assets.mjs` cannot reach it,
     and without this the two halves of the seed fix come apart *only* in the
     test suite. It reads the keys back off the rows the migration just wrote, so
     it cannot drift from `0081`.
   * `assignments.test.ts`, `vc-pipeline.test.ts`, `evaluate-w7d.test.ts`,
     `notifications.test.ts` — their own `seedDeck` helpers now store an object.
   * `schema-w1b.test.ts` — see *Findings to escalate*.

4. **`migrations/0020_seed_demo_refresh.sql` is modified.** §7.1 asks for this
   (amend the pitchloop note at `:604`). It is **comment-only** — verified: every
   changed line begins `--`. Safe because Wrangler's applied-migrations table keys
   on filename and stores no checksum, so the file cannot re-run either way.

5. **The two-lists-agree check lives in the script, not the test.** The plan's
   shape was a test comparing `0081`'s id list with the script's. The worker
   project runs inside workerd with no filesystem, and `?raw` cannot be typed for
   it without `/// <reference types="vite/client" />`, whose ambient
   `ImportMetaEnv` collides with `src/server/security.ts:38` across the whole
   worker program (measured — two TS errors). So
   `scripts/seed-deck-assets.mjs` parses `0081`'s id list itself and **exits
   non-zero on any difference**, in both directions, on every run including
   inside `e2e:serve`. Proven to fire by deleting one id from the migration. This
   is strictly stronger than the test would have been, because the script is the
   process that would otherwise silently upload the wrong set. The worker test
   pins the resulting database state instead.

## 6. Findings to escalate — neither is mine to fix

1. **No deck the product creates can be deleted.**
   `deck_versions.deck_id` is `TEXT NOT NULL REFERENCES decks (id)` with **no
   `ON DELETE` clause** (`0016_automation.sql:41`), while its siblings use
   `CASCADE` or `SET NULL`. `storeDeck` writes a `deck_versions` row in the same
   batch as the deck, so `DELETE FROM decks WHERE id = …` has failed with
   `FOREIGN KEY constraint failed` for every real deck since 0016 shipped.
   `test/worker/schema-w1b.test.ts:420` passed only because the **seeded** decks
   uniquely had no file and therefore no version row — `0081` removes that
   accident, which is how this surfaced. I cleared the version rows in the test
   (its subject is `credit_ledger.deck_id ON DELETE SET NULL`, not deck
   deletability) rather than weaken the assertion. The schema is the real bug and
   it wants a migration nobody in this wave owns.

2. **`test/worker/billing.test.ts:391` is a random-UUID flake.** It asserts a
   serialised `billing_payments` row does not contain the literal `"123"` to prove
   no CVV leaked, but the row carries `id = pi_<uuid>`, and a hex UUID contains
   `123` often. It failed on the baseline run and passed on the next two. The
   assertion needs to exclude the id column, not the whole row.

## 7. Commands

```bash
# local, from a clean slate — this is what e2e:serve now does
rm -rf .wrangler/state && npm run db:migrate:local && npm run seed:deck-assets

# after a deploy, IN THIS ORDER
npx wrangler d1 migrations apply startup-jury-db --remote
npm run seed:deck-assets:remote
```
