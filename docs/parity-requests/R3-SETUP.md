# R3-SETUP — item 6 for the admin and programme manager, and the SeatsCard prerequisite

**Branch `parity/R3-SETUP`, based on `main` @ `f0ee14d`.** Wave R of
`docs/plan_roles_incubator.md` §3. Closes item **6** for `admin` + `program_manager`, and footnote
**ʷ** (the SeatsCard prerequisite). No migration — as §3 requires, `0076` is untouched.

---

## 1. What shipped

**`src/client/routes/SetupWizard.tsx` — one predicate, widened, plus one deliberately not widened.**
`programmeOnly` was `edition === "incubator" && role === "superuser"`; it is now a
`PROGRAMME_ONLY_ROLES` set of `superuser · admin · program_manager` — the three roles the client's own
row names. The admin and the PM now walk **Configure → Select**, Select finishes the wizard, and
neither Org type nor Team is rendered.

`nominateOnly` was **split out of** `programmeOnly` rather than widened with it. They were the same
expression passed twice; `stepsFor`'s early return shadows `nominateOnly`, so it is unreachable
either way and stays KEPT against a reversal of item 7 — but only as the *narrow* superuser
predicate. If item 7 were ever reversed, an admin's or a PM's restored step 4 is the roster, not the
nomination, so carrying the wide predicate into that slot would have relabelled a step neither of
them ever had.

**The `programmeOnly` early return is now load-bearing, not tidy.** The prompt's warning is real and
its cost is now paid by a live principal: while `programmeOnly` meant the super user alone it was
always a `full` seat, so returning `{ labels: STEPS_PROGRAMME, first: 1 }` outright rather than
slicing was belt-and-braces. Item 6 adds the **programme manager, a `cohorts` seat**, whose list
`stepsFor` has *already* sliced. Re-expressing the narrowing as a second `slice` would now open their
wizard on Select with nothing configured. The comment above `stepsFor` says so in those words, and
`test/client/setupWizard.test.tsx` plus `e2e/setup-wizard.spec.ts` both pin it from the program
associate's side.

**`src/client/routes/admin/TeamRoles.tsx` — footnote ʷ.** `SeatsCard`'s gate moves in lockstep with
the deletion: `incubator && (superuser || admin)`. The admin is a `full` seat and loses the seat bar
and **Buy additional seats** exactly as the super user did. This closes the §5 P1 inconsistency rather
than opening a door — the admin could already buy seats from My account (`AccountOverlay.tsx:317`)
and `/api/seats` has always admitted them (`seats.ts:60`, `requireTask("addmembers","admin")`). Only
this screen disagreed.

**The PM is deliberately NOT added to `SeatsCard`**, though they also lose a step 4: a `cohorts` seat
never rendered `TeamStep`'s `manages` half, so they had no seat bar to lose, and `admin` nav is
`roles: ["admin"]`, so the gate could never fire for them. Nothing is stranded (footnote ᵍ), and
`branding.orgName` keeps its writer — the admin reaches Admin console → Branding, where item 7 moved
the field. `branding.orgType` loses its last incubator writer and that is inert: `SetupWizard.tsx:42`
already records it is read by nothing.

**PA and jury untouched**, per footnote ʰ. This is asserted, not assumed — see §3.

## 2. A structural consequence to record: `TeamStep`'s `manages` half is now incubator-dead

Counting the incubator's five roles against `nav.ts:172` and `seatFor`, the only role that still opens
`setup/TeamStep.tsx` is the **program associate**, and they land in the `!manages` branch. So the
`manages` half is unreachable **in the incubator edition**, on top of `nominateOnly`, which has been
unreachable since item 7.

It is **edition-dead, not dead**: the VC edition was never rescoped and its admin and super user still
walk all four steps through that exact code. So the code is LEFT in place and recorded in
`TeamStep.tsx`'s own header, exactly as plan §4 tells R1 to treat its orphaned screen — deleting it
inside a widening would be a removal wearing a widening's clothes. **Logged as a Wave R+1 cleanup.**

The one test whose *name* made a wizard-level claim that item 6 falsifies — `setupTeam.test.tsx`'s
*"an ADMIN's step 4 is untouched"* — was re-pointed to the two VC `full` seats and is now the honest
negative control. The tests above it still render an incubator admin on purpose: they pin the shared
component, not the route that reaches it.

## 3. The negative controls, run both ways

| Control | Result |
|---|---|
| Revert `PROGRAMME_ONLY_ROLES` to `superuser` alone | **5 of 13** `setupWizard.test.tsx` tests fail — admin 3/3, PM 2/3 |
| Revert `SeatsCard`'s `shown` to `superuser` alone | **1** `teamRoles.test.tsx` test fails (`the incubator admin gets the seat bar`) |
| `e2e/roles.spec.ts` — program associate, Set up read-only | **passes**, untouched |
| `e2e/seats.spec.ts` — VC admin walks all four steps and buys a seat | **passes**, untouched |
| New: PA walks three steps → Configure → Select → **Team**, banner and all | passes (`e2e/setup-wizard.spec.ts`) |

The PM fails 2 of 3, not 3 of 3, and that is correct rather than a weak test: the *"no Back button"*
case passes for a `cohorts` seat even with the predicate reverted, because `onBack` is
`seat === "full" && !programmeOnly` and the seat check alone already excludes them. That assertion is
load-bearing for the **admin** — the first `full` seat other than the super user to be narrowed, for
whom the seat check alone would have drawn a Back button into a step that no longer exists. The test's
comment says so, so the column is not mistaken for redundant later.

## 4. Cross-session request — `e2e/coverage.spec.ts` (NOT this session's file)

`docs/parity-requests/R3-coverage-setup-walk.patch` · 29 lines · `git apply --check` **passes** on
this branch and on `main` @ `9e3220c`.

`e2e/coverage.spec.ts:289` *"the Set up wizard walks through Select and Team to the dashboard"* signs
in as `INC_ADMIN` and clicks through four steps. **Measured, not predicted:** on this branch it fails
at line 300 — the first click now advances out of Configure into Select, so `getByText("Sectors")`
never matches. The patch changes the **principal only** (`INC_ADMIN` → `VC_ADMIN`) and adds the
comment explaining why; every assertion is untouched. With it applied, `e2e/coverage.spec.ts` is
**18/18**.

There is no incubator role left that can carry that walk: the program associate has three steps and
their step 4 has no seat bar. The VC admin is the correct principal and the VC edition is precisely
what the negative controls above depend on staying four-step.

**Place it in the same merge as this branch** — without it the wave's e2e is red for a reason this
session already knows the answer to. Per the memory note, `git apply --check` it at integration.

## 5. Parity rows: R3 needs NONE — and this contradicts plan §4

Plan §4 budgets **2 rows** for R3 in `e2e/parity.spec.ts`. Measured: **zero move.** The walk records a
screen's `h1` and its table headers. The Set up wizard's title is *"Set up your workspace"* on every
step and it renders no `<table>`, so all six `*/setup` rows are `{ title: …, tables: [] }` before and
after. `SeatsCard` renders a `SeatBar`, not a table, and it is in `?section=tm` while the walk lands
on the console's default Scoring framework section. All four incubator staff parity walks pass on this
branch. **No `R3-parity.patch` is shipped, deliberately** — an empty patch file is the kind of thing
that gets applied and then trusted.

## 6. Two observations for the integration session

**(a) `main` moved under the wave, and `R1-parity.patch` is unapplied.** `main` advanced from
`f0ee14d` to **`9e3220c`** during this session — a commit subject-lined *"JURYbuddy: match the spec's
composition, in our palette"* that in fact carries R1-DASH's, R5-LOGIN's and R6-SCOPE's work. It
touches **none** of this session's files, so `parity/R3-SETUP` merges cleanly; this is a note, not a
conflict.

What is worth acting on: on `9e3220c`, `e2e/parity.spec.ts`'s `incubator/program_manager/alldecks`
and `incubator/program_associate/alldecks` rows still expect the title **"All decks"** and the screen
now renders **"Dashboard"**. Measured directly in the main working directory:

```
Error: incubator/program_manager/alldecks title
  Expected: "All decks"   Received: "Dashboard"
```

`docs/parity-requests/R1-parity.patch` closes exactly those rows and `git apply --check` still passes
— i.e. it is **written and unapplied**, which is the memory note's recurring pattern (four patches
sat for one to two waves). **Two parity rows are red on `main` right now until it is placed.**

**(b) A latent race in `teamRoles.test.tsx`, fixed here because this change made it lose.**
`AccountOwnerCard` renders the same `data-testid="account-owner"` div before the roster lands,
carrying *"This workspace has no owner"* — so `findByTestId` resolved on the **empty** state and the
assertion after it raced its own fetch. Latent since W4-A; the extra `/api/seats` request the widened
`SeatsCard` makes for the admin is what finally made it lose. All three call sites now gate on the
POPULATED card, which is the rule the rest of this repo's tests already follow.

## 7. Green gate

Run in this worktree, Node 22.23.1 (`.nvmrc` = 22 — under Node 20 `vite build` dies on
`node:module`'s `registerHooks`; tests still pass, so the gate can look green on the wrong Node).

| | |
|---|---|
| `npm run typecheck` | ✓ |
| `npm run lint` | ✓ |
| `npm test` | **2456 passed · 1 skipped** (baseline 2451; +5, all in `setupWizard.test.tsx`) |
| `npm run build` | ✓ |
| `npm run test:e2e` | **233 passed · 7 flaky · 2 failed** in 6.5 min — see below |
| `npm run roles` | **1191 checks · 1191 passed · 0 failed**, port 5233, `lsof` + `ps` + cwd all proved this worktree's node (PID 1900) |
| `npm run parity:nav` | ok · 67 known gaps, **unchanged** |
| `npm run parity:tokens` | ok · 0 gaps |

**The two e2e failures, both accounted for:**

1. `coverage.spec.ts:289` — this change's own consequence; §4's patch fixes it, verified 18/18.
2. `coverage.spec.ts:73` *"every VC nav slug renders a real screen"* — **not this branch.** Re-run
   alone with `--retries=0 --workers=1`: **passes in 20.7 s**. It walks ~28 slugs sequentially inside
   one 30-second budget, which is plan §9's recorded load failure.

The 7 flaky all recovered on retry — the documented miniflare port exhaustion, not assertions.

**A caution about `parity.spec.ts` at two workers.** `incubator/program_manager` and
`incubator/program_associate` failed on the 2-worker run and **passed alone at `--workers=1`** (29.9 s
and 30.2 s). Their `observe()` gate times out under load well before the 30 s test budget. Do not read
a red parity walk as a moved row without re-running it alone — the two failure modes print at
different lines (`:94` is the timeout, `:137` is a genuine title mismatch), and that distinction is
what separated §6(a)'s real finding from this noise.

## 8. Explicitly not done

- **PA and jury (footnote ʰ)** — not narrowed. Asserted, not assumed.
- **`nominateOnly` (footnote ʸ)** — not widened; item 6 removes the step that renders it.
- **PA/PM into the Admin console (§5 item 2)** — not opened.
- **Migration `0076` (§5 item 8)** — not taken.
- **The incubator-dead `manages` branch** — left in place, recorded, logged for Wave R+1.
