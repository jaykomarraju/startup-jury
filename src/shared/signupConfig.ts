/**
 * Sign-up configuration — the vocabulary and the arithmetic behind three admin
 * console sections, shared by the server (`src/server/routes/signup-config.ts`)
 * and the console bodies (`RequiredDocuments.tsx`, `SeatCapacity.tsx`):
 *
 *   • **Required documents** (`admin/s-sudocs.html`, both editions) — the
 *     per-programme checklist every sign-up inherits, and the four-state
 *     lifecycle each inherited item walks.
 *   • **Seat capacity** (`admin/s-suseat.html`, incubator) — cohort seats,
 *     utilisation, and the `seatless` flag.
 *   • **Fund Deployment** (`admin/s-sufund.html`, VC) — allotted / deployed /
 *     unutilised per programme, and the ±0.5 Cr reconciliation.
 *
 * Pure: no `Env`, no DB, no `fetch`. That is what lets the console recompute a
 * utilisation bar as the admin types with the exact arithmetic the route
 * persists, and what lets the state machine be unit-tested at the node tier.
 *
 * `seatUtilisation` itself already lives in `./types` beside the columns it
 * reads (migration `0036`); it is re-exported here so a section needs one
 * import, not two.
 */
import { DOCUMENT_STATUSES, seatUtilisation, type DocumentStatus } from "./types";

export { seatUtilisation };
export { DOCUMENT_STATUSES, type DocumentStatus };

// ═══════════════════════════════════════════════════════════════════════════
// Required documents — the four-state lifecycle
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Spec §8.3 / `s-sudocs.html`: `not_requested → awaiting → submitted →
 * verified`, and `0034`'s own header — *"Skipping a state is illegal; W5-A
 * enforces it."*
 *
 * The closed table below is that sentence made executable. Three rules decide
 * every cell:
 *
 *  1. **Forward, one step at a time.** Every skip is refused, so a document
 *     cannot arrive `verified` without ever having been submitted — which is
 *     the whole point of recording the lifecycle rather than a boolean.
 *  2. **One step back is legal below `verified`**, because both backward moves
 *     are things that actually happen: an item is stood down after the
 *     checklist drops it (`awaiting → not_requested`), and a wrong file is sent
 *     back to the founder (`submitted → awaiting`). The prototype draws no
 *     control for either, so neither is a screen — they are the API's honest
 *     answer to a real request.
 *  3. **`verified` is terminal.** Verification is an assertion a named person
 *     made at a recorded time (`verified_by` / `verified_at`), and silently
 *     un-asserting it would leave the audit trail claiming something nobody
 *     said. A mis-verified item is corrected by waiving it with a reason, or by
 *     adding a fresh item — both of which stay on the record. Recorded as a
 *     decision in the plan's §8 (Q56) with the alternative named.
 *
 * A no-op (`x → x`) is not a transition and is refused too: the bulk verify
 * advances only the items that CAN advance, so an idempotent PATCH would only
 * ever hide a client bug.
 */
export const LEGAL_DOCUMENT_TRANSITIONS: Readonly<Record<DocumentStatus, readonly DocumentStatus[]>> =
  {
    not_requested: ["awaiting"],
    awaiting: ["submitted", "not_requested"],
    submitted: ["verified", "awaiting"],
    verified: [],
  };

export function isDocumentStatus(v: unknown): v is DocumentStatus {
  return typeof v === "string" && (DOCUMENT_STATUSES as readonly string[]).includes(v);
}

/** Whether `from → to` is one of the transitions above. */
export function canTransitionDocument(from: DocumentStatus, to: DocumentStatus): boolean {
  return LEGAL_DOCUMENT_TRANSITIONS[from].includes(to);
}

/** The prototype's `suwPill` colours — `_scripts.js:2163-2166`, verbatim. */
export const DOCUMENT_STATUS_BADGES: Record<
  DocumentStatus,
  { label: string; fg: string; bg: string }
> = {
  not_requested: { label: "Not requested", fg: "#9A9488", bg: "#EEEDE7" },
  awaiting: { label: "Awaiting", fg: "#8A5B06", bg: "#FBF0DA" },
  submitted: { label: "Submitted", fg: "#185FA5", bg: "#E6F1FB" },
  verified: { label: "Verified", fg: "#047857", bg: "#E7F3EC" },
};

/** The same pill for a waived item. Not a lifecycle state — a note beside one. */
export const WAIVED_BADGE = { label: "Waived", fg: "#9A9488", bg: "#EEEDE7" };

export interface DocumentItem {
  status: DocumentStatus;
  mandatory: boolean;
  waived: boolean;
}

/**
 * `deck_onboarding.documents_status` (`0022`) as a DERIVED roll-up of the
 * per-item set, so the Sign up Pipeline's one-column view keeps working while
 * the truth lives in `signup_documents` (F0050).
 *
 *   complete — every mandatory item is verified or waived
 *   pending  — nothing has moved past `awaiting` yet
 *   partial  — anything in between
 *
 * Optional items never hold the roll-up back: the prototype badges them
 * "Optional" and its own "All required documents verified." line counts the
 * required three.
 */
export function rollUpDocumentsStatus(items: DocumentItem[]): "pending" | "partial" | "complete" {
  const required = items.filter((i) => i.mandatory && !i.waived);
  const settled = (i: DocumentItem) => i.status === "verified" || i.waived;
  if (required.length > 0 && required.every((i) => i.status === "verified")) return "complete";
  if (required.length === 0 && items.length > 0 && items.every(settled)) return "complete";
  if (items.some((i) => settled(i) || i.status === "submitted")) return "partial";
  return "pending";
}

/** How many of this set's items the bulk verify would advance. */
export function verifiableCount(items: DocumentItem[]): number {
  return items.filter((i) => !i.waived && canTransitionDocument(i.status, "verified")).length;
}

// ═══════════════════════════════════════════════════════════════════════════
// Seat capacity (incubator) — `admin/s-suseat.html`
// ═══════════════════════════════════════════════════════════════════════════

export interface SeatRow {
  /** "Accelerator · Cohort 8" — the programme and the batch within it. */
  name: string;
  capacity: number;
  filled: number;
}

/** `scPct` — `over` is the prototype's red bar, drawn when filled > capacity. */
export function seatRowState(row: SeatRow): { pct: number; over: boolean } {
  return { pct: seatUtilisation(row.capacity, row.filled), over: row.filled > row.capacity };
}

export function seatsRemaining(row: SeatRow): number {
  return Math.max(0, row.capacity - row.filled);
}

/**
 * `scNote` — the section's one note, in its two states. Over-capacity is a
 * WARNING, never a block: "Sign-up is never blocked by seats" (`s-suseat.html`,
 * and `0036`'s own header).
 */
export function seatNote(rows: SeatRow[]): { tone: "warn" | "info"; text: string } {
  const over = rows.filter((r) => r.filled > r.capacity);
  if (over.length > 0) {
    return {
      tone: "warn",
      text:
        `Over capacity: ${over.map((r) => `${r.name} (${r.filled}/${r.capacity})`).join(", ")}. ` +
        "Sign-up still proceeds, but these push past the cohort seat count.",
    };
  }
  return {
    tone: "info",
    text: "Startups that complete sign-up without a seat are flagged seatless in the pipeline for allocation.",
  };
}

/** The ICAdmin variant's seatless callout — "2 signed records still need a seat". */
export function seatlessNote(count: number): string {
  if (count === 0) return "Every completed sign-up holds a cohort seat.";
  return count === 1
    ? "1 signed record still needs a seat."
    : `${count} signed records still need a seat.`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Fund Deployment (VC) — `admin/s-sufund.html`
// ═══════════════════════════════════════════════════════════════════════════

/** `fdRecon`'s tolerance, in ₹ Cr. */
export const FUND_RECONCILE_TOLERANCE = 0.5;

export interface FundRow {
  name: string;
  /** ₹ Cr. `null` = never set, which is not the same as 0. */
  allotted: number | null;
  deployed: number | null;
  unutilised: number | null;
}

/** `fdPct` — deployed as a percentage of allotted; 0 when nothing is allotted. */
export function fundUtilisation(row: Pick<FundRow, "allotted" | "deployed">): number {
  const allotted = row.allotted ?? 0;
  const deployed = row.deployed ?? 0;
  return allotted > 0 ? Math.round((deployed / allotted) * 100) : 0;
}

/**
 * `(deployed + unutilised) − allotted`, the figure the warning quotes. `null`
 * when any of the three is unset — a programme with no committed capital has
 * nothing to reconcile, and reading its blanks as zeroes would report a fund
 * that does not exist as balanced.
 */
export function fundReconcileDelta(row: FundRow): number | null {
  if (row.allotted === null || row.deployed === null || row.unutilised === null) return null;
  return row.deployed + row.unutilised - row.allotted;
}

export function fundReconciles(row: FundRow): boolean {
  const delta = fundReconcileDelta(row);
  return delta === null || Math.abs(delta) <= FUND_RECONCILE_TOLERANCE;
}

/** ₹ Cr are authored to 0.1; trim the float noise `0.5 + 0.2` leaves behind. */
function crore(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

/**
 * `fdRecon`'s two states, verbatim. Green is the section's only all-clear; the
 * warning names every offending programme and its delta, because "adjust so
 * they reconcile" is useless without saying which row and by how much.
 */
export function fundReconcileNote(rows: FundRow[]): { tone: "warn" | "ok"; text: string } {
  const bad = rows.filter((r) => !fundReconciles(r));
  if (bad.length > 0) {
    return {
      tone: "warn",
      text:
        "Deployed + unutilised doesn't match allotted for: " +
        bad.map((r) => `${r.name} (${crore(fundReconcileDelta(r)!)} Cr)`).join(", ") +
        ". Adjust so they reconcile.",
    };
  }
  return { tone: "ok", text: "Deployed + unutilised reconciles with allotted for every program." };
}

// ═══════════════════════════════════════════════════════════════════════════
// The wire shapes
// ═══════════════════════════════════════════════════════════════════════════

/** One configured checklist item (`required_documents`). */
export interface RequiredDocumentView {
  id: string;
  name: string;
  note: string | null;
  mandatory: boolean;
  /** False = retired. A retired item stays for the sign-ups that inherited it. */
  active: boolean;
  /** NULL = the edition-wide default; otherwise this programme's override. */
  programId: string | null;
  cohortId: string | null;
  sortOrder: number;
}

/** One inherited item on one sign-up (`signup_documents`). */
export interface SignupDocumentView {
  id: string;
  name: string;
  note: string | null;
  status: DocumentStatus;
  mandatory: boolean;
  waived: boolean;
  waivedReason: string | null;
  verifiedAt: string | null;
  /** Which lifecycle moves this item will accept right now. */
  next: DocumentStatus[];
}

/** One sign-up's whole document set, as the status card renders it. */
export interface SignupDocumentSetView {
  signupId: string;
  deckId: string;
  startup: string;
  programName: string | null;
  cohortName: string | null;
  signupStatus: string;
  /** The derived roll-up the Sign up Pipeline column reads. */
  documentsStatus: "pending" | "partial" | "complete";
  /** How many items "Verify all" would advance — 0 disables it. */
  verifiable: number;
  items: SignupDocumentView[];
}

export interface SeatRowView extends SeatRow {
  cohortId: string;
  programId: string;
  programName: string;
  cohortName: string;
  utilisation: number;
  over: boolean;
  remaining: number;
}

export interface FundRowView extends FundRow {
  programId: string;
  utilisation: number;
  /** `null` when a figure is unset — see `fundReconcileDelta`. */
  reconcileDelta: number | null;
  reconciles: boolean;
}

/** The scope a checklist is configured for (`s-sudocs.html`'s first card). */
export const DOCUMENT_APPLY_TO = ["all", "new"] as const;
export type DocumentApplyTo = (typeof DOCUMENT_APPLY_TO)[number];

export const DOCUMENT_APPLY_TO_LABELS: Record<DocumentApplyTo, string> = {
  all: "All startups entering sign-up",
  new: "New sign-ups only",
};

export function isDocumentApplyTo(v: unknown): v is DocumentApplyTo {
  return typeof v === "string" && (DOCUMENT_APPLY_TO as readonly string[]).includes(v);
}
