/**
 * W7-B — the Upload screen's pure logic: the credits bar, the batch cost
 * preview, the staged-deck checks, the results table's status, and the letter
 * "Send to Query" raises.
 *
 * Kept free of React and of Env so every rule the screen draws is unit-tested
 * at the node tier (`test/unit/uploadReview.test.ts`).
 *
 * ── Credits, never money (§8 Q1, Q40) ──────────────────────────────────────
 * The prototype's cost bar reads "1 credit · ₹999" and multiplies a per-deck
 * rate. §8 Q1 retired per-deck pricing: the catalogue sells plans and packs as
 * stated amounts. What survives is METERING — one evaluated deck consumes one
 * credit (`reserveCredits`, `src/server/decks/versions.ts`). So every preview
 * here counts credits, and nothing here knows a currency exists.
 */
import { MAX_DECK_PDF_BYTES, type IntakeField } from "./intake";
import {
  SCREENING_STATUS_LABELS,
  screeningStatus,
  type ScreeningDeck,
  type ScreeningValue,
} from "./deckStats";
import type { Edition } from "./roles";

/** One evaluated deck consumes one credit. Metering, not a price. */
export const CREDITS_PER_DECK = 1;

/** "1 credit" / "3 credits" — the method badges and the cost bar. */
export function creditsLabel(n: number): string {
  return `${n} credit${n === 1 ? "" : "s"}`;
}

export interface BatchCostPreview {
  decks: number;
  /** Credits the batch will consume. */
  credits: number;
  /** The balance read before the batch, or null when it could not be read. */
  balance: number | null;
  /** What is left after the batch — null when the balance is unknown. */
  balanceAfter: number | null;
  /** Credits missing for the batch; 0 when it is covered or the balance is unknown. */
  shortfall: number;
  /** True / false when the balance is known; null when it is not (the server decides). */
  affordable: boolean | null;
}

/**
 * The "Cost preview → You approve" beat. A preview READS the balance; it never
 * spends. An unknown balance does not block — the upload route reserves under
 * its own conditional UPDATE and answers 402 when the balance is short.
 */
export function batchCostPreview(decks: number, balance: number | null | undefined): BatchCostPreview {
  const n = Math.max(0, Math.floor(decks));
  const credits = n * CREDITS_PER_DECK;
  if (typeof balance !== "number" || !Number.isFinite(balance)) {
    return { decks: n, credits, balance: null, balanceAfter: null, shortfall: 0, affordable: null };
  }
  const shortfall = Math.max(0, credits - balance);
  return {
    decks: n,
    credits,
    balance,
    balanceAfter: Math.max(0, balance - credits),
    shortfall,
    affordable: shortfall === 0,
  };
}

/**
 * The credits bar's meter (`.up-cr-bar-inner`): what remains against the most
 * this workspace is known to have been granted. `purchased` is only readable by
 * a billing administrator; everyone else measures against the free trial, and
 * a balance above either fills the bar.
 */
export function creditsMeterPct(input: {
  balance: number | null | undefined;
  purchased?: number | null;
  trialDecks?: number | null;
}): number {
  const balance = typeof input.balance === "number" ? Math.max(0, input.balance) : 0;
  const granted = Math.max(balance, input.purchased ?? 0, input.trialDecks ?? 0);
  if (granted <= 0) return 0;
  return Math.round((balance / granted) * 100);
}

/**
 * The sub-line under the balance — "3 free trial credits · Standard plan". The
 * trial count is the published catalogue's `trial.decks`, never a literal;
 * either half is dropped when it is unknown, and a trial of zero is not offered.
 */
export function creditsSubline(input: { trialDecks?: number | null; planLabel?: string | null }): string | null {
  const parts: string[] = [];
  if (typeof input.trialDecks === "number" && input.trialDecks > 0) {
    parts.push(`${input.trialDecks} free trial credit${input.trialDecks === 1 ? "" : "s"}`);
  }
  if (input.planLabel) parts.push(`${input.planLabel} plan`);
  return parts.length ? parts.join(" · ") : null;
}

// ── Staging ──────────────────────────────────────────────────────────────────

/** A reason a staged file will be refused by the upload route. */
export type StagedIssue = "not_pdf" | "too_large";

/** "50 MB" — derived from the limit the server enforces, never typed. */
export const MAX_DECK_SIZE_LABEL = `${Math.round(MAX_DECK_PDF_BYTES / (1024 * 1024))} MB`;

export const STAGED_ISSUE_LABELS: Record<StagedIssue, string> = {
  not_pdf: "Not a PDF — decks must be PDF files",
  too_large: `Too large — the ${MAX_DECK_SIZE_LABEL} limit is exceeded`,
};

/** The checks the server will run, run early so the operator never pays to learn them. */
export function stagedDeckIssues(file: { name: string; size: number; type?: string }): StagedIssue[] {
  const issues: StagedIssue[] = [];
  const pdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!pdf) issues.push("not_pdf");
  if (file.size > MAX_DECK_PDF_BYTES) issues.push("too_large");
  return issues;
}

/** The provisional startup name a file stands for until the AI reads the real one. */
export function provisionalDeckName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  return base.replace(/\.pdf$/i, "").trim() || "Untitled deck";
}

/** "2.4 MB" — the size badge. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Results ──────────────────────────────────────────────────────────────────

/**
 * The results table's Status pill BEFORE the client's screening vocabulary: the
 * prototype's two (`upDetailsComplete`) plus the honest third state a real
 * asynchronous upload has while the AI has not read the deck yet.
 *
 * ── RETAINED FOR THE VC EDITION ONLY (tester issue 5) ───────────────────────
 * These three words cannot express the distinction the incubator spec requires.
 * `intakeStatusOf` reads `missingFields` and nothing else, so a deck the AI
 * could not READ and a deck whose FOUNDER details are missing arrive at the same
 * word — and "Incomplete" is then the word an operator is asked to act on, with
 * no way to know which of the two causes they are looking at. The incubator path
 * reads `screeningStatus` instead (`shared/deckStats.ts`), whose thirteen
 * statuses are the client's own and which keeps the two causes apart.
 *
 * The VC edition was explicitly out of scope on 2026-10-01 and the screening
 * vocabulary is the incubator's by construction (`ScreeningOptions.edition`
 * exists for exactly that reason), so VC keeps these.
 */
export type IntakeStatus = "complete" | "incomplete" | "awaiting";

export const INTAKE_STATUS_LABELS: Record<IntakeStatus, string> = {
  complete: "Complete",
  incomplete: "Incomplete",
  awaiting: "Awaiting AI",
};

export function intakeStatusOf(deck: {
  statusId?: string;
  missingFields?: readonly IntakeField[];
}): IntakeStatus {
  if (!deck.statusId || deck.statusId === "pending_ai") return "awaiting";
  return (deck.missingFields ?? []).length > 0 ? "incomplete" : "complete";
}

/** How a status pill reads, whichever vocabulary produced it. */
export type UploadStatusTone = "good" | "warn" | "muted";

/**
 * `screeningStatus` takes the AI screening gate as a REQUIRED number so that no
 * screen can type a threshold of its own — the product already has three, and
 * `routes/decks.ts:95-100` records a past confusion between two of them. The
 * gate is `org_scoring_settings.ai_gate_threshold`, served on the config
 * summary, so it is null for as long as that response is in flight.
 *
 * A null gate means "there is no rating check to apply YET", never "the
 * threshold is five": a constant beside the setting is the live defect this is
 * being wired to avoid. `UNGATED` sits below every possible score, so a deck
 * reads from its two completeness axes alone for that one fetch — which is
 * exactly what these screens reported before they learned the screening words.
 */
const UNGATED = Number.NEGATIVE_INFINITY;

export interface UploadStatusContext {
  /** `org_scoring_settings.ai_gate_threshold`; null until the summary is read. */
  gate: number | null;
  /** Which vocabulary this operator's edition speaks — see `IntakeStatus`. */
  edition: Edition;
}

/**
 * How each screening status reads on an upload pill. A `Record` over the whole
 * union on purpose: a fourteenth status must be given a tone here rather than
 * falling through to whatever the last branch happened to be.
 */
const SCREENING_TONES: Record<ScreeningValue, UploadStatusTone> = {
  // Settled — nothing is owed on these.
  complete: "good",
  completeEdited: "good",
  assigned: "good",
  // The operator has something to do.
  incompleteContact: "warn",
  incompleteContactEdited: "warn",
  incompleteDeck: "warn",
  incompleteDeckEdited: "warn",
  bothIncomplete: "warn",
  belowThreshold: "warn",
  belowThresholdEdited: "warn",
  rejected: "warn",
  noResponse: "warn",
  // Waiting on someone else: the AI, the founder, or nobody at all.
  awaitingAi: "muted",
  contactEdited: "muted",
  queried: "muted",
  archived: "muted",
};

/** `D` is false — the client's "Incomplete deck" arm. */
const DECK_INCOMPLETE: readonly ScreeningValue[] = ["incompleteDeck", "incompleteDeckEdited", "bothIncomplete"];

/** `C` is false — the client's "Incomplete contact details" arm. */
const CONTACT_INCOMPLETE: readonly ScreeningValue[] = [
  "incompleteContact",
  "incompleteContactEdited",
  "bothIncomplete",
];

export interface UploadDeckStatus {
  /** The word on the pill. */
  label: string;
  tone: UploadStatusTone;
  /** `D` — the AI could not read the deck itself. */
  deckIncomplete: boolean;
  /** `C` — one of the founder's four contact details is missing. */
  contactIncomplete: boolean;
  /** The AI has not answered yet, so there is no verdict to report. */
  awaiting: boolean;
  /**
   * May "Parameters needing response" → Send to Query open on this deck?
   *
   * The spec's §1 tree arms Send to Query on the DECK axis — "Incomplete deck:
   * Send to Query active", settled against the §5 table in §3 note 1 — and
   * disables it on the contact axis and on Both incomplete, where the operator
   * is told to Edit instead. It was armed on `missingFields.length > 0`, which
   * is the contact axis: the one state the spec turns it off in (tester issue
   * 4). The VC edition keeps the old arming along with the old vocabulary.
   */
  flaggable: boolean;
}

/** One uploaded deck's status, as the upload screens say it. */
export function uploadDeckStatus(deck: ScreeningDeck, ctx: UploadStatusContext): UploadDeckStatus {
  if (ctx.edition !== "incubator") {
    const status = intakeStatusOf(deck);
    return {
      label: INTAKE_STATUS_LABELS[status],
      tone: status === "complete" ? "good" : status === "incomplete" ? "warn" : "muted",
      deckIncomplete: false,
      contactIncomplete: status === "incomplete",
      awaiting: status === "awaiting",
      flaggable: status === "incomplete",
    };
  }
  const value = screeningStatus(deck, { gate: ctx.gate ?? UNGATED, edition: ctx.edition });
  return {
    label: SCREENING_STATUS_LABELS[value],
    tone: SCREENING_TONES[value],
    deckIncomplete: DECK_INCOMPLETE.includes(value),
    contactIncomplete: CONTACT_INCOMPLETE.includes(value),
    awaiting: value === "awaitingAi",
    flaggable: value === "incompleteDeck" || value === "incompleteDeckEdited",
  };
}

/** The summary banner over the results table. */
export function resultsSummary(statuses: readonly UploadDeckStatus[]): string {
  const n = statuses.length;
  const contact = statuses.filter((s) => s.contactIncomplete).length;
  const unread = statuses.filter((s) => s.deckIncomplete).length;
  const awaiting = statuses.filter((s) => s.awaiting).length;
  const head = `${n} deck${n === 1 ? "" : "s"} uploaded.`;
  const read =
    " The AI records the founder’s name, email, phone and city from each deck; sector is taken from your setup context.";
  const tail: string[] = [];
  // Counted on the two axes SEPARATELY, and a deck failing both is counted in
  // both: one "N marked Incomplete" line is what sent an operator to edit
  // contact details on a deck whose PDF was the thing the AI could not read.
  if (contact) tail.push(`${contact} deck${contact === 1 ? "" : "s"} with incomplete contact details.`);
  if (unread) tail.push(`${unread} deck${unread === 1 ? "" : "s"} the AI could not read.`);
  if (awaiting) tail.push(`${awaiting} still being read by the AI.`);
  if (!tail.length && n > 0) tail.push("All details captured.");
  return [head + read, ...tail].join(" ");
}

// ── Parameters needing response → Send to Query ──────────────────────────────

/** The signal an operator tags a flagged parameter with (`.up-sig`). */
export type FlagSignal = "weak" | "absent";

export const FLAG_SIGNAL_LABELS: Record<FlagSignal, string> = {
  weak: "Weak signal",
  absent: "Absent",
};

export interface ParameterFlag {
  area: string;
  signal: FlagSignal;
}

/**
 * The clarification letter "Send to Query" raises for the areas an operator
 * flagged. Same salutation, bullets and sign-off as the Query screen's own
 * letter, so a founder cannot tell which screen asked — and one bullet per area
 * in the form `• <Area> (weak signal|absent)`, which is what the Query screen
 * would parse if it chose to list manually flagged areas (§9).
 */
export function composeUploadQuery(deckName: string, flags: ParameterFlag[]): string {
  const bullets = flags.map((f) => `• ${f.area} (${FLAG_SIGNAL_LABELS[f.signal].toLowerCase()})`);
  return [
    "Dear Founder,",
    "",
    `Thank you for submitting ${deckName}. As part of our evaluation, our review panel needs a few`,
    "clarifications on areas where the deck signalled incomplete or weak information:",
    "",
    ...bullets,
    "",
    "Please reply with an updated deck covering these areas, or respond to them directly in your",
    "founder portal.",
    "",
    "Warm regards,",
    "The Evaluation Team",
  ].join("\n");
}
