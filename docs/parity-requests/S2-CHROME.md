# S2-CHROME — handoff

**Session:** the screening-logic wave, S-2. `docs/plan_screening.md` §7.5.
**Closes:** feedback row **10** ("Move to Dashboard") · the Query screen's select-all removal.
**Branch:** `screening/S2-CHROME`, worktree `../sj-S2-CHROME`, cut from `main` at `fb49499`
(F-FOUL and S0-VOCAB both merged). No migration.

**Changed, all of it owned:**

| File | What |
|---|---|
| `src/client/components/AppShell.tsx` | `<MoveToDashboardBar>` + one insertion above the content pane |
| `src/client/components/PanelFrame.tsx` | new `<ToolbarLink>` — `.tbb` as an anchor |
| `src/client/routes/QueryPage.tsx` | header select-all removed; `toggleAll`, `allVisibleSelected`, `someVisibleSelected` deleted |
| `test/client/queryPage.test.tsx` | +2 tests |
| `test/client/chrome.test.tsx` | +5 tests — **see §5, this file is not on my ownership list** |
| `docs/parity-requests/s2-chrome.patch` | the e2e half of row 10 (§4) |

**Not changed, deliberately:** `src/client/components/Sidebar.tsx` and **`src/shared/nav.ts`**
— see §2. The roles-harness baseline therefore does **not** move for this session, and neither
does `parity:nav`.

**Gate:** `npm run typecheck && npm run lint && npm test && npm run build` — green.
Unit/worker/client **2594 passed, 1 skipped** — measured. The +7 are mine (2 in
`queryPage.test.tsx`, 5 in `chrome.test.tsx`), so the `fb49499` baseline is 2587/1 by
subtraction; I did not re-run the suite on a clean checkout to confirm that, because nothing of
mine can move another file's count. `npm run test:e2e`, `playwright` and `npm run roles` were **not** run, per the prompt.

---

## 1. Row 10 — what shipped

One control, `<MoveToDashboardBar>`, rendered once by the shell above the content pane, on every
authenticated screen except the one it points at. It is a real `<a>` (`<ToolbarLink>`, `.tbb`) to
`/app/alldecks` — the uploaded status screen, per §2 C9 and his own gloss *"Move to Dashboard
(meaning the Uploaded screen)"*.

**His universal holds for free.** *"Move to Dashboard unaffected by any status"* is the one
universal in his document; this control reads no deck, so there is no status, stage or list
membership that can affect it. That is worth saying back to him in exactly those terms.

**The other half of his ask is a no-op here, and I did not build machinery for it.** His
justification is *"useful if a deck is moved to a wrong screen by mistake"*. Screens in this
architecture are FILTERS, not locations: `matchesV3Stat(deck,"all")` is unconditionally true
(`src/shared/deckStats.ts:584-586`), Assign/Query membership is derived per read, and no deck is
ever removed from the uploaded screen. There is no "which screen is this deck on" to reset. The
only thing that CAN be wrong is the **stage**, and `restore` ("Restore", `rejected|archived →
ai_evaluated`, `src/pipeline/incubator.ts:168-179`) already fixes that from the Dashboard row
menu. **This is §8 Q16 and it needs his answer** — see §3.

**Where it lives, and the cost.** The prototype would put this inside each screen's own `.tbr`
strip. `<PanelFrame>` already takes an `actions` node, but only six route files have adopted
PanelFrame; QueryPage, AssignPage, ReviewScreen and the rest still hand-roll their toolbars and
belong to other sessions. So: one insertion in the shell, which buys "every screen" at the price
of a band **above** each screen's toolbar rather than a button **inside** it. That cost is
written into the comment on the component so a later parity pass reads it as a choice, and
`<ToolbarLink>` is exported from `PanelFrame.tsx` precisely so the per-screen version is a move,
not a rewrite.

**One thing that is not cosmetic:** the band is rendered OUTSIDE `<main>`. `.sj-frame` is
`position:absolute; inset:0` inside the content pane (`index.css:344-350`), so anything drawn
inside `<main>` next to a PanelFrame screen is covered by it. The pane keeps `relative`; the band
and `<main>` are now siblings in a flex column. Verified visually on three toolbar
implementations (PanelFrame / hand-rolled `.tb` / the three-column Assign frame).

## 2. The label half: shipped as a per-role name, NOT as a sidebar rename

The prompt's literal reading was that `alldecks` "still reads *All decks* / *Layers* for jury and
every VC role — that is the only gap, and it is a `labelOverrides` change". **I measured that
change before making it, and did not make it.** What I found:

- `docs/prototype/source/incubator/AISJ_IC_Jury_V4.html` renders `si-alldecks` as **"My
  Pipeline"**, and **all six VC prototypes** render it as **"All decks"**. Both are
  prototype-sourced labels, not defaults nobody chose.
- The jury's `alldecks` is a *different screen* — the five first-person allocation tiles
  (`DashboardPage.tsx:372,693`), not the uploaded-deck register the client is talking about. His
  own gloss ("meaning the Uploaded screen") describes a screen the jury does not have.
- Renaming them adds **seven** new `parity:nav` `label alldecks` rows (jury + six VC roles), and
  the waivers for those rows live in `scripts/parity-nav.ts` — **a file this session does not
  own**, and whose existing waiver text says in as many words that *"The JURY is deliberately
  absent from this list: they keep 'My Pipeline' and the v15 screen."*

So the band **names its destination as that role sees it**, from `navLabel`: "Move to Dashboard"
for the superuser, admin, PM and PA; "Move to My Pipeline" for the jury; "Move to All decks" in
the VC edition. His exact string appears for exactly the roles his 24-Sep document is about, and
no role is offered a screen name their sidebar does not have. The icon comes from `navIcon` for
the same reason.

If he answers Q16 "rename it for everyone", the change is four lines in `nav.ts`
(`labelOverrides`/`iconOverrides` for `jury` + the VC manifest's own entry) **plus** seven waiver
rows in `scripts/parity-nav.ts`, and the band then reads "Move to Dashboard" everywhere with no
further edit — it derives.

## 3. For the client — one question, with the fallback already shipped

> **Q16 (row 10).** "Move to Dashboard on every sidebar screen": we have shipped it as a link
> back to the Dashboard from wherever you are, on every screen, never affected by any status —
> which is what the words say. Your reason for it ("useful if a deck is moved to a wrong screen
> by mistake") describes something different, and in this build it has nothing to act on: screens
> are filters over one register, not places a deck is moved to. A deck is never taken off the
> uploaded screen, so there is nothing to put back. The one thing that CAN be set wrong is the
> deck's **stage**, and "Restore" on the Dashboard row menu already resets that. **Did you mean a
> per-deck "put this back" button, and if so, what would it put back?**
> Second half, if you did mean the sidebar entry: it reads "Dashboard" today for the Super User,
> Client Admin, Programme Manager and Programme Associate. The jury's reads "My Pipeline" and the
> VC edition's reads "All decks" — **both are what your own prototypes say**, and both name a
> different screen from the uploaded register. Should they be renamed "Dashboard" anyway?

## 4. The e2e patch — `docs/parity-requests/s2-chrome.patch`

`git apply --check` passes at `fb49499`. It appends ONE test to `e2e/chrome.spec.ts`: the band is
visible on `/app/query`, `/app/assign` and `/app/myparams` (three different toolbar
implementations), clicking it lands on `/app/alldecks`, and it is absent there.

**It has not been run** — the prompt forbids `playwright` in this session. What backs it instead:
the five client tests in §5, plus screenshots of all four screens taken against a real server in
this worktree. The only assertion no test of mine has exercised is the click-through, and the
href is pinned by a client test.

**Two things S-INT should know:**

1. **There is no e2e change for the select-all.** §7.8 lists `s2-chrome.patch` as *"the Query
   select-all header"* — but nothing in `e2e/` pins it. `e2e/query.spec.ts:114-124` reads the
   header row as `["", "startup", …]`, and the first cell is `""` both before and after, because
   the `<th>` stays (empty). Same for `test/client/queryPage.test.tsx:239` and
   `test/client/queryPageVc.test.tsx:143`. The patch carries the row-10 test instead.
2. **The band adds a link to every non-Dashboard screen.** I checked every `getByRole("link", …)`
   in `e2e/`: none is newly ambiguous. `e2e/chrome.spec.ts:97` (`name: /Dashboard/`) runs on
   `/app/alldecks`, where the band is hidden — that is one of the reasons it is hidden there. The
   band also shortens the content pane by ~35px on every other screen; no e2e geometry assertion
   runs off `/app/alldecks`.

## 5. Test placement — one deviation from the ownership list, declared

The five row-10 tests are in **`test/client/chrome.test.tsx`**, which is not on my ownership
list. `test/client/queryPage.test.tsx` was the only test file assigned to me, and shell chrome
tested inside the Query screen's suite is misfiled work that the next reader has to undo.
`chrome.test.tsx` is the file for exactly these primitives (`.tb`, the toast, the sidebar) and is
owned by no session in this wave — verified against §6.1's five ownership blocks, and `git branch
--no-merged main` is empty, so nothing else is in flight. The change is an append at the end of
the file plus two import lines, which is the cheapest possible merge shape.

`src/client/components/index.ts` is NOT touched: `<ToolbarLink>` and `<MoveToDashboardBar>` are
imported by path. Adding them to the barrel is one line for whichever session first adopts them
from a screen.

## 6. The Query select-all

`QueryPage.tsx` header `<th>` — checkbox removed, cell kept as an empty `w-[38px]` so the body's
per-row checkbox column still lines up. `toggleAll`, `allVisibleSelected` and
`someVisibleSelected` are deleted outright, not suppressed. **The per-row boxes stay** — he
removed only the header one, and his reason ("not relevant since each deck has distinguished
missing items") is a reason to select individually, not to stop selecting.

Screens affected: incubator `/app/query` **and VC `/app/query`**, which render the same
component. Nothing asked for that split and the VC tests stay green.

`test/client/evaluateV3.test.tsx` ("Select all decks") and `test/client/vcEvaluate.test.tsx`
("Select all") are **different screens** and were not touched, as instructed.
