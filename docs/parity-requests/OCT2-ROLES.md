# OCT2-ROLES — the programme associate's Jury Pipeline, read-only (issue 2)

> "The program associate should be able to see jury pipeline only as read only"

## 1. What the programme associate can do on that screen TODAY: nothing

Measured, not inferred — three independent gates all say no, and they say it for
two different reasons:

| gate | source | answer for `incubator/program_associate` |
|---|---|---|
| nav `roles` | `src/shared/nav.ts` → `jurypipeline` | `["admin", "program_manager", "jury"]` — **absent** |
| matrix default | `DEFAULT_ROLE_PERMISSIONS.incubator.jurypipeline` (`src/shared/types.ts:164`) | `["superuser", "admin", "program_manager", "jury"]` — **absent** |
| matrix persisted | `migrations/0029_role_permissions.sql:95` | `('incubator', 'program_associate', 'jurypipeline', 0)` — **explicit 0** |

So `canSeeNav("program_associate", jurypipeline)` is `false` (it fails on
`item.roles.includes(role)` before the task is even consulted), and
`can("incubator", "program_associate", "jurypipeline")` is `false` twice over —
by seed, and by a persisted override row that beats the seed. `RequireNav`
(`src/client/routes/guards.tsx:37`) renders "Not available for your role" at
`/app/jurypipeline`, and the sidebar has no entry. `test/unit/nav.test.ts:124`
has been pinning this (`expect(pa).not.toContain("jurypipeline")`), and
`scripts/parity-nav.ts:192` carries it as `incubator/program_associate ·
role-gap jurypipeline`, recorded "W3-A — needs adjudication". **The client has
now adjudicated it.**

### Therefore: task item 4's fork resolves to GRANT, not to withdraw

"See it as read-only" is **granting read access**. There is no write to take
away. Those are opposite edits, and only one of them applies.

## 2. The write half already holds, server-side, and is now pinned

The screen's only write affordance is `JuryPipelineActionCell`
(`StagePage.tsx:1727-1768`): one `Action ▾` select whose options are
`shortlist` (relabelled "Send to intro calls") and "Reassign / add jury", which
is a `navigate("/app/assign")` and writes nothing. Everything else on the screen
is read: the startup name opens `EvaluationDrawer`, which StagePage invokes with
no `actions` prop and which is read-only by design
(`EvaluationDrawer.tsx:97-104` — "Scoring has one surface in this build"); the
config declares no `subTabs`, no `workspace`, and none of the editable
onboarding columns.

`shortlist` is enforced in `performAction` (`src/pipeline/index.ts:80`), which
is what `POST /api/decks/:id/transition` consults, and
`incubator.ts:113-119` lists `["jury", "program_manager", "admin", "superuser"]`.
**The associate has never been on it.** Measured over the screen's whole stage
window (`assigned`, `jury_evaluation`, `shortlisted`, `rejected`), the only
transition the associate holds anywhere in it is `shortlisted/schedule_intro` —
correct by §8 (they are the intro-call executor by delegation) and never offered
on this screen, because a `shortlisted` row draws the `.jp-flowtag` badge where
the select would be.

Reads need nothing either: `GET /api/decks` has no task gate and the harness
probe `decks.list` already allows `program_associate`, so the grant exposes no
data the associate cannot fetch today. It only stops the screen 403-ing.

## 3. What this lane changed

* `scripts/role-matrix.ts` — two new §B invariants (total **1204 → 1206**):
  * `Oct-2 issue 2 [incubator] the program_associate holds no Jury Pipeline
    decision — only Intro calls' schedule_intro`. Stated as the WHOLE SET of
    `from/action` pairs the associate holds out of the screen's four stages, so
    granting them any new decision anywhere in the jury window reddens it. A
    hand-kept list of `!can(...)` denials would not.
  * `Oct-2 issue 2 [incubator] jurypipeline's nav reach and its matrix cell move
    together for the program_associate`. Asserts the two halves **agree** rather
    than asserting a value, so it holds before the grant and after it and goes
    red on a half-landed one in either direction. The existing `the default seed
    takes no nav item away from anyone` only catches nav ⊃ cell.
* `test/unit/jury-pipeline-readonly.test.ts` — new, 4 tests, the same boundary in
  vitest so it is checkable without a server.
* `src/shared/nav.ts` — **comment only, no behaviour change.** The `jurypipeline`
  entry now records why the associate is still absent and the four coupled edits
  the grant needs, so the next reader cannot land half of it.

## 4. What integration must do — the grant is four coupled edits, in files this lane does not own

Adding `"program_associate"` to `nav.ts`'s `roles` **on its own is inert and
reddens three checks**, because GATE, NOT GRANT means reach is the `roles` list
AND the matrix cell. Do all four, in one commit:

1. `src/shared/nav.ts` → `jurypipeline.roles` gains `"program_associate"`.
2. `src/shared/types.ts:164` → `DEFAULT_ROLE_PERMISSIONS.incubator.jurypipeline`
   gains `"program_associate"`. Without it,
   `test/unit/permissions.test.ts`'s "matches the nav manifest for every
   nav-backed task" (it re-derives the seed from `nav.ts`) and the harness's
   "the default seed takes no nav item away from anyone" both go red.
3. A new migration, modelled on `0040_permission_defaults.sql` — `0029`'s INSERT
   is `ON CONFLICT … DO NOTHING`, so a workspace that has already run it keeps
   the `granted = 0` row and **the grant stays invisible in production**:

   ```sql
   UPDATE role_permissions SET granted = 1, updated_at = datetime('now')
    WHERE edition = 'incubator' AND role = 'program_associate'
      AND task_id = 'jurypipeline';
   ```

   Take the next free number at integration (this lane deliberately did not
   reserve one; four agents share this checkout and a duplicate migration number
   is worse than a renumber — `0102` was already taken by a sibling lane while
   this handoff was being written, which is the whole argument). Migrate before
   deploying: the deployed D1 drifts behind the repo every wave.
4. `INCUBATOR_STAGE_CONFIG.jurypipeline.roleVariants` gains
   `program_associate: { ...JURY_PIPELINE_V3, readOnly: true }` — see §5.

Then update `test/unit/nav.test.ts:124` (`expect(pa).not.toContain("jurypipeline")`
→ `toContain`) and retire `scripts/parity-nav.ts:192`'s
`incubator/program_associate · role-gap jurypipeline` row, which is now
adjudicated. **Do not touch the `pmpipeline` row in that same `gap(...)` call** —
the client said Jury Pipeline, not Prog manager pipeline.

### Expected harness movement

`npm run roles` is forbidden to this lane (and passes vacuously without a live
server — one of this project's two documented fake-pass traps), so integration
must run it. Expect **1206/1206** with this lane alone, both new checks green.
After the grant lands, both stay green (the in-step check flips `false === false`
to `true === true`); the §A nav matrix gains a `✓` in the PA column of the
`jurypipeline` row.

## 5. Screen half — STOPPED, `StagePage.tsx` belongs to another lane

The Jury Pipeline screen is `src/client/routes/StagePage.tsx`
(`INCUBATOR_STAGE_CONFIG.jurypipeline`, line 1900), which the lane brief names as
off-limits. Not edited. The change is small and the mechanism already exists:

```ts
roleVariants: {
  superuser: JURY_PIPELINE_V3,
  admin: JURY_PIPELINE_V3,
  program_manager: JURY_PIPELINE_V3,
  program_associate: { ...JURY_PIPELINE_V3, readOnly: true },  // Oct-2 issue 2
  jury: JURY_PIPELINE_JURY,
},
```

`readOnly: true` drops the Action column entirely (`StagePage.tsx:1021`), which
is what read-only means here. Without the variant the associate inherits the
BASE config (the v15 shape with a `status` column), not `JURY_PIPELINE_V3`, and
`tableColumns` appends the built-in transitions Action cell — so they would land
on a screen with an Action column the other three staff roles do not even draw
the same way. The variant is therefore not optional polish; it is the difference
between "read-only" and "a different screen with buttons".

**One decision to confirm with the client:** `readOnly` also removes "Reassign /
add jury", which is a legitimate associate capability (`assign_jury` is theirs,
and they have the Assign screen). It removes the *shortcut*, not the power. Read
literally, "read only" says to remove it; the associate reaches the same place
via the Assign sidebar item. Shipped reading: remove it.

## 6. Cross-lane finding: `POST /api/decks/:id/transition` cannot be probed, and is the product's most authority-bearing route

Not required by the brief, found while doing item 2, and it is the
`role-boundary-leaks` class the brief points at. The transition dispatcher
(`src/server/routes/pipeline.ts:376`) carries **no route middleware** — no
`requireRole`, no `requireTask`. Its authZ is entirely `performAction`'s
per-transition role list, reached only after the handler has loaded the deck.
Consequences:

* §C of the roles harness has **no probe for it at all**, and cannot have one
  under the harness's "never mutate" rule. Every safe input is indistinguishable
  between an allowed and a refused role:
  * ghost deck id → `loadDeck` returns nothing → **404 for every role**, and the
    harness scores `status !== 403` as *allowed* (`role-matrix.ts:948`), so such
    a probe would read as "every role may transition any deck";
  * bogus action, or a real action in the wrong stage → `performAction` returns
    `unknown_action` **before** the role check (`index.ts:77-80`) → 409 for
    every role;
  * a real deck in the right stage with a real action → 403 for refused roles
    and **an actual stage change** for allowed ones.
* So the only assertion the harness can make about the single route that moves
  every deck through the pipeline is a §A/§B one, derived from the same
  `performAction` the route calls — which the harness header itself says proves
  only self-consistency.

Two ways to make it probeable, both outside this lane:

1. Reorder `performAction` to check the role list before the stage match, so a
   real-action/wrong-stage probe returns 403 for a refused role and 409 for an
   allowed one (`src/pipeline/index.ts`). Smallest change; needs a check that no
   caller depends on `unknown_action` winning the race.
2. Give the route a `?dryRun=1` that runs the gate and returns 204 without the
   batch (`src/server/routes/pipeline.ts`), then probe that.

Either one unlocks a real §C row per edition. Recommend (1).
