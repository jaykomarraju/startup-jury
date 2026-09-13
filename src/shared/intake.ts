/**
 * Session 5 — intake guardrails (pure, no Env/DB).
 *
 * Two concerns from the Jul-24 demo (FINISH-PLAN §8):
 *
 *  1. **Upload validation.** Every submission needs the founder/contact columns —
 *     founder, email, phone, city. A single upload collects them on the form; a
 *     bulk upload lets the AI extraction fill them in. Whatever is still missing
 *     after the merge marks the deck **Incomplete** (never a hard reject — the
 *     deck is stored and scored, then the founder is asked for the rest).
 *
 *     **Sector is not one of them** (`W7-B`, F0223/F0227). The prototype is
 *     explicit — "Sector is taken from your workspace setup context — not scanned
 *     from the deck" — and its `upDetailsComplete` can never fail on sector. It is
 *     still a detail column every deck carries (the results table, CRM mapping),
 *     but it comes from the operator: the programme they are working in, or the
 *     workspace's sector taxonomy. `resolveIntakeSector` is that resolution.
 *
 *  2. **Duplicate / returning-company flags.** Matching a new submission against
 *     the decks already in the edition on name / founder / email / phone gives a
 *     soft **duplicate** alert (cost-driven: each AI run spends a credit) and a
 *     **returning-company** history tag when a known company comes back at a new
 *     stage (seed → Series A). Both are alerts, never blocks.
 *
 * Kept free of Env so it unit-tests at the node tier and the client can import the
 * same labels/logic it renders.
 */

// ── Required intake detail ───────────────────────────────────────────────────

/** The founder/contact detail columns every deck carries, in display order. */
export const INTAKE_DETAIL_FIELDS = [
  "founder",
  "founderEmail",
  "founderPhone",
  "city",
  "sector",
] as const;

/**
 * The detail columns an intake collects. Kept under its original name because
 * `src/shared/crm.ts` spreads it into the CRM inbound mapping, where a sector a
 * CRM supplies IS operator-supplied. It no longer means "missing marks the deck
 * Incomplete" — that is `EXTRACTED_INTAKE_FIELDS`.
 */
export const REQUIRED_INTAKE_FIELDS = INTAKE_DETAIL_FIELDS;

export type IntakeField = (typeof INTAKE_DETAIL_FIELDS)[number];

/**
 * The columns the AI reads off the deck — and the only ones whose absence marks
 * a deck Incomplete (prototype `upDetailsComplete`: founder, email, phone, city;
 * sector is always supplied from the workspace context).
 */
export const EXTRACTED_INTAKE_FIELDS = [
  "founder",
  "founderEmail",
  "founderPhone",
  "city",
] as const satisfies readonly IntakeField[];

/** Human labels for the detail columns (upload form + Incomplete surfaces). */
export const INTAKE_FIELD_LABELS: Record<IntakeField, string> = {
  founder: "Founder name",
  founderEmail: "Founder email",
  founderPhone: "Phone",
  city: "City",
  sector: "Sector",
};

/**
 * The Upload screen's "Uploaded decks — AI-extracted details" headers
 * (`panel-upload.html:318`), which word two columns differently from the rest of
 * the app (F0345). Scoped to that table so no other screen's columns move.
 */
export const INTAKE_RESULTS_LABELS: Record<IntakeField, string> = {
  founder: "Founder name",
  founderEmail: "Email ID",
  founderPhone: "Phone number",
  city: "City",
  sector: "Sector",
};

/** The largest deck PDF intake accepts. `src/server/decks/versions.ts` enforces
 *  its own `MAX_PDF_BYTES`; a worker test pins the two equal so the Upload
 *  screen's "up to 24 MB" can never drift from the limit that rejects. */
export const MAX_DECK_PDF_BYTES = 24 * 1024 * 1024;

export interface IntakeDetails {
  founder?: string | null;
  founderEmail?: string | null;
  founderPhone?: string | null;
  city?: string | null;
  sector?: string | null;
}

/** Trim to a non-empty string, or null. */
function clean(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

export function normalizeEmail(v: string | null | undefined): string | null {
  const t = clean(v);
  return t ? t.toLowerCase() : null;
}

/** Digits only, keyed on the last 10 so "+91 98450 12345" == "9845012345".
 *  Fewer than 7 digits isn't a usable phone number → null. */
export function normalizePhone(v: string | null | undefined): string | null {
  const t = clean(v);
  if (!t) return null;
  const digits = t.replace(/\D+/g, "");
  if (digits.length < 7) return null;
  return digits.slice(-10);
}

// Legal/filler suffixes stripped before comparing company names, so
// "GreenGrid Energy Pvt Ltd" and "greengrid energy" are the same company.
const NAME_NOISE =
  /\b(pvt|private|ltd|limited|inc|incorporated|llc|llp|corp|corporation|co|company|technologies|technology|labs|systems|ventures|solutions)\b/g;

/** Comparable form of a company name: lowercased, legal suffixes and all
 *  non-alphanumerics removed. Returns null when nothing meaningful is left. */
export function normalizeCompanyName(v: string | null | undefined): string | null {
  const t = clean(v);
  if (!t) return null;
  const stripped = t.toLowerCase().replace(NAME_NOISE, " ").replace(/[^a-z0-9]+/g, "");
  return stripped ? stripped : null;
}

/** Comparable form of a person's name (founder matching). */
export function normalizePersonName(v: string | null | undefined): string | null {
  const t = clean(v);
  if (!t) return null;
  const stripped = t.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return stripped ? stripped : null;
}

/** Deliberately permissive — we're validating an intake column, not RFC 5322. */
export function isValidEmail(v: string | null | undefined): boolean {
  const t = normalizeEmail(v);
  return t !== null && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(t);
}

export function isValidPhone(v: string | null | undefined): boolean {
  return normalizePhone(v) !== null;
}

/**
 * The extracted intake columns still absent (or unusable) on a submission, in
 * the canonical order. An empty array means the deck has complete founder
 * details. Sector is never reported: it is the workspace's to supply, not the
 * founder's, so asking the founder for it would be asking the wrong person.
 */
export function missingIntakeFields(d: IntakeDetails): IntakeField[] {
  const missing: IntakeField[] = [];
  if (!clean(d.founder)) missing.push("founder");
  if (!isValidEmail(d.founderEmail)) missing.push("founderEmail");
  if (!isValidPhone(d.founderPhone)) missing.push("founderPhone");
  if (!clean(d.city)) missing.push("city");
  return missing;
}

/** Render missing field keys as a readable list ("Phone, City"). */
export function describeMissingFields(fields: IntakeField[]): string {
  return fields.map((f) => INTAKE_FIELD_LABELS[f]).join(", ");
}

/** Parse the CSV stored in `decks.missing_fields` back into known field keys. */
export function parseMissingFields(csv: string | null | undefined): IntakeField[] {
  if (!csv) return [];
  const known = new Set<string>(REQUIRED_INTAKE_FIELDS);
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is IntakeField => known.has(s));
}

/**
 * Merge what the uploader typed with what the AI extracted from the deck. The
 * **supplied value always wins** — a human who filled the form is more reliable
 * than an extraction — and the extraction only fills the blanks (which is how a
 * bulk upload, where nothing is typed, gets its details).
 *
 * Sector is the exception: it is taken ONLY from what was supplied (the
 * operator's pick, or the programme context the upload route resolved). An
 * extracted sector is ignored outright, so a deck that states "Climate" can
 * never overwrite the workspace's "CleanTech" — nor fill a blank the operator
 * deliberately left.
 */
export function mergeIntakeDetails(
  supplied: IntakeDetails,
  extracted: IntakeDetails,
): IntakeDetails {
  const pick = (a: string | null | undefined, b: string | null | undefined) => clean(a) ?? clean(b);
  return {
    founder: pick(supplied.founder, extracted.founder),
    founderEmail: pick(supplied.founderEmail, extracted.founderEmail),
    founderPhone: pick(supplied.founderPhone, extracted.founderPhone),
    city: pick(supplied.city, extracted.city),
    sector: clean(supplied.sector),
  };
}

// ── Sector, from the workspace ───────────────────────────────────────────────

export interface SectorContext {
  /** What the operator picked on the form (or a CRM supplied). */
  supplied?: string | null;
  /** The sector of the programme the upload is tagged to. */
  programSector?: string | null;
  /** The workspace's active sector taxonomy (`sectors`, managed in Set up). */
  sectors?: readonly string[];
}

/**
 * The sector a new deck is recorded under — never read off the deck.
 *
 *  1. The operator's pick wins, spelled the way the taxonomy spells it when it
 *     matches one ("fintech" → "FinTech"), so the Sector column and the sector
 *     mix analytics group on one value. A value outside the taxonomy is kept as
 *     typed: free text is the explicit fallback (F0298), not an error.
 *  2. Otherwise the tagged programme's sector — the prototype's "workspace
 *     setup context".
 *  3. Otherwise, a workspace with exactly ONE active sector has only one answer.
 *  4. Otherwise nothing. A blank sector is not a missing detail.
 */
export function resolveIntakeSector(ctx: SectorContext): string | null {
  const taxonomy = (ctx.sectors ?? []).map((s) => clean(s)).filter((s): s is string => !!s);
  const canonical = (v: string) => taxonomy.find((s) => s.toLowerCase() === v.toLowerCase()) ?? v;
  const supplied = clean(ctx.supplied);
  if (supplied) return canonical(supplied);
  const program = clean(ctx.programSector);
  if (program) return canonical(program);
  return taxonomy.length === 1 ? taxonomy[0] : null;
}

// ── Duplicate / returning-company detection ──────────────────────────────────

/** Soft alert kind. Never blocks an upload — both are advisory. */
export type IntakeFlag = "duplicate" | "returning";

export type IntakeMatchField = "name" | "founder" | "email" | "phone";

const MATCH_FIELD_LABELS: Record<IntakeMatchField, string> = {
  name: "company name",
  founder: "founder name",
  email: "email",
  phone: "phone",
};

/** An existing deck a new submission is compared against. `closed` means the
 *  earlier application already concluded (rejected / archived / onboarded /
 *  signed up) — the caller derives it from the pipeline stage kind. */
export interface IntakeCandidate extends IntakeDetails {
  id: string;
  name: string;
  /** Funding stage of the earlier submission, e.g. "Seed". */
  fundingStage?: string | null;
  /** Human stage label of the earlier submission, e.g. "Shortlisted". */
  statusLabel?: string | null;
  closed?: boolean;
  cohortId?: string | null;
  createdAt?: string | null;
}

export interface IntakeSubject extends IntakeDetails {
  name: string;
  fundingStage?: string | null;
  cohortId?: string | null;
  /** Excluded from matching (the deck being checked, on a re-check after AI extraction). */
  selfId?: string | null;
}

export interface IntakeMatch {
  deckId: string;
  name: string;
  flag: IntakeFlag;
  matchedOn: IntakeMatchField[];
  fundingStage?: string;
  statusLabel?: string;
  createdAt?: string;
  /** One-line explanation, used verbatim as the deck's intake_flag_note. */
  reason: string;
}

export interface IntakeClassification {
  /** The overall flag for the submission — `duplicate` outranks `returning`. */
  flag: IntakeFlag | null;
  matches: IntakeMatch[];
}

/** Which identity fields the subject and a candidate agree on. */
function matchFields(subject: IntakeSubject, cand: IntakeCandidate): IntakeMatchField[] {
  const on: IntakeMatchField[] = [];
  const sName = normalizeCompanyName(subject.name);
  if (sName && sName === normalizeCompanyName(cand.name)) on.push("name");
  const sFounder = normalizePersonName(subject.founder);
  if (sFounder && sFounder === normalizePersonName(cand.founder)) on.push("founder");
  const sEmail = normalizeEmail(subject.founderEmail);
  if (sEmail && sEmail === normalizeEmail(cand.founderEmail)) on.push("email");
  const sPhone = normalizePhone(subject.founderPhone);
  if (sPhone && sPhone === normalizePhone(cand.founderPhone)) on.push("phone");
  return on;
}

function sameStage(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = clean(a)?.toLowerCase() ?? null;
  const nb = clean(b)?.toLowerCase() ?? null;
  // Unknown on either side → treat as unchanged (don't invent a "returning" tag).
  if (na === null || nb === null) return true;
  return na === nb;
}

/**
 * Classify one submission against the edition's existing decks.
 *
 * A candidate matches when it agrees on **any** identity field (company name,
 * founder name, email, phone). A match is:
 *
 *  - **returning** — the earlier application already concluded, OR the funding
 *    stage changed (seed → Series A), OR it belongs to a different cohort. This
 *    is the "known company re-applies" history tag; §8 says they legitimately
 *    submit a new deck, we just surface the history.
 *  - **duplicate** — otherwise: the same company, same stage, still live in the
 *    pipeline. That's the cost-driven alert (a second AI run for nothing).
 *
 * The submission's overall flag is `duplicate` when any match is a duplicate
 * (the more urgent alert), else `returning`, else null.
 */
export function classifyIntake(
  subject: IntakeSubject,
  candidates: IntakeCandidate[],
): IntakeClassification {
  const matches: IntakeMatch[] = [];

  for (const cand of candidates) {
    if (subject.selfId && cand.id === subject.selfId) continue;
    const on = matchFields(subject, cand);
    if (on.length === 0) continue;

    const differentCohort =
      !!subject.cohortId && !!cand.cohortId && subject.cohortId !== cand.cohortId;
    const stageMoved = !sameStage(subject.fundingStage, cand.fundingStage);
    const flag: IntakeFlag =
      cand.closed || stageMoved || differentCohort ? "returning" : "duplicate";

    const fields = on.map((f) => MATCH_FIELD_LABELS[f]).join(", ");
    const where = cand.statusLabel ? ` (currently ${cand.statusLabel})` : "";
    const reason =
      flag === "duplicate"
        ? `Possible duplicate of “${cand.name}”${where} — matched on ${fields}.`
        : stageMoved
          ? `“${cand.name}” applied before at ${cand.fundingStage}${where} and is back at ${subject.fundingStage} — matched on ${fields}.`
          : `“${cand.name}” has applied before${where} — matched on ${fields}.`;

    matches.push({
      deckId: cand.id,
      name: cand.name,
      flag,
      matchedOn: on,
      fundingStage: cand.fundingStage ?? undefined,
      statusLabel: cand.statusLabel ?? undefined,
      createdAt: cand.createdAt ?? undefined,
      reason,
    });
  }

  // Duplicates first, then most recent — the top match is what the deck records.
  matches.sort((a, b) => {
    if (a.flag !== b.flag) return a.flag === "duplicate" ? -1 : 1;
    return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
  });

  const flag = matches.length === 0 ? null : matches[0].flag;
  return { flag, matches };
}
