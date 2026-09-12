/**
 * Section id → the component that renders its body.
 *
 * **This file is the slot Waves 2–5 land in.** EVERY section id has an entry
 * already. A session that builds one changes `undefined` to its component on its
 * OWN line, and adds one import:
 *
 *     import { CreditsBillingSection } from "./CreditsBilling";
 *     …
 *     bl: CreditsBillingSection, //  W4-C · Credits & billing
 *
 * `undefined` means "not built yet" and renders `SectionPlaceholder`, which
 * names what the section will contain and which session lands it (`sections.ts`).
 *
 * Why every id is pre-listed rather than commented out: this file conflicted in
 * all three of Waves 1–3, because a commented placeholder forces a session to
 * turn a comment into code, and parallel sessions kept resolving by commenting
 * out each other's entries. One session, one line, one token — distinct lines
 * merge cleanly three ways. **Never comment out or delete another session's
 * line.** Restructured at Wave 3 integration.
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
import { AuditLogSection } from "./AuditLog";
import { CrmSyncSection } from "./CrmSync";
import { NotificationsSection } from "./Notifications";
import { PriceConfigurationSection } from "./PriceConfiguration";
import { QuestionBankSection } from "./QuestionBank";
import { RubricAnchorsSection } from "./RubricAnchors";
import { ScoringFrameworkSection } from "./ScoringFramework";
import { TeamRolesSection } from "./TeamRoles";

export const SECTION_COMPONENTS: Record<string, ComponentType | undefined> = {
  // Evaluation
  fw: ScoringFrameworkSection, //    W2-A · Scoring framework
  wt: AreaWeightsSection, //         W2-A · Area weights
  rb: RubricAnchorsSection, //       W2-B · Rubric anchors
  qb: QuestionBankSection, //        W2-C · Question bank
  // Organisation
  tm: TeamRolesSection, //           W4-A replaces this with the full roster
  crm: CrmSyncSection, //            W3-D · CRM sync
  bl: undefined, //                  W4-C · Credits & billing
  pc: PriceConfigurationSection, //  W4-D · Price configuration
  // Sign-up (admin + superuser only)
  sudocs: undefined, //              W5-A · Required documents
  suagr: undefined, //               W5-B · Agreements library
  susign: undefined, //              W5-B · Authorised signatories
  suseat: undefined, //              W5-A · Seat capacity      (incubator)
  sufund: undefined, //              W5-A · Fund Deployment    (VC)
  // System
  nt: NotificationsSection, //       W3-B · Notifications
  al: AuditLogSection, //            W3-C · Audit log
  uc: undefined, //                  W4-A · User access
  br: undefined, //                  W4-B · Branding
};
