# The four-role extension — scoping the V3 work beyond the superuser

**Scoped 2026-09-23 against `36809e3`.** Produced by a seven-agent pass: one per role prototype
(`AISJ_ICAdmin_V6` · `AISJ_IC_PM_V5` · `AISJ_IC_PA_V3` · `AISJ_IC_Jury_V4`), one inventorying every
superuser gate in `src/`, one investigating the client's "two roles are missing" row, and one
synthesis. The per-role JSON and the two reports are in the workflow transcript; this file is the
plan they produced, kept verbatim so the reasoning travels with it.

Companion to `docs/plan_v3_superuser.md`, which remains the record for the superuser work itself.

**Already actioned from this scoping, before the wave:** the sign-in page's demo-login card listed
six of the twelve seeded accounts and omitted the incubator Admin and Program Manager — the literal
cause of the client's row, and not dev-gated, so it shipped. Fixed and pinned against the seed in
`test/client/loginDemoLogins.test.tsx`.

---

# Extending the V3 / 21-Sep work to the other four incubator roles

**Written 2026-09-23 against `36809e3`. Tree clean — nothing under `src/`, `test/` or `e2e/` was touched.**
Sources: the four per-role scoping reports, the gate inventory, the "missing roles" investigation. Every claim below was re-verified against the files named; the three places where the source reports contradicted each other are marked **[RECONCILED]**.

---

## 1. What is actually true about the five roles

**All five incubator roles exist and are fully built.** `src/shared/roles.ts:9-16` defines them; `migrations/0002_seed.sql:45-49` seeds one user each, including `nisha.kapoor@demo.startupjury.ai` (Admin) and `raj.kumar@demo.startupjury.ai` (Program Manager); `PERMISSION_ROLES.incubator` (`src/shared/types.ts:130`) carries all five in the client's own stated order. Each has its own sidebar — counted from the manifest at `src/shared/nav.ts:86-197`, the sizes are **admin 26 · program manager 22 · program associate 20 · jury 14**, with the superuser reaching 26 and shown 25. Each has pipeline permissions (`DEFAULT_ROLE_PERMISSIONS`, `types.ts:153-179`), its own prototype file, and its own pinned screen set in `e2e/parity.spec.ts` (26 admin · 22 PM · 20 PA · 14 jury rows). The Admin console's Roles & access legend and task-permission grid both render all five (`TeamRoles.tsx:1215-1233`, `:1276-1282`, fed by `PERMISSION_ROLES`), and the add-member dropdown offers admin, program manager, program associate and jury (`creatableStaffRoles`, `roles.ts:220-222` — it excludes `superuser` deliberately, because a workspace has exactly one owner). Twenty-seven e2e specs sign in as the incubator admin today. The row as filed — "Prog. manager and Admin. are missing" — is not true of the product.

**What the tester almost certainly saw is the sign-in screen.** `src/client/routes/LoginPage.tsx:7-14` hard-codes a "Demo logins · password demo1234" card, and for the incubator it lists exactly three accounts: Superuser, Program Associate, Jury. Admin and Program Manager are absent — the client's sentence verbatim, with nothing left over. It renders unconditionally (`LoginPage.tsx:86-101`, no `import.meta.env.DEV` guard), so it ships in production, and it is the only credential list the product hands out: a tester with no other list literally cannot sign in as Admin or Program Manager. They click the three buttons on offer, see three sidebars, and conclude there are three incubator roles. This also explains why the row carries "NA / NA" for screen and section — the observation is made *before* sign-in, so there is no in-app screen to cite. `docs/DEMO.md:48-53` lists all six incubator logins correctly, which is why nobody on the build side noticed the app contradicting it. The same card under-reports VC too (3 of 6), confirming it is a stale sample rather than a designed subset. **Recommended reply:** the five roles are built and seeded; the demo-login card was stale and now lists all of them. **The one question to ask if that does not settle it:** *"Was this observed on the sign-in screen's demo-login list, before signing in — or inside the app on a particular screen?"* A no means they were looking at Admin console → Scoring framework, where the score-visibility matrix genuinely draws **four** roles and **`admin` is the one absent** (`src/shared/scoreVisibility.ts:78-80`, deliberate — `:74` records that the prototype draws no admin row). That is a real gap, but it omits Admin only, not Admin *and* PM, so it fits the sentence half-way at best.

**One premise in the brief is wrong and should not propagate.** Item 9 says nav gives `help` to admin/PM/PA/jury "and NOT to superuser". `canSeeNav` (`nav.ts:339`) reads `role === "superuser" || item.roles.includes(role)`, and `help` (`nav.ts:192`) is not `exclusive`, not `portal` and has no `hiddenFor` — **the superuser sees Help.** The same bypass is in `requireRole` (`server/auth/middleware.ts:32`) and `requireTask` (`:63`). Consequence for every estimate in this plan: **a `roles: ["admin"]` list means admin *and* superuser.** There is no inverse gate and nothing to widen for item 9 in the incubator.

---

## 2. The matrix — eleven items × four roles

**EXTEND** = ship it this programme. **NO** = do not, with the reason in the footnote. **ASK** = a client decision; the fallback I would ship without an answer is in §6. **DONE** = already extended, no work.

| # | Item | admin | program_manager | program_associate | jury |
|---|---|---|---|---|---|
| 1 | V3 Dashboard (tiles · 2 shapes · Actions menu) | EXTEND | EXTEND | EXTEND | **NO** ᵃ |
| 2 | The four Status words | EXTEND ᵇ | EXTEND ᵇ | EXTEND ᵇ | **NO** ᶜ |
| 3 | Send to Assign / Send to Query | EXTEND ᵇ | EXTEND ᵇ | EXTEND ᵇ | **NO** ᵈ |
| 4a | Archive as a STATE (the tag) | EXTEND ᵇ | EXTEND ᵇ | EXTEND ᵇ | **NO** ᵃ |
| 4b | Archive as an ACTION (11 stages) | DONE | DONE | **ASK** ᵉ | **NO** ᵉ |
| 5 | "Contact Details Edited" | EXTEND ᵇ | EXTEND ᵇ | EXTEND ᵇ | **NO** ᶠ |
| 6 | Set up narrowed to Configure → Select | EXTEND | EXTEND ᵍ | **NO** ʰ | **NO** ʰ |
| 7 | My account / seat purchase | DONE ⁱ | **NO** ʲ | **NO** ʲ | **NO** ʲ |
| 8 | Area weights copy deletion | **ASK** ᵏ | n/a ˡ | n/a ˡ | n/a ˡ |
| 9 | Help / JURYbuddy | DONE | DONE | DONE | DONE |
| 10a | nav `labelOverrides` / `iconOverrides` on `alldecks` | EXTEND ᵇ | EXTEND ᵇ | EXTEND ᵇ | DONE ᵐ |
| 10b | `hiddenFor: ["superuser"]` on `evaluate` | **NO** ⁿ | **NO** ⁿ | **NO** ⁿ | n/a |
| 10c | `NAV_ORDER_OVERRIDES` | **ASK** ᵒ | **ASK** ᵒ | n/a ᵒ | n/a ᵒ |
| 11 · V3-UP | Upload & Evaluate + Evaluate redev | EXTEND | **ASK** ᵖ | EXTEND | **NO** ᑫ |
| 11 · V3-JP | Jury Pipeline (Status col deleted, 2 actions) | EXTEND ʳ | EXTEND ʳ | n/a ʳ | **NO** ˢ |
| 11 · V3-REP | Evaluation report | DONE ᵗ | DONE ᵗ | DONE ᵗ | DONE ᵗ |
| 11 · V3-SF | Score-visibility matrices | **ASK** ᵘ | **NO** ᵛ | **NO** ᵛ | **NO** ᵛ |
| 11 · V3-PT | SeatsCard in Team & roles | EXTEND ʷ | **NO** ᵛ | **NO** ᵛ | **NO** ᵛ |
| 11 · V3-PT | Price configuration | **NO** ˣ | **NO** ᵛ | **NO** ᵛ | **NO** ᵛ |
| 11 · V3-PT | `nominateOnly` (wizard step 4) | **NO** ʸ | **NO** ʸ | **NO** ʸ | **NO** ʸ |
| 11 · V3-AW | AI-prompt column + Seat configurability | **ASK** ᵏ | n/a ˡ | n/a ˡ | n/a ˡ |
| 11 · V3-FLOW | Intro-call scheduling | DONE ᶻ | DONE ᶻ | DONE ᶻ | DONE ᶻ |

**Footnotes — the disagreements, and why.**

**ᵃ Jury is not a widening; adding `"jury"` to `isV3Dash` is dead code.** Verified at `DashboardPage.tsx:921-922`, `:927-929`, `:941-949`: `isJury` is tested **before** `isV3Dash` at all three decision sites, so a juror added to the flag keeps `juryTiles(mine)` and the `juryOpen`/`jurySubmitted` shapes and sees no change whatsoever. More importantly they should not get it: the jury already has a five-tile, two-shape screen built verbatim from their own prototype's `mpRender()` (`DashboardPage.tsx:398-423`, `:211-219`), and the V3 shape would delete a screen that already matches. The row Actions menu specifically must not come — the jury prototype's `.act-btn`/`.act-drop` CSS is a dead style block with zero call sites, and the jury holds no Dashboard-row pipeline transitions (`src/pipeline/incubator.ts:93/102/109` give them only `start_jury_eval`, `shortlist`, `reject`).

**ᵇ Rides the single predicate `isV3Dash` at `DashboardPage.tsx:694`.** Items 2, 3, 4a, 5 have **no gate of their own** — `v3StatusKey`/`matchesV3Stat`/`v3DeckStats` (`deckStats.ts:519/565/617`) and `deckListRoute` (`shared/queries.ts:484`) are pure and role-free; migration 0075's `ai_complete`, `lastActivityAt`, `queried` and `contactEditedAt` are already served to every role (`server/routes/decks.ts:311`, `:361-364`); and `PATCH /api/decks/:id`'s `EDIT_DECK_ROLES` (`decks.ts:700-707`) already contains all three roles. Flipping `:694` for admin/PM/PA ships items 1, 2, 3, 4a and 5 in one edit. **Item 10a is the same edit's other half** — without it the sidebar reads "All decks" while `homeTitle` (`DashboardPage.tsx:1078`) renders "Dashboard".

**ᶜ Wrong vocabulary for the role.** The juror's Status column has its own five words — Assigned · Pending · Overdue · Draft · Evaluated — built as `juryPill` (`DashboardPage.tsx:438-447`) from the prototype's `chip()`. Those describe the juror's own obligation; a juror has no visibility of `ai_complete` or `missing_fields` and no action on either.

**ᵈ The destinations do not exist.** `assign` and `query` are `["admin","program_manager","program_associate"]` (`nav.ts:102`, `:107`); a juror navigating to `/app/assign` hits `RequireNav`'s 403. Extending would mean granting jury the Assign and Query screens — a permission-model change nobody asked for.

**ᵉ Three sources, two answers — a genuine contradiction to put to the client.** `src/pipeline/incubator.ts:145-163` sets `roles: ["program_manager","admin","superuser"]` on all eleven widened `* → archived` transitions and on both Restores (`:169`, `:177`), and `allowedTransitions` has **no superuser bypass** (`pipeline/index.ts:28-37`) — that array *is* the rule. But `DEFAULT_ROLE_PERMISSIONS.incubator.archive` (`types.ts:169`) **does** include `program_associate` (and jury), which is why the PA sees the Archive screen at all; and the PA prototype gives them a working Restore button per row (`arRestore` in `_scripts.js`). The build contradicts itself for the PA whichever way the client rules. Practical consequence if left: with item 1 extended, the PA's Actions menu draws "Archive" unconditionally (`DashboardPage.tsx:1444-1446`) and it permanently reads as unavailable.

**ᵍ The cheapest of the six extensions, and safer than the superuser's was.** The client's own row for this item names *Superuser / Prog. manager / Admin*, so both are covered by the instruction. The PM's seat is `"cohorts"` (`SetupWizard.tsx:127`), so `stepsFor` already slices Org type off and `TeamStep`'s `manages = seat === "full"` is already false (`setup/TeamStep.tsx:145`) — they never had the roster, the add-member form or Buy seats, so deleting their step 4 strands nothing. That is the opposite of the superuser case, where §12.7 had to move `purchaseSeats` into Team & roles to avoid stranding it. **The admin is a `full` seat and does have that problem** — see ʷ.

**ʰ Not named by the client's row, and meaningless or harmful.** The PA's seat is `"readonly"` (`SetupWizard.tsx:127`), so they already see a view-only wizard; deleting step 3 would also delete `StandardSeatBanner` (`SetupWizard.tsx:133-143`, rendered inside `TeamStep`'s `!manages` branch at `TeamStep.tsx:207-215`) — the only place that tells them their seat is read-only. The PA prototype has no Set up item at all, and the jury has no `setup` nav (`nav.ts:172`).

**ⁱ Already shipped to the admin.** `AccountOverlay.tsx:317` reads `edition === "incubator" && (role === "superuser" || role === "admin")`; `e2e/parity.spec.ts:321`/`:326` already carry the admin's account and billing rows.

**ʲ Client's row says Superuser + Admin and stops, and for once the stale prototypes agree.** The PM, PA and jury top-navs all render the plan pill **locked** — `profPlanLocked()`, *"Your plan is set by your subscription and can't be changed here"* — and none of the three sidebars carries a My account item. Widening is also the most expensive item on the list: five coordinated edits (`nav.ts:175` `billing`, `types.ts:156` `upgrade`, `server/routes/account.ts:59`, `server/routes/billing.ts:71`, `config.ts:1083/1108/1139`).

**ᵏ The strongest prototype conflict on the list, and not a clean predicate flip.** Measured from the decoded consoles: `AISJ_ICAdmin_V6/admin/s-wt.html` has `<th>Type</th>` and `<th>Permit configuration</th>`, zero hits for "AI prompt" and zero for "Seat configurability"; the V3 superuser's has `<th>AI prompt</th>`, 15 "AI prompt" hits and the `Parameter set · Standard · Pro · Premium` card. So the admin prototype draws **neither half** of V3-AW. Worse, §12.5 records that one of the two deleted sentences — *"These parameters are configurable by default."* — is **verbatim prototype copy** (`admin.html:410`), so widening the deletion widens a recorded deviation rather than closing a gap. **Split the question:** the AI-prompt/Seat-configurability redesign is a different decision from the copy deletion.

**ˡ Unreachable, so there is nothing to extend.** `AreaWeightsSection` mounts in exactly one place — `admin/registry.tsx:52`, inside the Admin console — and `admin` is `roles: ["admin"]` (`nav.ts:174`), as is `coreparams` (`:169`). `usesV3AreaWeights` can never be evaluated for a PM, PA or juror. The PM and PA prototypes both embed a 12-section `ADMIN_B64` console, but `openAdmin()` has **zero callers** in either file (4 in `AISJ_SuperuserV3`, 2 in `AISJ_ICAdmin_V6`), and the PM console's own footer reads *"Rajan Sharma · Admin"* — it is the admin's console shipped as dead weight. **This is the base64 trap firing in the opposite direction from usual: decoding it finds content, and the content is not evidence of scope.**

**ᵐ Already extended.** Jury gets "My Pipeline" (`nav.ts:93`), "Evaluated" (`:119`), "My Intro calls" (`:140`) and "My Archive" (`:158`), matching `_sidebar.html` verbatim.

**ⁿ Do not hide Evaluate from admin/PM/PA, and this is the one place I am overruling a per-role report.** V3 deletes the standalone item only because `upSendToEvaluate()` gives Upload the entry point (`nav.ts:60-68`); all three prototypes draw `si-evaluate` in their sidebars, and `test/unit/nav.test.ts:268-271` pins `isInSidebar("program_associate", evaluate) === true` on purpose. Unlike the superuser these roles are not dependent on the Upload button for reachability, so hiding it buys nothing and risks stranding a screen. **Leaving it also removes the only cross-session ordering dependency in the wave** — see §4.

**ᵒ §4 Q11 is still open and the roles sit on opposite sides.** The admin prototype orders `si-forsignup` **before** `si-introcalls`; the PM prototype orders `jurypipeline · forsignup · introcalls`; V3 reverses both. For the PA and jury the override is a provable no-op (`pmpipeline` is invisible to them, so `applySidebarOrder` re-lays one item into its own slot). `parity-nav` does not assert order, so neither answer moves a gate — it is a pure product call.

**ᵖ Two prototypes want a multi-select Evaluate for the PM and they disagree on the chrome.** `AISJ_IC_PM_V5`'s panel-evaluate differs from **both** superuser files (md5 `2d68d311` vs v15 `34060deb` vs v3 `b73ca6b6`) and already carries a redesign: `evToggleAll()`/`#ev-chk-all` "Select all", an `.ev-sel-count` strip, and a bottom action bar with Cancel + `evGoEvaluate()` "Evaluate selected decks". V3 instead puts an `evAiEvaluate()` **"AI Evaluate"** button in the toolbar, moves the checkbox into the column-1 header with `#ev-col1-count`, has no bottom bar, and adds the sub-line *"evaluated decks move to the Assign screen"*. This is the cleanest "the client should pick" on the list — V3 is the later file, but the PM's is the one drawn for this role.

**ᑫ And a trap worth naming.** `App.tsx:118` routes **both** `evaluate` and the jury-exclusive `jassigned` to `EvaluatePage`, so adding `"jury"` to `isV3Evaluate` (`EvaluatePage.tsx:120-124`) would silently rebuild the jury's Assigned screen. Jury also has no `upload` nav (`nav.ts:98`), so the Upload half is meaningless for them.

**ʳ [RECONCILED] The admin lane report was wrong here — the gate does exist.** It claimed "NO ROLE GATE EXISTS" for V3-JP. Verified at `StagePage.tsx:1727-1745`: the delta is `roleVariants: { superuser: { columns, legend: undefined, emptyDescription } }`, applied at `:391-394` (`base.roleVariants?.[role]`). The admin and PM both reach the screen (`nav.ts:112-119`, `roles: ["admin","program_manager","jury"]`) and both currently get the base nine-column shape including STATUS — pinned at `e2e/parity.spec.ts:278-281` and `:350-352`. The client's item-2 complaint (the row pill repeats the per-juror `jp-jstat` pills) is true of both screens identically. The PA has no `jurypipeline` nav at all, so it is n/a for them — that absence is a separate prototype-vs-build gap, listed in §5. **Note the mechanism's limit:** `StagePage` applies exactly **one** variant per role, with no composition, so if jury ever needs its own variant the whole object must be duplicated.

**ˢ Direct conflict with the jury's own prototype, resolved against extending.** `AISJ_IC_Jury_V4`'s `panel-jurypipeline.html` declares **both** a Status and an Action column (12 `<th>`), and `jpRender` emits a four-option Action select — View deck · Submit · Save draft · Re-assign — none of which is one of V3-JP's two. The client's reported defect is about the superuser's row pill restating per-juror pills; the jury's table has no per-juror pill column, so the repeat does not exist for them and the "fix" would delete a column they need. Separately, the build gives the jury the wrong table here entirely — see §5, the wave's P0.

**ᵗ No gate exists, so it never needed extending.** `EvaluationDrawer.tsx` / `EvaluationReport.tsx` contain no role or edition predicate; the only role read is `viewerRole`, feeding `reportStage`'s per-viewer section modes (`shared/reportStage.ts:128-150`), which is role-awareness by design, not a V3 gate.

**ᵘ Two questions, not one, and the second is not a one-liner.** (a) Should the admin get the matrix **editor**? `showMatrices` (`admin/ScoringFramework.tsx:387`) is one line — and the server already agrees, which is the problem (see §5, P0-2). (b) Should `admin` become a **fifth row and column**? Today `VISIBILITY_ROLES.incubator` has four entries and `:74` says outright *"`admin` is in neither — the prototype does not draw it"*. Opening the editor without (b) hands the admin a matrix that does not contain their own role. (b) moves migration 0072's persisted shape **and** the server-side filters on `GET /decks/:id/report` and all three analytics reports — that is the wave's only migration candidate.

**ᵛ Console- or overlay-only, and the role reaches neither** (`nav.ts:174-175`, `AccountOverlay.tsx:317`). Opening the Admin console to PM/PA is an XL change touching ~25 server call sites (`permissions.ts:31`, `audit.ts:45`, `crm.ts:62`, `signup-config.ts:77`, `pricing.ts:308`, `billing.ts:71`, `esign/routes.ts:111-113`, `anchors.ts:131`, `questions.ts:51`, `users.ts:214/354/597`, `aiPrompts.ts:237/260/289/335`, `config.ts:172/903/1018/1043/1066`). Not this programme.

**ʷ Not optional if item 6 extends to the admin.** §12.7 records that deleting the superuser's step 4 removed the sole importer of `purchaseSeats`, and the flow was moved whole into Admin console → Team & roles as `SeatsCard`, gated `edition === "incubator" && role === "superuser"` (`admin/TeamRoles.tsx:260`). The admin is a `full` seat and is about to lose the same step. It also closes a live inconsistency: the admin can already buy seats from My account (ⁱ) but not from Team & roles, and `/api/seats` already admits them (`server/routes/seats.ts:60`, `requireTask("addmembers","admin")`).

**ˣ The client is pulling the other way on this exact surface.** §12.1 item 10 says Price Configuration should belong to AISJ, not the customer, and `migrations/0033_price_configuration.sql:5-7` already calls it *"a PLATFORM-OWNER surface"*. `admin/PriceConfiguration.tsx` has no role predicate today and `e2e/price-configuration.spec.ts` drives it as the incubator admin, so the admin already has it — widening anything here would move against a live request to narrow it.

**ʸ Self-cancelling.** If item 6 lands there is no step 4 to render `nominateOnly` in — which is exactly why §12.7 records it as unreachable and KEPT only against a reversal (`setup/TeamStep.tsx:147`). The super-user nomination is already in Team & roles (`AccountOwnerCard`).

**ᶻ No gate, and measured.** §3.1 measured `AISJ_ICAdmin_V6`, `AISJ_IC_PM_V5` and `AISJ_IC_PA_V3` as the three other incubator scheduler builds, with byte-identical `ncRoles` and byte-identical `panel-introcalls.html` (md5 `9de0d3e0`, 9,430 B). `trailing: ["assignScheduler","action"]` is on the shared config, not a roleVariant. The jury's own thirteen-column variant is already built (`CallsPage.tsx:1549-1600`).

---

## 3. The sessions

**This is two waves, not one. Wave R is the widening; Wave R+1 is the jury and the ASKs.** Saying otherwise is how this programme has burned waves: the jury lane is a redesign blocked on a server fix, and four of the matrix's ASK cells cannot be estimated until the client answers.

**Migrations: Wave R needs ZERO.** Main ends at `0075`; `ALLOTMENT_CEILING` in `test/worker/migrations-w1b.test.ts:40` is **76**, so exactly **one** slot (`0076`) exists. Nothing in Wave R persists anything new — every item is a client-side predicate over data the server already serves. **The one slot is reserved for Wave R+1's V3-SF question (b)**, which would move `score_visibility`'s persisted shape. If the client also says yes to anything else needing schema, **the ceiling must be raised and that must be a stated decision, not a session's discretion.**

### Wave R — six sessions, parallel, worktree-isolated

| Session | Owns exclusively | Closes | Migration |
|---|---|---|---|
| **R1-DASH** | `src/client/routes/DashboardPage.tsx` · `src/shared/nav.ts` · `test/client/allDecks.test.tsx` · `test/unit/nav.test.ts` | Items **1, 2, 3, 4a, 5, 10a** for admin + PM + PA; the `upload` labelOverride line | none |
| **R2-UPEVAL** | `src/client/routes/UploadPage.tsx` · `src/client/routes/upload/**` · `src/client/routes/EvaluatePage.tsx` · `test/client/upload.test.tsx` · `test/client/evaluateV3.test.tsx` · `e2e/upload.spec.ts` · `e2e/evaluate-v3.spec.ts` | **V3-UP** for admin + PA (PM pending Q-P) | none |
| **R3-SETUP** | `src/client/routes/SetupWizard.tsx` · `src/client/routes/setup/**` · `src/client/routes/admin/TeamRoles.tsx` · `test/client/setupWizard.test.tsx` · `test/client/setupTeam.test.tsx` · `test/client/teamRoles.test.tsx` · `e2e/setup-wizard.spec.ts` · `e2e/programs.spec.ts` · `e2e/automation.spec.ts` · `e2e/team-roles.spec.ts` | Item **6** for admin + PM; the **SeatsCard** prerequisite (ʷ) | none |
| **R4-JP** | `src/client/routes/StagePage.tsx` · `test/client/stagePage.test.tsx` | **V3-JP** for admin + PM | none |
| **R5-LOGIN** ✅*(login half DONE 2026-09-23 — see the header; only P0-2 remains)* | `src/client/routes/LoginPage.tsx` · `src/client/routes/admin/ScoringFramework.tsx` · `src/server/routes/config.ts` · `test/client/scoringFramework.test.tsx` · `e2e/scoring-framework.spec.ts` | The **client's filed row** (demo logins, all 5 incubator + all 6 VC); **P0-2** (§5) | none |
| **R6-SCOPE** | `src/server/routes/decks.ts` · `test/worker/deck-scope.test.ts` *(new)* | **P0-1** (§5) — server-side assignee scoping for jury | none |

Sizing, honestly: **R1 is roughly twice any other session** and is the one to watch. It carries a structural consequence none of the six source reports named — see §4, "the orphaned screen". R5 and R6 are small and independent; R3 and R4 are medium; R2 is medium and may shrink to admin-only if the client answers Q-P against V3.

### Wave R+1 — after Wave R merges and the client answers

Ordered, because two of these depend on Wave R:

1. **R7-JURY** — the jury lane proper. **Blocked on R6-SCOPE landing**, because the P0 below decides what a juror's rows even are. Scope: the Evaluated/`jurypipeline` table (the jury's twelve prototype columns, not the staff nine), the `jassigned` allocation table, and the "Drafts" tile. This is a redesign, not a widening: three shadowed branches, no `assign`/`query`/`upload` nav, no `edit_contact` permission, no Archive transition.
2. **R8-AW/SF** — items 8 and V3-AW/V3-SF for the admin, **only if** the client answers Q-K and Q-U. Takes migration `0076` if answer (b) to Q-U is yes.
3. **R9-GAPS** — the prototype-vs-build gaps in §5 that survive triage, each as its own decision.

---

## 4. The collisions, and how they split

| File | Wanted by | Split |
|---|---|---|
| **`src/client/routes/DashboardPage.tsx`** | Items 1, 2, 3, 4a, 5, 10a | **No split needed** — all five items flow through the single predicate at `:694`. Giving them to five sessions would be five sessions editing one line. **R1 owns it whole.** This is the plan's main consolidation and the reason the wave is six sessions rather than eleven. |
| **`src/shared/nav.ts`** | R1 (`alldecks` label/icon, `:93-94`), R2 (`upload` label `:98`, `hiddenFor` `:106`), R4 (nothing), §5 gaps (`coreparams`, `jurypipeline` role lists) | **R1 owns it exclusively**, and makes the `upload` labelOverride line on R2's behalf — one line, no behaviour, no dependency on R2's outcome. **`hiddenFor` is not touched at all this wave** (footnote ⁿ), which deliberately deletes the only ordering dependency between R1 and R2. The `coreparams`/`jurypipeline` role-list widenings are §5 gaps and are **not** in Wave R. |
| **`src/shared/deckStats.ts`** | Nominally items 1, 2, 4a | **Nobody — it is read-only this wave.** `v3StatusKey` (`:519`), `V3_STATUS_LABELS` (`:460-465`), `matchesV3Stat` (`:565`) and `v3DeckStats` (`:617`) are already pure and role-free. The contention is imaginary; the only file-level consequence is that its comment block at `:368-372` ("the admin, program-manager, program-associate and jury prototypes were NOT reshared") becomes false — **R1 rewrites that comment** as part of owning the item. |
| **`e2e/parity.spec.ts`** | R1 (14 rows), R2 (4), R3 (2), R4 (2), R5 (1) | **Nobody in Wave R — the integration session owns it.** `EXPECTED` (`:162`) is one flat record and every session would land a hunk in it. Each session instead ships `docs/parity-requests/R<n>-parity.patch` with its exact row delta, per the repo's existing mechanism. **`git apply --check` every patch at integration** — the memory note records four patches sitting unapplied for one to two waves. |
| **`test/client/allDecks.test.tsx`** | R1 only | R1 owns it, but note what is in there: the default principal is `mount(role: Role = "admin", id = "u_admin")` at `:173`, and it is the default for the **ten** `it`s in the "All decks — staff table" describe (`:244-400`). Those are not the visible negative control — they are collateral. |
| **`src/server/routes/decks.ts`** | R6 (the scoping clause), nominally R1 (item 5's event) | **R6 owns it.** Item 5 needs **no server change** — `EDIT_DECK_ROLES` (`:700-707`) already contains all three roles and the event write at `:836-853` is role-free. |
| **`src/client/routes/admin/TeamRoles.tsx`** | R3 (SeatsCard), potentially R8 (Team & roles realignment) | R3 owns it in Wave R; R8 is Wave R+1, so no overlap in time. |

**The orphaned screen — the wave's biggest hidden cost, named by none of the six reports.** `principal()` in `allDecks.test.tsx:157-162` hard-codes `edition: "incubator"`. If admin, PM and PA all move to V3, **there is no incubator staff role left on the pre-V3 screen** — the jury has its own tiles and shapes, so `STAT_ORDER.incubator`, `matchesStat(incubator, …)` and the four v15 table shapes (`details`, `evaluated`, `assigned`, `shortlisted`) become **unreachable in production for the incubator edition**, surviving only for VC. The ten staff-table tests therefore **cannot be re-pointed at another role** — they must be moved to the VC edition or deleted, and the negative-control loop at `:894-925` must go with them. R1 must budget for that explicitly and must not quietly delete the incubator branch of `deckStats` in the same change: leave the code, delete the incubator assertions, and record the dead branch as a Wave R+1 cleanup.

---

## 5. What NOT to do this wave

1. **Do not add `"jury"` to `isV3Dash`.** It is dead code (`isJury` shadows it at all three sites) and, if the precedence were fixed, it would delete a screen that already matches its prototype.
2. **Do not open the Admin console to PM or PA.** ~25 coordinated server call sites, and no incubator prototype gives either role a reachable console — the embedded `ADMIN_B64` blobs have zero `openAdmin()` callers and the PM's carries *"Rajan Sharma · Admin"* in its own footer.
3. **Do not widen `seatFlow` beyond superuser + admin.** Five coordinated edits, the client's row names two roles, and all three other prototypes independently lock the plan pill.
4. **Do not hide the `evaluate` nav item from anyone new.** All three prototypes draw it, `test/unit/nav.test.ts:268-271` pins it, and V3's justification for deleting it does not transfer.
5. **Do not touch `admin/PriceConfiguration.tsx`.** §12.1 item 10 is a live request to move it the other way.
6. **Do not widen `nominateOnly`.** Item 6 removes the step that renders it.
7. **Do not extend V3-JP to the jury.** Their prototype declares both the Status and Action columns and a four-option select; the client's complaint is about a repeat that does not exist on their screen.
8. **Do not take migration `0076`.** Nothing in Wave R persists anything; the one slot belongs to Wave R+1's V3-SF answer.
9. **Do not "add the missing roles" to `requireTask` call sites as a sweep.** `server/routes/users.ts:724` gates `POST /:id/transfer-ownership` with `requireTask("adminconsole")` and an **empty role list** — the emptiness *is* the gate (`middleware.ts:63`). A widening wave that tidied that call site would silently open account-ownership transfer. Documented at `users.ts:705-712`; treat it as a tripwire.
10. **Do not fold the three missing PA/PM screens into "extend V3".** Core Parameters (read-only) for PM and PA, Jury Pipeline for PA, and PM pipeline for PA are prototype-vs-build permission gaps that **predate V3 entirely**. Deciding them under cover of a restyle would smuggle a permissions change past review. They are Wave R+1, item R9.

### Two divergences that are more urgent than anything above, and are in Wave R for that reason

**P0-1 · `GET /api/decks` does not scope a jury member — "My Pipeline" is client-side only. → R6-SCOPE.** The only row filter is `if (role === "founder") clauses.push("d.uploaded_by = ?")` (`server/routes/decks.ts:399-402`). A juror's `GET /api/decks` returns **every deck in the edition** with founder name, email, phone, city, sector, tags and stage (`toDeckView`, `:290-372`); the client then filters to `mine` at `DashboardPage.tsx:899-901`. `StagePage` filters by stage only (`:519-533`, no assignee predicate anywhere in the file), so a juror opening `/app/archive` — labelled **"My Archive"** — sees every archived deck in the workspace, and `/app/jurypipeline` ("Evaluated") shows every deck in jury stages. **The counter-example proves this is a defect, not a policy:** `CallsPage.tsx:685-691` does exactly the right thing, with the comment *"Read-only participants (jury, IC members, analysts) see only the decks they're actually on a call for."* One screen enforces it; two do not. Blind scoring *is* enforced server-side (`decks.ts:432-470`), so this is a PII and pipeline-visibility exposure rather than a score leak. This is the recurring role-boundary-leak class in the memory note; **run the negative control both ways.**

**P0-2 · The score-visibility matrix is writable by `admin` and drawn for `superuser` only. → R5-LOGIN.** Client: `showMatrices = superuser && incubator` (`admin/ScoringFramework.tsx:387`). Server read: `GET /api/config/scoring` (`config.ts:788-830`) returns both editions' full matrices to every non-founder. Server write: `PUT /api/config/scoring-framework` is `requireTask("adminconsole","admin")` (`config.ts:903`) and `visibilityWrites` (`:862-890`) persists any well-formed `visibility` body. `score_visibility` is what `canSeeEvaluatorScoresIn` resolves (`roles.ts:180-189`), driving the report route and all three incubator analytics reports — so **an admin can grant a program associate sight of program-manager scores through an API whose console does not show the grid.** Decide one way: widen `showMatrices` to admin (one line, the server already agrees) or narrow the route. Leaving it is the repo's recurring defect class in its write form.

**P1 · The SeatsCard is hidden from the admin while `/api/seats` admits them** (`TeamRoles.tsx:260` vs `seats.ts:60`) — not a leak, but inconsistent with ⁱ, and R3 closes it as ʷ anyway.

---

## 6. Open questions for the client — with the fallback I would ship if they never answer

| | Question | Ship-without-answer |
|---|---|---|
| **Q-A** | Extending the V3 Dashboard to admin, PM and PA contradicts all three of their prototypes (v15 six tiles, no Archived tile, no Actions column) — confirm this deviation in writing? | **Extend.** The written instruction is later than the files and the client said the files are stale. Record it in §12 the way §12.6/§12.7 recorded theirs, or the next parity capture reverts it and re-files it as a P0. |
| **Q-B** | Does the sidebar item become "Dashboard" with the LayoutDashboard icon for these three, or do they keep "All decks" over the new screen? | **Rename.** A sidebar saying "All decks" over an H1 saying "Dashboard" is a worse outcome than either consistent answer. |
| **Q-C** | Item 7/Q7 — if the V3 tile set reaches these roles, does the retained `Assigned` tile come with it (`ASSIGNED_TILE_RETAINED_PENDING_Q7`, `deckStats.ts:586`), or is this the moment to ship the prototype's six? | **Keep it retained.** Deleting it reverses Aug-2026 issue 4, quoted at `deckStats.ts:166-167`; one unanswered question should not silently undo a closed one. |
| **Q-D** | Item 6 — the client's row names Prog. manager, but the PM prototype draws three steps ending in Team. Delete the Team step for the PM too? | **Delete it.** The row names them, and the PM's `cohorts` seat means nothing is stranded (ᵍ). |
| **Q-E** | Item 4b — should `archive`/`restore` widen to the program associate? Prototype says yes, `types.ts:169` says yes, `pipeline/incubator.ts:163` says no. | **Widen.** Two of three sources say yes, and the alternative is a permanently-unavailable Archive option in the PA's new Actions menu. Restore widens with it. |
| **Q-K** | Item 8 / V3-AW for the admin — the copy deletion, the whole redesign, or neither? | **Neither.** One of the two deleted sentences is verbatim admin-prototype copy, so extending widens a recorded deviation rather than closing a gap. |
| **Q-O** | §4 Q11, now forced — is the Intro calls / Prog manager pipeline swap global or superuser-only? | **Superuser-only.** `parity-nav` does not assert order, so the answer moves no gate, and the admin and PM prototypes both order it the other way. |
| **Q-P** | V3-UP for the PM — their own prototype's bottom action bar, or V3's toolbar "AI Evaluate" button? | **STILL OPEN — and `R2-UPEVAL` did NOT take the fallback.** The session shipped V3-UP to the admin and the program associate and left the PM on the v15 surface, because the two candidate designs are visibly different screens and the fallback ("V3's, it is the later file") is an argument from filename order, not from the client. Withholding costs nothing and reverses nothing: the PM keeps the screen they have today. **The record is executable, not a note:** `src/client/routes/upload/v3Up.ts` holds `V3_UP_ROLES` and `PROGRAM_MANAGER_PENDING_Q_P`, both screens read that one gate, and `test/client/upload.test.tsx` + `test/client/evaluateV3.test.tsx` each pin the set and the constant — so the PM cannot be added by accident, and answering "V3's" is dropping the guard on one flagged line. Answering "the PM's own design" is a **new session, not a flip**: the bottom action bar is markup neither built screen has. |
| **Q-U** | V3-SF — (a) give the admin the matrix **editor**, and (b) make `admin` a fifth row and column? | **(a) yes, (b) no** — for now. (a) is one line and closes P0-2 in the direction the server already took. (b) moves migration 0072's shape and the report filters; it deserves its own wave, and the admin sees everything via rank 99 in the meantime. |
| **Q-L** | Should the demo-login card ship in production at all, or be dev-gated with the roster living in `docs/DEMO.md`? | **Fix it and ship it.** Add the two missing incubator rows and the three missing VC rows in `ROLE_LABELS` order — that closes the client's filed row today. Dev-gating it is a separate call and would reopen the row. |
| **Q-J** | With item 1 extended, the PA's row Actions menu shows fewer options than the superuser's (no Archive, unless Q-E). Is a visibly shorter menu acceptable, or should blocked options render disabled-with-a-reason, as §12.8 Q111 settled for incomplete rows? | **Disabled-with-a-reason**, matching Q111. A menu that silently differs per role is the thing that generates "feature missing" rows like this one. |


---

## 7. Measured after scoping — P0-1 is real, and here is the number

`P0-1` was verified against a running dev server rather than left as a reading, because this is the
repo's recurring defect class and the plan above turns on it.

Signed in as `rajesh.kumar@demo.startupjury.ai` (incubator jury) and called `GET /api/decks`:

| | |
|---|---|
| decks returned to the juror | **15** |
| decks actually assigned to them | **7** |
| **not theirs, carrying founder name + email + phone** | **8** |

Four of the eight, verbatim from the response: FinStack (Rohan Mehta · rohan@finstack.io ·
+91 99012 88456) · GreenGrid Energy (Ananya Reddy · ananya@greengrid.in · +91 98480 21345) ·
SolarCircuit (Nikhil Rao · nikhil@solarcircuit.in · +91 98330 41290) · PayRoute (Vikram Singh ·
vikram@payroute.in).

`DashboardPage.tsx:899-901` says so in its own words — *"(F0193 asks the API to scope this; until
it does, the screen does)"* — so this is a known, deferred gap rather than a new discovery. It is
**not** an active breach: the deployed instance is the demo workspace with no real customer data
(confirmed 2026-09-12). That is why it stays a dedicated session (`R6-SCOPE`) with negative controls
both ways, rather than a hurried patch inside a restyle wave — but it should be the FIRST session to
land, and it must land before `R7-JURY`, which cannot decide what a juror's rows are until the
server does.
