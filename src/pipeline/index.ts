import type { Edition, Role } from "../shared/roles";
import type { PipelineConfig, Stage, Transition } from "./types";
import { incubatorPipeline } from "./incubator";
import { vcPipeline } from "./vc";

export * from "./types";
export { incubatorPipeline } from "./incubator";
export { vcPipeline } from "./vc";

const PIPELINES: Record<Edition, PipelineConfig> = {
  incubator: incubatorPipeline,
  vc: vcPipeline,
};

export function getPipeline(edition: Edition): PipelineConfig {
  return PIPELINES[edition];
}

export function getStage(edition: Edition, stageId: string): Stage | undefined {
  return getPipeline(edition).stages.find((s) => s.id === stageId);
}

export function isTerminal(edition: Edition, stageId: string): boolean {
  return getStage(edition, stageId)?.terminal === true;
}

/** All transitions out of `from` that `role` is allowed to perform. */
export function allowedTransitions(
  edition: Edition,
  from: string,
  role: Role,
): Transition[] {
  return getPipeline(edition).transitions.filter(
    (t) => t.from === from && t.roles.includes(role),
  );
}

/** Resolve a transition by its action id from a given stage. */
export function transitionByAction(
  edition: Edition,
  from: string,
  action: string,
): Transition | undefined {
  return getPipeline(edition).transitions.find(
    (t) => t.from === from && t.action === action,
  );
}

/** Whether `role` may move a deck from `from` to `to`. */
export function canTransition(
  edition: Edition,
  from: string,
  to: string,
  role: Role,
): boolean {
  return getPipeline(edition).transitions.some(
    (t) => t.from === from && t.to === to && t.roles.includes(role),
  );
}

export interface TransitionResult {
  ok: boolean;
  to?: string;
  error?: "unknown_action" | "forbidden" | "terminal";
}

/**
 * Validate and resolve a role-performed action. Pure — callers persist the
 * resulting stage and append a pipeline event.
 */
export function performAction(
  edition: Edition,
  from: string,
  action: string,
  role: Role,
): TransitionResult {
  if (isTerminal(edition, from)) return { ok: false, error: "terminal" };
  const transition = transitionByAction(edition, from, action);
  if (!transition) return { ok: false, error: "unknown_action" };
  if (!transition.roles.includes(role)) return { ok: false, error: "forbidden" };
  return { ok: true, to: transition.to };
}
