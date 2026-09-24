import type { Edition, Role } from "../../../shared/roles";

/**
 * **V3-UP's role gate — the one place the lane's admitted set lives.**
 *
 * V3-UP is the client's "Upload & Evaluate" lane, and it spans two screens:
 * `UploadPage` (the wizard's forward label, and `Send to Evaluate` on the
 * results card) and `EvaluatePage` (the `AI Evaluate` toolbar button, column
 * 1's select-all checkbox and counter, and the new sub-line). Those started as
 * two independent literals — `v3Superuser` in `UploadPage.tsx` and
 * `isV3Evaluate()` in `EvaluatePage.tsx` — which was fine while both read
 * `role === "superuser"`. Widening them to a three-role set in two files would
 * be two tuples to keep in step, and the whole point of the Q-P record below is
 * that ONE edit ships the program manager. So the set lives here and both
 * screens import it. This module is the LANE's, not the Upload screen's; it
 * sits under `upload/` because that is the directory the lane owns.
 *
 * Why these roles, per `docs/plan_roles_incubator.md` §2 row `11 · V3-UP`:
 *
 *   • **admin · program associate — EXTEND.** Nothing server-side has to move
 *     for either: `RESCORE_ROLES` (`server/routes/decks.ts:1268`) already
 *     carries both, `DEFAULT_ROLE_PERMISSIONS.incubator` grants both `upload`
 *     and `evaluate` (`shared/types.ts:157-158`), and both destinations the new
 *     controls navigate to — `/app/evaluate` and `/app/assign` — are already in
 *     their nav. This is a client-side predicate over data and routes the
 *     application already serves them, which is why the wave takes no
 *     migration.
 *   • **jury — NO.** Two reasons, and the second is a trap. Their prototype has
 *     no Upload item at all (`nav.ts:98`), so the Upload half is meaningless;
 *     and `App.tsx:117` routes the jury-exclusive `jassigned` screen through
 *     `EvaluatePage` as well, so admitting `"jury"` here would silently rebuild
 *     the juror's **Assigned** screen — a redesign nobody asked for, on the one
 *     screen where a juror does their actual scoring. The jury lane is Wave
 *     R+1's `R7-JURY`, blocked on `R6-SCOPE`.
 *   • **program manager — UNDECIDED. See `PROGRAM_MANAGER_PENDING_Q_P`.**
 *
 * The VC edition is not in scope and never reaches either surface as V3: it was
 * not rescoped, and it has its own `VcEvaluatePage`. The `edition` test below is
 * what keeps it out, and the founder portal with it (`FounderUpload`).
 */

/**
 * **Q-P — the program manager's Evaluate, unanswered.**
 *
 * This is not a gap; it is two prototypes drawn for the same role that disagree
 * on the chrome, and the client has not picked:
 *
 *   • `AISJ_IC_PM_V5`'s `panel-evaluate` already carries its own multi-select
 *     redesign — `evToggleAll()` / `#ev-chk-all` "Select all", an `.ev-sel-count`
 *     strip, and a BOTTOM ACTION BAR with Cancel + `evGoEvaluate()` "Evaluate
 *     selected decks".
 *   • `AISJ_SuperuserV3` instead puts an `evAiEvaluate()` "AI Evaluate" button
 *     in the TOOLBAR, moves the checkbox into column 1's header with
 *     `#ev-col1-count`, has no bottom bar, and adds the "evaluated decks move to
 *     the Assign screen" sub-line.
 *
 * V3 is the later file; the PM's is the one drawn for this role. Either is
 * defensible and they are visibly different screens, so shipping one on a
 * coin-flip is how a wave earns a re-filed P0. Until the client answers, the
 * program manager keeps the v15 surface — the same surface they have today, so
 * withholding changes nothing for them and reverses nothing.
 *
 * **Answering it "V3's design" is deleting the guard on the one flagged line in
 * `V3_UP_ROLES` and flipping this constant.** Nothing else refers to it.
 * Answering it "the PM's own design" is a new session, not a flip: the bottom
 * action bar is markup neither screen has.
 */
export const PROGRAM_MANAGER_PENDING_Q_P = true;

/** The incubator roles that get the V3-UP surfaces, in `PERMISSION_ROLES` order. */
export const V3_UP_ROLES: readonly Role[] = [
  "superuser",
  "admin",
  // ── Q-P: drop the guard on this line to ship V3's design to the PM. ──
  ...(PROGRAM_MANAGER_PENDING_Q_P ? [] : (["program_manager"] as const)),
  "program_associate",
  // jury is deliberately absent — see the header, and `App.tsx:117`.
];

/**
 * Does this principal get the V3-UP surfaces?
 *
 * Note there is no superuser bypass here, unlike `canSeeNav` and `requireRole`:
 * this is a design variant, not an authorization gate, so the admitted set is
 * spelled out in full and `"superuser"` is simply the first entry.
 */
export function isV3Up(edition: Edition | undefined, role: Role | undefined): boolean {
  return edition === "incubator" && role !== undefined && V3_UP_ROLES.includes(role);
}
