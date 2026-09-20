/**
 * **Score visibility** — V3 item 13, the configurable replacement for the fixed
 * rank ladder.
 *
 * The v3 superuser prototype's admin console (`ADMIN_B64` → section `s-fw`,
 * which a grep of the .HTM cannot see) adds two matrices under *Score
 * transparency & reports*: `Visibility for Incubator` (4×4) and
 * `Visibility for VC` (5×5), captioned
 *
 *     Viewer (row) → can see scores of (column)
 *
 * and, for the diagonal, "The diagonal controls whether members of the same
 * role (e.g. jury ↔ jury) can see each other's scores."
 *
 * This is a PERMISSION SYSTEM, not a screen. The matrix is persisted
 * (`score_visibility`, migration 0072), resolved here, and enforced on the
 * SERVER — `GET /api/decks/:id/report` and the three analytics reports filter
 * the response payload, so a viewer's browser never receives a number it may
 * not see. See `docs/plan_v3_superuser.md` §3 item 13.
 *
 * ## What the matrix does and does not replace
 *
 * It replaces the **off-diagonal and diagonal role rule** that
 * `canSeeEvaluatorScores` / `EVALUATION_RANK` held. It does NOT replace:
 *
 *  - **Your own column.** Identity beats role everywhere: an evaluator always
 *    sees the scores they themselves submitted, whatever the matrix says. The
 *    diagonal is about OTHER people who hold your role.
 *  - **`jurySeesPeerScores`** (F0109, the "Jury can see each other's scores"
 *    toggle). It remains a live conjunctive gate on the deck report: off, an
 *    assignable evaluator sees only the AI column and their own, and the matrix
 *    is not consulted. The v3 prototype deletes that toggle's row from `s-fw`;
 *    we do NOT, because deleting it removes the blind-round kill switch F0109
 *    was built for — §4 Q72.
 *  - **Roles the matrices do not list.** `admin` is a row/column in neither
 *    matrix, and `founder`/`mentor` are outside this surface entirely. Any pair
 *    the matrix does not cover falls through to `canSeeEvaluatorScores`, so
 *    admin keeps rank 99 and sees the whole workspace exactly as before.
 *
 * ## The defaults, and where they differ from what shipped
 *
 * `DEFAULT_VISIBILITY` is the prototype's own printed default state — the
 * footnote the screen renders is therefore TRUE, which matters more here than
 * anywhere else: a permission screen that shows a state the server does not
 * enforce is the exact failure mode this file exists to prevent.
 *
 * Four incubator cells differ from the rank ladder that shipped. Recorded as
 * §4 Q71, with the deltas measured per surface:
 *
 *  | cell                            | ladder | v3 default | direction |
 *  |---------------------------------|--------|------------|-----------|
 *  | program_manager → superuser     | off    | **on**     | WIDENS    |
 *  | program_associate → program_associate | on | **off**  | narrows   |
 *  | jury → program_associate        | on     | **off**    | narrows   |
 *  | jury → jury                     | on     | **off**    | narrows   |
 *
 * On the deck report at the shipped settings nothing moves at all, because
 * `jurySeesPeerScores` defaults OFF and already reduces every assignable
 * evaluator to "AI + own". The deltas are visible only once an org turns that
 * toggle on, and on the three analytics reports, which never applied it.
 */
import {
  canSeeEvaluatorScores,
  type Edition,
  type Role,
} from "./roles";

/**
 * The rows and columns each matrix carries, in the prototype's order.
 *
 * Incubator is the 4×4 `Super User · Program Mgr · Program Assoc · Jury Member`;
 * VC is the 5×5 `Mng Partner · IC · Partner · Inv. Assoc · Analyst`, where the
 * prototype's "Managing Partner" is this repo's `superuser` (roles.ts:19).
 * `admin` is in neither — the prototype does not draw it.
 */
export const VISIBILITY_EDITIONS: readonly Edition[] = ["incubator", "vc"];

export const VISIBILITY_ROLES: Record<Edition, readonly Role[]> = {
  incubator: ["superuser", "program_manager", "program_associate", "jury"],
  vc: ["superuser", "ic_member", "partner", "associate", "analyst"],
};

/** `Role` → the label the prototype's row header uses. */
export const VISIBILITY_ROW_LABELS: Record<Edition, Partial<Record<Role, string>>> = {
  incubator: {
    superuser: "Super User",
    program_manager: "Program Manager",
    program_associate: "Program Associate",
    jury: "Jury Member",
  },
  vc: {
    superuser: "Managing Partner",
    ic_member: "IC member",
    partner: "Partner/Principal",
    associate: "Inv. Associate",
    analyst: "Analyst",
  },
};

/** `Role` → the (shorter) label the prototype's COLUMN header uses. */
export const VISIBILITY_COLUMN_LABELS: Record<Edition, Partial<Record<Role, string>>> = {
  incubator: {
    superuser: "Super User",
    program_manager: "Program Mgr",
    program_associate: "Program Assoc",
    jury: "Jury Member",
  },
  vc: {
    superuser: "Mng Partner",
    ic_member: "IC",
    partner: "Partner",
    associate: "Inv. Assoc",
    analyst: "Analyst",
  },
};

/** `viewer → target → may the viewer see that role's scores?` */
export type VisibilityMatrix = Partial<Record<Role, Partial<Record<Role, boolean>>>>;

function rows(edition: Edition, on: readonly Role[]): VisibilityMatrix {
  const all = VISIBILITY_ROLES[edition];
  const m: VisibilityMatrix = {};
  for (const viewer of all) {
    const row: Partial<Record<Role, boolean>> = {};
    for (const target of all) row[target] = on.includes(viewer);
    m[viewer] = row;
  }
  return m;
}

/**
 * The prototype's shipped toggle state, read off the decoded markup:
 * every `<div class="tog on">` in a row is on, every `<div class="tog">` off.
 *
 * Incubator: "Super User & Program Manager see everyone; Program Associate and
 * Jury Member see no one — jury members cannot see each other (blind
 * evaluation) until turned on here."
 * VC: "Managing Partner, IC member and Partner/Principal see everyone; Inv.
 * Associate and Analyst see no one until turned on here."
 */
export const DEFAULT_VISIBILITY: Record<Edition, VisibilityMatrix> = {
  incubator: rows("incubator", ["superuser", "program_manager"]),
  vc: rows("vc", ["superuser", "ic_member", "partner"]),
};

/**
 * The rule that shipped before the matrix existed, cell by cell — kept so the
 * §4 Q71 delta can be asserted as data rather than described in prose, and so
 * an org that wants the old behaviour back has an exact target to save.
 */
export function ladderVisibility(edition: Edition): VisibilityMatrix {
  const all = VISIBILITY_ROLES[edition];
  const m: VisibilityMatrix = {};
  for (const viewer of all) {
    const row: Partial<Record<Role, boolean>> = {};
    for (const target of all) row[target] = canSeeEvaluatorScores(edition, viewer, target);
    m[viewer] = row;
  }
  return m;
}

/** Stored overrides layered onto the default — the matrix the server enforces. */
export function resolveVisibility(
  edition: Edition,
  stored: Iterable<{ viewer_role: string; target_role: string; visible: number | boolean }>,
): VisibilityMatrix {
  const all = VISIBILITY_ROLES[edition] as readonly string[];
  const m = structuredClone(DEFAULT_VISIBILITY[edition]);
  for (const cell of stored) {
    // A row for a role this edition's matrix does not draw is ignored rather
    // than trusted: the matrix must never grant outside its own 4×4 / 5×5.
    if (!all.includes(cell.viewer_role) || !all.includes(cell.target_role)) continue;
    const row = (m[cell.viewer_role as Role] ??= {});
    row[cell.target_role as Role] = cell.visible === true || cell.visible === 1;
  }
  return m;
}

/**
 * May `viewer` see the scores an evaluator holding `target` submitted?
 *
 * The matrix decides for the pairs it draws; everything else falls through to
 * the rank ladder, which is what keeps `admin` (in neither matrix) at its
 * present "sees the whole workspace".
 *
 * Note there is deliberately NO `viewer === target → true` short circuit: the
 * diagonal is the prototype's blind-evaluation control and must be able to say
 * no. An evaluator's own scores are protected by an IDENTITY check at each call
 * site (`evaluator_id === viewerId`), not by this role predicate.
 */
export function canSeeEvaluatorScoresIn(
  matrix: VisibilityMatrix | null | undefined,
  edition: Edition,
  viewer: Role,
  target: Role,
): boolean {
  const cell = matrix?.[viewer]?.[target];
  if (typeof cell === "boolean") return cell;
  return canSeeEvaluatorScores(edition, viewer, target);
}
