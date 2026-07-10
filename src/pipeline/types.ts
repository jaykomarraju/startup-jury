import type { Edition, Role } from "../shared/roles";

/** Visual/semantic grouping used by the flow diagrams and the UI pipeline board. */
export type StageKind = "intake" | "evaluation" | "decision" | "advancing" | "exit";

export interface Stage {
  id: string;
  label: string;
  kind: StageKind;
  /** Terminal stages have no outgoing transitions (onboard/archive). */
  terminal?: boolean;
}

export interface Transition {
  from: string;
  to: string;
  /** Stable action id (used by the API and audit log), e.g. "shortlist". */
  action: string;
  label: string;
  /** Roles permitted to perform this transition. */
  roles: readonly Role[];
}

export interface PipelineConfig {
  edition: Edition;
  initialStage: string;
  stages: readonly Stage[];
  transitions: readonly Transition[];
}
