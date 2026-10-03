# OCT2-UPLOAD — issue 3, "bulk upload isnt working"

> "i tried uploading 10 decks at once and it still says uploading after 40 minutes"

Lane: `src/client/routes/UploadPage.tsx` · `src/client/routes/upload/**` · `src/client/api.ts`.
`src/server/routes/decks.ts` was read only; everything server-side is under **Cross-lane** below.

---

## 1. The premise, corrected

The brief's reading of the client half was right and is confirmed:

* `uploadSelected` groups bulk-source decks by context and sends **all** of a group's files in ONE
  `POST /api/decks/bulk` (`for (const d of group) form.append("files", d.file!, d.fileName)`).
* `uploadBulk` was a bare `fetch`. **`fetch` has no timeout**, so a request that never settles never
  settles, and `setBusy(false)` sat after the awaited call with nothing else able to reach it. Ten
  decks, one request, one unbounded await, and "Uploading…" for ever. That is the report.

**One thing in the brief is wrong, and it changes which limit matters.** `/api/decks/bulk` does
**not** evaluate the decks inside the request. Per file it does `storeDeck` (R2 put + a 2-statement
D1 batch), `EVAL_QUEUE.send`, and `flagIntake` (a D1 read) — the AI runs later, in the queue
consumer. It is the **single** route (`/api/decks/upload`, `decks.ts:2164`) that calls
`evaluateDeck` inline. So the bulk handler is cheap per file and CPU time is almost certainly not
what killed it.

## 2. What the real server-side limit is

The bulk handler is sequential, and the binding ceilings are all reached by the batch's
**aggregate**, which nothing bounded:

| Ceiling | Value here | Reached by |
|---|---|---|
| Edge request-body limit | 100 MB on `*.workers.dev` | 10 decks × the product's own 50 MB per-file cap = up to **500 MB**. The edge rejects this before any of our code runs. |
| Isolate memory | 128 MB | `c.req.formData()` materialises the WHOLE multipart body. `decks.ts:1945-1950` already records the consequence in this codebase's own words: exceeding the limit "kills the isolate rather than throwing something catchable", and **miniflare does not enforce the cap**, so local green proves nothing. |
| Subrequests per invocation | 1000 (Workers Paid; 50 on Free) | ~4 per file plus the context read and the credit reservation. Not binding at 10 files on this plan, but it scales with the batch. |
| CPU time | 30 s default (no `limits` in `wrangler.jsonc`) | Not the binding limit for bulk — no AI work in the request. |

Note the ordering: the per-file `MAX_PDF_BYTES` check runs **after** `formData()` has already
materialised everything, so it cannot protect the isolate from an oversized batch.

**Why the client saw a hang rather than an error.** Whether a 413 from the edge, a killed isolate or
a stalled uplink surfaces as a rejection or as a socket that goes quiet is not something the client
can choose — and it does not have to. The client's job is to be bounded either way, which is what
shipped.

## 3. What shipped

**`src/client/api.ts` — every multipart POST now has a deadline.** `postForm` wraps `uploadSingle`
and `uploadBulk` in an `AbortController` whose timer is **scaled to the bytes in the form**
(`uploadDeadlineMs` = 60 s floor + 1 ms per 150 bytes ≈ a 1.2 Mbit/s uplink floor), because a
legitimate 20 MB upload over a slow line is slow, not stuck. A missed deadline is reported as its
own code, `upload_timeout`, and **not** as a generic failure — the server refused nothing, so the
deck may be on file and "try again" could charge twice. `uploadDeadlineMs` is exported for the test.

**`UploadPage.tsx` — `chunkBulk` cuts a batch into bounded requests.** `BULK_CHUNK_FILES = 3`,
`BULK_CHUNK_BYTES = 24 MB`, greedy fill, never fewer than one deck per request (so a deck at the
50 MB per-file cap still goes alone — the byte budget caps a request, it cannot refuse a deck). Ten
decks become 3+3+3+1 requests, each inside every ceiling in §2.

**Outcome mapping survives the new shape.** Rows are still matched to decks by `row.file ===
d.fileName`, now within a chunk rather than within a group, so the pending list is shorter and the
splice-on-match logic is unchanged. One addition: **a file the per-row report never mentions is now
reported failed.** Without that a silent row counts as neither uploaded nor failed, and a chunked
batch with a missing deck would read as fully successful and leave for the Dashboard. It is guarded
on `Array.isArray(res.results)`, so a reply with no `results` keeps today's behaviour.

**Outcomes land per request, not per batch** (`settle`), so the decks in the chunks that finished
are saved and visible even if a later chunk fails — and the screen moves.

**Per-deck progress.** `StagedDeck.uploading` marks the decks in the request currently in flight;
the row says `· uploading…` with an `up-row-uploading` badge, and the button counts the batch down
("Uploading 2 of 10…", new `progress` prop on `ReviewScreen`). "Uploading…" alone cannot tell an
operator whether anything is moving, which is the complaint underneath the bug.

**`setBusy(false)` is in a `finally`.** Defence in depth: nothing can now leave the button saying
"Uploading…".

**Preserved, deliberately and under test:**

* `no_credits` still stops the batch (the decks behind it are never sent, so never charged);
* per-row `pdf_too_large` / `pdf_required` still map to `STAGED_ISSUE_LABELS`;
* a FULLY successful incubator batch still navigates to `/app/alldecks` and a partly failed one
  still stays on the review list with the Dashboard demoted to a link (yesterday's issues 2 and 12);
* the VC edition's wording and landing are untouched. `e2e/vc-intake.spec.ts` uploads a single
  ticked deck — one chunk — so its walk is unchanged.

**A missed deadline also stops the batch**, like `no_credits`. The connection could not carry the
request we already sent; working through the remaining chunks would spend a fresh deadline on each
before saying so, which is how one slow batch becomes forty minutes of silence.

## 4. Where this fix stops

It bounds the damage; it does not remove the cause. Two things are still true:

* **A client-side abort can leave decks on file with credits spent.** The server may have stored
  some of a chunk before we stopped waiting. That is why the copy says "check All decks before
  trying again, in case it landed anyway" rather than "try again" — but it is a real gap and only an
  idempotency key per file closes it.
* **The server has no aggregate guard**, so a direct API caller (or a future client) can still post
  500 MB. See Cross-lane.

## 5. Tests

`test/client/upload.test.tsx`, new describe "a bulk batch of ten decks (issue 3)". 43/43 pass in
`npx vitest run --project client test/client/upload.test.tsx`. The bulk mock now **echoes the
request's own files** (a fixed reply would answer for files a chunked request never carried), with
three special names: `Refused.pdf` fails per-row, `Silent.pdf` is left out of the report entirely,
`Kept.pdf` keeps the id `pollDecks` is keyed on so the existing end-to-end query walk is untouched.

Each test was negative-controlled by reverting the fix and watching it fail:

| Test | Reverted | Failed with |
|---|---|---|
| cuts the batch into bounded requests | `chunkBulk(group)` → `[group]` | `expected [ 10 ] to deeply equal [ 3, 3, 3, 1 ]` |
| maps every outcome back to its own row | deleted the unreported-file clause | the "2 decks could not be uploaded" banner never appeared (the silent deck counted as nothing) |
| gives up on a request that never answers | `postForm`'s timer no longer aborts | the button stayed "Uploading…" through the whole advanced clock |
| …and again | `stopReason`'s `upload_timeout` arm disabled | same test fails — the batch ploughed into the next held request |
| names the decks in flight | `start()`'s `setStaged` removed | `expected [ 4 spans ] to have a length of 3` (no in-flight flag; also fails with chunking reverted, 4 ≠ 3) |

Not separately controlled, and said plainly: the `finally` around `setBusy(false)`. Every throw site
in the loops is caught, so no test distinguishes it from the old trailing call — it is insurance
against a future throw outside a `try`, not a fix for a path I can demonstrate.

Checks run (lane-scoped, per the standing rules): `npx tsc -p tsconfig.json` filtered to these
files — clean; `npx eslint` on all six — clean. The one unrelated error in the full typecheck is
another lane's (`test/client/evaluateScoring.test.tsx`, `listMyAssignments`).

## 6. Cross-lane — for the `src/server/routes/decks.ts` owner

1. **An aggregate guard on `POST /api/decks/bulk`.** A cap on file count and on summed bytes,
   refused with a per-row report, would turn "the isolate died" into "this batch is too big". Note
   it has to be decided from the entries, and `c.req.formData()` has already materialised the body
   by the time any of them can be inspected — so a `content-length` check before `formData()` is the
   only thing that protects the isolate itself.
2. **A killed isolate refunds nothing.** `refundCredits` lives in a `catch`, which only runs for a
   catchable throw; the memory limit is not one (`decks.ts:1945-1950`).
3. **Chunking changes what `reserveCredits` reserves per call** — 3+3+3+1 instead of 10. The total
   is the same, but a mid-batch `no_credits` now refuses a later chunk rather than the whole batch,
   and the earlier chunks stay uploaded. That is the better behaviour; it is also new.
4. **Idempotency.** A per-file key (name + size + context, or a client-supplied token) would let a
   retry after a timeout be safe instead of merely warned about.

## 7. For the client

Nothing to ask — the report was accurate and the cause was ours. Worth telling him that a bulk batch
is now sent in groups of three, so the button counts down instead of sitting still, and that if an
upload does time out he should look at All decks before re-uploading, because the decks in the
request that timed out may already be there.
