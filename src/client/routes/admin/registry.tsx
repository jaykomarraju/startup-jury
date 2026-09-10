/**
 * Section id → the component that renders its body.
 *
 * **This file is the slot Waves 2–5 land in.** A session that builds a console
 * section adds its component here as ONE line, keyed by the prototype section
 * id, and changes nothing else in the shell:
 *
 *     import { ScoringFramework } from "./ScoringFramework";
 *     …
 *     fw: ScoringFramework,
 *
 * Anything absent from this map renders `SectionPlaceholder`, which names what
 * the section will contain and which session lands it (see `sections.ts`).
 * Keep the entries in `secs` order so a three-way merge of three parallel
 * sessions stays a three-line diff.
 *
 * A section that owns unsaved state wires the title bar's global Save changes
 * button by calling `useAdminSave({ dirty, saving, onSave })` from
 * `./saveContext`; with no section registered the button is disabled and says
 * why. The section is rendered inside the console's scroll pane and must NOT
 * draw its own page chrome — the title bar supplies the section label, the
 * program/cohort chip and the save. Its own `.sec-title` / `.sec-sub` heading
 * pair belongs in the body, as an `<h2>` plus a one-line description, matching
 * `SectionPlaceholder`.
 */
import type { ComponentType } from "react";
import { AreaWeightsSection } from "./AreaWeights";
import { RubricAnchorsSection } from "./RubricAnchors";
import { ScoringFrameworkSection } from "./ScoringFramework";
import { TeamRolesSection } from "./TeamRoles";

export const SECTION_COMPONENTS: Record<string, ComponentType> = {
  // Evaluation
  fw: ScoringFrameworkSection, //   W2-A · Scoring framework
  wt: AreaWeightsSection, //        W2-A · Area weights
  rb: RubricAnchorsSection, //      W2-B · Rubric anchors
  // qb:      W2-C · Question bank
  // Organisation
  tm: TeamRolesSection, //   W4-A replaces this with the full roster
  // crm:     W3-D · CRM sync
  // bl:      W4-C · Credits & billing
  // pc:      W4-D · Price configuration
  // Sign-up
  // sudocs:  W5-A · Required documents
  // suagr:   W5-B · Agreements library
  // susign:  W5-B · Authorised signatories
  // suseat:  W5-A · Seat capacity      (incubator)
  // sufund:  W5-A · Fund Deployment    (VC)
  // System
  // nt:      W3-B · Notifications
  // al:      W3-C · Audit log
  // uc:      W4-A · User access
  // br:      W4-B · Branding
};
