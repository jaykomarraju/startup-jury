/**
 * The org's **score visibility matrix** (`score_visibility`, migration 0072) —
 * one read for every path that has to answer "may this viewer see that
 * evaluator's numbers?".
 *
 * A plain module rather than part of `routes/config.ts` for the same reason
 * `scoringSettings.ts` is: the deck report and the three analytics reports all
 * need it and none of them should import a route file.
 *
 * The table is sparse and a missing row is not an error — `resolveVisibility`
 * layers whatever is stored onto the prototype's printed defaults, so an
 * edition with no rows at all behaves exactly like the prototype rather than
 * throwing halfway through a report.
 */
import { resolveVisibility, type VisibilityMatrix } from "../../shared/scoreVisibility";
import { scoped, type TenantScope } from "../../shared/tenant";


interface Row {
  viewer_role: string;
  target_role: string;
  visible: number;
}

/**
 * Read one WORKSPACE's matrix, resolved. Never throws; never returns null.
 *
 * `0092` rebuilt the table with `PRIMARY KEY (tenant_id, edition, viewer_role,
 * target_role)`, so the predicate is the pair. The matrix answers "may this
 * viewer see that evaluator's numbers?" and `resolveVisibility` layers whatever
 * is stored onto the prototype's printed defaults — which means an unscoped read
 * does not fail, it quietly applies ANOTHER CUSTOMER'S visibility rules to this
 * customer's deck report. A missing row stays a non-error, as before.
 *
 * `edition` still comes out of the scope because it is also the product variant:
 * the two matrices have different role lists (`VISIBILITY_ROLES`), and
 * `routes/config.ts` reads both from one screen by passing `inEdition(scope, …)`.
 */
export async function loadScoreVisibility(
  db: D1Database,
  scope: TenantScope,
): Promise<VisibilityMatrix> {
  const resolved = scope;
  const q = scoped(resolved).on("v");
  const rows = await db
    .prepare(`SELECT v.viewer_role, v.target_role, v.visible FROM score_visibility v ${q.whereClause()}`)
    .bind(...q.binds)
    .all<Row>();
  return resolveVisibility(resolved.edition, rows.results);
}
