/**
 * THE CONFIG MODULES' SCOPE ARGUMENT — AND THE ONE TRANSITIONAL EDGE IN T1-CONFIG
 * ==============================================================================
 *
 * `src/server/config/**` is T1-CONFIG's by `plan_multitenancy.md` §11. Four of
 * the five modules in it export a loader that other T1 sessions' route files
 * call, and that is the whole problem this file exists to state honestly.
 *
 * ── THE MEASUREMENT ─────────────────────────────────────────────────────────
 *
 * Twenty call sites of the four exported loaders live OUTSIDE T1-CONFIG's paths:
 *
 *   loadScoringSettings  decks.ts ×8, analytics.ts ×4, pipeline.ts ×2,
 *                        assignments.ts ×1            → T1-DECKS, T1-REPORTS
 *   scoringSettingsFor   ai/evaluate.ts ×1            → T1-DECKS
 *   loadScoreVisibility  analytics.ts ×3, decks.ts ×1 → T1-REPORTS, T1-DECKS
 *   introCallPrompts     calls.ts ×1                  → T1-FLOW
 *   maybeAutoClarify     ai/evaluate.ts ×1            → T1-DECKS
 *
 * Changing the second parameter from `Edition` to `TenantScope` would redden
 * every one of those files on a branch that cannot test them, in a wave whose
 * shape §11 verified "disjoint by path". And two of them — `pipeline.ts:520`
 * and `ai/evaluate.ts:897` — cannot be fixed from here at all: they derive the
 * key from a `decks` row whose `SELECT` does not carry `tenant_id`, so the fix
 * is an edit to another session's statement and to its row type.
 *
 * ── SO THE PARAMETER TAKES EITHER, AND THE BRIDGE IS LOUD ───────────────────
 *
 * `configScope()` accepts a `TenantScope` — which every T1-CONFIG call site now
 * passes — or a bare `Edition`, which resolves to `DEFAULT_TENANT_ID`. On an
 * edition-only call the behaviour is byte-identical to today's, because
 * `t_default` is the organisation every seeded row was backfilled to.
 *
 * **An edition-only call is a LEAK, not a nicety.** `org_settings`,
 * `org_scoring_settings` and `score_visibility` were all rebuilt with
 * `(tenant_id, edition)` in the key (`0089`, `0090`, `0092`), so a second
 * customer's row can exist and an edition-only read returns the FIRST
 * customer's. The routes that still make such a call are the routes
 * `test/worker/tenant-scope.test.ts` still lists as `pending`, owned by the
 * sessions named above. This bridge does not hide that; it is what lets each
 * session close its own row without waiting on the others.
 *
 * ── THE RATCHET, SO IT CANNOT ROT ───────────────────────────────────────────
 *
 * `test/unit/config-scope-bridge.test.ts` scans `src/server/` for calls that
 * pass an edition rather than a scope and asserts the EXACT set. A new one fails
 * the test; a fixed one fails it too, and the fix is to delete that line from the
 * list. **T1 integration deletes the `Edition` arm of `ConfigScopeArg` and that
 * test together**, at which point the four loaders take a `TenantScope` and
 * nothing else, and the type system carries the invariant instead of a grep.
 *
 * `rescoreEdition` is deliberately NOT on the bridge: both of its call sites are
 * in `routes/config.ts`, so it takes a `TenantScope` outright.
 */
import type { Edition } from "../../shared/roles";
import { DEFAULT_TENANT_ID, type TenantScope } from "../../shared/tenant";

/**
 * What the config loaders accept while the wave is in flight: a real workspace
 * scope, or — from the twenty foreign call sites listed above — the edition
 * alone.
 *
 * **Integration narrows this to `TenantScope`.** Do not add a new call site that
 * passes an `Edition`; `test/unit/config-scope-bridge.test.ts` refuses one.
 */
export type ConfigScopeArg = TenantScope | Edition;

/**
 * Resolve the argument to a workspace.
 *
 * A bare `Edition` resolves to `DEFAULT_TENANT_ID` — today's behaviour exactly,
 * because every backfilled row belongs to that organisation. It is the WRONG
 * answer for a second customer, which is the point of the ratchet above.
 */
export function configScope(arg: ConfigScopeArg): TenantScope {
  return typeof arg === "string" ? { tenantId: DEFAULT_TENANT_ID, edition: arg } : arg;
}

/**
 * The same workspace, in a different edition.
 *
 * `routes/config.ts` reads and writes BOTH score-visibility matrices from one
 * screen — `s-fw` draws *Visibility for Incubator* and *Visibility for VC* side
 * by side regardless of which edition the viewer is in — so those statements are
 * scoped by the viewer's TENANT and the matrix's own EDITION, never by the
 * viewer's edition. Spelling that out here rather than inline at six call sites
 * keeps the one judgement in one place.
 */
export function inEdition(scope: TenantScope, edition: Edition): TenantScope {
  return { tenantId: scope.tenantId, edition };
}
