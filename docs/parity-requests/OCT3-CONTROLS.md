# OCT3-CONTROLS — three controls the client withdrew, and one they want back

Lane: **3-Oct issues 20, 24, 27 and 22.**
Files: `src/client/routes/StagePage.tsx` · `src/client/routes/upload/CrmMethod.tsx` ·
`test/client/stagePage.test.tsx` · `test/client/crmMethod.test.tsx` (new).
`src/client/routes/admin/TeamRoles.tsx` is **unchanged** — see §4, which is the
whole of issue 22's answer.

---

## 1 · Issue 20 — the jury's Action column is gone

`JURY_PIPELINE_JURY` drops `"action"` from its column list **and sets
`readOnly: true`**. Both halves are load-bearing: `tableColumns` APPENDS the
built-in Action cell to any screen whose list omits it, so dropping the string
alone redraws Shortlist / Reject as buttons — the test asserts that shape
specifically, and the half-fix fails it.

This is the pattern `JURY_PIPELINE_READONLY` landed for the programme associate
two days ago, with the mirror-image reason: the associate declared a custom
`col("action", …)` that `readOnly` deliberately keeps, so their list had to lose
the cell; the jury declared the built-in string, so their list has to lose the
string *and* set the flag.

**What the juror lost, deliberately.** `actionMenu: {}` went with it, so the
prototype's `jpActionSelect` — View deck, plus the juror's own `shortlist` /
`reject` — is off this screen entirely. That select was the one place the build
kept the prototype's shape and its own substance (R7-JURY §"the Action column"),
and issue 18 settles it the other way for the same two transitions on the
evaluation report: *"Not required since the below threshold levels are indicated
automatically. It is the prerogative of the Incubator to take a final call. Juror
is always an external guy."* The juror still reaches the deck through the
Evaluation drawer their startup name opens, and scores it on Evaluate.

**The server still grants them.** `pipeline/incubator.ts` lists `jury` on both
`shortlist` (`jury_evaluation → shortlisted`) and `reject`
(`jury_evaluation → rejected`). The UI no longer offers either, but a juror who
POSTs `/api/decks/:id/transition` still moves the deck — the role-boundary class
this project has re-opened three times. **Cross-lane request (A), below.**

## 2 · Issue 24 — Sign up Pipeline's Sign-up action, deactivated

New `StageConfig.signupComingSoon`, set on `INCUBATOR_STAGE_CONFIG.incuration`
only. The row's **Sign-up** button (the prototype's `openSuWork`) renders
disabled with the tooltip **"Sign-up — coming soon"**, for every role that
reaches the screen.

Two things worth keeping in the next reader's head:

* **The tooltip hangs on a wrapping `<span>`, not on the button.** `Button`
  carries `disabled:pointer-events-none`, so a `title` on a disabled `Button` is
  markup no hover can ever reach — the "mouse over comment" the client asked for
  would silently not exist. The span is the fix; the test pins the span.
* **It is one screen's flag, not a renderer mode.** Onboard ready
  (`curation`) draws the same button from the same `actionCell` and it is how a
  cohort seat gets allocated. The test "Onboard ready keeps its Sign-up action
  live" is the control for exactly that mistake.

The workspace is **not** withdrawn: the row's slide-over keeps its Sign-up tab
and its "Open sign-up workspace" button. That is deliberate — the client
deactivated an action, not a feature — and it is also the path the e2e suite can
take, which is cross-lane request (B).

## 3 · Issue 27 — the CRM option says coming soon

A notice strip at the top of `CrmMethod`, `data-testid="up-crm-soon"`:
"Upload from CRM — coming soon. Decks can't be pulled from a CRM yet; use Single
or Bulk upload meanwhile."

Clicking the option is what opens this panel, so the panel is where the words
go. Nothing else on the panel changed, and that is the point of two of the three
tests: for an administrator the four provider tiles still link to
`/app/admin?section=crm`, where a connection is really recorded — what does not
exist is the PULL, which is what the notice says. `e2e/crm-sync.spec.ts` clicks
Salesforce and lands on that section; it stays green.

The radio itself (`#up-um-crm`) is untouched, in `upload/Wizard.tsx`, and should
stay clickable: the client's wording is "when clicked, it should say coming
soon", not "deactivate it" — which is what they asked for on the Sign up
Pipeline button instead.

## 4 · Issue 22 — "Email id field is not available for editing"

**Not shipped, and the client half would have been a lie.** Asked WHY before
changing it, as the lane said to, and the answer is that nothing on the server
can accept the change:

* `PATCH /api/users/:id` (`src/server/routes/users.ts`) declares
  `UpdateUserBody { active, role, name, title }` and runs
  `UPDATE users SET name = ?, role = ?, initials = ?, active = ?, title = ?`.
  An `email` in the body is **ignored silently, with a 200 and the old address
  in the response**. A field in `EditRow` would save, re-render unchanged, and
  teach the operator the screen is broken.
* `src/client/api.ts`'s `updateUser` types the patch to the same four fields, so
  the client could not even send it without that file changing too.

Four decisions have to be made before the field is worth drawing, and they are
the client's, not a lane's:

1. **Collision.** `users` is `UNIQUE (tenant_id, email)` since `0087`. The route
   needs `getUserByEmailInScope(db, email, scopeOf(c.var.user))` and a 409 whose
   message does not disclose anything about other tenants —
   `TeamRoles.refusalMessage` already carries `email_taken` → "That email already
   has an account.", so the client wording exists.
2. **Login.** `POST /api/auth/login` resolves the principal BY EMAIL
   (`getUsersByEmail`), and `password_hash` lives on the user row. So the moment
   an admin saves, the member signs in with the new address and their existing
   password, and the **old address stops working**. Somebody has to be emailed —
   both addresses, by preference — and nothing does that today.
3. **The rows that reference a person by address, not by id.** `call_participants`
   is matched as `p.user_id = ? OR lower(p.email) = (SELECT lower(email) FROM
   users WHERE id = ?)` (`routes/calls.ts`, and again in `routes/decks.ts`'s
   calls-scope clause). After an email change, that OR still matches on
   `user_id`, so staff participants survive — but a participant row written for a
   **not-yet-registered** address (the invite path) keeps the old string and no
   longer resolves to anybody. Same question for `decks.founder_email`, which
   `esign` signs against and `resubmit` mails to: a FOUNDER's email change is a
   different, larger operation than a staff member's.
4. **Scope.** The client's words are "in cases where the email ids change", which
   is a staff rename (`nisha@old-domain` → `nisha@new-domain`). Restricting the
   field to staff rows (`user_type !== 'mentor'`, never `superuser` — `PATCH`
   already refuses that row) answers the ask without opening (3)'s founder case.

**Issue 21 is the same table and is NOT blocked by this** — deleting the
fictitious seeded names and inviting real addresses works today (`POST /api/users`
+ `DELETE`), and `ai.startupjury@gmail.com` as superuser is a seed/ops change.
Whoever takes 21 should not wait for 22.

---

## 5 · Cross-lane requests — two e2e edits this lane did not make

Both are mechanical, both are consequences of §1 and §2, and both are in files
this lane does not own. Neither could be verified here (the lane forbids running
Playwright), which is the second reason they are requests rather than edits.

**(A) `src/pipeline/incubator.ts` — drop `"jury"` from `shortlist` and `reject`.**
Issues 18 + 20 together say the juror does not decide. Until this lands the UI
hides a permission the API still grants. The negative control is the one this
project has learned to demand: a juror's POST to
`/api/decks/:id/transition {action:"shortlist"}` must come back 403, not 200.
Three specs assert the CURRENT grant and have to move with it:
`test/unit/pipeline.test.ts`, `test/worker/pipeline.test.ts`, and
`test/unit/jury-pipeline-readonly.test.ts` — the last one most explicitly, in
"leaves the decision with the jury and the programme manager", which loops
`["jury", "program_manager", "admin", "superuser"]` through `performAction` and
expects every one to be `ok`. That test was written as the *other side* of the
associate's read-only control, so whoever lands (A) should keep the control and
re-point the grant at the PM and the two admin roles.

**(B) `e2e/signup-workspace.spec.ts` — reach the workspace through the pane.**
`openWorkspace()` (line ~70) clicks the row's Sign-up button on
`/app/incuration`, which §2 just disabled. Four tests use the one helper, so one
edit fixes all four:

```ts
async function openWorkspace(page: Page, slug = "incuration") {
  await page.goto(`/app/${slug}`);
  await expect(pipelineRow(page)).toBeVisible(NAV);
  // Oct-3 issue 24 deactivated the ROW's Sign-up action on the Sign up Pipeline
  // ("coming soon"). The workspace is reached from the row's slide-over, which
  // the same change deliberately left live.
  await pipelineRow(page).getByRole("button", { name: STARTUP, exact: true }).click();
  const pane = page.getByRole("complementary", { name: `${STARTUP} detail` });
  await pane.getByRole("tab", { name: "Sign-up" }).click();
  await pane.getByRole("button", { name: "Open sign-up workspace" }).click();
  const dialog = page.getByRole("dialog", { name: "Sign-up workflow" });
  await expect(dialog.getByTestId("workspace-startup")).toHaveText(STARTUP, NAV);
  return dialog;
}
```

`e2e/pipeline-stages.spec.ts` needs nothing: its incuration test never clicks
that button, and the **Action header is still there** — only the control inside
it is disabled. Its Onboard-ready test clicks the Sign-up button on `curation`,
which §2 left alone on purpose.

**(C) `e2e/parity.spec.ts` line 508 — re-capture one row.** Issue 20 removes a
column, and that file's own rule is that the session which deliberately changes a
screen re-captures its row in the same commit:

```
  "incubator/jury/jurypipeline": {
    title: "Evaluated",
-   tables: [["STARTUP", …, "STATUS", "ACTION"]],
+   tables: [["STARTUP", …, "STATUS"]],
  },
```

Replaced, not unioned: the twelve-header set is no longer reachable, so keeping
it would let the regression back in.

---

## 6 · Tests, and what each negative control did

`npx vitest run --project client test/client/stagePage.test.tsx test/client/crmMethod.test.tsx`
→ **46 passed**.

| control applied | what failed |
|---|---|
| `"action"` + `actionMenu: {}` restored on `JURY_PIPELINE_JURY` | both issue-20 tests (eleven columns; Action gone) |
| the HALF fix — `"action"` dropped, no `readOnly` | the same two: `tableColumns` re-appends the cell and Shortlist / Reject come back as buttons |
| `signupComingSoon: true` removed from `incuration` | "the row's Sign-up action is deactivated…" |
| the button disabled UNCONDITIONALLY in `actionCell` | "Onboard ready keeps its Sign-up action live" — the scope control earns its place |
| the `up-crm-soon` strip deleted | all three `crmMethod.test.tsx` tests |

The staff tests (`superuser` · `admin` · `program_manager` keep their Action
select on the same slug) passed under every one of the issue-20 controls, which
is what says the removal is the jury variant's and not the slug's.
