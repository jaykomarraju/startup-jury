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
import type { Edition } from "../../shared/roles";
import { resolveVisibility, type VisibilityMatrix } from "../../shared/scoreVisibility";

interface Row {
  viewer_role: string;
  target_role: string;
  visible: number;
}

/** Read one edition's matrix, resolved. Never throws; never returns null. */
export async function loadScoreVisibility(
  db: D1Database,
  edition: Edition,
): Promise<VisibilityMatrix> {
  const rows = await db
    .prepare("SELECT viewer_role, target_role, visible FROM score_visibility WHERE edition = ?")
    .bind(edition)
    .all<Row>();
  return resolveVisibility(edition, rows.results);
}
