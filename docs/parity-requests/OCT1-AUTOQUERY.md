# OCT1-AUTOQUERY — stop auto-clarify firing where it must not

**Lane:** tester issue 4, and the ROOT of 5 and 6.
**Owned:** `src/server/config/autoQuery.ts` · `src/server/routes/pipeline.ts` ·
`src/server/ai/evaluate.ts` · `test/worker/auto-clarify.test.ts` (new) ·
`test/worker/pipeline.test.ts`.
**Date:** 2026-10-01.

---

## 1. What was wrong, as measured

All eleven decks the tester uploaded carried a `queries` row at
`email_status = 'sent'` with a fully composed letter and no reply. Two
independent causes, both in `maybeAutoClarify`, and the whole trigger was
untested — `grep -rn "maybeAutoClarify" test/ e2e/` returned nothing:

1. **Every missing CONTACT column arrived as a trigger.** `areasNeedingResponse`
   emits one `detail` area per absent intake column, and `maybeAutoClarify` fired
   on `areas.length > 0`. A blank phone number alone composed a letter asking the
   founder about their own phone number.
2. **Nothing asked whether there was a founder to mail.** The recipient was
   `input.founderEmail ?? uploader?.email ?? "founder@portal.local"`, so the
   common outcome of a staff upload was mailing the uploading analyst "Dear
   Founder, thank you for submitting…" about a company they do not run.

Those rows are what latched the Dashboard: `queried = true` collapses an
`incomplete` deck's `screeningStatus` to `"queried"`, whose
`V3_ACTIVE_ACTIONS.queried` is `[]`, so Edit and Archive became unreachable even
though they are in the right whitelists. **The latch is `DashboardPage`'s; the
rows were ours.** This lane stops the rows.

## 2. What shipped

### `src/server/config/autoQuery.ts`

* **`clarifiableAreas(areas)`** — drops `detail`-kind areas. Used for the trigger
  test *and* for the letter body, so a clarification is about weak or missing
  SIGNAL. Contact gaps are already handled by `notifyIncompleteDeck`'s resubmit
  mail, which fires from the same evaluation.
* **`clarificationRecipient(gate)`** — the one address a clarification may go to,
  or `null`. No fallback. `null` when the address is absent/unusable
  (`isValidEmail`, the same test intake wrote `missing_fields` with) **or** when
  `missingFields` is non-empty.
* **`autoClarifyBlock(gate)`** — the pure, exported, **authoritative** predicate:
  `disabled` → `no_contact` → `no_weak_signal` → `null`. `maybeAutoClarify` is
  built from the same two helpers in the same order, so the predicate and the
  path cannot drift.
* `maybeAutoClarify` now returns `{ triggered: false, reason: "no_contact" }`
  **before** the two weak-area reads and before the INSERT.
* **The uploader lookup is gone**, and with it `AutoClarifyInput.uploadedBy`. It
  existed only to supply the fallback recipient and the fallback greeting; past
  the gate, `founderName` is guaranteed present because
  `missingIntakeFields` reports `founder`.

### `src/server/routes/pipeline.ts`

* `DeckRow` + `loadDeck` now carry `d.missing_fields`.
* `POST /api/decks/:id/queries` refuses with **409 `{ error:
  "contact_incomplete", missingFields: [...] }`** when an **incubator** deck has
  no deliverable founder address. Placed after the `questions_required` /
  `invalid_subject` 400s (validate the request, then the state) so it catches
  both client wrappers — `createQuery` posts `{ questions }`, `recordQuery` posts
  `{ questions, subject }`.
* `toEmail` takes the guarded address on the incubator path, so no fake recipient
  is reachable there.
* Untouched on purpose: `POST /:id/send-to-query` (`routes/decks.ts`, another
  lane, and it inserts a placeholder and mails nothing).

### `src/server/ai/evaluate.ts`

Call site verified: it already passed `founderEmail: details.founderEmail` and
`missingFields` — **the merged, post-write values**, so the trigger decides on the
same contact state the Dashboard renders. `uploadedBy` removed from the call.

## 3. The one plan correction, measured

**The route guard is REACHABILITY, not completeness.**

The brief asked the route to read `missing_fields`, which maps to the client's
"Contact complete? No → Query disabled" branch. I built that first and it
**reddened two e2e specs**:

* `e2e/query.spec.ts` creates two decks, deliberately clears one contact column
  each (phone / city), and composes a real letter asserting
  `• Phone (missing detail)` in the body.
* `e2e/incubator.spec.ts:97` sends a query to `inc_deck_payroute`, which seeds at
  `missing_fields = 'founderPhone'` (`migrations/0023`), and expects
  `vikram@payroute.in` as the recipient.

Both are right and the branch as literally drawn is not: the Query screen's own
column is "Parameters needing response" and it lists `Phone (missing detail)` as
a thing to **ask the founder for**. A completeness guard deletes the screen's
purpose. The worker equivalent is pinned in `test/worker/pipeline.test.ts` —
widening the guard back to completeness fails `still sends to a reachable founder
whose contact block is only PARTLY filled`.

So the two paths are deliberately asymmetric, and the asymmetry runs the right
way round:

| | gate |
|---|---|
| **automatic** (`maybeAutoClarify`) | reachable **and** contact block complete |
| **manual** (`POST /decks/:id/queries`) | reachable |

The automatic path is stricter because a deck with an incomplete contact block
has *already* had the resubmit letter from the same evaluation — a second
automatic letter a second later is exactly the eleven-for-eleven noise reported.
An operator composing by hand is a person deciding, and keeps the looser rule.

**→ CLIENT QUESTION (§3-class, not yet in §3).** The diagram makes Query disabled
at INCOMPLETE CONTACT; the prototype's Query screen is built to ask for exactly
those missing details. Shipped reading: a human may query a reachable founder
about a missing phone; the AI may not do it unprompted. Confirm.

## 4. The caveat to state honestly

**Nothing was actually being mailed.** `outbox.ts:258` gates real delivery on
`Boolean(env.EMAIL && env.EMAIL_FROM?.trim())` and `EMAIL_FROM` is **empty in
production**, so every one of those eleven letters was *recorded*, not sent. This
was a **latent hole**, not a live leak — and it must close before the sending
domain is onboarded, because the day `EMAIL_FROM` is set is the day eleven
analysts start receiving founder mail. It is closed now on the paths in this lane.

## 5. Tests, each negative-controlled

Negative control = revert the fix, watch the named test fail, restore. Done for
every item below.

`test/worker/auto-clarify.test.ts` (new, 11 tests — the trigger had none):

| asserts | negative control |
|---|---|
| a weak deck with complete contact gets exactly one letter, to `ada@testco.example`, never the analyst | — (positive case) |
| the letter names a weak `parameters.name`; no contact labels | — (see note below) |
| **no `queries` row and no outbox row when there is no founder address** | replaced the early return with `?? "founder@portal.local"` → **failed** |
| **the analyst / `founder@portal.local` is never a `founder_query` recipient** | same revert → **failed** |
| **a half-filled contact block is not asked to defend its score** | same revert → **failed** |
| `no_contact` for `null`/`""`/`"   "`/`"ada@"`/`"not an address"` and for `missingFields: ["city"]`, writing nothing | same revert → **failed** |
| `no_weak_signal`, `disabled`, `already_open` | covered by the same revert run |
| **`clarifiableAreas` drops `detail` and keeps `section`/`parameter`** | made it `[...areas]` → **failed** |
| **detail-only areas ⇒ `autoClarifyBlock` is `no_weak_signal`** | same revert → **failed** |
| `autoClarifyBlock(gate) === null ⇒ shouldAutoClarify === true` (the direction that must always hold) | — invariant, see §6 |

`test/worker/pipeline.test.ts` (+4 tests, `seedDeck` gained `founderEmail` /
`missingFields`):

| asserts | negative control |
|---|---|
| **409 `contact_incomplete` from both wrapper payload shapes; 0 `queries`, 0 `email_outbox`, 0 `resubmit_tokens`** | neutered the `if` → **failed** |
| **the refusal names the missing columns** | same → **failed** |
| **a reachable founder with a partly-filled contact block still receives the letter** | widened the guard to `missing_fields` → **failed** |
| **§3 item 1 — an unreadable FILE with good contact stays queryable** | added `deck.status === "incomplete"` to the guard → **failed**, plus 11 more across `pipeline` + `screening-status` |
| **the VC arm is unchanged** | dropped the `edition === "incubator"` condition → **failed** |

Two honest notes:

* **`seedDeck` in `test/worker/pipeline.test.ts` had no `founder_email`.** Five
  existing tests were passing *on the bug* — they raised queries that went to
  `founder@portal.local`. The fixture now seeds a real address.
* **The letter-body "no contact labels" assertion is implied, not evidence.**
  Past the `no_contact` gate `missingFields` is empty, so no `detail` area can
  exist on that deck. `clarifiableAreas`'s real control is the predicate case.
  Inside `maybeAutoClarify` the filter is defence in depth; it is load-bearing in
  `autoClarifyBlock`, which other callers reach with no contact gate of their own.

**Verification run** (per the standing rules — no `npm test`, no e2e):

```
npx tsc -p tsconfig.worker.json          # clean
npx tsc -p tsconfig.json                 # clean for these files
npx eslint <the 5 files>                 # clean
npx vitest run --project worker \
  auto-clarify pipeline screening-status vc-pipeline questions resubmit \
  notifications permissions automation scheduled outbox tenant-scope decks \
  evaluate ai-complete assignments audit calls deck-file-guard deck-size \
  esign evaluate-w7d files-api-contract issuelog-aug2026 route-partition \
  scoring-framework signups upload-intake workbench alldecks-shortlist-hint \
  assignments-mine                       # all green
```

## 6. CROSS-LANE — things I did NOT do

### 6.1 `shouldAutoClarify` still disagrees (the brief's "make them agree")

`shouldAutoClarify` lives in **`src/shared/queries.ts` (READ ONLY for me)** and
its only consumer is **`src/server/routes/questions.ts:407` (not in my lane
either)**. I made `autoClarifyBlock` authoritative and exported it; I could not
close the loop from here. **The exact patch, for whoever owns `questions.ts`:**

1. Add `d.founder_email` to the `GET /draft/:deckId` SELECT (`questions.ts:361`).
2. Replace

   ```ts
   triggered: shouldAutoClarify({ autoClarification, areas: responseAreas }),
   ```

   with

   ```ts
   import { autoClarifyBlock } from "../config/autoQuery";
   // …
   triggered:
     autoClarifyBlock({
       autoClarification,
       founderEmail: deck.founder_email,
       missingFields: parseMissingFields(deck.missing_fields),
       areas: responseAreas,
     }) === null,
   ```

   (`parseMissingFields` is already imported there.)

Today's direction holds and is pinned: whatever the trigger fires on,
`shouldAutoClarify` also reports. The other direction — the flag claiming the AI
would have raised a letter it will not raise — is open. `shouldAutoClarify`
itself should probably then be deleted or delegated; that is `shared/queries.ts`'s
owner's call.

### 6.2 `pipeline.ts:1031` — the signup path's `founder@portal.local`

Left as instructed, and worth its own look: `POST /decks/:id/send-signup` uses
`toEmail: uploader?.email ?? "founder@portal.local"` and **never consults
`deck.founder_email` at all**, so the sign-up invite goes to the uploading
analyst even when the founder's address is on the row. That is a different and
arguably worse shape than the query path had.

### 6.3 The VC arm keeps the placeholder

`pipeline.ts`'s `toEmail` chain still ends in `"founder@portal.local"` for VC,
because eleven seeded VC deals carry `complete = 1` with an empty contact block
(nobody submitted them) and a guard there would delete the edition's Query
screen. VC is out of scope per the client. `e2e/vc-intake.spec.ts` and
`test/worker/vc-pipeline.test.ts` are green, and a worker test now pins the VC arm
explicitly so a later lane cannot remove the condition silently.

Note the auto path is **not** edition-gated: `maybeAutoClarify`'s guards apply to
both editions. It is a server-side correctness fix on a mail-sending path with no
VC surface and no VC test pinning it (the e2e dev server has no AI key, so the
trigger never runs there), and leaving VC auto-mailing analysts "as the founder"
would be shipping a known defect under the banner of scope. Flagging it as a
judgement call rather than burying it.

### 6.4 The Upload screen's error copy is now wrong for a 409

`src/client/routes/UploadPage.tsx:452` catches everything as *"Couldn't send the
query. Try again."* Retrying a `contact_incomplete` will never work. The Upload
lane should read the body and say something like *"Add the founder's email before
sending a query"*, and keep the button disabled on that state. Same for
`QueryPage.tsx:289`'s `recordQuery` call.

### 6.5 Not reopened

`docs/spec_screening_flow.md` §3 items 1–4 are unchanged. §3 item 1 is now pinned
by a worker test. The archive/rejected distinction was not touched.
