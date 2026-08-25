import type { PipelineConfig } from "./types";

// Incubator pipeline — mirrors INC_DIAGRAM_2 and the role×stage permission matrix,
// reconciled with the Jul-24 demo decision that the Program Manager is the
// DECISION MAKER (the role matrix image predates it). superuser + admin have full
// access at every stage. The program_manager assigns jury, makes/overrides the
// shortlist decision, and decides (schedules, or delegates to the associate) the
// intro call; the program_associate stays the frontline EXECUTOR (assign, schedule
// on the PM's direction, send signup, run the founder-query loop). Jury still
// scores + shortlists their assigned decks.
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
    // AI gate (score > 5 enforced in the evaluation service, not here).
    // The PM (decision maker) can assign jury; the associate (executor) does the
    // day-to-day assignment.
    {
      from: "ai_evaluated",
      to: "assigned",
      action: "assign_jury",
      label: "Assign jury",
      roles: ["program_manager", "program_associate", "admin", "superuser"],
    },
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
    // Jury scores + shortlists their assigned decks; the PM (decision maker) may
    // also make or override the shortlist / reject decision.
    {
      from: "jury_evaluation",
      to: "shortlisted",
      action: "shortlist",
      label: "Shortlist",
      roles: ["jury", "program_manager", "admin", "superuser"],
    },
    {
      from: "jury_evaluation",
      to: "rejected",
      action: "reject",
      label: "Reject",
      roles: ["jury", "program_manager", "admin", "superuser"],
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
    {
      from: "rejected",
      to: "archived",
      action: "archive",
      label: "Archive",
      roles: ["program_manager", "admin", "superuser"],
    },
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
