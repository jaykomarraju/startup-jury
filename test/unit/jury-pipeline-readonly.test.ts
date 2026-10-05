/**
 * Oct-2 issue 2 — "The program associate should be able to see jury pipeline
 * only as read only."
 *
 * The lane's finding is that the associate cannot reach the screen AT ALL
 * today, so the ask is to GRANT read access, not to remove write access. That
 * grant is three coupled edits (`nav.ts` `roles`, the
 * `DEFAULT_ROLE_PERMISSIONS` cell, and a migration, because `0029` persisted
 * the cell at `granted = 0` and a persisted row beats the code default). This
 * file is the guard that it lands whole and that the READ-ONLY half survives
 * it.
 *
 * Why the write half is stated over the state machine rather than the screen:
 * this repo has a recurring class of bug where a screen is gated client-side
 * only (`role-boundary-leaks` — issue 21, `/api/messages`, the founder portal).
 * `POST /decks/:id/transition` has no route middleware; its authZ is
 * `performAction`'s per-transition role list, so that list IS the rule and is
 * what gets asserted.
 */
import { describe, it, expect } from "vitest";
import { getPipeline, performAction } from "../../src/pipeline";
import { NAV_BY_EDITION, canSeeNav } from "../../src/shared/nav";
import { can } from "../../src/shared/permissions";

/**
 * `INCUBATOR_STAGE_CONFIG.jurypipeline.statuses` — the four stages the Jury
 * Pipeline screen lists. Duplicated here rather than imported because
 * `StagePage.tsx` is a React module and this is a pure suite; `stagePage.test.tsx`
 * renders the config itself.
 */
const JURY_PIPELINE_STAGES = ["assigned", "jury_evaluation", "shortlisted", "rejected"] as const;

/** Every `from/action` a role may perform out of the screen's stage window. */
function writesInJuryWindow(role: string): string[] {
  return getPipeline("incubator")
    .transitions.filter((t) => (JURY_PIPELINE_STAGES as readonly string[]).includes(t.from))
    .filter((t) => performAction("incubator", t.from, t.action, role as never).ok)
    .map((t) => `${t.from}/${t.action}`)
    .sort();
}

describe("Jury Pipeline is read-only for the programme associate", () => {
  /**
   * The whole set, not a list of denials: granting the associate any new
   * decision anywhere in the jury window reddens this, which a hand-kept
   * `expect(...).toBe(false)` list would not.
   *
   * `shortlisted/schedule_intro` is the one survivor and is correct — §8 makes
   * the associate the intro-call executor by delegation. The Jury Pipeline
   * screen never offers it: a `shortlisted` row draws the `.jp-flowtag` badge
   * ("Sent to intro calls") where the Action select would be.
   */
  it("gives the associate no decision out of the screen's four stages", () => {
    expect(writesInJuryWindow("program_associate")).toEqual(["shortlisted/schedule_intro"]);
  });

  /**
   * `JuryPipelineActionCell`'s only transition, relabelled "Send to intro
   * calls". Asserted through `performAction` because that is the predicate the
   * transition route calls — the refusal has to be the server's, not a
   * `disabled` attribute's.
   */
  it("refuses the associate the screen's one write (shortlist), with 'forbidden'", () => {
    expect(performAction("incubator", "jury_evaluation", "shortlist", "program_associate")).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  /** The negative control's other side: read-only must not mean nobody decides. */
  it("leaves the decision with the incubator — the programme manager, not the juror", () => {
    // The juror was in this list until 2026-10-04, when the client took the
    // decision off them entirely: "It is the prerogative of the Incubator to
    // take a final call. Juror is always an external guy." So this case now
    // carries BOTH halves — somebody still decides, and it is not the jury.
    for (const role of ["program_manager", "admin", "superuser"] as const) {
      expect(performAction("incubator", "jury_evaluation", "shortlist", role).ok, role).toBe(true);
    }
    expect(performAction("incubator", "jury_evaluation", "shortlist", "jury").ok).toBe(false);
  });

  /**
   * GATE, NOT GRANT: reach is `nav.ts`'s `roles` AND the matrix cell, so the
   * grant is two code edits that must move together. This asserts they AGREE
   * rather than asserting a value, so it holds before the grant and after it,
   * and goes red on a half-landed one in either direction.
   */
  it("keeps the nav reach and the matrix cell in step for the associate", () => {
    const item = NAV_BY_EDITION.incubator.find((i) => i.id === "jurypipeline")!;
    expect(canSeeNav("program_associate", item)).toBe(
      can("incubator", "program_associate", "jurypipeline"),
    );
  });
});
