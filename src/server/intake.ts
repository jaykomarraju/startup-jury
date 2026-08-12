// Session 5 — the DB-backed half of the intake guardrails. The classification
// itself is pure (`src/shared/intake.ts`); this module only loads the candidate
// decks and turns a classification into the deck's persisted flag columns.
//
// Lives under the worker tsconfig (it imports `Env`), like `ai/evaluate.ts`.

import type { Env } from "./types";
import type { Edition } from "../shared/roles";
import { getStage } from "../pipeline";
import {
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
