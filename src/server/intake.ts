// Session 5 — the DB-backed half of the intake guardrails. The classification
// itself is pure (`src/shared/intake.ts`); this module only loads the candidate
// decks and turns a classification into the deck's persisted flag columns.
//
// Lives under the worker tsconfig (it imports `Env`), like `ai/evaluate.ts`.

import type { Env } from "./types";
import type { Edition } from "../shared/roles";
import { getStage } from "../pipeline";
import {
  resolveIntakeSector,
  classifyIntake,
  type IntakeCandidate,
  type IntakeClassification,
  type IntakeSubject,
} from "../shared/intake";

/** How many recent decks a new submission is matched against. The comparison is
 *  normalised in JS (SQL can't do it), so the scan is bounded — far above any
 *  realistic single-cohort intake, and it reads the newest decks first. */
const CANDIDATE_LIMIT = 500;

interface CandidateRow {
  id: string;
  name: string;
  founder: string | null;
  founder_email: string | null;
  founder_phone: string | null;
  stage: string | null;
  status: string;
  cohort_id: string | null;
  created_at: string | null;
}

/** An earlier application has "concluded" when its stage is an exit or terminal
 *  node — a company coming back after that is returning, not duplicating. */
function isClosed(edition: Edition, status: string): boolean {
  const stage = getStage(edition, status);
  if (!stage) return false;
  return stage.kind === "exit" || stage.terminal === true;
}

/** Load the decks a new submission in `edition` is matched against. */
export async function loadIntakeCandidates(
  env: Env,
  edition: Edition,
  excludeDeckId?: string,
): Promise<IntakeCandidate[]> {
  const rows = (
    await env.DB.prepare(
      "SELECT id, name, founder, founder_email, founder_phone, stage, status, cohort_id, created_at " +
        "FROM decks WHERE edition = ? AND id != ? ORDER BY created_at DESC LIMIT ?",
    )
      .bind(edition, excludeDeckId ?? "", CANDIDATE_LIMIT)
      .all<CandidateRow>()
  ).results;

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    founder: r.founder,
    founderEmail: r.founder_email,
    founderPhone: r.founder_phone,
    fundingStage: r.stage,
    statusLabel: getStage(edition, r.status)?.label ?? r.status,
    closed: isClosed(edition, r.status),
    cohortId: r.cohort_id,
    createdAt: r.created_at,
  }));
}

/**
 * Classify one submission against the edition's existing decks. Soft alerts only —
 * the caller stores the flag and surfaces it; nothing is ever blocked.
 */
export async function detectIntakeFlags(
  env: Env,
  edition: Edition,
  subject: IntakeSubject,
): Promise<IntakeClassification> {
  const candidates = await loadIntakeCandidates(env, edition, subject.selfId ?? undefined);
  return classifyIntake(subject, candidates);
}

// ── The operator's context, carried onto every deck (W7-B) ───────────────────

/** What an upload form says about WHERE its decks belong — as opposed to what
 *  is in them. A bulk upload applies it to every file in the batch. */
export interface IntakeContext {
  programId?: string;
  cohortId?: string;
  sector?: string;
}

/**
 * Validate the programme / cohort an upload is tagged to and resolve its sector
 * from the workspace (F0223, F0227, F0298).
 *
 * The ids come from a form, so nothing is trusted: a programme from the other
 * edition, a cohort that belongs to a different programme, or an id that does
 * not exist is DROPPED rather than written — a deck tagged to a programme the
 * caller cannot see would vanish from every programme-scoped screen. A cohort
 * sent without its programme implies the programme. The sector is then
 * `resolveIntakeSector`: the operator's pick, else the programme's, else the
 * workspace's only sector.
 *
 * Every key is always present (possibly `undefined`), so the caller can
 * `Object.assign` the result over the raw form values and a bogus id is erased.
 */
export async function resolveIntakeContext(
  env: Env,
  edition: Edition,
  input: IntakeContext,
): Promise<{ programId: string | undefined; cohortId: string | undefined; sector: string | undefined }> {
  const clean = (v: string | undefined) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  let programId = clean(input.programId);
  let cohortId = clean(input.cohortId);

  if (cohortId) {
    const cohort = await env.DB.prepare(
      "SELECT c.program_id FROM cohorts c JOIN programs p ON p.id = c.program_id WHERE c.id = ? AND p.edition = ?",
    )
      .bind(cohortId, edition)
      .first<{ program_id: string }>();
    if (!cohort || (programId && cohort.program_id !== programId)) cohortId = undefined;
    else programId = cohort.program_id;
  }

  let programSector: string | null = null;
  if (programId) {
    const program = await env.DB.prepare("SELECT sector FROM programs WHERE id = ? AND edition = ?")
      .bind(programId, edition)
      .first<{ sector: string | null }>();
    if (!program) {
      programId = undefined;
      cohortId = undefined;
    } else {
      programSector = program.sector;
    }
  }

  const sectors = (
    await env.DB.prepare("SELECT name FROM sectors WHERE edition = ? AND active = 1 ORDER BY sort_order, name")
      .bind(edition)
      .all<{ name: string }>()
  ).results.map((r) => r.name);

  const sector = resolveIntakeSector({ supplied: input.sector, programSector, sectors }) ?? undefined;
  return { programId, cohortId, sector };
}

/** The statement that records a classification on the deck (or clears it). */
export function intakeFlagStatement(
  env: Env,
  deckId: string,
  classification: IntakeClassification,
): D1PreparedStatement {
  const top = classification.matches[0];
  return env.DB.prepare(
    "UPDATE decks SET intake_flag = ?, intake_flag_note = ?, related_deck_id = ? WHERE id = ?",
  ).bind(classification.flag, top?.reason ?? null, top?.deckId ?? null, deckId);
}
