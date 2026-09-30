# The screening-logic wave — plan and session prompts

**Scoped 2026-09-30** from the client's 24-Sep feedback (16 numbered rows) and his
"Deck Screening Logic: Status & Action Flow" v1.0, whose §4 flow diagram is transcribed separately
at `docs/spec_screening_flow.md` — that file records the two places the diagram and his own §5
table contradict each other, and is required reading for every session below.

Six agents: the state machine, what it invalidates, the button matrix, the two "fouls", the
collisions against the other two planned waves, and a synthesis.

**Read §2 before anything else.** His three lists — the 11-row matrix, the 6-word status list in
row 6, and the 3-entry final-status map — do not agree with one another. Fourteen conflicts are
catalogued there with the reading we ship and why. Choosing silently would have been the expensive
mistake.

---

# The screening-logic wave: plan and session prompts

*Written 2026-09-30 against `main` @ `a6bd5b6`, clean tree. Scoping only — nothing under `src/`, `test/`, `e2e/`, `migrations/` was touched. Every claim below is either a file:line I opened in this session or a figure carried from one of the five scoping reports with its citation kept.*

---

## 1. What he is actually asking for

The 24-Sep document is not a punch list. It is a **redesign of the deck-screening logic**, and it replaces work we shipped nine days earlier. On 21-Sep we built a Status pill whose value is a pure function of two database columns — deck-complete and contact-complete — producing four words, and two handoff buttons ("Send to Query", "Send to Assign") that are *navigation*: they move the operator to another screen and write nothing down. His spec needs something categorically different: a status that depends on **what was done to the deck and in what order**. "Incomplete contact details" and "Incomplete contact details, Edited" have identical columns; only the history distinguishes them. That is an action-history state machine, not a derivation over two fields, and it cannot be reached by renaming strings.

**How much of 21-Sep survives: about 40% overall, and effectively all of it is below the surface.** The plumbing was right and is now load-bearing rather than optional. Migration `0075` and the `decks.ai_complete` column — which separated the AI's verdict from the intake checklist — are what make his check (1) answerable at all; before that migration the product could not distinguish "the deck is thin" from "we lack a phone number". The upward-only re-derive on `PATCH /api/decks/:id`, the real `edit_contact` pipeline event behind `contact_edited_at`, archive-as-a-state (23-Sep), and the decision to keep the Assigned tile all survive whole, and three of them his spec now *requires*. Above that line — the four Status words, the two enablement predicates, the three additive chips, the automatic Assign/Query partition, and the premise that Send-to-X is navigation — **closer to 15% survives**. The single largest item, `v3SendToQuery`, is currently pinned by tests (`test/client/allDecks.test.tsx:1100-1124`) to do the exact opposite of what his feedback row 4 requires: on a deck with a missing founder email it asserts Send to Query **enabled**. He wants it disabled. The comment block written on 23-Sep to stop that regression coming back now documents his requirement as a regression.

Do not read 40% as cheap. The discarded 60% is the part he looks at, and its replacement is structurally harder than what it replaces. Two of his asks have **no data source at all**: there is no AI screening threshold anywhere in the product (`reject_ai_gate` is labelled "Reject (below AI gate)" at `src/pipeline/incubator.ts:85` and compares nothing), and "Move to Dashboard" returns zero hits across `src/`, `test/`, `e2e/` and `docs/*.md` — I grepped it in this session and it is new on 24-Sep. His two "Foul" reports (rows 8 and 12) are real, but not in the way he thinks: nothing a user can do creates a startup without a deck — `grep -rn 'INSERT INTO decks' src/server` has exactly one hit, `storeDeck`, which writes the R2 object before the row — what he saw is 34 demo fixtures with `r2_key` NULL, 30 of them carrying full score sets, and what is genuinely missing is a **guard**: no code path anywhere asks whether a deck has a file before assigning it or letting a juror score it. And finally, the payment checklist he attached **reverses an instruction he gave us on 24-Sep**; that reversal is a saving, not a cost, and §5 sets it out.

**This is more than one wave.** Screening alone is three sequential waves (two parallel foundation sessions, then five parallel build sessions, then integration), roughly 2.5–3 weeks of session time. It is still the *shortest* of the three bodies of work in flight, and it is upstream of both others.

---

## 2. The inconsistencies in his own spec — and the reading we ship

His three lists do not agree with each other: the matrix produces 11 intermediate states and 3 sinks, his numbered row 6 gives 6 status words, and his FINAL STATUSES map names 3. Fourteen conflicts, deduplicated from the two scoping passes. For each: the reading we build, and why.

| # | The conflict | What we ship | Why |
|---|---|---|---|
| C1 | **One sink, two names.** Row 6 says `Complete, Assigned`; the matrix *and* the FINAL STATUSES map both say `AI Evaluated, Assigned`. | **`AI Evaluated, Assigned`** everywhere, one string. | Two of his three lists agree on it, and it is the one that appears in the authoritative stat-box map. Row 6's variant is treated as informal shorthand. |
| C2 | **Row 6 is not closed under his own matrix.** Six options; the matrix yields ten-plus distinct pills and three sinks. Row 6 has no word for *Both incomplete*, *Below threshold*, *Rejected* — or ***Archived***, which his own final-status list names as a sink and which is the terminal action of four matrix rows. | **Row 6 = the sort/filter dropdown's option list. The matrix = the displayed pill set.** The pill set gets `Archived`, `Below threshold` and `Rejected` in addition to his six. | This is the only reading under which both lists can be true. A filter list may be coarser than a display value; it may not omit the value a row actually shows. |
| C3 | **Row 6 deletes "Not AI Evaluated", which is a tile as well as a word.** `inc_deck_pitchloop` sits at `pending_ai` in that tile today and would have no status. | Keep the tile; give it a seventh pill, **"Awaiting AI evaluation"**. | A populated stat box whose rows have nothing to say is worse than an extra word. Flagged to him as Q3. |
| C4 | **I2 (`Incomplete deck`) is unclassifiable.** Active = Edit. Disabled = Send to Assign, Archive. **Send to Query is in neither column** — yet I2's own `next` column fires it. Row 5 then says Send to Query becomes active "*if status is Incomplete deck*" but only *once contact details are edited*, and at I2 the contact is already complete, so the enabling event can never occur. | **Send to Query is ACTIVE at I2.** Row 5's precondition is read as describing the post-edit path, not the only path. | His own stated reason for row 3 is *"a deck with incomplete contact details cannot be emailed"*. At I2 the contact is complete, so it can be. The alternative leaves I2 with no exit but Edit-to-nowhere. This is the largest hole in the document and cannot be closed by reading harder — Q4. |
| C5 | **Archive forbidden on the subset, allowed on the superset.** I2 (¬D ∧ C) disables Archive "as incomplete"; I3 (¬D ∧ ¬C) enables it. I3 is strictly worse. | **Archive active on both**, and on every state. | A strictly worse deck cannot gain a capability. Archive-as-a-state (23-Sep) already assumes any deck can be set aside and stay visible. |
| C6 | **"Active: Reject. Disabled: all except Archive."** Self-cancelling at I4, and the same shape at I9 and I10. | **Whitelist-only.** Exactly the named active actions are enabled; everything else is disabled with its remark. "all except Archive" is a drafting artefact — except that, per C5, Archive stays enabled. | A whitelist is the only mechanism that makes his matrix a specification. `v3ActionCell` is a blacklist today (`deck.actions` minus two, plus two guarded navigations), which is why every row of his matrix shows "extra active options" against the build. That is one defect, not eleven. |
| C7 | **The latch forecloses his own open item.** Row 7: no button active once Send to Query / Send to Assign / Archive has fired. `Incomplete, Queried` is reached *by* Send to Query. His open item then requires archiving exactly those decks. | The latch binds the **operator UI**. The **cron sweep is exempt**, and one action — **"Archive (no response)"** — re-arms on a queried deck past the 5-working-day window. | Row 7 and the open item cannot both hold literally. This is the narrowest exception that satisfies both. |
| C8 | **I6 (`Complete`) offers only Send to Assign** — no Edit, no Archive. A typo in a complete deck's contact details is uncorrectable, and a complete deck cannot be set aside, while every failing state can. | **Edit and Archive stay active on Complete.** | Almost certainly an omission, not a decision. Q8. |
| C9 | **The word "Dashboard" names two screens.** The display rule: *"a copy on the Dashboard; the ORIGINAL stays on the uploaded status screen."* Row 10: *"Move to Dashboard (meaning the Uploaded screen)."* And `src/shared/nav.ts:96-107` titles the `alldecks` screen "Dashboard" for superuser/admin/PM/PA. | **The uploaded status screen is `alldecks`.** "The Dashboard" in the display rule means the **destination workflow screen** (Query or Assign). | The stat boxes decide it: they live on `alldecks`, and his final statuses are "counted in the matching stat box". Q9 — if he means the reverse, a genuine second row, the only existing mechanism is `decks.related_deck_id` (`0016_automation.sql:36`) and every aggregate consequence below returns. |
| C10 | **"A COPY of the deck… the ORIGINAL stays."** | **"Copy" means membership in two views, not a second row.** | *"Counted in the matching stat box"*, singular — a duplicate row would be counted twice in Uploaded, his own denominator, and move every percentage in the rail. And he asks for no second identity, no second status. He is denying a *move*, not requesting a duplicate. `matchesV3Stat(d,"all")` already returns true for every deck including archived (`src/shared/deckStats.ts:584-586`), so "ALL decks, including archived, always remain" already holds end-to-end; there is no server-side exclusion either (`grep archived src/server/routes/decks.ts` hits only the `exit_*` subqueries). What changes is the **Incomplete tile predicate**, so a queried deck counts there. |
| C11 | **Row 3 vs the automatic partition.** `deckListRoute` (`src/shared/queries.ts:484-500`) answers *at most one of* Assign / Query from `(stage, complete, missing_fields, queried)`, and `src/server/routes/decks.ts:528-531` applies it as a post-filter on `GET /api/decks?list=`. Stage `incomplete` ⇒ `"query"` with no click. | **Ship row 3.** Query membership becomes a **recorded action**; the Assign arm survives unchanged. | His stated reason names a live defect (§4). `deckListRoute`'s own header says *"one function, one answer per deck, so 'on both screens' is not a state it can express"* — and his display rule requires exactly that state. |
| C12 | **"The threshold" — which of three?** The hardcoded `GATE = 5` (`src/server/ai/evaluate.ts:27`, verified); the org-wide `shortlist_threshold` (`org_scoring_settings`, `migrations/0026:40`, default 7.0); the cohort buckets `threshold_best`/`threshold_mediocre` (`migrations/0001_init.sql:24-25`). | **The AI gate.** Promote `GATE` from a constant to `org_scoring_settings.ai_gate_threshold`, default 5.0. | His matrix's threshold gates screening, which is what the gate does. `routes/decks.ts:95-100` already records a past confusion between two of the three; making his the named one prevents a fourth. |
| C13 | **"At or above the threshold" vs `total > GATE`** (`evaluate.ts:488`, comment at `:27` reads *"strictly-greater-than gate from the flow diagram"*). A deck scoring exactly 5.0 is Complete under his spec and Rejected under ours. | **`>=`.** One character. | His words are unambiguous; ours came from a different diagram. Q13 anyway, because it is his product and a deck is affected. |
| C14 | **Row 11's "Sign up section"** — `susign` is *Authorised signatories*, but the prototype's `<div class="sb-lbl">Sign-up</div>` is a **rail group heading** over four sections per edition (`sudocs`, `suagr`, `susign`, `suseat`/`sufund`). | **Hide the whole group.** | The prototype's own markup says it is a group. Q14. |
| C15 | **`no response` has no stat box.** His open item moves decks *out of* Incomplete, which "counted in the matching stat box" does not describe. | **It lands in Archived**, with `exit_note = "no response"`, and the new STATUS sort on the Archived box surfaces it. | `exit_note` already reads `pipeline_events.note` (`routes/decks.ts:130`), so the reason needs nothing new. |

Two places his spec and our build **already agree**, and the plan should stop re-arguing them: his fixed check order (deck → contact → rating) is exactly the order `v3StatusKey` uses (`deckStats.ts:539-540`), and `computeResult` already short-circuits on completeness before applying the gate (`evaluate.ts:484-489`). Also: his machine has **no Restore**. We shipped one as Aug-issue 31 (`src/pipeline/incubator.ts:165-180`). We keep it; his silence is not a deletion.

---

## 3. The state machine we will build

### 3.1 Inputs, and where each one already lives

| Input | Source | Available today? |
|---|---|---|
| `D` — deck complete | `decks.ai_complete` (migration `0075`), served as `aiComplete` (`routes/decks.ts:314`) | **Yes** |
| `C` — contact complete | `decks.missing_fields` (`0016_automation.sql:33`), served as `missingFields` | **Yes** |
| `R` — rating ≥ threshold | `decks.ai_score` vs the gate | Column yes; **the comparison is consumed and discarded at evaluation time** |
| `A = Edit` | `pipeline_events.action='edit_contact'` → `contact_edited_at` (`routes/decks.ts:121`, written `:926-927` from a `CONTACT_FIELDS` set of exactly his four fields) | **Yes, already persisted** |
| `A = Send to Query` | `queries` row ⇒ `query_count > 0` ⇒ `DeckView.queried` (`routes/decks.ts:118`, `:366`) | **Yes** |
| `A = Archive / Reject` | stage `archived` / `rejected` | **Yes** |
| `A = Send to Assign` | **nothing.** Guarded navigation only — `DashboardPage.tsx:1495` calls `navigate("/app/assign")` and writes no row; `assign_jury` is withheld by `V3_EXCLUDED_ACTIONS` (`:1325`, verified) | **No** |
| `no response` | nothing; nearest is `queryStatusOf` → `"overdue"` after 5 working days (`queries.ts:328-333`) | **No — two subqueries** |

### 3.2 The states

**Eleven intermediates**, each a pure predicate over fields `toDeckView` already serves:

| # | Pill | Predicate | Active (whitelist) |
|---|---|---|---|
| I1 | Incomplete contact details | `D ∧ ¬C` | Edit, Archive |
| I2 | Incomplete decks | `¬D ∧ C` | Edit, **Send to Query** (C4), Archive (C5) |
| I3 | Both incomplete | `¬D ∧ ¬C` | Edit, Archive |
| I4 | Below threshold | `D ∧ C ∧ ¬R` | Reject, Archive |
| I5 | Rejected | stage `rejected` | Archive |
| I6 | Complete | `D ∧ C ∧ R` | Send to Assign, Edit (C8), Archive (C8) |
| I7 | Contact details edited | `contactEditedAt` set, re-check pending | none — transient |
| I8 | Incomplete contact details, Edited | `contactEditedAt ∧ ¬C` | Archive |
| I9 | Incomplete decks, Edited | `contactEditedAt ∧ C ∧ ¬D` | Send to Query, Archive |
| I10 | Below threshold, Edited | `contactEditedAt ∧ C ∧ D ∧ ¬R` | Reject, Archive |
| I11 | Complete, Edited | `contactEditedAt ∧ C ∧ D ∧ R` | Send to Assign, Archive |

Plus **two states his lists imply but do not name**: `Awaiting AI evaluation` (stage `pending_ai`, C3) and — his open item — `no response`.

**Three sinks**, and their boxes: `Incomplete, Queried` → Incomplete · `AI Evaluated, Assigned` → Assigned · `Archived` → Archived. Once a sink is reached, the operator whitelist is empty (row 7), with the single C7 exception.

I7 is the one row that asks for a **zero-button state**, and nothing in the build can express it today: `rowBusy` (`DashboardPage.tsx:1474`) only disables the menu while a save is in flight. That is the right hook to generalise — the re-check is synchronous with the `PATCH`, so I7 exists for the duration of one request and never needs to be stored.

### 3.3 Derived versus persisted — and the migration question, answered

**All thirteen displayed statuses and all three sinks are derived. No new column on `decks`. No new table.** The status vocabulary must stay a function, never a column: `decks.status` already holds the 13-stage pipeline (and `routes/decks.ts:924-925` warns in as many words that it is not the startup's funding stage either), and `decks.signal` is the rating *band* from `signalTag` (`shared/scoring.ts:88`) whose `'flagged'` value is already spoken for as the incomplete marker (`deckStats.ts:452`). Reusing either collides with a live job.

Three things do have to change, and only one of them is schema:

1. **A behaviour change, zero storage.** `FAIL_STAGE.incubator = "rejected"` (`evaluate.ts:63`) must stop firing, so a sub-gate deck lands at `ai_evaluated` with `ai_score ≤ gate` and waits. I4 and I10 are unreachable until it does — measured on the seed, the only sub-gate decks are `creditbri` (4.3, already `rejected`) and `solarc` (3.8, `archived`); nothing ≤ 5 waits at `ai_evaluated`. The moment the deck stops being moved out from under them, both states become pure predicates, and `reject_ai_gate` (`incubator.ts:81-87`) finally becomes the Reject button his matrix draws — today it is offered only from `ai_evaluated`, i.e. only on decks that *passed* the gate, which makes its label false.

2. **One marker event for Send to Assign — no migration.** `pipeline_events` already carries a non-transition marker with `from_stage === to_stage`: `edit_contact` at `routes/decks.ts:926-927`, whose own comment explains the shape and notes that the exit-reason columns select on `to_stage IN ('rejected','archived')` so a marker never pollutes them. A `send_to_assign` event is the same pattern plus one `MAX(created_at)` subquery beside `contact_edited_at` at `:121`. **Do not implement it as the `assigned` stage**: `DashboardPage.tsx:1316-1320` records that `POST /decks/:id/transition` will move a deck to `assigned` with `assigned_to` still NULL — which is precisely the shape of his own row 12 Foul. The marker is what lets his Send to Assign row and his row 12 both be satisfied: the deck joins the Assign roster and latches, and `assigned_to` keeps meaning a real evaluator.

3. **One migration, one column, and it is the threshold, not the machine:** `org_scoring_settings.ai_gate_threshold REAL NOT NULL DEFAULT 5.0`. A derivation will not do — a hardcoded `GATE = 5` in `src/server/ai/evaluate.ts` cannot be a per-org setting, and his whole matrix pivots on "the threshold". **This column must land before tenancy's rebuild block**: `org_scoring_settings` is keyed on `edition` (verified — `SELECT … WHERE edition = ?`, `config/scoringSettings.ts`) and is rebuild #1 in `plan_multitenancy.md` §5e. Authored concurrently, the rebuild's `CREATE TABLE … _new` enumerates a column that does not exist on the branch it was written from.

**The open item needs no schema either.** `DeckView.queried` is a boolean over `query_count` (`decks.ts:366`) and throws away exactly what is needed. Two more subqueries in `DECK_DERIVED` — the latest query's `created_at` and whether it was answered — plus `queryStatusOf`'s existing 5-working-day rule make `no response` computable. The archive reason is an `archive` event with a note, which `exit_note` already surfaces.

### 3.4 What this means for the plan's shape

Because everything except items 1–3 is computable from `aiComplete`, `missingFields`, `aiScore`, `queried`, `contactEditedAt`, `statusId` and `assignedTo`, **the bulk of the work lands in `src/shared/deckStats.ts`, `src/shared/queries.ts` and `src/client/routes/DashboardPage.tsx` — none of which any other plan owns.** That is the fact the session split below is built on.

One cost to state up front: `V3_STATUS_LABELS`' four words render on exactly one screen (`DashboardPage.tsx:1806`), so the *pill's* blast radius is small. But the Upload review screen and the Assign/Query screens carry their own status words. If his six are meant to be the product's whole status vocabulary, that is a much wider change than the Dashboard pill — Q6.

---

## 4. The two fouls

### 4.1 What is seed data

**All 34 decks in the seed have `r2_key` NULL. Not one seeded deck has a file.** `deck_versions` is empty for the same reason: `0016_automation.sql:60` backfills `WHERE d.r2_key IS NOT NULL`, so it inserts zero rows. **30 of the 34 carry evaluation data** — 648 `scores` rows and 80 `evaluations` rows across 30 distinct decks, every one fileless. The rows come from **five** migrations, not one (`0002_seed.sql:57`, `0005_seed_founder_decks.sql:6`, `0006_seed_vc_decks.sql:8`, `0008_seed_analytics.sql:13,93`, `0020_seed_demo_refresh.sql:607,636`), and **none of them names the `r2_key` column at all** — it is NULL by omission, not decision. `0020:604-606` shows the one time anyone reasoned about it, for PitchLoop: *"NB it has no `r2_key`. 'Re-run AI' on this deck will re-reserve a credit and then fail again."* One deck's fileless-ness was considered; the other 33 were not.

**His literal reading of row 8 is closed permanently and should be answered that way.** There are **zero orphaned rows**, and structurally so: `scores.deck_id` and `evaluations.deck_id` are both `TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE` (`0001_init.sql`). A score at a missing deck cannot exist while foreign keys are on. Do not re-audit it.

**Row 12 is the sharper version and it is true in the shape he did not name: 25 decks sit at or past the evaluation gate with no file** — 8 incubator (`assigned` … `onboard_ready`), 17 VC (`analyst_scoring` … `onboard_ready`), nine of them in `onboard_ready`, the terminal stage, having never had a PDF.

### 4.2 The missing guard

`grep -rn "r2_key" src/server/routes/assignments.ts src/server/routes/pipeline.ts src/pipeline/*.ts` returns **nothing** — verified in this session. There are three write paths to `assigned`, not two:

| Path | file:line | Today |
|---|---|---|
| `POST /api/decks/:id/assign` | `routes/pipeline.ts:387-433` | validates the assignee, `performAction`, writes `status='assigned'`. No file check. |
| `POST /api/decks/:id/transition` with `action:"assign_jury"` | `routes/pipeline.ts:341-381` | generic dispatcher; only `SHORTLIST_ACTIONS` gets a data guard. No file check. |
| `POST /api/assignments` (bulk) | `routes/assignments.ts:150-250` | has a **fully built refusal channel already** — `refused[]` → 409 `not_assignable` with per-deck names (`:184-210`). |

Because path 2 is generic, a guard on 1 and 3 alone is bypassable by posting `{"action":"assign_jury"}` to `/transition`. The guard must be **action-keyed inside the generic handler**, plus explicit checks in 1 and 3.

**And the human evaluation path is unguarded too, which is worse.** `POST /api/decks/:id/evaluate` (`routes/pipeline.ts:447-600`) checks the task gate, jury-must-be-assigned, VC stage eligibility, parameter validity and the override-rationale rule — then writes `scores` and `evaluations` (`:568`, `:574`) and advances `assigned → jury_evaluation` (`:581-595`). It never reads `r2_key`. A juror can open a deck whose PDF 404s, score all 13 parameters, and produce a signed evaluation report. An assignment is reversible; a submitted evaluation is a record. The AI path *is* guarded (`ai/evaluate.ts:843` throws; `:875` throws again if the R2 object is missing) — which means **the seed asserts something the code forbids**: 30 decks carry AI scores for files `evaluate.ts:843` would have refused to read.

**Where the guard goes.** Not in the transition engine. `Transition` is `{from, to, action, label, roles}` (`src/pipeline/types.ts:14-22`) and `performAction(edition, from, action, role)` never receives a deck row; adding a data precondition there means changing that signature at seven call sites and making a pure function async and DB-aware. The precedent to copy is already in the file: `routes/pipeline.ts:355-372` applies `checkShortlistFloor` *after* `performAction` returns ok, keyed off `SHORTLIST_ACTIONS` (`:246`). A `requiresDeckFile` set and a `no_pdf` 409 in the same position is the same shape, reviewed the same way, and reuses an error code the client already renders (`src/client/api.ts:442`, `:456`; `EvalScorecard.tsx:83` → *"No stored PDF to re-score."*).

**Column check on the bulk path** (cheap, catches the class); **column + `env.DECKS.head(key)` on the single-deck path and on evaluate** (one deck, one call). State the asymmetry in the plan so nobody "tidies" it later.

### 4.3 Production

**I could not read it.** `npx wrangler d1 execute startup-jury-db --remote` returns `7403: The given account is not valid or is not authorized to access this service`; `wrangler whoami` shows a token with queues/pipelines/containers/email/browser write scopes and **no D1 scope**. No write was attempted, no other credential tried. After `wrangler login`, three SELECTs answer it:

```sql
SELECT COUNT(*) total, SUM(r2_key IS NULL) no_file FROM decks;
SELECT status, COUNT(*) n FROM decks WHERE r2_key IS NULL GROUP BY status ORDER BY n DESC;
SELECT COUNT(DISTINCT e.deck_id) evaluated_no_file
  FROM evaluations e JOIN decks d ON d.id = e.deck_id WHERE d.r2_key IS NULL;
```

The deployed D1 runs behind the repo every wave, so the answer is not guessable — which is precisely why **the seed migration must be idempotent and safe on a partially-drifted database**: `UPDATE decks SET r2_key = … WHERE id IN (…) AND r2_key IS NULL`, never a blanket update, and no assumption that all 34 ids are present.

### 4.4 The fix, and why the seed half is the larger half

**A migration cannot write to R2**, and an `r2_key` pointing at nothing is *worse* than NULL: `routes/decks.ts:1345-1346` already returns `no_pdf` for a dangling key, so the UI is unchanged — but a guard written as `r2_key IS NOT NULL` would now **pass**, defeated by the very fix meant to satisfy it. And the five seed migrations **cannot be edited in place**: Wrangler's applied-migrations table keys on filename, so an edited file never re-runs — production keeps the bad rows while every fresh local DB gets the good ones, manufacturing the exact deploy-drift this repo already suffers.

So: a **bootstrap script** puts `docs/demo-assets/gridbloom-sample-deck.pdf` into R2 under stable keys (`decks/<id>_v1.pdf`, matching `versionKey` at `routes/decks.ts:1473`), and a **new numbered migration** sets `r2_key` on the 30 decks that carry evaluation data. The four without it stay NULL and are correct: `inc_deck_payroute`, `inc_deck_meera_incomplete` and `vc_deck_northbeam` are `incomplete` (a deck whose intake failed is *supposed* to be thin), and `inc_deck_pitchloop` is a deliberate AI-failure fixture whose purpose is to have nothing to read — amend `0020:604` to say it is now the *exception* rather than merely noting the consequence. The hook exists: `e2e:serve` already does `rm -rf .wrangler/state && npm run db:migrate:local` (verified in `package.json`).

**The seed's fileless-ness is load-bearing in the suite.** `e2e/assign.spec.ts:27,75` assigns `inc_deck_greengrid` by name; `e2e/evaluate-workbench.spec.ts:39` carries the comment *"graceful 'no PDF' for the seed fixture"* and asserts the no-PDF path as correct behaviour. Eighteen test/e2e files name one of the six fileless incubator decks. **A guard landed without a seed fix reddens `assign.spec.ts` on the first run.** The guard is ~40 lines; the seed is a migration, a script, a `package.json` change, an R2 upload against the deployed bucket, and a re-read of 18 files.

### 4.5 What to tell him, in his words

> Nothing a user can do produces a startup without a deck — there is exactly one code path that creates a deck row, and it writes the file first. The 34 cases you saw are demo fixtures, and you are right that they should not exist. What is genuinely missing is the guard: nothing in the product asks "does this deck have a file?" before assigning it to a juror or letting a juror score it, so any row that arrives fileless by another route — our seed, a future CRM import, a support-driven database edit, a restore from a partial backup — is assigned and scored without complaint. We are adding the guard on all three assignment paths and on evaluation, and fixing the fixtures.

Do not tell him the product creates these rows. It does not, and he will find that out.

---

## 5. The payment items

### 5.1 The headline: his checklist reverses his own 24-Sep instruction, and the reversal is a saving

`docs/plan_myaccount.md:305` records the 24-Sep answer as *"Q2 / GST — KEEP IT, on USD"*, with the instruction *"Build what he asked for — 18% GST on the USD total"*, and names the three artefacts that encode the opposite rule as things that *"get updated, not deleted"*.

**The new checklist reverses both.** "LUT on the GST portal for 0% GST on exports" and an export invoice marked *"Supply meant for export under LUT without payment of IGST"* mean GST on an export sale is **zero**, not 18%. "Two price displays — USD for international, INR + 18% GST for Indian" is a currency decision per customer. "Don't charge Indian customers in USD" makes INR mandatory domestically.

**And that is what the code already does.** `src/shared/plans.ts:200` — `export const BASE_CURRENCY = "INR";` under the comment *"The currency GST applies to."* `:226-238` — `priceBreakdown` returns `taxMinor: 0, taxed: false` for every non-base currency. `src/shared/priceBook.ts:293-299` — the same branch, commented *"GST is the INR-billing tax."* `migrations/0073:143` — the published price document has `"baseCurrency":"INR"`, seven currencies with USD active on every plan, and the footnote *"GST at {gst}% added at checkout for INR billing. International pricing shown exclusive of local taxes."* `plans.ts:212-219` even records *why* the currency parameter was added at Wave 4 integration: before it, *"a USD plan was advertised tax-free by the catalogue and charged 18% more at checkout"* — the exact defect the 24-Sep instruction would have reintroduced on purpose.

**So the first engineering action on the payment checklist is to not do a planned piece of work.** Strike the 18%-GST-on-USD item from S-CAT. Keep `BASE_CURRENCY`, keep the branch, keep `0073`'s footnote, and keep `e2e/account-purchase.spec.ts:145` — *"an organisation buys an annual plan through to a receipt (USD, no GST)"* — which is now the **correct** assertion rather than the one to update.

### 5.2 What we build

| Item | Where | Size |
|---|---|---|
| **Currency resolution from the buyer's country**, with the hard invariant **country == IN ⇒ currency must be INR**, enforced server-side | `routes/account.ts`, `routes/billing.ts`, `billing_subscriptions.currency` | **Small** |
| **Mandatory customer name + billing address at checkout**, stored and printed on the invoice | new columns, `AccountScreens.tsx`, `routes/billing.ts:326-390`, `routes/account.ts:504` | **Large — the biggest item on the checklist** |
| **Export invoice as a third `billing_invoices.kind`**, `tax_minor = 0`, the LUT declaration, non-India `place_of_supply` | CHECK widening (SQLite table rebuild) + renderer branch | **Medium** |
| Two price displays from the existing seven-currency catalogue | already in `0073`'s published document; needs only currency resolution | **Small** |
| Keep INR-only GST; **do not** build the 24-Sep USD-GST change | `plans.ts`, `priceBook.ts` | **Negative** |
| RBI e-mandate | `src/server/billing/provider.ts:96` — `const ADAPTERS = {}` *"Empty by design"* | **Blocked, not deferred** |

Three things are genuinely absent, and none of them is the tax arithmetic:

- **Nothing decides which currency a customer sees.** `billing_subscriptions.currency TEXT NOT NULL DEFAULT 'INR'` exists (`0046`) and `routes/billing.ts:144,255` reads it — but **no route ever writes it**, and `billing/ledger.ts:251` hardcodes `currency: "INR"` as the no-subscription default. Every customer is INR and there is no way to become anything else. "Two price displays" is ~80% built and 0% reachable. The resolution input exists but is the wrong shape: `account_profiles.country` (`0053:48`) is nullable and, per the table's own CHECK, the Org-details screen that collects it is Organization-only — an individual buyer has no country at all.
- **There is no billing address anywhere.** `account_profiles` has `city` and `country` and nothing else address-shaped. `billing_invoices` has `place_of_supply` and `gst_registration` but no customer address. `account_orders` has no plan code, no quantity, no amount, no line table (`plan_myaccount.md:183`).
- **RBI e-mandate is unreachable, not deferrable.** `provider.ts:96` is empty by design, `recordPaymentIntent` writes `provider='none'`, and invoices are stamped `NOT A TAX INVOICE · NO PAYMENT RECEIVED` (`routes/account.ts:505`). **The product has never charged anyone anything.** An e-mandate is a property of a recurring charge that cannot exist before the Stripe account does. `plan_myaccount.md:330` already rules: *"Do not begin an adapter before the account, the keys and the enabled payment methods arrive."*

One thing that already pays off: `account_orders.taxed` (`0053:71-73`) is stored rather than re-derived, with the comment *"so a receipt can never disagree with the intent it documents if the rule is ever revisited."* It is now the column that distinguishes a domestic GST sale from an LUT export, and the invoice kind should be derived from it.

### 5.3 His compliance homework — track, do not build

1. **Pvt Ltd incorporation**, for Stripe India international payments. Blocks the Stripe account, which blocks every adapter.
2. **The Stripe account itself** — `plan_myaccount.md:327` records *"I will open the account on Stripe and share details."* Still not opened. Needed: KYC status, live-vs-test keys, which methods are enabled, and **who sets the Worker secret and where the webhook signing secret lives** (`plan_myaccount.md:84`, questions 2–3, unanswered).
3. **LUT filing on the GST portal** — the ARN and validity period. Until the LUT is accepted, exports are not 0% IGST and the declaration we print on his invoice would be false.
4. **The real GSTIN we print as ours.** `0073` seeds `"gstRegistration":"29ABCDE1234F1Z5"`, a placeholder; `routes/billing.ts:153` validates the *customer's* GSTIN against a real regex while ours is unvalidated seed data.
5. **His CA's ruling, in writing.** On 24-Sep he said *"I will cross-check with our CA too."* The three code artefacts encoding INR-only GST were written deliberately and we are now keeping them **on his instruction** — that should be recorded as his decision.
6. **Place-of-supply rules for a B2B Indian customer with an out-of-state GSTIN** (IGST vs CGST+SGST). `billing_invoices.place_of_supply` exists and nothing computes it.
7. **Payment-link scope** (`plan_myaccount.md:87`) — now more pointed: a link for an export customer would carry a billing address and an LUT declaration.

### 5.4 What it costs the My Account wave

S-CAT's scope changes shape, not size: **three items out** (the USD-GST change and its "make it a setting" wrapper — the setting already exists as `pricing_settings.gst_rate_pct`, snapshotted per invoice at `billing_invoices.gst_rate_pct`; the "update, don't delete" triple; and "no currency selector" as an *absence*) and **four in** (currency resolution, billing name + address, the export invoice kind, and `taxed` becoming load-bearing). Net roughly level, and the work moves from arithmetic to identity.

**One new collision to record.** S-CAT owns `routes/account.ts`; **T1-COMMERCE** owns `routes/account.ts` · `routes/billing.ts` · `billing/**` (`plan_multitenancy.md:380`). The invoice-kind and address work spans both files, so it cannot be split between them: **it belongs entirely to S-CAT**, which runs first. `plan_multitenancy.md:160` already imposes one instruction on S-CAT from Stage 4; this is a second.

**Write into `docs/plan_myaccount.md` verbatim:** *§9 Q2 is superseded. The 24-Sep answer "18% GST on the USD total" is reversed by the payment checklist's LUT/export item. `BASE_CURRENCY = "INR"`, `priceBreakdown`'s non-base branch, `0073:143`'s footnote and `e2e/account-purchase.spec.ts:145` are correct as shipped and must not be changed. §9 Q1's "no currency selector" survives, but the currency is resolved from the buyer's country rather than left to the gateway, and an Indian customer may never be priced in USD.*

---

## 6. The sessions

### 6.0 A pre-wave commit, before anything cuts a branch

The migration number line has three problems today, and **all three are fixed by one standalone commit on `main` while nothing is in flight.** Verified in this session: `migrations/` holds 61 files ending at `0075`, and `ALLOTMENT_CEILING = 76` (`test/worker/migrations-w1b.test.ts:40`).

- **`0076` is double-claimed** — R8-AW/SF's `score_visibility` (`plan_roles_incubator.md:122,172`, conditional and not started) and S-CAT (`plan_myaccount.md:188`, *"this work takes `0076`"*).
- **My Account's two plans disagree about its own slots** — `plan_myaccount.md` §5 says `0076`/`0077`; `plan_multitenancy.md:156` and `:262` say `0077`–`0078`.
- **Two separate ceiling raises are planned** (76→80, then 80→110), which means two one-line merge conflicts on `:40`, each hitting every parallel session in its wave.

**Correcting one claim from the scoping pass:** the argument that screening must take the *lowest* free numbers or the directory acquires an intolerable hole is wrong. I read the test — above the W1-B block it asserts only **uniqueness** and `max ≤ ALLOTMENT_CEILING`; strict contiguity is asserted only over `n <= LAST`, and the file says so at `:66-71`. There are already gaps after `0044`, `0049`, `0053`, `0058`, `0060`, `0063` and `0065`. Screening needs unique slots under the ceiling, nothing more.

**The commit:** raise `76 → 110`, and write the whole allotment table into the comment block at `:31-39`:

| Slot | Claimant |
|---|---|
| `0076` | R8-AW/SF `score_visibility` (conditional; **S-CAT's claim on it is withdrawn**) |
| `0077`–`0078` | My Account S-CAT |
| `0079` | `trial_requests` (Stage 2) |
| `0080` | `tickets.scope` (Stage 3) |
| **`0081`** | **F-FOUL — `r2_key` on the 30 seeded decks** |
| **`0082`** | **S2-SERVER — `org_scoring_settings.ai_gate_threshold`** |
| `0083`–`0108` | tenancy T0 block (26 slots, was `0081`–`0106`) |
| `0109`–`0110` | declared headroom |

`0082 < 0083` is what keeps the gate-threshold column ahead of tenancy's `org_settings`/`org_scoring_settings` rebuilds.

### 6.1 The sessions themselves

Seven work sessions plus one integration, in three waves. **File ownership is disjoint within each wave**, verified path by path. No session owns anything under `e2e/` — every e2e change goes through `docs/parity-requests/*.patch` and is applied at integration, which is what keeps `e2e/upload.spec.ts` out of a three-way fight with the My Account wave.

**Wave S-1 — two sessions, in parallel.**

| Id | Owns exclusively | Rows / items closed | Migration |
|---|---|---|---|
| **F-FOUL** | `src/server/decks/deckFile.ts` (NEW) · `src/server/routes/pipeline.ts` · `src/server/routes/assignments.ts` · `migrations/0081_seed_deck_files.sql` (NEW) · `scripts/seed-deck-assets.mjs` (NEW) · `package.json` · `test/worker/deck-file-guard.test.ts` (NEW) | Rows **8** and **12** | **`0081`** |
| **S0-VOCAB** | `src/shared/deckStats.ts` · `src/shared/queries.ts` · `test/unit/deckStats.test.ts` · `test/unit/queries.test.ts` | Row **6**; the 13-state derivation; the Incomplete tile predicate; C1–C6, C10, C15 | none |

**Wave S-2 — five sessions, in parallel, after both of S-1 merge.**

| Id | Owns exclusively | Rows / items closed | Migration |
|---|---|---|---|
| **S2-DASH** | `src/client/routes/DashboardPage.tsx` · `test/client/allDecks.test.tsx` · `test/client/deckHandoff.test.tsx` | Rows **1, 4, 5, 7**; the 11-row whitelist; the composed status string; the STATUS column sort | none |
| **S2-SERVER** | `src/server/routes/decks.ts` · `src/server/ai/evaluate.ts` · `src/pipeline/incubator.ts` · `src/server/config/scoringSettings.ts` · `src/server/routes/config.ts` · `src/server/scheduled.ts` · `migrations/0082_ai_gate_threshold.sql` (NEW) · `test/worker/ai-complete.test.ts` · `test/worker/screening-status.test.ts` (NEW) | Row **3** server half; the gate (`>` → `>=`, configurable); the `send_to_assign` marker; the `no response` sweep | **`0082`** |
| **S2-CHROME** | `src/client/components/AppShell.tsx` · `src/client/components/PanelFrame.tsx` · `src/client/components/Sidebar.tsx` · `src/shared/nav.ts` · `src/client/routes/QueryPage.tsx` · `test/client/queryPage.test.tsx` | Row **10**; the Query select-all removal | none |
| **S2-ADMIN** | `src/client/routes/admin/sections.ts` · `src/client/routes/admin/AdminConsole.tsx` · `src/client/App.tsx` · `test/client/adminConsole.test.tsx` | Row **11** | none |
| **S2-UPLOAD** | `src/client/routes/upload/ReviewScreen.tsx` · `src/client/routes/UploadPage.tsx` · `src/client/routes/upload/types.ts` · `test/client/upload.test.tsx` | Row **2** | none |

**Wave S-3 — one integration session, S-INT:** owns `e2e/**`, applies the parity patches, runs the full gate including e2e, reconciles the plan files.

Note the one cross-session instruction: **S2-UPLOAD's removal of "Mark incomplete" leaves `flag_incomplete` live in the Dashboard row menu** (`V3_EXCLUDED_ACTIONS` withholds only `assign_jury` and `complete_signup` — verified at `DashboardPage.tsx:1325`), so a `manual_review` deck still renders "Flag incomplete" as an active option. That one-line addition belongs to **S2-DASH**, and is written into its prompt.

### 6.2 Sequencing verdict against the other two waves

**Screening → tenancy (T0, then T1) → My Account, with My Account permitted to overlap the front.**

Six hard `src/` collisions, all with tenancy, all inside T1-DECKS / T1-PEOPLE / T1-CONFIG: `routes/decks.ts` · `routes/pipeline.ts` · `routes/assignments.ts` · `ai/evaluate.ts` · `scheduled.ts` · `config/**`. T1-DECKS' ownership block is verified at `plan_multitenancy.md:378` and its weight is 263; the four files screening must also rewrite carry **201 of it — 83% of that session's predicate weight.** Two sessions rewriting those three route files in parallel is not a merge; it is one of them being redone.

**Screening first, because it is upstream in the dependency sense, not as a preference.** Tenancy is a mechanical widening whose cost model assumes the statements it widens are the statements that will exist. Screening does not widen predicates — it deletes and replaces them: list membership stops being derived, status gains a second axis, and the gate moves. Run tenancy first and every widened predicate in the `?list=` path is re-derived by hand a wave later, in the same file, by a session whose prompt is about status semantics — the shape that produces a missed clause. Worse, **the isolation test cannot catch it**: `tenant-scope.test.ts` is specified *per table*, and a membership model replacing a partition is a statement-level change inside `decks`, a table already on the list. The invariant stays green while the statement that produced the rows is rewritten. Screening first costs tenancy only a prompt regeneration against a newer HEAD, and T1-DECKS' weight goes *down*.

One honest correction to a tempting version of that argument: the derived `contact_edited_at` subquery (`routes/decks.ts:121`) correlates on `pe.deck_id = d.id`, so it **inherits** the deck's scope and is not a leak site; screening's new derived columns of the same shape inherit it too. The leak risk is `scheduled.ts`, which runs with no session and therefore no tenant — and screening adds a second `for (const edition of …)` loop to the one file whose loop tenancy must nest (`src/server/scheduled.ts:190`, verified).

**Which may be in flight together: screening + My Account.** They share **zero `src/` files**. The three shared test/e2e paths are all handled by mechanisms this repo has: the ceiling line is lifted into §6.0's pre-wave commit, and `e2e/upload.spec.ts` and `e2e/parity.spec.ts` go through `docs/parity-requests/*.patch` with `git apply --check` at integration. **Tenancy runs strictly after screening merges.** And My Account cannot run concurrently with tenancy's *migrations* whatever the file ownership says — `account_profiles` and `billing_subscriptions` are two of the four PK-is-`edition` rebuilds in §5e, and a catalogue migration cannot be authored against an unmerged rebuild of the tables it writes.

If only two may be in flight and one must be tenancy (Stage 0 is shipped and the client is waiting on the AISJ tier), then the pair is **tenancy + My Account**, and screening goes ahead of both as a single short wave first. It is the shortest of the three and the only one upstream of the other two.

### 6.3 Six things to settle in writing before any branch is cut

1. The `0076` double-claim (R8-AW/SF vs S-CAT) — resolved above as S-CAT withdrawing; record it.
2. `plan_myaccount.md` §5 vs `plan_multitenancy.md` §5g on My Account's slots — `0077`–`0078` wins.
3. **Name T1-DECKS' four test files.** Nine test/e2e files move under rows 3 and 6, and the overlap cannot be checked while the set is written as "+ 4 tests".
4. Add `src/server/ai/evaluate.ts` to the screening scope and to both collision lists — neither plan names it, and `GATE = 5` at `:27` is where "at or above the threshold" lives.
5. Row 11: `susign` alone or the whole `Sign-up` group. Shipping the group (C14).
6. **Assign the twenty `src/shared/` files that carry `edition` to a tenancy session, or state that they are deliberately excluded and why.** `plan_multitenancy.md` §11's "50 of 51 files" count is over `src/server/` only; `src/shared/permissions.ts:97` is one of the twenty and §3 (`:130`) already calls that line a gate.

---

## 7. The session prompts

### 7.0 Pre-wave commit

```
Repo: /Users/jayanthkomarraju/Documents/GitHub/startup-jury, branch `main`, clean.
export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"

ONE commit on `main`, directly, before any branch is cut for the screening wave.
It touches exactly two files. Do not touch src/, e2e/ or migrations/.

1. test/worker/migrations-w1b.test.ts
   - Raise `ALLOTMENT_CEILING` (line 40) from 76 to 110.
   - Extend the comment block at :31-39 with the full allotment table:
       0076        R8-AW/SF score_visibility (conditional, not started)
       0077-0078   My Account S-CAT
       0079        trial_requests (Stage 2)
       0080        tickets.scope + escalated_at (Stage 3)
       0081        F-FOUL  — r2_key on the 30 seeded decks
       0082        S2-SERVER — org_scoring_settings.ai_gate_threshold
       0083-0108   tenancy T0 block (26 slots; was 0081-0106)
       0109-0110   declared headroom
   - Add one sentence recording WHY this is a single raise to 110 rather than two
     raises to 80 and then 110: three bodies of work share the number line, and
     two raises means two one-line conflicts on :40 hitting every parallel session
     in two waves. Nothing is in flight right now, so this commit cannot conflict.

2. docs/plan_myaccount.md
   - §5 "Migration position": My Account takes 0077-0078, NOT 0076. S-CAT's claim
     on 0076 is withdrawn; 0076 stays with R8-AW/SF. Reconcile with
     docs/plan_multitenancy.md:156 and :262, which already say 0077-0078.
   - §9 Q2 is SUPERSEDED. Write verbatim: the 24-Sep answer "18% GST on the USD
     total" is reversed by the payment checklist's LUT/export item.
     src/shared/plans.ts:200 (BASE_CURRENCY = "INR"), priceBreakdown's non-base
     branch at :226-238, src/shared/priceBook.ts:293-299, migrations/0073:143's
     footnote and e2e/account-purchase.spec.ts:145 are CORRECT AS SHIPPED and must
     not be changed. §9 Q1's "no currency selector" survives, but the currency is
     resolved from the buyer's country, and an Indian customer may never be priced
     in USD.
   - Add the S-CAT scope amendment: OUT — the USD-GST change and its "make it a
     setting" wrapper (the setting already exists: pricing_settings.gst_rate_pct,
     snapshotted per invoice at billing_invoices.gst_rate_pct). IN — currency
     resolution from buyer country with the server-side invariant country==IN =>
     INR; mandatory billing name + address at checkout, stored and printed; the
     export invoice as a third billing_invoices.kind with tax_minor=0, the LUT
     declaration and a non-India place_of_supply; account_orders.taxed becomes the
     column the invoice kind derives from.
   - Record the second cross-wave instruction on S-CAT: the invoice kind and the
     billing-address columns are S-CAT's entirely, not T1-COMMERCE's, because they
     span routes/account.ts (S-CAT) and routes/billing.ts (T1-COMMERCE) and cannot
     be split. plan_multitenancy.md:160 already imposes one such instruction; this
     is the second.

3. docs/plan_multitenancy.md §11
   - Add the sequencing line: the screening wave (F-FOUL, S0-VOCAB, then the five
     S2 sessions) ships BEFORE T0-SCHEMA. It touches all four files carrying 201 of
     T1-DECKS' 263 weight (routes/decks.ts, routes/pipeline.ts,
     routes/assignments.ts, ai/evaluate.ts) plus scheduled.ts (T1-PEOPLE) and
     config/** (T1-CONFIG). T1 prompts are regenerated against post-screening HEAD;
     no `owns` block changes, only weights, and they go down.
   - Add src/server/ai/evaluate.ts to the collision list with the screening wave.
   - Add the open question: the twenty src/shared/ files that carry `edition` are
     assigned to no session. Either assign them or state the exclusion and why.
     src/shared/permissions.ts:97 is one of them and §3 at :130 calls it a gate.

Gate: `npm run typecheck && npm run lint && npm test`. Do NOT run test:e2e,
playwright, or roles. Commit message ends with:
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

### 7.1 F-FOUL — the deck-file precondition

```
Repo: /Users/jayanthkomarraju/Documents/GitHub/startup-jury. Cut a worktree from
`main` AFTER the pre-wave ceiling commit lands. Runs in parallel with S0-VOCAB;
you two share no file.
export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"

YOU OWN, EXCLUSIVELY — touch nothing else under src/ or migrations/:
  src/server/decks/deckFile.ts              NEW — the precondition helper
  src/server/routes/pipeline.ts             transition + assign + evaluate guards
  src/server/routes/assignments.ts          the bulk refusal arm
  migrations/0081_seed_deck_files.sql       NEW — r2_key on the 30
  scripts/seed-deck-assets.mjs              NEW — the R2 bootstrap
  package.json                              the db:migrate:local / e2e:serve hook
  test/worker/deck-file-guard.test.ts       NEW — one negative control per path
  docs/prototype/... nothing. docs/parity-requests/*.patch if you need an e2e change.
You do NOT own e2e/. Any e2e change goes out as docs/parity-requests/f-foul.patch.

WHAT YOU ARE CLOSING: the client's feedback rows 8 ("eval reports and scores
without decks — that's a Foul") and 12 ("startups without any decks, assigned to
Jury"). Both are real, and both are the ABSENCE OF A GUARD, not a defect in the
creation path.

MEASURED FACTS — do not re-derive, but do sanity-check anything you rely on:
 · All 34 seeded decks have r2_key NULL. 30 of them carry evaluation data: 648
   `scores` rows and 80 `evaluations` rows across those 30. 25 decks sit at or past
   the evaluation gate with no file (8 incubator, 17 VC; nine VC decks in
   `onboard_ready`, the terminal stage).
 · ZERO orphaned rows, structurally: scores.deck_id and evaluations.deck_id are
   both `TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE` (0001_init.sql). The
   client's literal reading of row 8 is impossible while FKs are on. Do not audit it.
 · `grep -rn 'INSERT INTO decks' src/server` has exactly ONE hit: storeDeck
   (routes/decks.ts:1490-1492), which does `env.DECKS.put(key, file)` and THEN
   inserts with r2_key bound to that key. The only `UPDATE ... SET r2_key` is
   decks/versions.ts:242 and always sets a real key. NO API PATH CREATES A FILELESS
   DECK. Do not write a plan document or a comment that says otherwise.
 · `grep -rn r2_key src/server/routes/assignments.ts src/server/routes/pipeline.ts
   src/pipeline/*.ts` returns NOTHING. That is the gap.

THE GUARD — three write paths to `assigned`, not two:
  1. POST /api/decks/:id/assign              routes/pipeline.ts:387-433
  2. POST /api/decks/:id/transition, action "assign_jury"   routes/pipeline.ts:341-381
  3. POST /api/assignments (bulk)            routes/assignments.ts:150-250
Path 2 is a GENERIC dispatcher, so a guard on 1 and 3 alone is bypassable by
posting {"action":"assign_jury"} to /transition. The guard must be ACTION-KEYED
INSIDE the generic handler, plus explicit checks in 1 and 3.

COPY THE PRECEDENT ALREADY IN THE FILE. routes/pipeline.ts:355-372 applies
checkShortlistFloor AFTER performAction returns ok, keyed off SHORTLIST_ACTIONS
(:246), and returns 409 below_shortlist_minimum. Write `requiresDeckFile` and a
`no_pdf` 409 in the same position. Reuse `no_pdf`: the client already renders it
(src/client/api.ts:442,456; components/EvalScorecard.tsx:83 → "No stored PDF to
re-score."). On the bulk path, a fileless deck belongs in the EXISTING refused[]
array → 409 not_assignable with per-deck names (assignments.ts:184-210).

DO NOT put the precondition in the transition engine. `Transition` is
{from,to,action,label,roles} (src/pipeline/types.ts:14-22) and
performAction(edition, from, action, role) (src/pipeline/index.ts:71-82) never
receives a deck row. Adding a data precondition there means changing that
signature at seven call sites (routes/pipeline.ts:348,411,581,750,828,872;
routes/assignments.ts:197; routes/calls.ts:726) and making a pure function async
and DB-aware.

ALSO GUARD THE HUMAN EVALUATION PATH, and treat it as the more urgent half. POST
/api/decks/:id/evaluate (routes/pipeline.ts:447-600) checks the task gate (:449),
jury-must-be-assigned (:468), VC stage eligibility, parameter validity and the
override-rationale rule (:534-556), then writes scores (:568) and evaluations
(:574) and advances assigned → jury_evaluation (:581-595). It never reads r2_key.
An assignment is reversible; a submitted evaluation report is a record. The AI
path is already guarded (ai/evaluate.ts:843 and :875 both throw) — do not touch it.

THE ASYMMETRY, and write a comment saying why so nobody "tidies" it later:
  · bulk path      — COLUMN CHECK ONLY (cheap, catches the class; up to MAX_DECKS
                     rows — check that constant before committing to any per-row
                     R2 call)
  · single-deck assign, and evaluate — COLUMN CHECK + env.DECKS.head(key)
Reason: a column check is exactly what your own seed migration would silently
satisfy. An r2_key pointing at nothing is WORSE than NULL — routes/decks.ts:
1345-1346 already returns no_pdf for a dangling key, so the UI is unchanged while
`r2_key IS NOT NULL` starts passing.

THE SEED — THE LARGER HALF, AND THE TRAPS:
 · A migration cannot write to R2. So: scripts/seed-deck-assets.mjs puts
   docs/demo-assets/gridbloom-sample-deck.pdf into R2 under stable keys
   `decks/<id>_v1.pdf` — MATCH `versionKey` at routes/decks.ts:1473 exactly — and
   0081 sets r2_key on the 30 decks that carry evaluation data.
 · DO NOT EDIT 0002_seed.sql, 0005, 0006, 0008 or 0020 IN PLACE. Wrangler's
   applied-migrations table keys on filename; an edited file never re-runs, so
   production keeps the bad rows while every fresh local DB gets the good ones.
   That is manufactured deploy drift.
 · 0081 must be IDEMPOTENT AND SAFE ON A PARTIALLY-DRIFTED DB:
   `UPDATE decks SET r2_key = ... WHERE id IN (...) AND r2_key IS NULL`. Never a
   blanket update. Never assume all 34 ids are present — the deployed D1 runs
   behind the repo every wave.
 · FOUR DECKS MUST KEEP r2_key NULL: inc_deck_payroute, inc_deck_meera_incomplete
   and vc_deck_northbeam are `incomplete` (a deck whose intake failed is SUPPOSED
   to be thin), and inc_deck_pitchloop is a deliberate AI-failure fixture whose
   whole purpose is to have nothing to read. Amend the comment at
   0020_seed_demo_refresh.sql:604 to say pitchloop is now the EXCEPTION, not just
   to note the consequence.
 · package.json hook: e2e:serve already does `rm -rf .wrangler/state && npm run
   db:migrate:local`, so there is a place for the bootstrap step. A --remote
   variant for the deployed bucket is a one-off script, not part of the gate.

THE TWO SPECS YOU ARE MOST LIKELY TO BREAK, and you cannot run them:
  e2e/assign.spec.ts:27,75 assigns inc_deck_greengrid BY NAME and asserts
  board.decks.inc_deck_greengrid.assignees. e2e/evaluate-workbench.spec.ts:39
  carries the comment "graceful 'no PDF' for the seed fixture" and ASSERTS THE
  NO-PDF PATH AS CORRECT BEHAVIOUR. Eighteen test/e2e files name one of the six
  fileless incubator decks. Read all eighteen, and write into your handoff note
  exactly which ones the integration session must look at first.

PRODUCTION IS UNREADABLE FROM HERE. `wrangler d1 execute --remote` returns
7403 (the token has no D1 scope). Do not retry with another credential and do not
attempt any write. Put the three SELECTs in your handoff note for the user to run
after `wrangler login`:
  SELECT COUNT(*) total, SUM(r2_key IS NULL) no_file FROM decks;
  SELECT status, COUNT(*) n FROM decks WHERE r2_key IS NULL GROUP BY status;
  SELECT COUNT(DISTINCT e.deck_id) FROM evaluations e JOIN decks d ON d.id=e.deck_id
    WHERE d.r2_key IS NULL;

Gate: `npm run typecheck && npm run lint && npm test && npm run build`.
DO NOT run npm run test:e2e, playwright, or npm run roles.
```

### 7.2 S0-VOCAB — the status vocabulary and the derivation

```
Repo: /Users/jayanthkomarraju/Documents/GitHub/startup-jury. Worktree from `main`
after the pre-wave ceiling commit. Runs in parallel with F-FOUL; you share no file.
export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"

YOU OWN, EXCLUSIVELY:
  src/shared/deckStats.ts
  src/shared/queries.ts
  test/unit/deckStats.test.ts
  test/unit/queries.test.ts
Nothing else. You do NOT own DashboardPage.tsx, routes/decks.ts, or any e2e file.
You are the FOUNDATION SESSION: the five S2 sessions consume your exported types
and functions, so your public surface is a contract. Export it deliberately and
document it.

WHAT YOU ARE BUILDING. The client's 24-Sep spec replaces the four-word Status pill
we shipped on 21-Sep with an ELEVEN-STATE intermediate machine plus three sinks.
V3_STATUS_LABELS (deckStats.ts:477-482, currently aieval / noteval /
incompleteDeck / incompleteContact) goes. So does v3StatusKey's SHAPE
(:536-560) — not its string values, its SIGNATURE: it is a pure function of two
columns and the spec needs action history. "Incomplete contact details" and
"Incomplete contact details, Edited" have IDENTICAL COLUMNS.

THE THIRTEEN PILLS. Predicates over fields toDeckView ALREADY SERVES — aiComplete,
missingFields, aiScore, queried, contactEditedAt, statusId, assignedTo, plus the
new sendToAssignAt marker and the two no-response fields S2-SERVER adds. Write the
function so a field it does not yet receive is an explicit optional, not a crash:
  Incomplete contact details            D ∧ ¬C
  Incomplete decks                      ¬D ∧ C
  Both incomplete                       ¬D ∧ ¬C
  Below threshold                       D ∧ C ∧ ¬R
  Rejected                              stage `rejected`
  Complete                              D ∧ C ∧ R
  Incomplete contact details, Edited    contactEditedAt ∧ ¬C
  Incomplete decks, Edited              contactEditedAt ∧ C ∧ ¬D
  Below threshold, Edited               contactEditedAt ∧ C ∧ D ∧ ¬R
  Complete, Edited                      contactEditedAt ∧ C ∧ D ∧ R
  Awaiting AI evaluation                stage `pending_ai`
  Incomplete, Queried / AI Evaluated, Assigned / Archived     the three sinks
D = decks.ai_complete (migration 0075, served as aiComplete at routes/decks.ts:314)
C = decks.missing_fields empty (0016_automation.sql:33, served as missingFields)
R = aiScore >= the gate (S2-SERVER makes the gate configurable; take it as a
    parameter, do not import a constant)

RESOLUTIONS ALREADY DECIDED — implement these, do not relitigate them:
 · ONE STRING for the assigned sink: "AI Evaluated, Assigned". His row 6 says
   "Complete, Assigned"; his matrix and his FINAL STATUSES map both say
   "AI Evaluated, Assigned". Two of three lists win.
 · His row-6 six words are the SORT/FILTER OPTION LIST. The thirteen above are the
   DISPLAYED pill set. Export both, separately, and comment that this is the only
   reading under which both of his lists can be true.
 · KEEP the noteval TILE and give it the pill "Awaiting AI evaluation". Row 6
   deletes "Not AI Evaluated", which is a TILE (deckStats.ts:619) as well as a
   word, and inc_deck_pitchloop at pending_ai sits in it. A populated stat box
   whose rows have nothing to say is worse than a seventh word.
 · "Both incomplete" becomes a real word. Today deck-before-contact deliberately
   collapses it into incompleteDeck (deckStats.ts:503-510); two live seed decks are
   in it (inc_deck_payroute, inc_deck_meera_incomplete: ai_complete=0 AND
   missing_fields='founderPhone'). The DATA already distinguishes the pair; only
   the label does not.
 · KEEP his check ORDER — deck, then contact, then rating. That is already exactly
   what v3StatusKey does at :539-540 and what computeResult does at
   ai/evaluate.ts:484-489. Say so in a comment so nobody re-argues precedence.

THE INCOMPLETE TILE PREDICATE CHANGES, and this is the subtle one. His sink map
says "Incomplete, Queried" → the Incomplete box. Today matchesV3Stat → v3DeckState,
and POST_AI_STAGES includes `ai_evaluated` (deckStats.ts:433-447), so a deck sent
to Query from the evaluated population counts under AI Evaluated, NOT Incomplete.
Make Queried a tile predicate in its own right rather than moving the stage.

deckListRoute (queries.ts:484-500) — ITS QUERY ARM AS AN AUTOMATIC PARTITION DIES.
His feedback row 3: decks with incomplete decks or incomplete contact details must
NOT reach the Query screen automatically, only when Send to Query is clicked. His
stated reason is a LIVE DEFECT (see below). Today ASSIGNABLE_STAGES ∧ ¬complete →
"query", and FLAG_STAGES includes `incomplete`, so stage `incomplete` routes to
query with no click. THE ASSIGN ARM SURVIVES UNCHANGED. Query membership becomes a
recorded action (`queried`), not a derivation.
DO NOT widen deckListRoute's return type to express "on both screens". Its own
header comment at :380-384 says "one function, one answer per deck, so 'on both
screens' is not a state it can express" — and that stays true. The uploaded screen
simply is not one of the two things it partitions: the Dashboard renders every
deck already. What changes is the Incomplete TILE predicate, not the partition.

ARCHIVE-AS-A-STATE SURVIVES AND IS CONFIRMED BY HIS OWN WORDS. matchesV3Stat
answers `all` BEFORE the archived test (:565-590), deliberately reversing the
prototype's `else if(d.archived) show=false`. His display rule — "ALL decks,
INCLUDING ARCHIVED, always remain on the uploaded status screen" — is that
deviation in his words. Do not touch it. The only extension: an archived row must
now carry a sortable Status too. Pinned by test/client/allDecks.test.tsx:661
(S2-DASH owns that file — send it a note, do not edit it).

ASSIGNED_TILE_RETAINED_PENDING_Q7 (deckStats.ts:603, consumed :622-624) can be
PROMOTED from "retained pending" to ANSWERED: his FINAL STATUSES map requires an
Assigned tile. Rewrite the hedge as a decision with his sentence quoted.

DO NOT PERSIST THE VOCABULARY. decks.status holds the 13-stage pipeline (and
routes/decks.ts:924-925 warns it is not the startup's funding stage either).
decks.signal is the rating BAND from signalTag (shared/scoring.ts:88) and its
'flagged' value is already the incomplete marker (deckStats.ts:452) — reusing it
collides with two live jobs. decks.complete is redundant (isDeckComplete
re-derives it at read time anyway, queries.ts:441-443). The status vocabulary is a
DERIVED FUNCTION, always.

TEST COVERAGE THAT MOVES, and it is the negative controls:
  test/unit/deckStats.test.ts — the whole v3StatusKey describe (:375-470), all four
  labels at :422-426. 8 of 36 declared.
  test/unit/queries.test.ts — the "Assign / Query partition" describe (:514-585, 6
  tests) plus 3 in "which decks the list shows". ~9 of 45.
Rewrite them as the new contract. Do not renumber them into vacuity: each one
exists to make a guard un-revertable, and you are changing which guard is right.

THE LIVE DEFECT THAT JUSTIFIES ROW 3 — quote it in your handoff note, because it
is the strongest argument for the whole change. POST /decks/:id/queries DOES email
a deck with no contact details: routes/pipeline.ts:770-771 —
  const toEmail = deck.founder_email ?? uploader?.email ?? "founder@portal.local";
— then mints a resubmit token and sends. deckListRoute puts that deck on the Query
list automatically and the Dashboard arms the button. He is not describing a
preference; he is describing this path. The FIX is S2-SERVER's and S2-DASH's; your
job is to stop the partition arming it.

Gate: `npm run typecheck && npm run lint && npm test && npm run build`.
DO NOT run npm run test:e2e, playwright, or npm run roles.
Publish your exported surface in the handoff note — the five S2 sessions read it.
```

### 7.3 S2-DASH — the matrix, the whitelist, and the sort

```
Repo: /Users/jayanthkomarraju/Documents/GitHub/startup-jury. Worktree from `main`
AFTER F-FOUL and S0-VOCAB both merge. Parallel with S2-SERVER, S2-CHROME,
S2-ADMIN, S2-UPLOAD; you share no file with any of them.
export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"

YOU OWN, EXCLUSIVELY:
  src/client/routes/DashboardPage.tsx     (2,404 lines — no competing owner in any plan)
  test/client/allDecks.test.tsx
  test/client/deckHandoff.test.tsx
Nothing else. Consume S0-VOCAB's exports from src/shared/deckStats.ts; do not edit
that file. Any e2e change goes out as docs/parity-requests/s2-dash.patch.

ROWS YOU CLOSE: 1, 4, 5, 7, the eleven-row status/button matrix, the composed
Status string, and the STATUS column sort.

THE ONE STRUCTURAL CHANGE, and every row of his matrix is the same defect. His
spec is a WHITELIST — "these actions are active, everything else is disabled with a
remark". v3ActionCell (:1451-1528) is a BLACKLIST: `deck.actions` minus
V3_EXCLUDED_ACTIONS (:1325) minus `archive` (filtered :1464-1466), plus two guarded
navigations. That is why the build shows "extra active options" against ten of his
eleven rows — Reject (below AI gate), Founder responded, Restore, Edit. Invert the
mechanism: an 11-row per-status active set, sitting ABOVE allowedTransitions.
allowedTransitions stays the PERMISSION layer; the whitelist is the ENABLEMENT
layer. Do not collapse them.

THE WHITELIST, as we ship it (deviations from his literal text are marked and each
has a reason — keep the reason in a comment):
  Incomplete contact details          Edit, Archive
  Incomplete decks                    Edit, Send to Query [*], Archive [*]
  Both incomplete                     Edit, Archive
  Below threshold                     Reject, Archive [*]
  Rejected                            Archive
  Complete                            Send to Assign, Edit [*], Archive [*]
  Contact details edited              NOTHING — transient, system re-check
  Incomplete contact details, Edited  Archive
  Incomplete decks, Edited            Send to Query, Archive [*]
  Below threshold, Edited             Reject, Archive [*]
  Complete, Edited                    Send to Assign, Archive [*]
  any sink                            NOTHING (see row 7 below)
 [*] deviations and why:
  · Send to Query ACTIVE at "Incomplete decks": his matrix lists it in NEITHER the
    active nor the disabled column, yet its own `next` column fires it, and his row
    5 makes the enabling event impossible (it requires contact to be edited, but at
    this status contact is already complete). His own reason for row 3 is that a
    deck with incomplete CONTACT cannot be emailed — here the contact is fine. The
    alternative leaves the state with no exit but Edit-to-nowhere. Flagged to him
    as the biggest hole in the document; ship it active.
  · Archive active EVERYWHERE: his matrix disables it on "Incomplete deck" and
    enables it on "Both incomplete", which is strictly worse. A worse deck cannot
    gain a capability.
  · Edit + Archive on "Complete": his row offers only Send to Assign, which makes a
    typo in a complete deck's contact details uncorrectable. Almost certainly an
    omission.
  · "Disabled: all except Archive" (his rows for Below threshold, Edited-incomplete-
    deck, Edited-below-threshold) is self-cancelling read literally. Treat it as a
    drafting artefact; the whitelist above is the specification.

ROW 1 — THE COPY, AND IT IS TWO SURFACES, NOT ONE:
  :1409  `not available at ${deck.status ?? "this stage"}` — interpolates a STAGE
         LABEL, so "as" reads oddly ("not available as Shortlisted"). Pinned at
         test/client/allDecks.test.tsx:843 and :872.
  :1406-1408  emits the bare Status word with NO PREFIX at all — this is where his
         "as incomplete contact details" / "as incomplete" family belongs.
Fix both. His row 1 asks for "AT" → "AS", but only the second branch is the one he
saw.

ROW 7 — THE LATCH, AND ITS ONE EXCEPTION. No action is active once Send to Assign
/ Send to Query / Archive has been used. Three signals, all on the DeckView you
already receive — no new fetch:
  Archive         statusId === "archived" (isArchivedDeck, deckStats.ts:446-448),
                  plus exitAction / exitAt (routes/decks.ts:128-132)
  Send to Query   deck.queried (query_count > 0)
  Send to Assign  the NEW sendToAssignAt marker S2-SERVER adds — a pipeline_events
                  row with from_stage === to_stage, the same shape as edit_contact
                  (routes/decks.ts:926-927). Today NOTHING records this click:
                  :1495 calls navigate("/app/assign") and writes nothing.
THE EXCEPTION: his own open item requires archiving a queried deck whose founder
never responded, and "Incomplete, Queried" is a latched sink. Re-arm exactly one
action — "Archive (no response)" — on a queried deck past the 5-working-day window
(S2-SERVER serves the fields; queryStatusOf at shared/queries.ts:328-333 already
has the rule). Row 7 and his open item cannot both hold literally; this is the
narrowest exception that satisfies both. Comment it as such.

THE TRANSIENT ZERO-BUTTON STATE. His "Contact details edited" row asks for a state
with no buttons while the system re-checks. Today rowBusy (:1474) only disables the
menu while a save is in flight — generalise that, do not invent storage. The
re-check is synchronous with the PATCH, so the state lives for one request.

THE STATUS CELL MUST BECOME ONE SORTABLE STRING, and that is a prerequisite, not a
sibling. Today it is a pill (:1806) plus up to four additive chips — Assigned,
Queried, Contact Details Edited, Archived (:1804-1837). His "Incomplete contact
details, Edited" is a single composed value. Merge the pill and the chips into one
ordered string from S0-VOCAB's function, THEN sort.

THE SORT IS NEW CONSTRUCTION. There is NO column-sort primitive anywhere in the
client: aria-sort, SortableHeader, onSort, sortDir, setSort, ArrowUpDown, ChevronUp
all return zero hits under src/client/. Headers are plain <th> from
ALL_DECKS_COLUMNS[shape] (:2291-2295, sets at :242-243) and `rows` is sorted once,
unconditionally, by activityAt desc (:1009-1017), reproducing the prototype's
(b.act||0)-(a.act||0). Keep activity as the default; add Status as a toggle.
"All stat boxes" CANNOT be literal: every tile except Shortlisted shares the
v3Default shape, and v3Shortlisted (:243) HAS NO STATUS COLUMN. Say so in a comment
and in your handoff note.

TWO ONE-LINE ITEMS HANDED TO YOU BY OTHER SESSIONS:
 1. From S2-UPLOAD: add `flag_incomplete` to V3_EXCLUDED_ACTIONS (:1325). Row 2
    deletes "Mark incomplete" from the upload screen because the client says the
    product automates it — but flag_incomplete stays live in YOUR row menu, so a
    manual_review deck still renders "Flag incomplete" as an active option. Removing
    the upload button without this just moves the capability.
 2. From S0-VOCAB: allDecks.test.tsx:661 pins archived-rows-stay-visible. It stays
    green; it now also needs a sortable Status on an archived row.

THE TRAP THAT WILL LOOK LIKE A REGRESSION, AND IS NOT. allDecks.test.tsx:1100-1106
records that Send to Query shipped DISABLED on 21-Sep, was UN-DISABLED on 23-Sep as
a correction, and the test was written as "the old one inverted, so the block
cannot come back unnoticed". The measured fixture at :1109-1124 is
{aiComplete:true, complete:true, missingFields:["founderEmail"]} — the client's
"Incomplete contact details" deck — and it asserts Send to Assign DISABLED and Send
to Query ENABLED. His row 4 says BOTH must be disabled. The comment block that
exists to prevent that regression now documents his requirement as a regression.
DELETE THE COMMENT WITH THE TEST. Do not "fix" the test to keep it green.
Same for the tooltip at :144-149, which literally tells the operator "this deck is
on Query, not Assign" — row 3 makes that sentence false.

EVERYTHING YOU DO SHIPS FOUR TIMES. isV3Dash (:750-755) = incubator × {superuser,
admin, program_manager, program_associate}. The pin is the it.each at
allDecks.test.tsx:939, which runs the whole V3 contract per role — 3 test instances
move together. Do NOT add "jury" to isV3Dash: the juror keeps juryPill's own five
words (:438-447) and is untouched by his row 6.
~12 of allDecks.test.tsx's 35 declared tests move (:691, :736, :774, :814, the
it.each at :939, :1072, :1107, :1136, :1151), and all 8 of 9 in deckHandoff.test.tsx
are conditional on the "Dashboard" ambiguity — if the client's answer to Q9 comes
back as "a genuine second row", that file is rewritten, not adjusted. Flag it and
proceed on the reading in the plan.

Gate: `npm run typecheck && npm run lint && npm test && npm run build`.
DO NOT run npm run test:e2e, playwright, or npm run roles. e2e/all-decks.spec.ts
has 4 status-word assertions across 2 tests — put them in your parity patch.
```

### 7.4 S2-SERVER — the gate, the marker, the recorded send

```
Repo: /Users/jayanthkomarraju/Documents/GitHub/startup-jury. Worktree from `main`
AFTER F-FOUL and S0-VOCAB both merge. F-FOUL already changed
routes/pipeline.ts and routes/assignments.ts — YOU DO NOT OWN THOSE TWO FILES.
Parallel with S2-DASH, S2-CHROME, S2-ADMIN, S2-UPLOAD.
export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"

YOU OWN, EXCLUSIVELY:
  src/server/routes/decks.ts
  src/server/ai/evaluate.ts
  src/pipeline/incubator.ts                 (NOTE: src/pipeline/, NOT src/server/pipeline/)
  src/server/config/scoringSettings.ts
  src/server/routes/config.ts
  src/server/scheduled.ts
  migrations/0082_ai_gate_threshold.sql     NEW
  test/worker/ai-complete.test.ts
  test/worker/screening-status.test.ts      NEW
Consume S0-VOCAB's exports; do not edit src/shared/. Any e2e change goes out as
docs/parity-requests/s2-server.patch.

FOUR THINGS, and only one of them is schema.

1. THE GATE BECOMES CONFIGURABLE, AND "AT OR ABOVE" WINS.
   src/server/ai/evaluate.ts:27 is `const GATE = 5; // strictly-greater-than gate
   from the flow diagram.` and :488 is `total > GATE`. The client's check (3) is
   "at or above the threshold". A deck scoring exactly 5.0 is Complete under his
   spec and Rejected under ours — ONE CHARACTER. Ship `>=`.
   He says "the threshold" and the build has THREE: this GATE; the org-wide
   shortlist_threshold (org_scoring_settings, migrations/0026:40, default 7.0); and
   the cohort buckets threshold_best / threshold_mediocre (0001_init.sql:24-25).
   routes/decks.ts:95-100 already records a past confusion between two of them. His
   is the GATE. Migration 0082 adds:
     ALTER TABLE org_scoring_settings ADD COLUMN ai_gate_threshold REAL NOT NULL
       DEFAULT 5.0 CHECK (ai_gate_threshold BETWEEN 0 AND 10);
   Surface it through loadScoringSettings (config/scoringSettings.ts, the COLUMNS
   list and the row mapper) and routes/config.ts, exactly as shortlistThreshold is
   surfaced. Then DELETE the constant — do not leave a fallback constant beside a
   setting, that is how three thresholds became three.
   WHY 0082 AND NOT LATER: org_scoring_settings is keyed on `edition` and is
   rebuild #1 in plan_multitenancy.md §5e. A column authored after that rebuild is
   authored against a CREATE TABLE ..._new that does not enumerate it.

2. A BELOW-THRESHOLD DECK MUST WAIT, NOT BE MOVED. FAIL_STAGE.incubator =
   "rejected" (evaluate.ts:62-65) must stop firing. A sub-gate deck lands at
   `ai_evaluated` with ai_score <= threshold and STAYS there. This is the behaviour
   change with zero storage cost that makes his "Below threshold" and "Edited,
   below threshold" states REACHABLE — measured, they are unreachable today: the
   only sub-gate decks in the seed are creditbri (4.3, already `rejected`) and
   solarc (3.8, `archived`), and nothing <= 5 waits at ai_evaluated.
   Consequence to land with it: reject_ai_gate (src/pipeline/incubator.ts:81-87) is
   labelled "Reject (below AI gate)" and is offered ONLY from ai_evaluated — i.e.
   today only on decks that PASSED the gate, which makes the label false. After
   this change it is finally the Reject button his matrix draws. Fix the label's
   justification comment too.

3. THE send_to_assign MARKER — NO MIGRATION. pipeline_events already carries a
   non-transition marker with from_stage === to_stage: edit_contact at
   routes/decks.ts:926-927, whose own comment explains the shape AND notes that the
   exit-reason columns select on to_stage IN ('rejected','archived') so a marker
   never pollutes them. Write send_to_assign the same way, and serve it as
   `sendToAssignAt` via one MAX(created_at) subquery beside contact_edited_at
   (:121).
   DO NOT IMPLEMENT IT AS THE `assigned` STAGE. DashboardPage.tsx:1316-1320 records
   that POST /decks/:id/transition will move a deck to `assigned` with assigned_to
   still NULL — which is EXACTLY the shape of the client's feedback row 12 Foul
   ("startups without any decks, assigned to Jury... cannot be going to assign
   stage"). His Send-to-Assign row and his row 12 pull in opposite directions, and
   the marker is what satisfies both: the deck latches and joins the Assign roster,
   and assigned_to keeps meaning a real evaluator.

4. ROW 3 — DELETE THE AUTOMATIC PARTITION, SERVER SIDE. routes/decks.ts:528-531:
     const routed = (views) => list === null ? views
       : views.filter(v => deckListRoute(v, edition, {queried: v.queried===true}) === list);
   S0-VOCAB has already changed deckListRoute so its Query arm requires a recorded
   action and its Assign arm is unchanged. Your job is the route: `?list=query` now
   means "queried", not "derived as incomplete". Re-read the comment at :526-527 —
   "the server and the screens read the same shape through the same function, never
   two implementations of it" — and keep that property.
   Also serve the two NO-RESPONSE fields as derived columns, no schema:
   the latest query's created_at, and whether it was answered. DeckView.queried is
   a boolean over query_count (:118, :366) and throws away exactly what is needed.
   queryStatusOf (shared/queries.ts:328-333) already has the 5-working-day rule.
   The archive REASON needs nothing: exit_note already reads pipeline_events.note
   (:130), so "Archived — no response" is an archive event with a note.

THE CRON SWEEP (his own open item). src/server/scheduled.ts:190 is
`for (const edition of ["incubator","vc"] as const)`. Add the no-response sweep
INSIDE that loop — do not add a second top-level loop. Two warnings:
 · scheduled.ts is T1-PEOPLE's file in the tenancy wave, and it runs with NO
   SESSION and therefore no tenant. It is the one genuine leak site in this whole
   body of work (the correlated pipeline_events subqueries inherit the deck's
   scope; this does not). Write the sweep so a tenant key can be threaded through
   it later without restructuring, and say so in a comment addressed to T1-PEOPLE.
 · The sweep is the ONE exemption from feedback row 7's latch. Say so where the
   latch is described, not only here.

THE LIVE DEFECT TO FIX WHILE YOU ARE HERE — but the file is F-FOUL's, so hand it
over rather than editing it: routes/pipeline.ts:770-771 —
  const toEmail = deck.founder_email ?? uploader?.email ?? "founder@portal.local";
— POST /decks/:id/queries emails a deck with no founder email, mints a resubmit
token, and sends both to a placeholder address. That is the client's stated reason
for row 3, verbatim. After your partition change nothing ARMS it automatically any
more, but the path is still live if called directly. Put it in your handoff note as
a one-line ask for the integration session (or for F-FOUL if it has not merged).

Gate: `npm run typecheck && npm run lint && npm test && npm run build`.
DO NOT run npm run test:e2e, playwright, or npm run roles.
Traps: test/worker/ai-complete.test.ts:153 asserts deckListRoute READS the
incomplete mark, and :280 asserts the edit_contact event names the fields that
changed. The first moves with row 3; the second is a TRIGGER MISMATCH to flag, not
fix — his matrix fires "Contact details edited" on Edit CLICKED, our event is
written only when a field actually changed. Clicking Edit and saving nothing
produces our status and not his. Flag it as a client question; do not guess.
Worker tests share DB state despite the setup file's claim — if four tests fail
together and look like an authZ bug, suspect shared state first.
```

### 7.5 S2-CHROME — "Move to Dashboard", and the Query select-all

```
Repo: /Users/jayanthkomarraju/Documents/GitHub/startup-jury. Worktree from `main`
AFTER F-FOUL and S0-VOCAB merge. Parallel with S2-DASH, S2-SERVER, S2-ADMIN,
S2-UPLOAD.
export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"

YOU OWN, EXCLUSIVELY:
  src/client/components/AppShell.tsx
  src/client/components/PanelFrame.tsx
  src/client/components/Sidebar.tsx
  src/shared/nav.ts
  src/client/routes/QueryPage.tsx
  test/client/queryPage.test.tsx
  (+ any nav unit test you must move — name it in your handoff note)
Any e2e change goes out as docs/parity-requests/s2-chrome.patch.

ITEM 1 — FEEDBACK ROW 10: "Move to Dashboard" on EVERY sidebar screen.
The string returns ZERO hits across src/, test/, e2e/ and docs/*.md — I grepped it.
It is new on 24-Sep, and it is in NONE of the 13 prototype sources nor in any
*_B64 payload decoded from them.

Read the literal ask first, because half of it already exists. `alldecks` sits in
the persistent rail on every authenticated screen (AppShell.tsx:71-73 → <Sidebar>),
and shared/nav.ts:78-110 overrides its LABEL to "Dashboard" and its icon to
LayoutDashboard for superuser, admin, program_manager and program_associate. It
still reads "All decks" / Layers for jury and every VC role — THAT is the only gap
on the literal reading, and it is a labelOverrides change.

His justification is the other reading: "useful if a deck is moved to a wrong
screen by mistake". In this architecture that is a NO-OP and you must not build
machinery for it. Screens are FILTERS, not locations: matchesV3Stat(deck,"all")
returns true unconditionally, archived included (src/shared/deckStats.ts:584-586),
and Assign/Query membership is derived per read, never stored. There is no "which
screen is this deck on" to reset. The only thing that CAN be wrong is the STAGE,
and the affordance for that already exists — `restore` (src/pipeline/incubator.ts:
168-179, "Restore", rejected|archived → ai_evaluated), already rendered in the
Dashboard row menu. Put this in your handoff note as a client question; ship the
nav reading meanwhile.

SHAPE — pick the uniform one and say why. PanelFrame/PageToolbar already takes an
`actions` node (PanelFrame.tsx:22, :29-37, :58), so a shared <ToolbarButton> →
/app/alldecks is one component plus one prop per screen. BUT only six route files
adopt PanelFrame (DashboardPage, EvaluatePage, ConfigPage, MyParamsPage,
VcEvaluatePage, analytics/AnalyticsKit); QueryPage, AssignPage, ReviewScreen and
the rest still hand-roll .tb / sj-frame, so a toolbar-prop approach touches every
non-adopter individually — and those files belong to other sessions in this wave.
SHIP ONE INSERTION IN AppShell.tsx ABOVE THE <Outlet/>: one file, at the cost of
not living inside each screen's .tbr strip the way the prototype does. Note that
cost in a comment so a later parity pass knows it was a choice.
"Move to Dashboard unaffected by any status" is the one universal in his document
that the current model satisfies for free. Say so.

ITEM 2 — REMOVE THE SELECT-ALL CHECKBOX ON THE QUERY SCREEN.
QueryPage.tsx:617-635 — the header <th> holding
`<input type="checkbox" aria-label="Select all startups">` (verified at :621),
backed by toggleAll (:261-266) and allVisibleSelected / someVisibleSelected
(:317-319). His reason: "not relevant since each deck has distinguished missing
items."
 · KEEP THE <th> as an empty w-[38px] cell so the body's per-row checkbox <td>
   (:652-660, aria-label="Select {name}") stays aligned. THE PER-ROW BOXES STAY —
   he removed only the header one.
 · toggleAll, allVisibleSelected and someVisibleSelected then become unused. Delete
   them; do not leave them behind a lint suppression.
 · NOTHING PINS THIS. `grep -rni "select all" test/ e2e/` matches only
   test/client/evaluateV3.test.tsx ("Select all decks") and
   test/client/vcEvaluate.test.tsx ("Select all") — DIFFERENT SCREENS. DO NOT TOUCH
   THEM. If you find yourself editing either file, you have the wrong screen.

Gate: `npm run typecheck && npm run lint && npm test && npm run build`.
DO NOT run npm run test:e2e, playwright, or npm run roles.
Soft collision to be aware of, not to act on: parity W10-A owns Topbar.tsx and
src/client/auth/**, and src/client/auth/usePermissions.ts reads isInSidebar. W10
has not started. If your AppShell insertion needs a permission read, use the
existing helper rather than adding one.
```

### 7.6 S2-ADMIN — hide the Sign-up group

```
Repo: /Users/jayanthkomarraju/Documents/GitHub/startup-jury. Worktree from `main`
AFTER F-FOUL and S0-VOCAB merge. Parallel with the other four S2 sessions.
export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"

YOU OWN, EXCLUSIVELY:
  src/client/routes/admin/sections.ts
  src/client/routes/admin/AdminConsole.tsx
  src/client/App.tsx                       (prose only)
  test/client/adminConsole.test.tsx
Any e2e change goes out as docs/parity-requests/s2-admin.patch. You do NOT own
e2e/admin-console.spec.ts.

FEEDBACK ROW 11: "Admin console: the Sign up section should be HIDDEN (next
release)."

THERE IS NO SECTION LABELLED "Sign up". Decoding ADMIN_B64 from
docs/prototype/source/incubator/AISJ_ICAdmin_V6.html gives
secs=['fw','wt','rb','qb','tm','crm','bl','pc','sudocs','suagr','susign','suseat',
'nt','al','uc','br'] and `<div class="sb-lbl">Sign-up</div>` — "Sign-up" is a rail
GROUP HEADING. Row 11 is the WHOLE GROUP: four sections per edition.
  AdminSectionGroup = "Sign-up"        sections.ts:24, listed :27-32, and in
                                        ADMIN_ONLY_GROUPS :63
  sudocs :223 · suagr :239 · susign :255 · suseat :273 / sufund :290 (edition swap)
  assembled at adminSections() :378-386
(susign alone is "Authorised signatories" — if he meant only that one, the change
is one line instead of this session. Ship the group; it is his prototype's own
markup. Flagged as a client question.)

FOLLOW THE `pc` PRECEDENT EXACTLY (sections.ts:200-219, the Price configuration
removal): components STAY MOUNTED in the registry (admin/registry.tsx:61-65), and
SERVER ROUTES STAY. Removing a rail entry is not unguarding a route. Do not touch
src/server/routes/signup-config.ts (:796-806 gates suseat/sufund by edition) or
src/server/esign/routes.ts:4-7.

FIFTEEN PINS ON THE COUNT — find every one before you change a number. 15 today,
11 after:
  test/client/adminConsole.test.tsx:38-54  INCUBATOR_LABELS (15 labels, exact and
                                            ordered), asserted at :225
  :110  test NAME "declares fifteen sections in four groups"
  :112  expect(sections).toHaveLength(15)
  :115  expect(new Set(...).size).toBe(15)
  :120-146  SECS, 15 [id,label] pairs, + the VC map at :145
  :175  expect(adminSectionsFor("incubator", role)).toHaveLength(15)
  e2e/admin-console.spec.ts:56  test TITLE "walks all 15 admin console sections"
  e2e/admin-console.spec.ts:75  expect(sections).toHaveLength(15)
  e2e/admin-console.spec.ts:216 expect(visible).toHaveLength(11)  ← THE TRAP

THE TRAP, IN REVERSE, AND IT IS THE WHOLE REASON THIS SESSION EXISTS SEPARATELY:
e2e/admin-console.spec.ts:216 asserts ELEVEN visible sections for a NON-ADMIN.
Non-admins never saw the Sign-up group (ADMIN_ONLY_GROUPS, sections.ts:63), so
removing the group leaves that number at 11 AND IT MUST NOT BE CHANGED — whereas a
single-section removal from any OTHER group would move it. That asymmetry is
exactly what the comment at e2e/admin-console.spec.ts:213-217 was written to
record for `pc`. Read it before you touch anything.

ASSERTIONS THAT INVERT RATHER THAN RE-COUNT — rewrite these, do not renumber:
  adminConsole.test.tsx:114  [...new Set(sections.map(s=>s.group))] toEqual
                             ADMIN_SECTION_GROUPS — fails unless "Sign-up" also
                             leaves ADMIN_SECTION_GROUPS
  :151-160  the whole suseat↔sufund edition-swap test has NO SUBJECT LEFT
  :167 and :170-186  "restricts the Sign-up group to admin and superuser" becomes
                     vacuous for every role
  :234-247  "hides the whole Sign-up group from a role that is not admin or
            superuser" likewise
  e2e (your parity patch): :66 the group loop, :173-182 the edition swap, :196-207
  the five Sign-up labels asserted ABSENT for non-admins, :220-225 the deep link to
  ?section=sudocs

PROSE TO CORRECT, not assertions: admin/AdminConsole.tsx:55 ("sixteen sections")
and :62, and src/client/App.tsx around :79 ("sixteen-section overlay"). These are
already wrong by one (Price configuration went) — fix them to the new truth and say
what the number counts.

REMEMBER: /app/admin lands on Scoring framework by default, so a section list
change moves the `admin` parity row. Note it for the integration session.

Gate: `npm run typecheck && npm run lint && npm test && npm run build`.
DO NOT run npm run test:e2e, playwright, or npm run roles.
```

### 7.7 S2-UPLOAD — delete "Mark incomplete"

```
Repo: /Users/jayanthkomarraju/Documents/GitHub/startup-jury. Worktree from `main`
AFTER F-FOUL and S0-VOCAB merge. Parallel with the other four S2 sessions.
export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"

YOU OWN, EXCLUSIVELY:
  src/client/routes/upload/ReviewScreen.tsx
  src/client/routes/UploadPage.tsx
  src/client/routes/upload/types.ts
  test/client/upload.test.tsx
Any e2e change goes out as docs/parity-requests/s2-upload.patch. You do NOT own
DashboardPage.tsx — see the handoff below.

FEEDBACK ROW 2: on the "Review uploaded decks" screen, DELETE the "Mark
incomplete" button — "not required since we have automated this part".

WHAT IT IS, EXACTLY — and it is smaller than it looks:
  Button    ReviewScreen.tsx:317-331, label at :330
  Screen    "Review uploaded decks", step 2 of Upload (ReviewScreen.tsx:99,
            mounted at UploadPage.tsx:449)
  Handler   UploadPage.tsx:459-460 —
            patch(key, d => ({ markedIncomplete: !d.markedIncomplete, checked: false }))
  Server    NONE. This is PURE CLIENT STAGING STATE (upload/types.ts:44). It is NOT
            `flag_incomplete`, which is a real transition (manual_review →
            incomplete, src/pipeline/incubator.ts:56-62) fired at
            src/server/routes/pipeline.ts:750-755 as a side effect of raising a
            query. Do not conflate them.

THREE THINGS IT STRANDS. Decide each deliberately and comment the decision:
 1. isUploadable (ReviewScreen.tsx:42-44) — markedIncomplete is the ONLY way to
    exclude a staged file from the AI batch. Without the button, the "Marked
    incomplete" filter (:32, :37, :54) and the footer counter
    `{excluded} marked incomplete (excluded)` (:92, :195) and the badge at :306 are
    permanently zero. Remove them; do not leave dead chrome that can never fire.
 2. isFlaggable (:47-50) gates the "Parameters needing response" panel and its Send
    to Query (:431-…). After removal it fires only for a deck the AI ITSELF landed
    at `incomplete` — which is precisely the automation the client is invoking, so
    this is the INTENDED consequence, not a regression. :388-390 already tells the
    operator that flagging needs the deck on file; keep that note.
 3. A SECOND-ORDER EFFECT to record in your handoff note, not to fix:
    v3StatusKey's fall-through arm is justified by "the manual flag_incomplete
    route" (src/shared/deckStats.ts:503-509). With the manual mark gone that
    justification thins. S0-VOCAB has already rewritten that function; tell the
    integration session so the comment does not survive its own reason.

THE ONE-LINE ASK YOU HAND TO S2-DASH — send it as a note, do not edit their file:
add `flag_incomplete` to V3_EXCLUDED_ACTIONS (DashboardPage.tsx:1325, which today
withholds only assign_jury and complete_signup). Otherwise a manual_review deck
still renders "Flag incomplete" as an ACTIVE option in the Dashboard row menu — a
hand-made Incomplete deck, the exact thing row 2 says is automated. Removing the
upload button without this just moves the capability.

PINS: test/client/upload.test.tsx:213 ("Mark incomplete"). In your parity patch:
e2e/upload.spec.ts:117 and e2e/vc-intake.spec.ts:191.

ASK, DO NOT ASSUME: e2e/vc-intake.spec.ts:191 means this button exists in the VC
edition too. The client's feedback is written about the incubator screens. Put
"is row 2 incubator-only, or both editions?" in your handoff note as a client
question and ship it for BOTH unless told otherwise — a button he called
unnecessary is unnecessary in both, and keeping it in one edition only is the
harder thing to explain.

Gate: `npm run typecheck && npm run lint && npm test && npm run build`.
DO NOT run npm run test:e2e, playwright, or npm run roles.
Trap specific to this repo: a NEW client file's NAME can redden an unrelated spec,
because vite dev fetches modules over HTTP. If you add a file, pick a name that
collides with nothing under src/client/routes/.
```

### 7.8 S-INT — integration

```
Repo: /Users/jayanthkomarraju/Documents/GitHub/startup-jury. Integrate the
screening wave onto `main` after F-FOUL, S0-VOCAB and all five S2 sessions merge.
export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"

YOU OWN: e2e/**, docs/plan_*.md, HANDOFF.md, and the merge itself.

1. APPLY EVERY PARITY PATCH, AND CHECK EACH ONE FIRST.
   `git apply --check docs/parity-requests/*.patch` before applying anything. Four
   patches have previously sat unapplied for one to two waves in this repo; a patch
   that no longer applies is a finding, not a formality. Expect:
     s2-dash.patch     e2e/all-decks.spec.ts — 4 status-word assertions in 2 tests
     s2-server.patch   e2e/query.spec.ts
     s2-chrome.patch   the Query select-all header
     s2-admin.patch    e2e/admin-console.spec.ts :56, :66, :75, :173-182, :196-207,
                       :220-225 — and :216 MUST STAY AT 11 (non-admins never saw the
                       Sign-up group; read the comment at :213-217 first)
     s2-upload.patch   e2e/upload.spec.ts:117, e2e/vc-intake.spec.ts:191
   e2e/upload.spec.ts is a three-way collision path (this wave, R2-UPEVAL, and
   My Account's S-INT at :164 — plan_myaccount.md:284 records the first two). Check
   whether the My Account wave has moved that line before you do.

2. RUN THE TWO SPECS F-FOUL IS MOST LIKELY TO HAVE BROKEN, FIRST AND ALONE:
     e2e/assign.spec.ts            (:27, :75 assign inc_deck_greengrid BY NAME)
     e2e/evaluate-workbench.spec.ts (:39 asserts the graceful no-PDF path AS CORRECT)
   F-FOUL changed the seed so 30 decks now HAVE files. Eighteen test/e2e files name
   a fileless seed deck. If evaluate-workbench goes red because a PDF now loads,
   that is the seed fix working and the spec's premise expiring — rewrite the spec,
   do not revert the seed. Verify inc_deck_pitchloop STILL has r2_key NULL; it is
   the deliberate exception.

3. THE FULL GATE, IN ORDER, ON AN IDLE MACHINE:
     npm run typecheck && npm run lint && npm test && npm run build
     npm run parity:nav && npm run parity:tokens
     npm run smoke
     npm run roles          (needs a server running — a roles run with no server is
                             a trap that fakes a pass)
     npm run test:e2e       (needs a CLEAN seed — `rm -rf .wrangler/state` first;
                             e2e on a dirty seed is the second trap that fakes a pass)
   The whole gate is ~4.5 minutes on an idle box. Every "flaky suite" report in this
   repo's history has been ambient load, mostly self-inflicted — do not run two
   suites at once and then reason about the failures.
   One known hazard: ONE e2e run can exhaust all 16k ports, because a miniflare
   line opens a fresh socket per proxied dev request. Fewer workers is a rate
   limiter, not a fix. If you see EADDRINUSE, that is this, not your changes.

4. MIGRATE BEFORE DEPLOYING. The deployed D1 drifts behind the repo every wave, and
   0038 breaks on real data. 0081 (F-FOUL's seed) must be applied with the R2
   bootstrap's --remote variant, or it writes keys with no objects behind them —
   which is worse than NULL, because it makes a column-only guard pass. Run
   F-FOUL's three production SELECTs first (they need `wrangler login`; the current
   token has no D1 scope).

5. RECONCILE THE PLAN FILES, then log the wave at the end of HANDOFF.md with the
   measured baselines (unit/worker/client, e2e, smoke, roles). Update
   docs/plan_multitenancy.md §11 to say the screening wave has merged and the T1
   prompts must be REGENERATED against the new HEAD — T1-DECKS' `owns` block is
   unchanged, only its weight, and the weight goes DOWN.

Commit messages end with:
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## 8. Questions for the client

Each with the fallback we ship if he does not answer.

| # | Question | Fallback we ship |
|---|---|---|
| Q1 | The assigned status: is it **"AI Evaluated, Assigned"** (your matrix and your final-status list) or **"Complete, Assigned"** (your numbered list 6)? | "AI Evaluated, Assigned", used everywhere. |
| Q2 | Is your six-item status list the **filter/sort options**, with the matrix's fuller set as the **displayed pill**, or are they meant to be the same list? | Six = the filter list; the matrix set = the pill. Your list has no word for *Both incomplete*, *Below threshold*, *Rejected* or **Archived**, and Archived is a sink you name yourself. |
| Q3 | A deck that has been uploaded but not yet AI-evaluated has no word in your list, and it is one of your six stat boxes. What should the pill say? | **"Awaiting AI evaluation"**, and the box stays. |
| Q4 | On **Incomplete deck** (deck thin, contact complete), is **Send to Query active?** Your matrix lists it in neither column but uses it in that row's own *next*; your row 5 makes the enabling event impossible, because it requires contact to be edited and the contact is already complete. | **Active.** Your own reason for row 3 is that a deck with incomplete *contact* cannot be emailed — here the contact is fine. Otherwise the state has no exit. |
| Q5 | **Archive** is disabled on *Incomplete deck* and active on *Both incomplete*, which is a strictly worse deck. Which is right? | **Active on both**, and on every state. |
| Q6 | Are your six status words the **Dashboard pill only**, or the product's whole status vocabulary — i.e. should the Upload review screen and the Assign/Query screens adopt them too? | Dashboard pill only. The other screens' words stay until you say otherwise; adopting them everywhere is a much larger change. |
| Q7 | **"A copy on the Dashboard; the original stays on the uploaded status screen"** — do you mean the deck appears on **two screens at once** (our reading), or that a genuine **second record** is created? | Two screens at once. A second record would be counted twice in your Uploaded box and move every percentage in the rail. |
| Q8 | On **Complete** you allow only Send to Assign — no Edit, no Archive. Should a typo in a complete deck's contact details be correctable, and should a complete deck be settable aside? | **Yes to both** — Edit and Archive stay active. |
| Q9 | **"Send to Query" and "Send to Assign": do you want the click itself recorded**, or is "used" satisfied by "the deck has been queried / assigned"? Today those buttons only move the operator to another screen and write nothing. | We record the click as a marker. It is what your row 7 latch needs, and it lets a deck join the Assign roster without falsely claiming a juror. |
| Q10 | **Threshold**: your check (3) is the **AI screening gate**, not the shortlist floor and not the cohort rating bands — correct? And should it be admin-settable per organisation? | The AI gate, made admin-settable with a default of 5.0. |
| Q11 | **"At or above the threshold"** — the code today rejects a deck scoring exactly 5.0. Shall we change it so 5.0 passes? | Yes, `>=`. One character, and one seeded deck changes verdict. |
| Q12 | **Row 11, "the Sign up section"**: the whole **Sign-up group** (four sections: Documents, Agreements, Authorised signatories, Seat capacity / Fund deployment), or only **Authorised signatories**? | The whole group. Your prototype's own markup makes "Sign-up" a group heading. |
| Q13 | **Row 2, "Mark incomplete"**: incubator only, or the VC edition too? | Both. A button you called unnecessary is unnecessary in both, and keeping it in one is harder to explain. |
| Q14 | **Your open item.** Decks in the Incomplete box that were Queried and whose founder never responds: after how many days, is it automatic or one click, and does the archived row read **"Archived — no response"** or stay in Incomplete with a "no response" status? | Automatic after **5 working days** (the rule the product already uses for "overdue"), moving to **Archived with the reason "no response"**, surfaced by the new Status sort. This is also the one exception we make to your row 7 latch, which otherwise forbids any action on a queried deck — the two cannot both hold literally. |
| Q15 | **Payments — this reverses your 24-Sep answer.** On 24-Sep you said keep GST and charge it on the USD total. Your checklist now asks for an LUT and 0% GST on exports, plus USD for international and INR + 18% for Indian customers. Confirming the checklist wins? | The checklist wins, and it is **a saving**: the code already taxes only INR, so we delete a planned change rather than build one. We will record this as your decision, and we need it in writing from your CA, plus the LUT ARN and the real GSTIN before any invoice is issued. |
| Q16 | **Row 10, "Move to Dashboard on every sidebar screen"** — do you mean the sidebar entry should read "Dashboard" for *every* role (it already does for superuser, admin, PM and PA, but not jury or VC), or a per-deck "put this back" button? | The sidebar reading, plus one toolbar link on every screen. A per-deck "put it back" has nothing to reset: screens are filters, not locations, and a deck is never removed from the uploaded screen. The one thing that *can* be wrong is the stage, and "Restore" already fixes that. |

---

**Size, honestly.** Screening is three waves and ~2.5–3 weeks: F-FOUL and S0-VOCAB in parallel, then five sessions in parallel, then integration — plus the one pre-wave commit that clears the migration number line while nothing is in flight. The payment items are an amendment to the My Account wave's S-CAT, net level in size and smaller in tax logic than planned. Tenancy does not move in scope but does move in time: it starts after screening merges, and its T1 prompts are regenerated against the newer HEAD, where T1-DECKS' weight is lower than 263 rather than higher.
