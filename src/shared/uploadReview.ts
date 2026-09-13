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

/** "24 MB" — derived from the limit the server enforces, never typed. */
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
 * The results table's Status pill. The prototype has two (`upDetailsComplete`);
 * a real bulk upload is scored asynchronously, so there is a third, honest state
 * while the AI has not read the deck yet.
 */
export type IntakeStatus = "complete" | "incomplete" | "awaiting";

export const INTAKE_STATUS_LABELS: Record<IntakeStatus, string> = {
  complete: "Complete",
  incomplete: "Incomplete",
  awaiting: "Awaiting AI",
};

export function intakeStatusOf(deck: {
  statusId?: string;
  missingFields?: IntakeField[];
}): IntakeStatus {
  if (!deck.statusId || deck.statusId === "pending_ai") return "awaiting";
  return (deck.missingFields ?? []).length > 0 ? "incomplete" : "complete";
}

/** The summary banner over the results table. */
export function resultsSummary(statuses: IntakeStatus[]): string {
  const n = statuses.length;
  const incomplete = statuses.filter((s) => s === "incomplete").length;
  const awaiting = statuses.filter((s) => s === "awaiting").length;
  const head = `${n} deck${n === 1 ? "" : "s"} uploaded.`;
  const read =
    " The AI records the founder’s name, email, phone and city from each deck; sector is taken from your setup context.";
  const tail: string[] = [];
  if (incomplete) tail.push(`${incomplete} deck${incomplete === 1 ? "" : "s"} marked Incomplete — details missing.`);
  if (awaiting) tail.push(`${awaiting} still being read by the AI.`);
  if (!incomplete && !awaiting && n > 0) tail.push("All details captured.");
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
