import { describe, it, expect } from "vitest";
import {
  getPipeline,
  allowedTransitions,
  canTransition,
  performAction,
  isTerminal,
} from "../../src/pipeline";
import type { Edition } from "../../src/shared/roles";

const EDITIONS: Edition[] = ["incubator", "vc"];

describe("pipeline structural integrity", () => {
  for (const edition of EDITIONS) {
    it(`${edition}: every transition references valid stages`, () => {
      const p = getPipeline(edition);
      const ids = new Set(p.stages.map((s) => s.id));
      expect(ids.has(p.initialStage)).toBe(true);
      for (const t of p.transitions) {
        expect(ids, `from ${t.from}`).toContain(t.from);
        expect(ids, `to ${t.to}`).toContain(t.to);
        expect(t.roles.length).toBeGreaterThan(0);
      }
    });

    it(`${edition}: terminal stages have no outgoing transitions`, () => {
      const p = getPipeline(edition);
      for (const s of p.stages.filter((s) => s.terminal)) {
        expect(p.transitions.filter((t) => t.from === s.id)).toHaveLength(0);
      }
    });

    it(`${edition}: superuser can perform every defined transition`, () => {
      const p = getPipeline(edition);
      for (const t of p.transitions) {
        // superuser has full access at every stage.
        expect(
          canTransition(edition, t.from, t.to, "superuser"),
          `${t.action}`,
        ).toBe(true);
      }
    });
  }
});

describe("incubator role permissions", () => {
  it("jury can shortlist and reject during jury evaluation", () => {
    expect(performAction("incubator", "jury_evaluation", "shortlist", "jury")).toEqual({
      ok: true,
      to: "shortlisted",
    });
    expect(performAction("incubator", "jury_evaluation", "reject", "jury")).toEqual({
      ok: true,
      to: "rejected",
    });
  });

  it("jury cannot assign jury at the AI gate", () => {
    expect(performAction("incubator", "ai_evaluated", "assign_jury", "jury")).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("program associate schedules intro and sends signup", () => {
    expect(
      performAction("incubator", "shortlisted", "schedule_intro", "program_associate").ok,
    ).toBe(true);
    expect(
      performAction("incubator", "intro", "send_signup", "program_associate").ok,
    ).toBe(true);
  });

  it("program manager holds decision authority: assign, shortlist/reject and schedule intro", () => {
    // PM is the decision maker (Jul-24 demo) — can assign jury...
    expect(performAction("incubator", "ai_evaluated", "assign_jury", "program_manager").ok).toBe(true);
    // ...make or override the shortlist / reject decision...
    expect(performAction("incubator", "jury_evaluation", "shortlist", "program_manager")).toEqual({
      ok: true,
      to: "shortlisted",
    });
    expect(performAction("incubator", "jury_evaluation", "reject", "program_manager")).toEqual({
      ok: true,
      to: "rejected",
    });
    // ...and decide/schedule the intro call once a deck is shortlisted.
    expect(performAction("incubator", "shortlisted", "schedule_intro", "program_manager").ok).toBe(true);
  });

  it("founder completes signup but cannot shortlist", () => {
    expect(performAction("incubator", "signup", "complete_signup", "founder").ok).toBe(true);
    expect(performAction("incubator", "jury_evaluation", "shortlist", "founder")).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("unknown actions and terminal stages are rejected", () => {
    expect(performAction("incubator", "shortlisted", "nope", "superuser")).toEqual({
      ok: false,
      error: "unknown_action",
    });
    expect(isTerminal("incubator", "onboard_ready")).toBe(true);
    expect(performAction("incubator", "onboard_ready", "archive", "superuser")).toEqual({
      ok: false,
      error: "terminal",
    });
  });
});

describe("vc role permissions", () => {
  it("only the managing partner (superuser) decides invest/pass", () => {
    expect(performAction("vc", "mp_decision", "invest", "superuser")).toEqual({
      ok: true,
      to: "alignment_call",
    });
    expect(performAction("vc", "mp_decision", "invest", "partner")).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("associate shortlists to partner; analyst cannot advance to the partner call", () => {
    expect(
      performAction("vc", "associate_review", "shortlist_to_partner", "associate").ok,
    ).toBe(true);
    expect(performAction("vc", "partner_review", "advance_to_call", "analyst")).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("investment associate is one shade senior to the analyst", () => {
    // Analyst uploads + scores (submit_for_ai, submit_core_scores)...
    expect(performAction("vc", "uploaded", "submit_for_ai", "analyst").ok).toBe(true);
    expect(performAction("vc", "analyst_scoring", "submit_core_scores", "analyst").ok).toBe(true);
    // ...but only the associate makes the shortlist-to-partner call; the analyst
    // (who can be an intern) cannot.
    expect(performAction("vc", "associate_review", "shortlist_to_partner", "analyst")).toEqual({
      ok: false,
      error: "forbidden",
    });
    // The associate is the frontline scorer + reviewer; the partner (not the
    // associate) sponsors the deal to IC.
    expect(performAction("vc", "partner_call", "sponsor_to_ic", "associate")).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("lists a role's allowed transitions from a stage", () => {
    const partnerAtCall = allowedTransitions("vc", "partner_call", "partner").map(
      (t) => t.action,
    );
    expect(partnerAtCall).toEqual(
      expect.arrayContaining(["sponsor_to_ic", "pass_at_call", "another_meeting"]),
    );
    // analyst has nothing to do at the partner call.
    expect(allowedTransitions("vc", "partner_call", "analyst")).toHaveLength(0);
  });
});
