// W9-E — what a VC call decides, in the prototype's own words.
//
// `AISJ_VC_Superuser_V8/_scripts.js`: `PC_OUTCOMES = ['Sponsor to IC','Pass',
// 'Need another meeting']` is Partner call's Sponsorship select and
// `AL_OUTCOMES = ['Issue term sheet','Renegotiate','Hold']` is Alignment call's
// Outcome select; `clOutClass` colours them go / hold / no / info and each
// panel's `.nc-legend` repeats them.
//
// An outcome with an `action` IS that pipeline transition — choosing it moves the
// deck, exactly as the stage's button did. One without (Renegotiate, Hold) has no
// transition in `src/pipeline/vc.ts`: the deal stays at the stage and the choice
// is RECORDED against (deck, call kind) in `call_outcomes` (migration 0065).
//
// Shared by `src/server/routes/calls.ts` (which reads decided rows and records
// outcomes) and `CallsPage.tsx` (which draws the select and the legend), so the
// words and the stage sets cannot drift apart.

import type { CallKind, Edition } from "./roles";

export type OutcomeTone = "go" | "hold" | "no" | "info";

export interface CallOutcome {
  id: string;
  label: string;
  tone: OutcomeTone;
  /** The pipeline transition this outcome performs; absent → recorded only. */
  action?: string;
}

export interface CallDecision {
  /** The deck stages this screen decides. A deck leaving them was decided here. */
  stages: readonly string[];
  /** The select's options, in the prototype's order. */
  options: readonly CallOutcome[];
  /** The `.nc-legend`, in the prototype's order (it differs from the select's). */
  legend: readonly string[];
}

export const CALL_DECISIONS: Record<Edition, Partial<Record<CallKind, CallDecision>>> = {
  incubator: {},
  vc: {
    partner: {
      stages: ["partner_call"],
      options: [
        { id: "sponsor_to_ic", label: "Sponsor to IC", tone: "go", action: "sponsor_to_ic" },
        { id: "pass_at_call", label: "Pass", tone: "no", action: "pass_at_call" },
        { id: "another_meeting", label: "Need another meeting", tone: "hold", action: "another_meeting" },
      ],
      legend: ["Sponsor to IC", "Need another meeting", "Pass"],
    },
    alignment: {
      stages: ["alignment_call"],
      options: [
        { id: "issue_term_sheet", label: "Issue term sheet", tone: "go", action: "issue_term_sheet" },
        { id: "renegotiate", label: "Renegotiate", tone: "hold" },
        { id: "hold", label: "Hold", tone: "info" },
      ],
      legend: ["Issue term sheet", "Renegotiate", "Hold"],
    },
  },
};

export function callDecision(edition: Edition, kind: CallKind): CallDecision | undefined {
  return CALL_DECISIONS[edition][kind];
}

/** The option a transition performed, by its action. */
export function outcomeForAction(decision: CallDecision, action: string): CallOutcome | undefined {
  return decision.options.find((o) => o.action === action);
}

/** The recorded-only options (no transition) — the only ones `PUT /api/calls/outcome` accepts. */
export function recordedOutcome(decision: CallDecision, id: string): CallOutcome | undefined {
  return decision.options.find((o) => o.id === id && !o.action);
}
