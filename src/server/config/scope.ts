/**
 * THE CONFIG MODULES' SCOPE — AND THE BRIDGE THAT USED TO BE HERE
 * ==============================================================================
 *
 * `src/server/config/**`'s loaders take a `TenantScope` and nothing else. The
 * type system carries the invariant, so there is no longer anything for a test to
 * assert about it.
 *
 * ── WHAT WAS HERE, AND WHY IT IS GONE ───────────────────────────────────────
 *
 * T1-CONFIG could not land that signature outright. Twenty-one call sites of
 * these loaders lived in FIVE other sessions' route files, and in a wave whose
 * split §11 verified "disjoint by path", changing the parameter would have
 * reddened five files that branch could not test. So it shipped
 *
 *     export type ConfigScopeArg = TenantScope | Edition;
 *
 * where a bare `Edition` resolved to `DEFAULT_TENANT_ID` — byte-identical to the
 * pre-tenancy behaviour, and a CROSS-TENANT READ the moment a second customer
 * existed, because `org_settings`, `org_scoring_settings` and `score_visibility`
 * were all rebuilt with `(tenant_id, edition)` keys by 0089, 0090 and 0092.
 *
 * `test/unit/config-scope-bridge.test.ts` held it to a ratchet: it asserted the
 * exact per-file count of edition-only calls and failed in BOTH directions, so a
 * new one could not appear and a closed one could not go unnoticed. T1
 * integration closed all 21 and deleted the `Edition` arm and that test together,
 * which is exactly what this file said would happen.
 *
 * ── TWO PREDICTIONS IT GOT WRONG, KEPT BECAUSE THEY MISLED ──────────────────
 *
 * This header used to name `pipeline.ts:520` and `ai/evaluate.ts:897` as
 * impossible to close from anywhere — both derive the key from a `decks` row
 * whose `SELECT` carried no `tenant_id`. Neither needed what it predicted:
 *
 *   · `ai/evaluate.ts` — correct in substance, already stale in fact. T1-DECKS
 *     had added `tenant_id` to that SELECT and to `DeckRow` before integration
 *     ran, so the scope was already built from the row. It is a QUEUE CONSUMER
 *     with no session, so the deck row is the only scope it can have, and the
 *     answer had to come from stored state rather than a principal.
 *   · `pipeline.ts` — the premise was simply false by then. `loadDeck` is
 *     `scoped(scopeOf(user)).on("d")`, which binds BOTH halves of the key, so a
 *     deck reaching that line is already in the caller's workspace and
 *     `deck.edition` cannot differ from the principal's. Adding `tenant_id` to a
 *     SELECT that already predicates on it would have re-derived a value the
 *     predicate had pinned.
 *
 * The lesson worth keeping: "this cannot be fixed from here" is a statement about
 * a branch, not about the code, and it expires when the branches merge.
 */
import type { Edition } from "../../shared/roles";
import type { TenantScope } from "../../shared/tenant";

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
