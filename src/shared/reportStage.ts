/**
 * Stage-awareness for the evaluation report — incubator spec §8.4.
 *
 * > Which role parameters appear in the evaluation report depends on the
 * > stage/screen the report is opened from (detected in the prototype by which
 * > panel is visible):
 * > - Assign stage → Program associate + Program manager parameter sections.
 * > - Intro calls stage → Program associate + Program manager + Jury parameter
 * >   sections (jury section as read-only "completed").
 * > - Other stages → single-role behaviour.
 * > In the Jury file specifically: the Assigned screen adds a Program associate
 * > reference section; Intro calls adds PA + PM reference sections; the jury's
 * > own 3 parameters are always shown (editable).
 *
 * §13 names the contract: `GET /decks/:id/report?stage=assign|intro`.
 *
 * This module is the rule and nothing else, so the server that filters the
 * report and the screen that labels it cannot disagree about it. It is pure:
 * no Env, no DOM.
 *
 * **Where the spec and the Super User prototype disagree, the spec wins (§1.1)**
 * and the difference is recorded in plan §8. `AISJ_IC_SuserV15` `suevSections`
 * also shows the jury section on Assign and draws three further stages (Sign
 * up, Sign up pipeline, Jury pipeline); the written spec shows PA + PM on
 * Assign and calls every other stage single-role.
 */
import { ADDITIONAL_PARAM_OWNERS, type Edition, type Role } from "./roles";

/** The two stages the spec names. Anything else is the single-role default. */
export const REPORT_STAGES = ["assign", "intro"] as const;
export type NamedReportStage = (typeof REPORT_STAGES)[number];
export type ReportStage = NamedReportStage | "default";

/**
 * How a role's section renders for this viewer at this stage.
 *
 * - `editable` — the viewer's own lens: their parameters, which they score.
 * - `read_only` — another role's parameters, shown as reference.
 * - `completed` — the jury's parameters once the jury is done (Intro calls,
 *   for anyone but the jury): read-only, and labelled as submitted work.
 */
export type ReportSectionMode = "editable" | "read_only" | "completed";

export interface ReportSection {
  role: Role;
  mode: ReportSectionMode;
}

export interface ReportLayout {
  stage: ReportStage;
  /** False where the edition's stage rules are not built (VC — see below). */
  stageAware: boolean;
  /** Sections in render order. */
  sections: ReportSection[];
}

/** Parse the `?stage=` query value; anything unrecognised is the default. */
export function parseReportStage(value: unknown): ReportStage {
  return typeof value === "string" && (REPORT_STAGES as readonly string[]).includes(value)
    ? (value as NamedReportStage)
    : "default";
}

/**
 * The originating screen → the report stage. This is the prototype's
 * `suevStage()` ("which panel is visible"), keyed by nav slug instead of by a
 * panel's `display` style, so a screen gets the right report by being the
 * screen — no call site has to remember to pass anything (the spec's
 * "Report role sections are stage-detected via visible panel, not via call-site
 * opts").
 *
 * `jassigned` is the jury's own "Assigned" screen — the spec's Jury-file Assign.
 */
export const SCREEN_STAGE: Readonly<Record<string, NamedReportStage>> = {
  assign: "assign",
  jassigned: "assign",
  introcalls: "intro",
};

export function reportStageForScreen(navId: string | null | undefined): ReportStage {
  return (navId && SCREEN_STAGE[navId]) || "default";
}

const PA: Role = "program_associate";
const PM: Role = "program_manager";
const JURY: Role = "jury";

/**
 * The sections a viewer's report carries at a stage.
 *
 * Incubator, per §8.4:
 *
 * | viewer         | Assign                 | Intro calls                      | other            |
 * |----------------|------------------------|----------------------------------|------------------|
 * | jury           | PA (ref) · Jury (edit) | PA (ref) · PM (ref) · Jury (edit)| Jury (edit)      |
 * | PA / PM        | PA · PM (own editable) | PA · PM (own editable) · Jury ✓  | own role (edit)  |
 * | admin / su     | PA · PM (reference)    | PA · PM (reference) · Jury ✓     | every role (ref) |
 *
 * ✓ = `completed`. A superuser or admin owns no additional parameters, so
 * "single-role" has no role to be single about; they oversee, and keep the
 * all-roles reference view the report has always given them (plan §8).
 *
 * VC: its spec §8.4 is a different machine (partner-call / IC / alignment gates
 * with their own flags) and is `W9-E` / `W11-B`'s. Until it is built VC keeps
 * the report it had — every owning role, the viewer's own editable — and says
 * `stageAware: false` so nobody mistakes that for the VC rule.
 */
export function reportLayout(edition: Edition, stage: ReportStage, viewer: Role): ReportLayout {
  const owners = ADDITIONAL_PARAM_OWNERS[edition];
  const own = (role: Role): ReportSection => ({ role, mode: role === viewer ? "editable" : "read_only" });

  if (edition !== "incubator") {
    return { stage, stageAware: false, sections: owners.map(own) };
  }

  if (viewer === JURY) {
    if (stage === "assign") return { stage, stageAware: true, sections: [own(PA), own(JURY)] };
    if (stage === "intro") return { stage, stageAware: true, sections: [own(PA), own(PM), own(JURY)] };
    return { stage, stageAware: true, sections: [own(JURY)] };
  }

  if (stage === "assign") return { stage, stageAware: true, sections: [own(PA), own(PM)] };
  if (stage === "intro") {
    return {
      stage,
      stageAware: true,
      sections: [own(PA), own(PM), { role: JURY, mode: "completed" }],
    };
  }
  // Single-role: the viewer's own lens where they have one.
  if ((owners as readonly Role[]).includes(viewer)) {
    return { stage, stageAware: true, sections: [own(viewer)] };
  }
  return { stage, stageAware: true, sections: owners.map(own) };
}

/** Human names for the stages, for the report header. */
export const REPORT_STAGE_LABELS: Record<ReportStage, string> = {
  assign: "Assign",
  intro: "Intro calls",
  default: "Evaluation",
};
