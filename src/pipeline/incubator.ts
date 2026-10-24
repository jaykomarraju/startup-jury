import type { PipelineConfig } from "./types";

// Incubator pipeline — mirrors INC_DIAGRAM_2 and the role×stage permission matrix,
// reconciled with the Jul-24 demo decision that the Program Manager is the
// DECISION MAKER (the role matrix image predates it). superuser + admin have full
// access at every stage. The program_manager assigns jury, makes the reject
// decision, and decides (schedules, or delegates to the associate) the intro
// call; the program_associate stays the frontline EXECUTOR (assign, schedule on
// the PM's direction, send signup, run the founder-query loop). The jury scores
// its assigned decks and decides nothing (2026-10-04). Since 23-Oct nobody
// shortlists by hand: the criteria do, when the panel completes — see the note
// where the `shortlist` entry used to be.
export const incubatorPipeline: PipelineConfig = {
  edition: "incubator",
  initialStage: "uploaded",
  stages: [
    { id: "uploaded", label: "Uploaded", kind: "intake" },
    { id: "pending_ai", label: "Pending AI", kind: "intake" },
    { id: "manual_review", label: "Manual Review", kind: "decision" },
    { id: "incomplete", label: "Incomplete", kind: "exit" },
    { id: "ai_evaluated", label: "AI Evaluated", kind: "decision" },
    { id: "assigned", label: "Assigned", kind: "advancing" },
    { id: "jury_evaluation", label: "Jury Evaluation", kind: "decision" },
    { id: "shortlisted", label: "Shortlisted", kind: "advancing" },
    { id: "intro", label: "Intro", kind: "advancing" },
    { id: "signup", label: "Signup", kind: "advancing" },
    { id: "onboard_ready", label: "Ready to Onboard", kind: "advancing", terminal: true },
    { id: "rejected", label: "Rejected", kind: "exit" },
    // Not terminal since Aug-2026 issue 31: Archive offers "Restore back into
    // the workflow", so there IS a transition out of it.
    { id: "archived", label: "Archived", kind: "exit" },
  ],
  transitions: [
    {
      from: "uploaded",
      to: "pending_ai",
      action: "submit_for_ai",
      label: "Submit for AI evaluation",
      roles: ["founder", "program_associate", "program_manager", "admin", "superuser"],
    },
    // A human reviewer can pull a pending deck into manual review (the AI path
    // otherwise auto-lands decks at ai_evaluated/incomplete via evaluateDeck).
    {
      from: "pending_ai",
      to: "manual_review",
      action: "send_to_review",
      label: "Send to manual review",
      roles: ["program_manager", "program_associate", "admin", "superuser"],
    },
    // Manual review outcome: proceed to AI gate, or flag as incomplete.
    {
      from: "manual_review",
      to: "ai_evaluated",
      action: "approve_review",
      label: "Approve for AI evaluation",
      roles: ["program_manager", "program_associate", "admin", "superuser"],
    },
    {
      from: "manual_review",
      to: "incomplete",
      action: "flag_incomplete",
      label: "Flag incomplete",
      roles: ["program_manager", "program_associate", "admin", "superuser"],
    },
    // Founder answers a clarification query → deck re-enters intake.
    {
      from: "incomplete",
      to: "uploaded",
      action: "founder_response",
      label: "Founder responded",
      roles: ["founder", "program_associate", "admin", "superuser"],
    },
    // The AI screening gate is applied in the evaluation service, not here
    // (`server/ai/evaluate.ts`, against `org_scoring_settings.ai_gate_threshold`
    // — at or above the org's number, migration 0082). What reaches this stage
    // since the screening wave is EVERY evaluated deck, cleared or not: a
    // sub-gate deck used to be moved straight to `rejected` by the evaluator,
    // and now waits here with its low score. See `reject_ai_gate` below.
    //
    // The PM (decision maker) can assign jury; the associate (executor) does the
    // day-to-day assignment.
    {
      from: "ai_evaluated",
      to: "assigned",
      action: "assign_jury",
      label: "Assign jury",
      roles: ["program_manager", "program_associate", "admin", "superuser"],
    },
    // "Reject (below AI gate)" — and the label is only now TRUE of the decks it
    // is offered on. This transition has always started at `ai_evaluated`, and
    // `ai/evaluate.ts` used to send every sub-gate deck straight to `rejected`,
    // so the only decks that could ever reach this button were decks that had
    // PASSED the gate. It was an accurate description of nothing.
    //
    // Now it is the client's own Reject: his "Below threshold" row (`D ∧ C ∧ ¬R`)
    // draws exactly one active action, and this is it, on a deck that is still
    // here to act on. His "Rejected" row then offers Archive, which the
    // `rejected -> archived` entry below already serves.
    {
      from: "ai_evaluated",
      to: "rejected",
      action: "reject_ai_gate",
      label: "Reject (below AI gate)",
      roles: ["program_manager", "admin", "superuser"],
    },
    {
      from: "assigned",
      to: "jury_evaluation",
      action: "start_jury_eval",
      label: "Begin jury evaluation",
      roles: ["jury", "admin", "superuser"],
    },
    // **The jury SCORES; it does not DECIDE.** The client, 2026-10-04, on the
    // juror's Reject/Shortlist buttons: *"Should be deleted. Not required since
    // the below threshold levels are indicated automatically. It is the
    // prerogative of the Incubator to take a final call. Juror is always an
    // external guy."*
    //
    // That is a PERMISSION statement, not a layout one, which is why `"jury"`
    // comes out of both role lists here and not only off the buttons. This repo's
    // recurring defect is a screen gated client-side while the route still says
    // yes (`role-boundary-leaks` — issue 21, `/api/messages`, the founder
    // portal), and an external evaluator holding a transition nobody draws is
    // exactly that shape.
    //
    // The decision stayed with the incubator: programme manager, admin and super
    // user kept both, on the same screen — until 23-Oct for the shortlist.
    //
    // **`jury_evaluation → shortlisted` is no longer a person's transition**
    // (23-Oct tracker row 4): *"The startups are shortlisted as per the criteria
    // set in the admin console. NO MANUAL SHORTLISTING SHOULD BE ALLOWED BY THE
    // SYSTEM."* The same reasoning as the jury's removal above, one step
    // further: the entry is GONE, so `allowedTransitions` offers it to no screen
    // and `performAction` grants it to no role. The move itself is made by
    // `applyShortlistCriteria` (`routes/pipeline.ts`) as the system — NULL
    // actor, action `auto_shortlist` — when a deck's panel has scored it over
    // its floor. That is the established shape for a system move here
    // (`routes/decks.ts:1433`: `ai_evaluated`, `ai_skipped`, `send_to_assign`,
    // `details_completed` have no entry either), and it keeps this table's
    // invariant that every transition is some role's. The route refuses
    // `{"action":"shortlist"}` itself, before this table is read, so neither
    // half of the rule depends on the other. Reject keeps its roles: the client
    // took away the shortlist, not the incubator's final call.
    {
      from: "jury_evaluation",
      to: "rejected",
      action: "reject",
      label: "Reject",
      roles: ["program_manager", "admin", "superuser"],
    },
    // Shortlist routes to the PM, who decides + schedules the intro call (or
    // delegates the scheduling to the associate, who keeps the action too).
    {
      from: "shortlisted",
      to: "intro",
      action: "schedule_intro",
      label: "Schedule intro call",
      roles: ["program_manager", "program_associate", "admin", "superuser"],
    },
    {
      from: "intro",
      to: "signup",
      action: "send_signup",
      label: "Send signup",
      roles: ["program_associate", "admin", "superuser"],
    },
    {
      from: "signup",
      to: "onboard_ready",
      action: "complete_signup",
      label: "Complete signup",
      roles: ["founder", "admin", "superuser"],
    },
    // 21-Sep item 2 — Archive is one of the four row actions the client asked
    // for on the Dashboard, and that screen shows working stages, not rejected
    // ones. It was `rejected -> archived` alone, so a one-click Archive from a
    // dashboard row was a 403 and the option shipped disabled. Widened here,
    // one entry per stage a dashboard row can hold.
    //
    // `onboard_ready` (terminal — the deck has been taken on) and `archived`
    // itself are deliberately absent; `rejected` keeps the original entry. The
    // way out of all of them is the existing `archived -> ai_evaluated`
    // Restore, so nothing archived is stranded.
    ...(
      [
        "uploaded",
        "pending_ai",
        "manual_review",
        "incomplete",
        "ai_evaluated",
        "assigned",
        "jury_evaluation",
        "shortlisted",
        "intro",
        "signup",
        "rejected",
      ] as const
    ).map((from) => ({
      from,
      to: "archived",
      action: "archive",
      label: "Archive",
      roles: ["program_manager", "admin", "superuser"] as const,
    })),
    // Aug-2026 issue 31 — "Restore any of them back into the workflow." A
    // restored startup re-enters at the AI gate, ready to be assigned again.
    {
      from: "rejected",
      to: "ai_evaluated",
      action: "restore",
      label: "Restore",
      roles: ["program_manager", "admin", "superuser"],
    },
    {
      from: "archived",
      to: "ai_evaluated",
      action: "restore",
      label: "Restore",
      roles: ["program_manager", "admin", "superuser"],
    },
  ],
};
