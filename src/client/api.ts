// Typed fetch helpers for the deck API. All requests are same-origin and carry
// the session cookie automatically.
import type { DeckView } from "./types";
import type { ExtractionSlide, ParamScoreView } from "./components";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`request failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export function listDecks(): Promise<{ decks: DeckView[] }> {
  return fetch("/api/decks").then((r) => json(r));
}

export interface DeckReport {
  deck: DeckView;
  extraction: ExtractionSlide[];
  scores: ParamScoreView[];
  weightedTotal?: number;
  verdict?: string;
}

export function getDeck(id: string): Promise<DeckReport> {
  return fetch(`/api/decks/${id}`).then((r) => json(r));
}

export interface SingleUploadResult {
  deckId: string;
  evaluated: boolean;
  result?: { weightedTotal: number; signal: string; status: string; gatePassed: boolean };
}

export function uploadSingle(form: FormData): Promise<SingleUploadResult> {
  return fetch("/api/decks/upload", { method: "POST", body: form }).then((r) => json(r));
}

export function uploadBulk(form: FormData): Promise<{ count: number; deckIds: string[] }> {
  return fetch("/api/decks/bulk", { method: "POST", body: form }).then((r) => json(r));
}

// ── Phase 4 — workflow actions ────────────────────────────────────────────────

function postJson<T>(path: string, body?: unknown): Promise<T> {
  return fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  }).then((r) => json<T>(r));
}

/** Extra fields some VC transitions capture (e.g. term-sheet valuation/ownership). */
export interface TransitionExtra {
  valuation?: string;
  ownership?: string;
}

/** Apply a role-gated pipeline action to a deck. */
export function transitionDeck(id: string, action: string, note?: string, extra?: TransitionExtra) {
  return postJson<{ ok: true; status: string; label: string }>(
    `/api/decks/${id}/transition`,
    { action, note, ...extra },
  );
}

/** Assign a jury member and advance the deck to Assigned. */
export function assignDeck(id: string, assigneeId: string) {
  return postJson<{ ok: true; status: string; assignedToName: string }>(
    `/api/decks/${id}/assign`,
    { assigneeId },
  );
}

export interface HumanScoreInput {
  key: string;
  value: number;
  comment?: string;
}

/** Submit this jury member's per-parameter scores (mirrors the AI path). */
export function submitJuryScores(id: string, scores: HumanScoreInput[], remarks?: string) {
  return postJson<{ ok: true; weightedTotal: number; signal: string; status: string }>(
    `/api/decks/${id}/evaluate`,
    { scores, remarks },
  );
}

/** Advance a shortlisted/intro deck to Signup and send the (stubbed) invite. */
export function sendSignup(id: string) {
  return postJson<{ ok: true; status: string }>(`/api/decks/${id}/send-signup`);
}

export interface QueryView {
  id: string;
  deck_id: string;
  questions: string;
  email_status: string;
  founder_response: string | null;
  created_at: string;
  resolved_at: string | null;
}

export function listQueries(id: string): Promise<{ queries: QueryView[] }> {
  return fetch(`/api/decks/${id}/queries`).then((r) => json(r));
}

export function createQuery(id: string, questions: string) {
  return postJson<{ ok: true; queryId: string; emailStatus: string }>(
    `/api/decks/${id}/queries`,
    { questions },
  );
}

export function respondQuery(queryId: string, response: string) {
  return postJson<{ ok: true; status: string }>(`/api/queries/${queryId}/respond`, { response });
}

export interface PipelineEvent {
  id: string;
  fromStage: string | null;
  fromLabel: string | null;
  toStage: string;
  toLabel: string;
  action: string;
  note: string | null;
  actorName: string;
  createdAt: string;
}

export function getDeckEvents(id: string): Promise<{ events: PipelineEvent[] }> {
  return fetch(`/api/decks/${id}/events`).then((r) => json(r));
}

export interface JuryMember {
  id: string;
  name: string;
  initials: string;
}

export function listJury(): Promise<{ jury: JuryMember[] }> {
  return fetch("/api/jury").then((r) => json(r));
}

export interface RubricParameter {
  key: string;
  name: string;
  weight: number;
}

export function listParameters(): Promise<{ parameters: RubricParameter[] }> {
  return fetch("/api/parameters").then((r) => json(r));
}

/** The caller's own saved human scores for a deck (prefills the scoring form). */
export function getMyScores(id: string): Promise<{ scores: { key: string; value: number }[] }> {
  return fetch(`/api/decks/${id}/my-scores`).then((r) => json(r));
}

// ── Phase 5 — VC pipeline ─────────────────────────────────────────────────────

export type IcVoteValue = "invest" | "hold" | "need_more_info" | "pass";

/** Human-readable labels for the four IC vote options. */
export const IC_VOTE_LABELS: Record<IcVoteValue, string> = {
  invest: "Invest",
  hold: "Hold",
  need_more_info: "Need more info",
  pass: "Pass",
};

export interface IcVote {
  id: string;
  memberId: string;
  memberName: string;
  vote: IcVoteValue;
  comment: string | null;
  createdAt: string;
}

export interface IcVotes {
  votes: IcVote[];
  tally: Record<IcVoteValue, number>;
  total: number;
  recommendation: IcVoteValue | null;
  myVote: IcVoteValue | null;
}

export function listIcVotes(id: string): Promise<IcVotes> {
  return fetch(`/api/decks/${id}/ic-votes`).then((r) => json(r));
}

/** Cast (or replace) this IC member's vote on a deck in IC review. */
export function castIcVote(id: string, vote: IcVoteValue, comment?: string) {
  return postJson<{ ok: true; vote: IcVoteValue }>(`/api/decks/${id}/ic-vote`, { vote, comment });
}
