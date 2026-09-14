/**
 * W9-C — the VC edition's diligence-to-close record, as pure rules shared by
 * `src/server/routes/diligence.ts`, the stage screens and their tests.
 *
 * Two checklists and one deal record, all drawn by `AISJ_VC_Superuser_V8`:
 *
 *   • the **Investment DD** checklist (`DD_ITEMS`, `ddOpen` / `ddSet`) — six
 *     items, each with a status, an owner, a rating and a finding, and a label
 *     the team may rename in place;
 *   • the **Legal DD** checklist (`LD_ITEMS`, `ldOpen` / `ldSet`) — seven items,
 *     the same four fields, fixed labels;
 *   • the per-deal state the screens around them set: MP approval
 *     (`DD_MP`), the diligence row status (`DD_ROWSTATUS`), the two leads, the
 *     round's ask and pre-money (`ICQ_FIN`), and the term sheet's status
 *     (`TS_OUTCOMES`) and attached document (`tsDoc`).
 *
 * These are a diligence WORK LOG, not a document set. The §8.3 document
 * lifecycle (`not_requested → awaiting → submitted → verified`, Verify all) is
 * `signup_documents` and stays there — plan §8 Q141 records why the two are
 * different records and why neither is modelled inside the other.
 */

export type DiligenceTrack = "investment" | "legal";
export const DILIGENCE_TRACKS: readonly DiligenceTrack[] = ["investment", "legal"];

/** `DD_ITEMS`, verbatim. */
export const INVESTMENT_DD_ITEMS = [
  "Market",
  "Team references",
  "Customer calls",
  "Product / Tech review",
  "Financials & metrics",
  "Competitive positioning",
] as const;

/** `LD_ITEMS`, verbatim. */
export const LEGAL_DD_ITEMS = [
  "Cap table verification",
  "IP assignment",
  "Contracts & customer agreements",
  "Employment / ESOP",
  "Regulatory / compliance",
  "Litigation checks",
  "Legal documentation (SHA / SSA)",
] as const;

export const TRACK_ITEMS: Record<DiligenceTrack, readonly string[]> = {
  investment: INVESTMENT_DD_ITEMS,
  legal: LEGAL_DD_ITEMS,
};

/** Only the investment checklist's labels are editable in the prototype (`dd-iname-edit`). */
export const RENAMEABLE_TRACKS: readonly DiligenceTrack[] = ["investment"];

// ── Item fields ─────────────────────────────────────────────────────────────

export type DdItemStatus = "not_started" | "in_progress" | "done" | "flagged";
/** `DD_STATUSES`, in the prototype's order. */
export const DD_ITEM_STATUSES: readonly DdItemStatus[] = ["not_started", "in_progress", "done", "flagged"];
export const DD_ITEM_STATUS_LABELS: Record<DdItemStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  done: "Done",
  flagged: "Flagged",
};

export type DdRating = "strong" | "mixed" | "concern";
/** `DD_RATINGS` without the `—` placeholder, which is "no rating" (null). */
export const DD_RATINGS: readonly DdRating[] = ["strong", "mixed", "concern"];
export const DD_RATING_LABELS: Record<DdRating, string> = { strong: "Strong", mixed: "Mixed", concern: "Concern" };

export const MAX_DD_LABEL = 80;
export const MAX_DD_OWNER = 80;
export const MAX_DD_FINDING = 2000;
export const MAX_DEAL_FIGURE = 40;

export interface DdItemView {
  id: string;
  track: DiligenceTrack;
  sortOrder: number;
  label: string;
  /** The prototype's own name for the slot — the rename input's placeholder. */
  defaultLabel: string;
  status: DdItemStatus;
  owner: string | null;
  rating: DdRating | null;
  finding: string | null;
  updatedAt: string | null;
}

export function isDdItemStatus(v: unknown): v is DdItemStatus {
  return typeof v === "string" && (DD_ITEM_STATUSES as readonly string[]).includes(v);
}

export function isDdRating(v: unknown): v is DdRating {
  return typeof v === "string" && (DD_RATINGS as readonly string[]).includes(v);
}

export function isTrack(v: unknown): v is DiligenceTrack {
  return typeof v === "string" && (DILIGENCE_TRACKS as readonly string[]).includes(v);
}

// ── Summary (`ddSummary` / `ldSummary`) ─────────────────────────────────────

export interface DdSummary {
  done: number;
  total: number;
  flagged: number;
  /** Any item has left `not_started`. */
  started: boolean;
}

export function summarise(items: readonly { status: DdItemStatus }[]): DdSummary {
  let done = 0;
  let flagged = 0;
  let started = false;
  for (const it of items) {
    if (it.status === "done") done++;
    if (it.status === "flagged") flagged++;
    if (it.status !== "not_started") started = true;
  }
  return { done, total: items.length, flagged, started };
}

export const isComplete = (s: DdSummary | null | undefined) => !!s && s.total > 0 && s.done === s.total;

/** The legend word a checklist summary decodes to — Done / In progress / Flagged, or none. */
export type DdLegendKey = "done" | "in_progress" | "flagged";
export function legendKeyOf(s: DdSummary | null | undefined): DdLegendKey | undefined {
  if (!s || s.total === 0) return undefined;
  if (s.flagged > 0) return "flagged";
  if (s.done === s.total) return "done";
  return s.started ? "in_progress" : undefined;
}

// ── Deal record ─────────────────────────────────────────────────────────────

export type MpApproval = "approved" | "not_approved";
/** `DD_MP`. */
export const MP_APPROVALS: readonly MpApproval[] = ["approved", "not_approved"];
export const MP_APPROVAL_LABELS: Record<MpApproval, string> = { approved: "Approved", not_approved: "Not approved" };

export type DdRowStatus = "yet_to_start" | "in_progress" | "completed";
/** `DD_ROWSTATUS`. */
export const DD_ROW_STATUSES: readonly DdRowStatus[] = ["yet_to_start", "in_progress", "completed"];
export const DD_ROW_STATUS_LABELS: Record<DdRowStatus, string> = {
  yet_to_start: "Yet to start",
  in_progress: "In progress",
  completed: "Completed",
};

/**
 * `ddInitRow` — until someone sets them, the row's status and MP approval are
 * read off the checklist: complete → Completed, any item moved → In progress,
 * else Yet to start; and MP approval reads Approved once diligence has started.
 * A value someone chose always wins over the derivation.
 */
export function deriveRowStatus(stored: DdRowStatus | null, s: DdSummary | null): DdRowStatus {
  if (stored) return stored;
  if (!s) return "yet_to_start";
  if (isComplete(s)) return "completed";
  return s.started ? "in_progress" : "yet_to_start";
}

export function deriveMpApproval(stored: MpApproval | null, s: DdSummary | null): MpApproval {
  if (stored) return stored;
  return s?.started ? "approved" : "not_approved";
}

export type TermSheetStatus = "drafted" | "issued" | "signed" | "declined";
/** `TS_OUTCOMES`. */
export const TERM_SHEET_STATUSES: readonly TermSheetStatus[] = ["drafted", "issued", "signed", "declined"];
export const TERM_SHEET_STATUS_LABELS: Record<TermSheetStatus, string> = {
  drafted: "Drafted",
  issued: "Issued",
  signed: "Signed",
  declined: "Declined",
};

export type TermSheetVersion = "draft" | "issued" | "executed";
export const TERM_SHEET_VERSION_LABELS: Record<TermSheetVersion, string> = {
  draft: "Draft",
  issued: "Issued",
  executed: "Executed",
};

/** `tsDoc` — the attached document's badge follows the term sheet's own status. */
export function termSheetVersion(status: TermSheetStatus | null): TermSheetVersion {
  if (status === "signed") return "executed";
  if (status === "issued") return "issued";
  return "draft";
}

export const isMpApproval = (v: unknown): v is MpApproval =>
  typeof v === "string" && (MP_APPROVALS as readonly string[]).includes(v);
export const isDdRowStatus = (v: unknown): v is DdRowStatus =>
  typeof v === "string" && (DD_ROW_STATUSES as readonly string[]).includes(v);
export const isTermSheetStatus = (v: unknown): v is TermSheetStatus =>
  typeof v === "string" && (TERM_SHEET_STATUSES as readonly string[]).includes(v);

// ── Which stages carry which record ─────────────────────────────────────────

/** Investment diligence opens at `investment_dd` and travels with the deal to close. */
export const INVESTMENT_TRACK_STAGES = [
  "investment_dd",
  "ic_review",
  "mp_decision",
  "alignment_call",
  "term_sheet",
  "legal_dd",
  "onboard_ready",
] as const;
/** Legal diligence is post-signing (`panel-legaldd` sub). */
export const LEGAL_TRACK_STAGES = ["legal_dd", "onboard_ready"] as const;
/** The term sheet is in motion from its stage onward. */
export const TERM_SHEET_STAGES = ["term_sheet", "legal_dd", "onboard_ready"] as const;

export function trackOpenAt(track: DiligenceTrack, stage: string): boolean {
  const stages: readonly string[] = track === "investment" ? INVESTMENT_TRACK_STAGES : LEGAL_TRACK_STAGES;
  return stages.includes(stage);
}

/** `curData.stage` on the IC member's Invest ready — Term sheet / Legal DD / Closed. */
export function investReadyStage(stage: string | undefined): "Term sheet" | "Legal DD" | "Closed" | undefined {
  if (stage === "alignment_call" || stage === "term_sheet") return "Term sheet";
  if (stage === "legal_dd") return "Legal DD";
  if (stage === "onboard_ready") return "Closed";
  return undefined;
}

/** No movement on a deal for this long reads Stalled on Invest ready. */
export const STALLED_AFTER_DAYS = 14;

/** `curData.status` — Funded once closed, Stalled after two quiet weeks, else On track. */
export function investReadyStatus(
  stage: string | undefined,
  lastActivityAt: string | null | undefined,
  now: number = Date.now(),
): "On track" | "Stalled" | "Funded" {
  if (stage === "onboard_ready") return "Funded";
  if (!lastActivityAt) return "On track";
  const ms = Date.parse(lastActivityAt.includes("T") ? lastActivityAt : `${lastActivityAt.replace(" ", "T")}Z`);
  if (Number.isNaN(ms)) return "On track";
  return now - ms > STALLED_AFTER_DAYS * 86_400_000 ? "Stalled" : "On track";
}

// ── The wire shape ──────────────────────────────────────────────────────────

export interface DealView {
  deckId: string;
  stage: string;
  investment: DdSummary | null;
  legal: DdSummary | null;
  mpApproval: MpApproval;
  /** True when `mpApproval` was chosen rather than derived. */
  mpApprovalSet: boolean;
  ddStatus: DdRowStatus;
  investmentLead: string | null;
  legalLead: string | null;
  ask: string | null;
  valuation: string | null;
  /** The partner who sponsored the deal to IC (or issued its term sheet). */
  partnerName: string | null;
  /** When the deal cleared the Managing Partner's decision. */
  clearedAt: string | null;
  lastActivityAt: string | null;
  termSheet: {
    status: TermSheetStatus | null;
    doc: { fileName: string; templateName: string | null; templateVersion: string | null; version: TermSheetVersion } | null;
  };
}
