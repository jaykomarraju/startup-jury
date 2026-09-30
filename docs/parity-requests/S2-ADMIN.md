# S2-ADMIN — handoff

**Session:** the screening-logic wave, S-2. `docs/plan_screening.md` §7.6.
**Closes:** feedback **row 11** — *"Admin console: the Sign up section should be hidden — we want
to introduce this in the next release."* Shipped as **C14**: the whole Sign-up GROUP, four
sections per edition, hidden and not deleted.
**Owned and changed:** `src/client/routes/admin/sections.ts` ·
`src/client/routes/admin/AdminConsole.tsx` · `src/client/App.tsx` (prose only) ·
`test/client/adminConsole.test.tsx`. Nothing else. No migration.
**e2e goes out as** `docs/parity-requests/s2-admin.patch` — five files, `git apply --check` clean
against `fb49499`. Nothing under `e2e/` is committed by this session.

**Gate:** `npm run typecheck && npm run lint && npm test && npm run build` — green.
Unit/worker/client **2590 passed, 1 skipped**. `test/client/adminConsole.test.tsx` is the only
test file this session touched and it went **23 → 26** (measured both ends), so the baseline was
2587 / 1 and nothing moved red. `npm run test:e2e`, `playwright test` (beyond
`--list`) and `npm run roles` were **not** run, per the prompt.

---

## 1. The change, in one line

`HIDDEN_ADMIN_GROUPS = ["Sign-up"]` in `src/client/routes/admin/sections.ts`. Everything else
follows from it: `adminSections()` filters it out once, and `adminSectionsFor`, `adminGroupsFor`,
`resolveAdminSection`, the rail, the `?section=` resolver and the e2e walk all inherit the
decision instead of repeating it. **Un-hiding next release is deleting that one string**, plus
un-skipping the e2e walks named in §5.

The console now ships **eleven** of the prototype's sixteen sections: 16 − 1 (`pc` Price
configuration, removed 24-Sep) − 4 (the Sign-up group, hidden 24-Sep).

### Hidden, not deleted — verified, not asserted

Following the `pc` precedent exactly (`sections.ts`, the Organisation block):

| Thing | State |
|---|---|
| The four section objects (`sudocs`, `suagr`, `susign`, `suseat`/`sufund`) | untouched, still returned by the new `allAdminSections()` |
| `SECTION_COMPONENTS` in `admin/registry.tsx` | untouched — all five ids still mounted |
| `src/server/routes/signup-config.ts`, `src/server/esign/routes.ts` | **not touched.** A rail entry going away neither unguards a route nor is licence to delete one |
| `ADMIN_ONLY_GROUPS` | still names "Sign-up", deliberately — it is subsumed today and must be there when the group returns |
| Screen tests (`test/client/signupConfig.test.tsx`, `test/client/agreements.test.tsx`) | untouched and green — they mount the section components directly |
| Worker tests (`test/worker/signup-config.test.ts`, `test/worker/schema-w1b.test.ts`, `test/unit/agreements.test.ts`) | untouched and green |

New export `allAdminSections(edition)` — the fifteen sections that EXIST — is what proves the
group was hidden rather than deleted, and is what the next release re-reads. It is **not** added
to the `admin/index.ts` barrel: this session does not own that file, and both the test and the
e2e spec import from `./sections` directly, as they already did.

## 2. Verified in a browser, not only in vitest

Dev server in this worktree on port 5219, signed in as the incubator admin
(`nisha.kapoor@demo.startupjury.ai`):

```
RAIL BUTTONS: ["Scoring framework","Area weights","Rubric anchors","Question bank",
               "Team & roles","CRM sync","Credits & billing","Notifications",
               "Audit log","User access","Branding"]          ← 11
HEADINGS:              ["EVALUATION","ORGANISATION","SYSTEM"] ← 3, no Sign-up
SIGNUP HEADING COUNT:  0
DEEPLINK ?section=susign TITLE: Scoring framework             ← falls back, not blank
API /esign/signatories:          200
API /signup-config/documents:    200                          ← routes untouched
```

## 3. THE COUNT PINS — all fifteen, and the one that must NOT move

15 → 11 everywhere except the last line, which is the trap.

| Where | Was | Now |
|---|---|---|
| `adminConsole.test.tsx` `INCUBATOR_LABELS` | 15 labels | 11 (four removed) |
| …test name `"declares fifteen sections in four groups"` | — | `"declares eleven sections in three groups"` |
| …`expect(sections).toHaveLength(15)` | 15 | 11 |
| …`expect(new Set(…).size).toBe(15)` | 15 | 11 |
| …`SECS`, the `[id,label]` pairs | 15 | 11 |
| …the VC map beside it | `SECS.map(suseat→sufund)` | plain `SECS` — see §4 |
| …`adminSectionsFor("incubator", role)).toHaveLength(15)` | 15 | 11 |
| …`"renders …the four rail groups and all fifteen sections"` | — | three / eleven |
| …`"the console mounts a fifteen-item rail"` comment | — | eleven-item |
| `e2e/admin-console.spec.ts` test title `"walks all 15…"` | 15 | 11 |
| …`expect(sections).toHaveLength(15)` | 15 | 11 |
| **`e2e/admin-console.spec.ts` `expect(visible).toHaveLength(11)`** | **11** | **11 — UNCHANGED** |

**Why that last one does not move, and the comment now says so in the file.** It is the count for
a NON-ADMIN, a role that cannot reach the console at all. It went 12 → 11 on 24-Sep when `pc`
left, because `pc` sat in the Organisation group — which that role DOES enumerate. The Sign-up
group is the opposite case: `ADMIN_ONLY_GROUPS` already withheld it from every non-admin, so
hiding it takes nothing away from them. **The admin's count fell 15 → 11 and this one stayed
put.** They are equal now by arithmetic, not by sharing a cause; a single-section removal from
any OTHER group would move both. Changing it to match the admin's would be silently green and
wrong.

### Three prose counts, two of which were already wrong by one before this session

- `admin/sections.ts` header — "sixteen sections in four groups" was the prototype's figure;
  now carries a table of what actually ships and why.
- `admin/AdminConsole.tsx:55` — "four groups and sixteen sections" → three and eleven, with the
  arithmetic named.
- `src/client/App.tsx:79` — "sixteen-section overlay" → eleven, with both removals named.

## 4. Four assertions that INVERTED rather than renumbered

Renumbering any of these would have left a vacuous test that passes for the wrong reason.

1. **`[...new Set(sections.map(s=>s.group))] toEqual ADMIN_SECTION_GROUPS`** — fails unless
   "Sign-up" also leaves `ADMIN_SECTION_GROUPS`. It did: that constant is now the groups the rail
   DRAWS, and a heading with nothing under it would be worse than an absent one.

2. **The `suseat` ↔ `sufund` edition swap had no subject left.** That was the ONLY difference
   between the two editions' consoles, and it sat in the hidden group — so the two rails are now
   identical. Rewritten in both halves rather than deleted: the shipped rails are asserted equal,
   and the swap itself is asserted where it still lives, in `allAdminSections()`. Deleting it
   would restore four sections next release with no coverage that the fourth is edition-resolved
   at all.

3. **`"restricts the Sign-up group to admin and superuser"`** went vacuous —
   `canSeeAdminGroup(role, "Sign-up")` is false for all nine roles now, superuser included. It
   inverts to *"withholds the Sign-up group from every role, superuser included"*, and separately
   re-asserts that **reachability did not change**: the console still opens for exactly two roles,
   and both of them now see the same eleven a non-admin would.

4. **`"hides the whole Sign-up group from a role that is not admin or superuser"`** — "not admin
   or superuser" is now everybody, so the strongest version drives the console as the **admin**,
   the one principal whose rail actually moved. The old non-admin version is kept alongside it:
   F0038 could widen console reachability, and that guard has to keep holding when the group
   returns.

Two tests added: *"hides the Sign-up group without deleting it"* (the 15/11/4 split, and every
hidden id still mounted in `SECTION_COMPONENTS`) and *"sends an admin's bookmarked Sign-up deep
link to Scoring framework"*. Two existing tests were widened from `adminSections` to
`allAdminSections` — the registry-coverage one especially, because filtering the hidden group out
first would let the four screens be unmounted without a single test noticing.

## 5. The e2e patch — and the three specs beyond `admin-console.spec.ts`

`docs/parity-requests/s2-admin.patch`, 466 lines, five files. **The session prompt named only
`e2e/admin-console.spec.ts`; three more specs break, and they break functionally, not cosmetically.**
Every walk of a Sign-up screen reaches it through `/app/admin?section=…`, which now resolves to
Scoring framework, so each would fail at its first `admin-section-title` assertion.

| File | What the patch does |
|---|---|
| `e2e/admin-console.spec.ts` | counts → 11; the edition-swap pair rewritten (no subject); a new per-admin test that the group and its heading are absent from the rail AND that all four bookmarks fall back; the `toHaveLength(11)` comment rewritten to say why it did **not** move |
| `e2e/signup-config.spec.ts` | six walks `test.skip`-ed **one at a time**; the edition-swap loop replaced by a LIVE per-edition API test |
| `e2e/agreements.spec.ts` | five console walks `test.skip`-ed one at a time; a new LIVE test that the admin still gets 200 on both esign endpoints |
| `e2e/signup-workspace.spec.ts` | one test skipped — the only one that configures sign-up from inside the console |
| `e2e/roles.spec.ts` | prose only: "sixteen-section overlay" was stale; `?section=tm` is in neither removed set, so nothing there moved |

**Skipped one test at a time, deliberately, rather than skipping two whole files.** A file-level
`test.skip(true, …)` would also have taken out `agreements.spec.ts`'s two pure `/api/esign/*`
role checks (403 for a program associate and a juror) — live coverage of a role boundary that has
nothing to do with a rail. Given this repo's history of role-boundary leaks, dropping those to
save a re-indent is the wrong trade. For the same reason each of the two files gains one **live**
test asserting the routes still serve their admin: with every walk dark, that is the only thing
left in a browser that would catch someone deleting a route because "the screen is gone".

**Net e2e effect:** `--list` goes 248 → 253 (+5: four new per-admin console tests, one new live
esign API test; both rewritten swap pairs are 1-for-1). `--list` counts skipped tests, so at
runtime **12 of the 253 report skipped** — 6 in `signup-config.spec.ts`, 5 in
`agreements.spec.ts`, 1 in `signup-workspace.spec.ts`. Everything else, including all five new
tests and the two live API tests, runs.
`npx playwright test --list` parses clean; `npm run typecheck` and `npm run lint` were both run
**with the e2e edits in place** and are green, so the patch compiles and lints before it is
applied.

## 6. For the integration session

1. **The `admin` parity row moves.** `/app/admin` lands on Scoring framework by default, so a
   section-list change moves that row even though the default section itself is untouched — the
   rail is part of the capture. Expect it; do not treat it as a regression.
2. **Two deliberate prototype deviations now sit on this screen**, not one. `AISJ_ICAdmin_V6`'s
   `ADMIN_B64` still carries all sixteen sections and the `<div class="sb-lbl">Sign-up</div>`
   heading, so the next parity capture will try to restore five sections. Both are recorded in
   `sections.ts` where the capture reviewer will read them.
3. **The open client question (C14, Q14).** The prototype's markup says "Sign-up" is a group
   heading, which is why we hid all four. If he meant `susign` "Authorised signatories" alone,
   this is three sections too many and the correction is one entry in `HIDDEN_ADMIN_GROUPS`
   becoming a section-level list. Worth putting to him before the next release un-hides it.
4. **One stale comment in a file this session may not touch.**
   `src/server/routes/signup-config.ts:795` reads *"`s-suseat` is not in the VC rail — serving it
   would be a phantom capability."* Still true and still correct behaviour, but the section is now
   in no rail at all. Prose only; left alone per the prompt's "do not touch" on that file.
