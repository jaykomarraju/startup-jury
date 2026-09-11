-- W3-A · migration 0040 — the runtime permission engine's seed corrections.
--
-- `0029` seeded `role_permissions` by DERIVATION: a nav-backed task was granted
-- to exactly the roles that could reach its slugs in the shipped application,
-- so the matrix reproduced today's behaviour to the cell and `npm run roles`
-- stayed green. W3-A now makes that table LIVE — `can(edition, role, task)` is
-- ANDed onto every gate — and settles four of the plan's §8 open questions in
-- the process. Each of those decisions moves a role's reach, so the seed has to
-- move with it: `test/unit/permissions.test.ts` re-derives the matrix from
-- `nav.ts` + `pipeline/` and goes red the moment the two disagree.
--
-- STILL A GATE, NOT A GRANT (§8 Q8). Every row below is paired with a widened
-- `roles` array in `src/shared/nav.ts` or a widened route guard. The permission
-- alone cannot open a screen; it can only close one.
--
--   1. §8 Q5 / F0919 / F0926 — the incubator PROGRAM MANAGER reaches Sign up
--      Pipeline (`signuppipeline`) and Onboard ready (`onboard`). §1.4 makes the
--      PM the decision maker for the programmes they lead, and the PM
--      prototype's own Workflows list carries both. The associate stays the
--      executor: `send_signup` is unchanged at `requireRole("program_associate",
--      "admin")`, and `performAction` still gates every transition.
--
--   2. F0917 — the VC PARTNER reaches IC Pipeline (`icpipeline`). This closes an
--      internal contradiction rather than following the prototype: the partner
--      has been able to CAST an IC vote since Phase 1 (`IcVotePage.canVote`,
--      `POST /api/decks/:id/ic-vote`, asserted by the roles harness) while the
--      nav withheld the screen the vote is cast on.
--
--   3. §8 Q6 / F0063 / F0080 / F0071 — `configparams` ("Configure 3 additional
--      parameters") is granted to the PROGRAM MANAGER (incubator) and the
--      PARTNER (VC) by default. Both written specs §10 say so in as many words
--      — "editable by Super Users, Program Managers and Client Admins by
--      default" / "…Super Users, Partners and Fund Admins…" — and §1.1 ranks the
--      written spec above the prototype, whose live console grants it to the
--      Super User alone (F0150). It reaches the ADDITIONAL parameters, which is
--      what the task is named for and what `myparams` already shows these roles;
--      the core 13 area weights are a different surface and stay admin-only
--      (`PUT /api/config/parameters` is untouched, so the roles harness's
--      `config.params` probe does not move). Reversing this is one cell, not a
--      redeploy — which is the whole point of the engine.
--
-- `0029`'s INSERT is `ON CONFLICT … DO NOTHING`, so these are UPDATEs: a
-- workspace that has already run 0029 must actually change, and a workspace
-- migrating from empty gets the same end state either way.

UPDATE role_permissions SET granted = 1, updated_at = datetime('now')
 WHERE edition = 'incubator' AND role = 'program_manager'
   AND task_id IN ('signuppipeline', 'onboard', 'configparams');

UPDATE role_permissions SET granted = 1, updated_at = datetime('now')
 WHERE edition = 'vc' AND role = 'partner'
   AND task_id IN ('icpipeline', 'configparams');
