# OCT2-AIGATE — the gate the admin could not reach

**Lane:** issue 4 — *"Right now the selected threshold is not working on decks
evaluation. Even when I changed the threshold to 4, the decks I uploaded are
showing 4.8 as below threshold."*
**Date:** 2026-10-02. **Branch:** `main`, shared checkout with four sibling lanes.

Changed:

- `src/client/routes/admin/ScoringFramework.tsx`
- `test/client/scoringFramework.test.tsx`

**Verified complete and deliberately NOT changed** — see §2:

- `src/server/routes/config.ts`
- `src/client/routes/admin/scoringApi.ts`

---

## 1 · He is right about the symptom, and the cause is one screen away

Measured, not re-derived: production holds `shortlist_threshold = 4` and
`ai_gate_threshold = 5`. He set the one control this console exposes — the
Scoring framework's **Shortlist threshold** — to 4, and the screening verdict
(`shared/deckStats.ts` → `screeningStatus`, via `ratingAtOrAboveGate`) reads
`ai_gate_threshold`. So 4.8 really was below the gate that decides, the gate
really was still 5, and **no control anywhere in the client could move it**.

The number was not unsaved — it was unmovable. `GET /api/config/scoring` has
always served it and this section posts the whole `ScoringSettings` back on
every save, so the gate round-tripped through his save untouched while the
screen offered him the neighbouring threshold instead. That is the fourth
appearance of this product's standing fault (four thresholds, one labelled
box), which is why `deckStats.ts:855` carries a paragraph about it.

## 2 · The server half was already finished, and that is the honest answer

The brief said to verify before changing. Verified, twice over:

| Half | State | Proof |
|---|---|---|
| `PUT /api/config/scoring-framework` validates | complete (`config.ts:1104-1107`, own code `invalid_ai_gate_threshold`) | `test/worker/screening-status.test.ts` — `11` → 400 with that code |
| …and persists | complete (`config.ts:1154`, `:1168`) | same test — `6.5` lands in the column and `shortlist_threshold` does not move |
| `GET /api/config/scoring` serves it | complete (`config.ts:968` `scoring: settings`, via `loadScoringSettings`) | same file: `body.scoring.aiGateThreshold` is 5 beside a `shortlistThreshold` of 7 |
| `ScoringFrameworkView` carries it | complete — `scoring: ScoringSettings`, and `aiGateThreshold` is a **required** field of that shared type (`shared/scoring.ts:393`) | `test/worker/scoring-framework.test.ts` round-trips the whole object with `toEqual` |

So neither `config.ts` nor `scoringApi.ts` needed a line, and I wrote none in
them. The missing half was the control, and `recompute` correctly leaves the
gate out of `compositionChanged` — moving it does not change what a stored
composite *means*, so it must not re-score the edition.

## 3 · What shipped

One field in Card 2 · Score composition, immediately after **Shortlist
threshold** in the same grid, plus the thing the brief called the whole point:

- **`AI gate threshold`**, hinted *"The AI score a deck must reach to go to
  evaluators at all. Below it the deck reads Below threshold and can only be
  rejected or archived."*
- **`Shortlist threshold`** keeps its name — the prototype, the audit log
  (`Shortlist threshold changed from 6.5 to 7.0`) and four suites spell it
  exactly — and gains *"The blended AI + jury score a deck must reach to be
  shortlisted, applied after it has been evaluated."*
- The card's footer sentence said "the organisation's threshold" when there was
  one. It now names which, and says the gate is applied once, at scoring.

**Canonical 0–10 stored, the org's scale shown and typed**, the same W7-D
boundary as its neighbour (`toDisplayScale` / `fromDisplayScale`,
`SCORE_SCALE_BOUNDS` min/max, `step` 1 on 0–100). Without it a 0–100 workspace
that typed 40 would store 400 and the column's own `CHECK` would refuse the
save with nothing on screen to explain it. Its own negative control, below.

`Field` gained an optional `hint`, rendered **outside** the `<label>`. A
wrapping label's whole text is the control's accessible name, so folding the
sentence in would have renamed `Shortlist threshold` and reddened
`evaluateW7d.test.tsx` and `e2e/scoring-framework.spec.ts` — the comment on
`Field` says so, because the next person to add a hint will not otherwise know.

**Not gated on `aiPreScoringEnabled`**, deliberately, although the delta input
above it uses that pattern: a deck scored while pre-scoring was on keeps its
score and `screeningStatus` keeps reading the gate for it, so hiding the
control with the toggle would hide a number that is still deciding verdicts.

## 4 · The chain, link by link, and what holds each

Setting the gate to 4 now reaches the verdict, and every link already had a
test except the first:

1. console control → `aiGateThreshold` in the PUT body — **new**, §5 below.
2. PUT → `org_scoring_settings.ai_gate_threshold` — `screening-status.test.ts`.
3. column → `GET /api/config/summary` — `screening-status.test.ts` (6.5 → 3, and
   every screening role gets it).
4. summary → `DashboardPage` — `allDecks.test.tsx` ("raising the org's gate past
   it moves the same deck Below threshold").
5. gate → the word on the row — `test/unit/deckStats.test.ts`, and asserted
   again here: the new test hands `screeningStatus` the number the control just
   saved and expects his own deck (`ai_evaluated`, complete, 4.8) to read
   `complete` at the saved 4 and `belowThreshold` at the 5 he could not reach.

## 5 · Tests, and the negative control for each

`test/client/scoringFramework.test.tsx`, new describe `AI gate threshold (issue
4)`, 4 tests. Each control was applied, the suite run filtered to that describe,
then the file restored from a pristine copy and its md5 re-checked
(`19f95200866a88aff2386acfe983b071` every time — the tree is shared, so no
`git stash`, no `commit -a`).

| Test | Control: reverted | Result |
|---|---|---|
| on screen, named apart from the floor, each says what it governs | the whole `<Field>` | FAIL (4 tests) |
| | the `hint` prop only | FAIL (1) |
| saves the number the VERDICT reads — set 4, his 4.8 deck stops reading Below threshold | the whole `<Field>` | FAIL |
| | `aiGateThreshold` → `shortlistThreshold` on value+patch (his own confusion, in code) | FAIL (3) |
| converts on a 0–100 org: typed 40 stores 4, never 400 | `toDisplayScale`/`fromDisplayScale` dropped | FAIL (only this one — 0–10 is identity) |
| read-only for a role the server refuses | `disabled={ro}` | FAIL |

**One trap the controls exposed, worth knowing before adding a fifth test
here:** this file's `beforeEach` re-arms the mocks but never clears their call
log, and the describe above saves the DEFAULTS — so `mock.calls[0]` reads a
*neighbour's* save and a correct fix looks broken. Both saving tests
`mockClear()` first, with the reason on the line.

Green: client `scoringFramework` (35), `evaluateW7d`, `adminConsole`,
`areaWeights`; worker `screening-status` (35). `npx tsc` clean on both configs
for every file in this lane, `npx eslint` exit 0.

`test/worker/scoring-framework.test.ts` has **one failure that is not mine** —
`autoClarification` expected `false`, received `true`. A sibling lane has
flipped `DEFAULT_SCORING_SETTINGS.autoClarification` in `src/shared/scoring.ts`
and added `migrations/0102_auto_clarification_off_by_default.sql`; the seeded
test DB still holds 1. Reported, not touched.

## 6 · The deviation from the prototype, stated out loud

`admin/s-fw.html`, decoded out of `ADMIN_B64`
(`docs/prototype/tools/decode-embedded.py`), carries **exactly one** threshold
input — `Shortlist threshold`, `value="7.0" min="0" max="10" step="0.1"` — plus
the two cohort bands. There is no AI gate on it, because the gate did not exist
until migration 0082 replaced a hardcoded `GATE = 5`.

So this field is an addition beyond prototype parity, against a standing
instruction to match the prototype exactly, and it ships anyway: the client's
complaint *is* that the number deciding his verdicts is one he cannot choose.
Recorded here so the next parity audit reads it as a decision rather than drift.
The prototype's row grouping is untouched — it is a fifth cell in the same
two-column grid, which is what a third `fg fg-2` row with one child renders as.

## 7 · Cross-lane / not done

1. **The gate change is not audited, and every one of its neighbours is.**
   `auditScoringFramework` (`src/server/audit/events.ts:122`) emits
   `threshold_changed` for `shortlistThreshold`, plus a line for the scale, the
   formula, the split, the delta and all eight toggles — and nothing for
   `aiGateThreshold`. Now that an admin can move it, a verdict can change
   workspace-wide with no record of who did it. One `add(...)` beside the
   existing `threshold_changed`, with its own action name so a reader can tell
   the two thresholds apart. **That file is outside this lane; not touched.**
2. **No e2e assertion for the new control.** `e2e/scoring-framework.spec.ts`
   asserts presence by name rather than counting inputs, so it cannot redden —
   but it does not cover the gate either. Standing rule 3 forbade running
   playwright here.
3. **`/app/admin` lands on Scoring framework**, so this adds an input to the
   console's default section — the known blast radius for the `admin` parity row
   (`startup-jury-admin-console-default-section`). The parity harness was not
   run (load rules).
4. **Production moves the moment someone uses this.** It holds a gate of 5, so
   deploying changes nothing by itself; the first admin who sets 4 gets the
   behaviour the setting always promised, including the four sub-gate decks
   leaving the Assign roster via OCT1-AIGATE §2's filter.
5. **VC untouched.** This section is edition-agnostic and `aiGateThreshold` is
   per `(tenant_id, edition)` (0090), so a VC console edits the VC gate — which
   is what it already did through the save that round-tripped it. No VC
   behaviour changed; `VcEvaluatePage.tsx` / `VcDiligence.tsx` not opened, and
   `e2e/vc-intake.spec.ts` contains no reference to the scoring framework, the
   gate or `/api/config/scoring`.
