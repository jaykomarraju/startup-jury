/**
 * W3-B — the notification vocabulary, shared by the server's emitter, the
 * Admin console's Notifications section and the topbar bell.
 *
 * The prototype's `admin/s-nt.html` is ten rows under one "Email alerts" card,
 * eight toggled on and two off, above a sub-line that scopes the whole section
 * per person and names TWO channels: "Control which platform events trigger
 * email and in-app alerts for your account." So the model is
 * **event × channel × recipient**, which is exactly the shape
 * `migrations/0031_notification_preferences.sql` created — this file is that
 * migration's `event_key` column with labels attached, and the two must not
 * drift.
 *
 * Two of the ten labels are not the prototype's verbatim:
 *
 *   • **Row 3** is edition-conditional — "Jury member submitted scores" in the
 *     incubator, "IC member submitted scores" in the VC (F0181, and the ONLY
 *     textual difference between the two editions' sections). It is derived
 *     from the edition's evaluator role label rather than written twice, so
 *     renaming the role renames the alert.
 *   • **Row 4** drops two words. The prototype says "All jury complete — ready
 *     for **mentor** review", which names a review step §1.2 says does not
 *     exist: `mentor` is a directory record with no pipeline authority (commit
 *     `8822db2`). §8 Q11 assigned the rewording to this session. Nothing else
 *     about the row moves — the event still fires when the panel is done.
 */
import type { Edition, Role } from "./roles";
import { ROLE_LABELS } from "./roles";

/** The ten events, in the prototype's own top-to-bottom order. */
export const NOTIFICATION_EVENTS = [
  "deck_submitted",
  "ai_scoring_complete",
  "evaluator_scores_submitted",
  "all_evaluations_complete",
  "founder_responded",
  "intro_call_scheduled",
  "credits_low",
  "crm_sync_failed",
  "invite_accepted",
  "monthly_usage_summary",
] as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

/** The section's two channels — the sub-line names both. */
export const NOTIFICATION_CHANNELS = ["email", "in_app"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  email: "Email",
  in_app: "In-app",
};

/**
 * The prototype's default mask: eight `.tog on`, two bare. Seeded as the
 * workspace default for both editions and both channels in `0031`; repeated
 * here so a preference with no row at all still resolves to what the section
 * draws.
 */
export const NOTIFICATION_DEFAULTS: Record<NotificationEvent, boolean> = {
  deck_submitted: true,
  ai_scoring_complete: true,
  evaluator_scores_submitted: true,
  all_evaluations_complete: true,
  founder_responded: false,
  intro_call_scheduled: true,
  credits_low: true,
  crm_sync_failed: true,
  invite_accepted: false,
  monthly_usage_summary: true,
};

/** "Credit balance low — under 10 credits" is a number the producer must honour. */
export const LOW_CREDIT_THRESHOLD = 10;

/** The evaluator role whose label row 3 is named after, per edition. */
const EVALUATOR_ROLE: Record<Edition, Role> = { incubator: "jury", vc: "ic_member" };

/**
 * "Jury member" / "IC member" — the edition's evaluator, cased as the
 * prototype's sentence cases it ("Jury Member" is the role label; the alert row
 * lower-cases the noun).
 */
export function evaluatorNoun(edition: Edition): string {
  const label = ROLE_LABELS[edition][EVALUATOR_ROLE[edition]] ?? "Evaluator";
  return label.replace(/\bMember\b/, "member");
}

/** The prototype's optional `.nr-sub` second line. Only row 2 has one. */
const SUBLABELS: Partial<Record<NotificationEvent, string>> = {
  ai_scoring_complete: "Deck has been parsed and pre-scored by the AI engine",
};

export function notificationSubLabel(event: NotificationEvent): string | null {
  return SUBLABELS[event] ?? null;
}

/** `.nr-lbl` for one event, in one edition. */
export function notificationLabel(event: NotificationEvent, edition: Edition): string {
  switch (event) {
    case "deck_submitted":
      return "New pitchdeck submitted";
    case "ai_scoring_complete":
      return "AI scoring complete";
    case "evaluator_scores_submitted":
      return `${evaluatorNoun(edition)} submitted scores`;
    case "all_evaluations_complete":
      // See the header: the prototype's "mentor review" is struck.
      return "All jury complete — ready for review";
    case "founder_responded":
      return "Startup responded to clarification questions";
    case "intro_call_scheduled":
      return "Intro call scheduled or rescheduled";
    case "credits_low":
      return `Credit balance low — under ${LOW_CREDIT_THRESHOLD} credits`;
    case "crm_sync_failed":
      return "CRM sync error or failure";
    case "invite_accepted":
      return "New team member accepted invite";
    case "monthly_usage_summary":
      return "Monthly usage summary report";
  }
}

export function isNotificationEvent(value: unknown): value is NotificationEvent {
  return (NOTIFICATION_EVENTS as readonly string[]).includes(value as string);
}

export function isNotificationChannel(value: unknown): value is NotificationChannel {
  return (NOTIFICATION_CHANNELS as readonly string[]).includes(value as string);
}

/**
 * One cell of the section's toggle grid. `source` is what makes the two scopes
 * legible: a row the person has never touched reads `"default"` and follows the
 * workspace policy, and flipping it writes a `"user"` row that overrides it.
 */
export interface NotificationPreferenceView {
  event: NotificationEvent;
  channel: NotificationChannel;
  enabled: boolean;
  source: "user" | "default";
}

/** One row of the bell's notification centre. */
export interface NotificationView {
  id: string;
  event: NotificationEvent;
  title: string;
  body: string | null;
  link: string | null;
  deckId: string | null;
  readAt: string | null;
  createdAt: string;
}

/** One row of the delivery log the section shows beneath the toggles (F0144). */
export interface OutboxEntryView {
  id: string;
  kind: string;
  toEmail: string;
  toName: string | null;
  subject: string;
  status: "sent" | "failed" | "recorded";
  error: string | null;
  createdAt: string;
}
