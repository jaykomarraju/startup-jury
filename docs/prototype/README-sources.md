# Audit brief — prototype ⇄ implementation parity (READ FIRST)

## Goal
The client says: "the prototype is not functional, but it outlines **every screen we need and the way
it should look**. Your work must **exactly match** that while also being functional."
You are producing evidence for a **report only**. **MAKE NO CODE CHANGES.** Do not edit, write or
create any file inside the repo. Read-only analysis.

## The two sides

### 1. Prototype (SOURCE OF TRUTH)
Originals: `/Users/jayanthkomarraju/Downloads/STARTUPJURY-PROTO/{Incubator Final files,VC Final files}/`
Each role HTML is one SPA: a top nav (`.an`), a sidebar (`.sb`), and N screens as
`<div id="panel-SLUG">`. They are 750KB–950KB each — **do not read a whole prototype file**.
They have been pre-split for you into:

`SPLIT = /private/tmp/claude-501/-Users-jayanthkomarraju-Documents-GitHub-startup-jury/57a86692-6659-49ce-93eb-0da1a721584d/scratchpad/panels/<DIR>/`

with these files per prototype dir:
- `panel-<slug>.html` — one screen, self-contained markup (1–34 KB). **Read these.**
- `_topnav.html`, `_sidebar.html` — global chrome
- `_rest.html` (~100 KB) — modals/overlays/drawers NOT inside a panel: the Set up wizard
  (`#setup-overlay`, `sus-*`/`su-*`), Account & billing (`#acct-overlay`, `acs-*`/`ac-*`),
  Add/Edit team member (`aet-*`), Founder portal (`#fp-ov`, `fp-*`), deck drawers, report modals.
  **Grep it, don't read it whole.**
- `_style.css` (~130 KB) — all prototype CSS. Grep for the class names you see.
- `_scripts.js` (~450–540 KB) — all prototype JS: seed data arrays, `showPanel()`, renderers,
  modal builders. **Grep only** (e.g. `grep -n "function renderEvaluate" _scripts.js`). Much of a
  screen's real content is BUILT IN JS, not in the panel markup — if a panel looks thin, the table
  rows/cards/report bodies are almost certainly rendered by a JS function. Always check.

Prototype dirs (`<DIR>`):
| Edition | Role | DIR |
|---|---|---|
| Incubator | Super User (superset) | `Incubator_Final_files_AISJ_IC_SuserV11_HTM` |
| Incubator | Admin | `Incubator_Final_files_AISJ_ICAdmin_V4_html` |
| Incubator | Program Manager | `Incubator_Final_files_AISJ_INC_ProgManager_V2_HTM` |
| Incubator | Program Associate | `Incubator_Final_files_AISJ_INC_Prog_assoc_HTM` |
| Incubator | Jury | `Incubator_Final_files_AISJ_INC_Jury_V3_html` |
| VC | Super User / Managing Partner (superset) | `VC_Final_files_AISJ_VC_Superuser_V6_html` |
| VC | Admin | `VC_Final_files_AISJ_VC_Admin_V4_html` |
| VC | Partner | `VC_Final_files_AISJ_VC_Partner_V1_html` |
| VC | IC Member | `VC_Final_files_AISJ_VC_IC_member_V2_html` |
| VC | Investment Associate | `VC_Final_files_AISJ_VC_Associate_V1_html` |
| VC | Analyst | `VC_Final_files_AISJ_VC_Analyst_V1_html` |

Also present (not split): the two **launchers**
`Incubator Final files/AISJ_LauncherV7.html` and `VC Final files/AISJ_VC_Launcher (2).html`
— role-picker shells that embed the role HTMLs as base64. Their decoded copies are in
`.../scratchpad/launcher-inc/` and `.../scratchpad/launcher-vc/` (SU, JURY, ADMIN, PM, PA /
SU, ADMIN, PARTNER, IC, ASSOCIATE, ANALYST). Use only if you need to check the launcher screen itself.

### 2. Implementation
Repo root: `/Users/jayanthkomarraju/Documents/GitHub/startup-jury`
- Routing: `src/client/App.tsx` — maps nav slug → screen; unknown slugs fall through to `StubPage`.
- Nav manifest: `src/shared/nav.ts` (slugs mirror the prototype `panel-<slug>` ids).
- Roles/permissions: `src/shared/roles.ts`, `src/client/routes/guards.tsx`
- Screens: `src/client/routes/*.tsx` (+ `routes/analytics/*.tsx`)
- Shared UI: `src/client/components/*.tsx`, design tokens `src/client/index.css`
- Generic table screens: `src/client/routes/StagePage.tsx` (`INCUBATOR_STAGE_CONFIG` /
  `VC_STAGE_CONFIG` drive many pipeline slugs from one component) and
  `src/client/routes/CallsPage.tsx` (`*_CALLS_CONFIG`).
- Server/API: `src/server/routes/*.ts`, `src/server/index.ts`; scoring `src/shared/scoring.ts`;
  analytics `src/shared/analytics.ts`; pipeline `src/pipeline/*`.
- Background docs: `HANDOFF.md`, `docs/FINISH-PLAN.md` (§8 = authoritative meeting decisions),
  `docs/issue-log-2026-08.csv`. These describe intent; the PROTOTYPE outranks them on look & feel.

## How to judge parity
For every screen you own, build a **checklist of what the prototype actually contains**, then find
the repo counterpart and check each item. Cover:
1. **Presence** — does the screen exist at all, or is it a `StubPage` / generic `StagePage` stand-in?
2. **Layout & chrome** — page title, subtitle, toolbar buttons, filters/dropdowns, tabs, sub-nav,
   KPI tiles, split panes, drawer/modal, empty state.
3. **Data surface** — every table column (name them), card fields, chart types + their axes/series,
   badges/pills/legends, counts, sort/search/pagination, export.
4. **Report format** — for report/analytics screens: the exact tiles, tables, matrices, chart kinds
   and the column headers. This is what the client means by "report formats".
5. **Actions** — every button and what it does (modal it opens, transition it triggers).
6. **Copy** — headings and labels that differ in wording (the client wants an exact match).
7. **Visual system** — colours, typography, density, iconography where the repo clearly diverges.
8. **Role behaviour** — how the panel differs per role file (compare the role variants when the
   sizes differ) and whether the repo reproduces that.
9. **Functionality** — is the repo screen wired to real data/API, or static? Prototype is static by
   definition, so here you judge whether the repo *does* the thing the prototype *depicts*.

## Severity
- **P0** — screen missing entirely, or a whole workflow/report the prototype specifies is absent.
- **P1** — screen exists but a major element is missing (columns, chart, modal, action, tab).
- **P2** — meaningful but contained difference (wrong labels, missing filter/export, layout shape).
- **P3** — cosmetic (spacing, icon, wording nuance).

## Evidence rules
- Every finding must name the **prototype file(s) + panel/selector or JS function** and the
  **repo file:line** (or state `NONE` when there is no counterpart).
- Before calling something missing, **grep the whole repo** for it — a feature may live on another
  screen, in `StagePage` config, in a component, or in a server route.
- Do not invent. If you cannot verify, mark it `uncertain: true` and say what you checked.
