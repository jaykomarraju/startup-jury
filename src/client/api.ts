// Typed fetch helpers for the deck API. All requests are same-origin and carry
// the session cookie automatically.
import type { DeckView } from "./types";
import type { ExtractionSlide, ParamScoreView } from "./components";
import type { Plan } from "../shared/plans";
import type {
  FunnelReport,
  CohortSummary,
  EvaluatorReport,
  DriftReport,
  ScoringSummary,
  CapitalReport,
  PortfolioReport,
  DecisionReport,
} from "../shared/analytics";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`request failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export function listDecks(filter?: { programId?: string; cohortId?: string }): Promise<{ decks: DeckView[] }> {
  const qs = new URLSearchParams();
  if (filter?.programId) qs.set("programId", filter.programId);
  if (filter?.cohortId) qs.set("cohortId", filter.cohortId);
  const q = qs.toString();
  return fetch(`/api/decks${q ? `?${q}` : ""}`).then((r) => json(r));
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

export interface RescoreResult {
  weightedTotal: number;
  signal: string;
  status: string;
  gatePassed: boolean;
}

/** Outcome of a re-score request. The guard blocks a needless re-run (nothing
 *  changed) with `already_scored`, which the workbench surfaces as an alert. */
export type RescoreOutcome =
  | { ok: true; result: RescoreResult }
  | { ok: false; reason: "already_scored" | "no_pdf" | "evaluation_failed" | "forbidden" | "error" };

export async function rescoreDeck(id: string): Promise<RescoreOutcome> {
  const res = await fetch(`/api/decks/${id}/rescore`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (res.ok) {
    const body = (await res.json()) as { result: RescoreResult };
    return { ok: true, result: body.result };
  }
  if (res.status === 403) return { ok: false, reason: "forbidden" };
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (body.error === "already_scored" || body.error === "no_pdf" || body.error === "evaluation_failed") {
    return { ok: false, reason: body.error };
  }
  return { ok: false, reason: "error" };
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
  /** Additional / role-scoped param (assistive, not in the composite). */
  informational?: boolean;
  /** The role that owns an additional param. */
  roleScope?: string;
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

// ── Phase 6 — Config, plans & credits ─────────────────────────────────────────

export interface ConfigParam {
  id: string;
  key: string;
  name: string;
  weight: number;
  informational: boolean;
  roleScope?: string;
  /** Configurable AI extraction prompt (additional params). */
  prompt?: string;
}

/** Safe read subset available to any authed user (dashboard rail + My Params). */
export interface ConfigSummary {
  plan: Plan;
  /** Configuring the core 13 weights is unlocked (Pro+). */
  coreConfigEnabled: boolean;
  /** Configuring the role-scoped additional params is unlocked (Premium). */
  additionalEnabled: boolean;
  thresholdBest: number;
  thresholdMediocre: number;
  branding: Record<string, unknown>;
  coreParams: ConfigParam[];
  additionalParams: ConfigParam[];
}

export function getConfigSummary(): Promise<ConfigSummary> {
  return fetch("/api/config/summary").then((r) => json(r));
}

/** Full admin settings (adds the AI prompt + credits balance). */
export interface FullConfig extends ConfigSummary {
  creditsBalance: number;
  aiSystemPrompt: string;
}

export function getConfig(): Promise<FullConfig> {
  return fetch("/api/config").then((r) => json(r));
}

function putJson<T>(path: string, body: unknown): Promise<T> {
  return fetch(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => json<T>(r));
}

export interface WeightUpdate {
  id: string;
  weight: number;
  name?: string;
}

/** Update core parameter weights — the server re-scores the whole edition. */
export function updateWeights(params: WeightUpdate[]) {
  return putJson<{ ok: true; rescored: { decks: number; evaluations: number }; coreParams: ConfigParam[] }>(
    "/api/config/parameters",
    { params },
  );
}

export function updateThresholds(best: number, mediocre: number) {
  return putJson<{ ok: true; thresholdBest: number; thresholdMediocre: number }>(
    "/api/config/thresholds",
    { best, mediocre },
  );
}

export function updateAiPrompt(prompt: string) {
  return putJson<{ ok: true; aiSystemPrompt: string }>("/api/config/ai-prompt", { prompt });
}

export function updateBranding(branding: Record<string, unknown>) {
  return putJson<{ ok: true; branding: Record<string, unknown> }>("/api/config/branding", { branding });
}

export function updatePlan(plan: Plan) {
  return putJson<{ ok: true; plan: Plan; additionalEnabled: boolean }>("/api/config/plan", { plan });
}

export function updateCredits(credits: number) {
  return postJson<{ ok: true; creditsBalance: number }>("/api/config/credits", { credits });
}

/** Buy a credit pack (simulated demo top-up — adds credits, no real payment). */
export function purchaseCredits(credits: number) {
  return postJson<{ ok: true; purchased: number; creditsBalance: number }>(
    "/api/config/credits/purchase",
    { credits },
  );
}

/** Add a role-scoped additional param (Premium; ≤3 per role). */
export function addAdditionalParam(name: string, roleScope: string, prompt?: string) {
  return postJson<{ ok: true; param: ConfigParam }>("/api/config/additional-params", {
    name,
    roleScope,
    prompt,
  });
}

/** Rename an additional param and/or edit its configurable AI prompt. */
export function updateAdditionalParam(
  id: string,
  patch: { name?: string; prompt?: string | null },
) {
  return putJson<{ ok: true; param: { id: string; name: string; prompt?: string } }>(
    `/api/config/additional-params/${id}`,
    patch,
  );
}

export function deleteAdditionalParam(id: string) {
  return fetch(`/api/config/additional-params/${id}`, { method: "DELETE" }).then((r) =>
    json<{ ok: true }>(r),
  );
}

// ── Session 2 — Program & Cohort hierarchy ────────────────────────────────────

export interface CohortView {
  id: string;
  programId: string;
  name: string;
  startsOn?: string;
  endsOn?: string;
  active: boolean;
}
export interface ProgramView {
  id: string;
  name: string;
  sector?: string;
  description?: string;
  fundSize?: number;
  fundAllocated?: number;
  capitalDeployed?: number;
  /** The Program Manager who leads this program (owner-scoped cohort management). */
  ownerId?: string;
  active: boolean;
  cohorts: CohortView[];
}
export interface SectorView {
  id: string;
  name: string;
  active: boolean;
}
export interface ProgramsResponse {
  sectors: SectorView[];
  programs: ProgramView[];
}

export function listPrograms(all = false): Promise<ProgramsResponse> {
  return fetch(`/api/programs${all ? "?all=1" : ""}`).then((r) => json(r));
}

export interface ProgramInput {
  name: string;
  sector?: string;
  description?: string;
  fundSize?: number | null;
  fundAllocated?: number | null;
  capitalDeployed?: number | null;
}
export function createProgram(input: ProgramInput) {
  return postJson<{ ok: true; program: ProgramView }>("/api/programs", input);
}
export function updateProgram(id: string, input: Partial<ProgramInput> & { active?: boolean }) {
  return putJson<{ ok: true; program: ProgramView }>(`/api/programs/${id}`, input);
}
export function deleteProgram(id: string) {
  return fetch(`/api/programs/${id}`, { method: "DELETE" }).then((r) => json<{ ok: true }>(r));
}
export function createCohort(programId: string, input: { name: string; startsOn?: string; endsOn?: string }) {
  return postJson<{ ok: true; cohort: CohortView }>(`/api/programs/${programId}/cohorts`, input);
}
export function updateCohort(
  cohortId: string,
  input: { name?: string; startsOn?: string; endsOn?: string; active?: boolean },
) {
  return putJson<{ ok: true; cohort: CohortView }>(`/api/programs/cohorts/${cohortId}`, input);
}
export function deleteCohort(cohortId: string) {
  return fetch(`/api/programs/cohorts/${cohortId}`, { method: "DELETE" }).then((r) => json<{ ok: true }>(r));
}
export function createSector(name: string) {
  return postJson<{ ok: true; sector: SectorView }>("/api/programs/sectors", { name });
}
export function deleteSector(id: string) {
  return fetch(`/api/programs/sectors/${id}`, { method: "DELETE" }).then((r) => json<{ ok: true }>(r));
}

// ── Session 4 — User management (Admin console) ───────────────────────────────

export interface UserView {
  id: string;
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  /** 'staff' | 'mentor' — mentor is a directory user-type, not a pipeline role. */
  userType: string;
  initials: string;
  active: boolean;
}

export function listUsers(): Promise<{ users: UserView[] }> {
  return fetch("/api/users").then((r) => json(r));
}

export interface CreateUserInput {
  name: string;
  email: string;
  /** Required for a staff member; ignored for a mentor. */
  role?: string;
  /** 'staff' (default) or 'mentor'. */
  userType?: "staff" | "mentor";
}

/** Create a team member or mentor. Returns the created user + a one-time
 *  temporary password for the admin to relay. */
export function createUser(input: CreateUserInput) {
  return postJson<{ ok: true; tempPassword: string; user: UserView }>("/api/users", input);
}

/** Update a user's active flag, name, or role (staff only for re-roling). */
export function updateUser(
  id: string,
  patch: { active?: boolean; role?: string; name?: string },
): Promise<{ ok: true; user: UserView }> {
  return fetch(`/api/users/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  }).then((r) => json(r));
}

// ── Phase 7 — Analytics ───────────────────────────────────────────────────────

export type {
  FunnelReport,
  CohortSummary,
  EvaluatorReport,
  DriftReport,
  ScoringSummary,
  CapitalReport,
  PortfolioReport,
  DecisionReport,
} from "../shared/analytics";

export const getFunnel = () => fetch("/api/analytics/funnel").then((r) => json<FunnelReport>(r));
export const getCohortSummary = () => fetch("/api/analytics/cohort").then((r) => json<CohortSummary>(r));
export const getEvaluatorScores = () => fetch("/api/analytics/evaluators").then((r) => json<EvaluatorReport>(r));
export const getScoreDrift = () => fetch("/api/analytics/drift").then((r) => json<DriftReport>(r));
export const getScoringSummary = () => fetch("/api/analytics/scoring").then((r) => json<ScoringSummary>(r));
export const getCapital = () => fetch("/api/analytics/capital").then((r) => json<CapitalReport>(r));
export const getPortfolio = () => fetch("/api/analytics/portfolio").then((r) => json<PortfolioReport>(r));
export const getDecisions = () => fetch("/api/analytics/decisions").then((r) => json<DecisionReport>(r));

export interface DiligenceReport {
  inDiligence: number;
  redFlags: number;
  clarifications: number;
  onTrack: number;
  items: Array<{ company: string; stage: string; signal: string | null; status: string }>;
  flags: Array<{ company: string; flag: string }>;
}
export const getDiligence = () => fetch("/api/analytics/diligence").then((r) => json<DiligenceReport>(r));

// Jury-personal reports.
export interface MyDecksReport {
  evaluated: number;
  avgGiven: number;
  shortlisted: number;
  pending: number;
  decks: Array<{ id: string; name: string; status: string; score: number }>;
}
export const getMyDecks = () => fetch("/api/analytics/my/decks").then((r) => json<MyDecksReport>(r));

export interface MyScoresReport {
  rows: Array<{ id: string; name: string; ai: number | null; mine: number }>;
}
export const getMyReportScores = () => fetch("/api/analytics/my/scores").then((r) => json<MyScoresReport>(r));

export const getMyDrift = () => fetch("/api/analytics/my/drift").then((r) => json<DriftReport>(r));

// ── Phase 7 — Tickets & Contact ───────────────────────────────────────────────

export interface Ticket {
  id: string;
  subject: string;
  body: string | null;
  status: string;
  billingRouted: boolean;
  createdAt: string;
  creator: string;
}
export const listTickets = () => fetch("/api/tickets").then((r) => json<{ tickets: Ticket[] }>(r));
export const createTicket = (subject: string, body: string, billing: boolean) =>
  postJson<{ ok: true; id: string; billingRouted: boolean }>("/api/tickets", { subject, body, billing });
export const setTicketStatus = (id: string, status: "open" | "closed") =>
  postJson<{ ok: true; status: string }>(`/api/tickets/${id}/status`, { status });

export interface ContactMessage {
  id: string;
  body: string;
  toScope: string;
  createdAt: string;
  sender: string;
}
export const listMessages = (scope: "admin" | "team") =>
  fetch(`/api/messages?scope=${scope}`).then((r) => json<{ messages: ContactMessage[]; inbox: boolean }>(r));
export const sendMessage = (toScope: "admin" | "team", body: string) =>
  postJson<{ ok: true; id: string }>("/api/messages", { toScope, body });
