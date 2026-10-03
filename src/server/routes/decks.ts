// Deck routes: list + detail (Review-decks + Evaluation-report data), single
// upload (R2 → direct AI evaluation), and bulk upload (R2 → Queue). Uploads are
// PDF-only; each deck's PDF lives at `decks/<id>.pdf` in the DECKS bucket.

import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv, SessionUser } from "../types";
import type { Edition, Role } from "../../shared/roles";
import { evaluationRank, isAssignableEvaluator, roleLabel } from "../../shared/roles";
import { canSeeEvaluatorScoresIn } from "../../shared/scoreVisibility";
import { getStage, allowedTransitions } from "../../pipeline";
import {
  aiWeightFor,
  decisionScore,
  shortlistFloor,
  withholdsAiScore,
  WEAK_SIGNAL_MAX,
  type ScoringSettings,
} from "../../shared/scoring";
import { loadScoringSettings } from "../config/scoringSettings";
import { loadScoreVisibility } from "../config/scoreVisibility";
import { missingIntakeFields, parseMissingFields, type IntakeMatch } from "../../shared/intake";
// V3-DASH — one timestamp comparison, shared with the Dashboard that reads it.
// `ratingAtOrAboveGate` / `isAllocatedDeck` are the AI gate's `?list=assign`
// post-filter (tester issue 8): the predicates come from the status vocabulary
// that already owns them, never re-written as `score < gate` at the call site.
// `deckComplete` / `contactComplete` are that same vocabulary's first two
// checks, and they narrow both rosters for the client's 2026-10-02 flow — see
// `screened` below for why they, and not `isDeckComplete`.
import {
  contactComplete,
  deckComplete,
  isAllocatedDeck,
  latestTimestamp,
  ratingAtOrAboveGate,
} from "../../shared/deckStats";
// V4-ROUTE — the Assign/Query partition (items 6, 7). The list route enforces
// it so it holds however the deck got to its stage, not just when a screen asks.
import { deckListRoute, type DeckListRoute } from "../../shared/queries";
import { denyMentor, requireAuth, requireTask } from "../auth/middleware";
import { detectIntakeFlags, intakeFlagStatement, resolveIntakeContext } from "../intake";
import { emitNotification } from "../email/outbox";
import { evaluateDeck } from "../ai/evaluate";
// W7-D — incubator spec §8.4: which role sections the report carries.
import { parseReportStage, reportLayout } from "../../shared/reportStage";
import {
  classifyEvalError,
  clearEvalFailure,
  markEvalTerminal,
  recordEvalFailure,
  summariseError,
} from "../ai/health";
import {
  addDeckVersion,
  isPdf,
  versionKey,
  versionStatement,
  MAX_PDF_BYTES,
  reserveCredits as reserveEditionCredits,
  refundCredits as refundEditionCredits,
} from "../decks/versions";
// P0-1 — the one answer to "is this person assigned?" (`decks.assigned_to` UNION
// `deck_assignments`). Read the union, never the join table alone.
import { ASSIGNEE_PAIRS_SQL } from "../decks/assignments";
// T1-DECKS — the ONE scope helper (T0-SCHEMA). `scopeOf(user)` is the only way a
// scope is built, so a predicate can never take its key from the browser; `scoped()`
// carries each fragment and its binds together; `viaParent` reads the ownership path
// out of `TENANT_OWNER` so "what owns `scores`?" is answered once, in that file, and
// not at each of the 61 `FROM decks` sites in this one.
import { scopeOf, scoped, insertScope } from "../../shared/tenant";

const decks = new Hono<AppEnv>();
// The deck pipeline is staff-only: a mentor is a directory record, not an
// actor, so it never reaches the listing, a deck's report or its PDF.
decks.use("*", requireAuth, denyMentor);

// The deck columns every view selects. Kept in one place because the list, the
// detail report and the version endpoints all need the Session-5 intake columns.
const DECK_COLUMNS =
  "d.id, d.name, d.sector, d.stage, d.city, d.founder, d.founder_email, d.founder_phone, " +
  "d.missing_fields, d.intake_flag, d.intake_flag_note, d.related_deck_id, d.content_version, " +
  // V4-ROUTE — the complete/incomplete mark itself. It was written by the AI
  // path and selected by nothing, so no screen could route on it.
  "d.complete, " +
  // S1-DASH (0075) — the model's own verdict, un-ANDed. `complete` says
  // whether the deck may be assigned; this says WHICH of the two things is
  // wrong when it may not, which is the whole of item 3.
  "d.ai_complete, " +
  "d.ai_score, d.signal, d.status, d.assigned_to, d.ai_error, d.ai_attempts, d.ai_failed_at, " +
  "d.tags, d.created_at, d.updated_at";

// Joined columns: the assignee's name, the program's shortlist floor, and the mean
// of this deck's human evaluations (the other half of the decision score).
//
// T1-DECKS — every join to a TENANT-KEYED table also matches `d.tenant_id`. These
// are LEFT joins on ids that belong to the scoped deck, so they are already
// unreachable from another customer unless a column drifted; the extra condition
// makes a drifted id render NULL rather than the other customer's name, and it
// costs no bind (column = column), so it cannot disturb bind order at the 7 call
// sites that interpolate this string. `cohorts` and `deck_onboarding` carry no
// tenant column of their own — they are reached through `programs` and `d.id`.
const DECK_JOINS =
  "LEFT JOIN users u ON u.id = d.assigned_to AND u.tenant_id = d.tenant_id " +
  "LEFT JOIN programs pr ON pr.id = d.program_id AND pr.tenant_id = d.tenant_id " +
  // NOT also `AND co.program_id = pr.id`: a deck may carry a cohort with its
  // programme column unset, and that condition would silently drop the cohort
  // name. `cohorts` is owned through `programs` (TENANT_OWNER) and the id comes
  // off the scoped deck row.
  "LEFT JOIN cohorts co ON co.id = d.cohort_id " +
  // Aug-2026 issues 29/30 — sign-up + curation state for the pipeline screens.
  "LEFT JOIN deck_onboarding ob ON ob.deck_id = d.id " +
  "LEFT JOIN users lead ON lead.id = ob.lead_user_id AND lead.tenant_id = d.tenant_id";
//
// ── T1-DECKS · WHY NONE OF THE SUBQUERIES BELOW CARRIES A TENANT PREDICATE ────
// Every one of them is CORRELATED on `d.id` — `WHERE pe.deck_id = d.id`,
// `WHERE s.deck_id = d.id`, and so on — and `d` is scoped by the caller at all
// seven sites that interpolate this string. The correlation IS the scope: a row in
// another customer's `pipeline_events` has a `deck_id` that no scoped `d.id` can
// equal, so there is nothing for a predicate to exclude.
//
// This is NOT the §5b exemption being claimed loosely. §5b's hazard is a child read
// in its own statement, relying on a parent check one FRAME up — a guard that can be
// rearranged away. These are in the same statement as their parent and cannot be
// separated from it; adding `pe.tenant_id` would not even compile, because
// `pipeline_events` has no such column, and routing each through `viaParent` would
// emit twelve more `JOIN decks` for no change in the result set.
//
// If any of these is ever lifted OUT of this string into a statement of its own, it
// stops being correlated and MUST take `viaParent`. That is the line.
const DECK_DERIVED =
  "u.name AS assigned_to_name, pr.shortlist_min AS shortlist_min, " +
  "pr.name AS program_name, co.name AS cohort_name, " +
  // V4-WEIGHT (0074) — the split this deck's blend uses. NULL at both
  // levels means it follows the organisation's `ai_weight_pct`, which is
  // every deck that predates the column.
  "pr.ai_weight_pct AS program_ai_weight_pct, co.ai_weight_pct AS cohort_ai_weight_pct, " +
  "(SELECT AVG(e.weighted_total) FROM evaluations e WHERE e.deck_id = d.id AND e.evaluator_id IS NOT NULL) AS human_avg, " +
  // Aug-2026 issues 16/17 — the Query screen's "Parameters needing response" /
  // "Areas requiring response". Core areas the AI scored in the rubric's Weak
  // or Insufficient band, plus the deck sections the extraction found absent.
  //
  // W2-A / F0042 — this used to read `org_settings.threshold_mediocre`, the
  // admin-tunable COHORT rating threshold, so raising "Poor — below" to
  // re-bucket the All Decks overview silently widened which parameters a
  // founder was questioned about. Two unrelated scales; this is the rubric one
  // (`WEAK_SIGNAL_MAX` in shared/scoring.ts, specs §7: 3–4 Weak, 0–2
  // Insufficient). The cohort thresholds keep doing cohort rating only.
  `(SELECT GROUP_CONCAT(p.name, '||') FROM scores s JOIN parameters p ON p.id = s.parameter_id ` +
  "  WHERE s.deck_id = d.id AND s.evaluator_kind = 'ai' AND p.informational = 0 " +
  `    AND s.value < ${WEAK_SIGNAL_MAX}) AS weak_areas, ` +
  "(SELECT GROUP_CONCAT(e.label, '||') FROM deck_extractions e WHERE e.deck_id = d.id AND e.missing = 1) AS missing_sections, " +
  // Aug-2026 issue 25 — the Jury Pipeline's "Assigned date" and whether the
  // assignee has actually submitted their evaluation yet.
  "(SELECT MAX(pe.created_at) FROM pipeline_events pe WHERE pe.deck_id = d.id AND pe.action = 'assign_jury') AS assigned_at, " +
  "(SELECT COUNT(*) FROM evaluations ev WHERE ev.deck_id = d.id AND ev.evaluator_id IS NOT NULL AND ev.evaluator_id = d.assigned_to) AS assignee_submitted, " +
  // V3-DASH — the Dashboard's "· 2h ago" row clock, and the sort it drives.
  // The list is ordered by recent ACTIVITY, not by upload date, so the newest
  // thing that happened to the deck is needed: its last pipeline event, folded
  // against the deck's own `updated_at` in `toDeckView` (the two columns are
  // written in different timestamp formats, so SQL MAX() cannot compare them —
  // see `latestTimestamp`).
  "(SELECT MAX(pe.created_at) FROM pipeline_events pe WHERE pe.deck_id = d.id) AS last_event_at, " +
  // V3-DASH — the row's `.ad-tag.q` "Queried" tag: a clarification letter has
  // been raised on this deck at least once.
  "(SELECT COUNT(*) FROM queries qq WHERE qq.deck_id = d.id) AS query_count, " +
  // 21-Sep item 6 — the "Contact Details Edited" chip's source. The most recent
  // contact correction on this deck, written by `PATCH /api/decks/:id`.
  "(SELECT MAX(pe.created_at) FROM pipeline_events pe WHERE pe.deck_id = d.id AND pe.action = 'edit_contact') AS contact_edited_at, " +
  // Screening row 7 — **the Send-to-Assign marker**, and the ONLY authority for
  // the `AI Evaluated, Assigned` sink. Same shape as `edit_contact` directly
  // above: a `pipeline_events` row with `from_stage === to_stage`, so it is a
  // record of a CLICK and not a transition, and so the `exit_*` columns below
  // (which select on `to_stage IN ('rejected','archived')`) can never see it.
  //
  // Deliberately NOT the `assigned` stage. `POST /decks/:id/transition` will
  // move a deck to `assigned` with `assigned_to` still NULL, which is precisely
  // the shape the client filed as his row 12 Foul ("startups without any decks,
  // assigned to Jury"). His Send-to-Assign row and his row 12 pull in opposite
  // directions; the marker is what satisfies both — the deck latches and joins
  // the Assign roster, and `assigned_to` keeps meaning a real evaluator.
  "(SELECT MAX(pe.created_at) FROM pipeline_events pe WHERE pe.deck_id = d.id AND pe.action = 'send_to_assign') AS send_to_assign_at, " +
  // Oct-2026 issue 5 — how many times the AI has evaluated this deck, which is
  // the whole of "it should say reevaluated". `ai/evaluate.ts` writes one of
  // these per run under a fresh id and nothing deletes them, so COUNT is the
  // run counter. The deck's own `evaluations` row is NOT: evaluate.ts:1052
  // deletes it and re-inserts under the fixed id `${deckId}_ai_eval`, so that
  // table shows one AI row however often the model has looked.
  "(SELECT COUNT(*) FROM pipeline_events pe WHERE pe.deck_id = d.id AND pe.action = 'ai_evaluated') AS ai_eval_count, " +
  // The client's own open item ("queried but the founder never responds").
  // `query_count` above collapses the whole history to a boolean, which throws
  // away exactly the two things the rule needs: WHEN the last letter went out,
  // and whether it was answered. `queryStatusOf` (`shared/queries.ts`) already
  // owns the five-working-day rule; these two columns are what let it run on a
  // deck row instead of on a fetched query list.
  "(SELECT qq.created_at FROM queries qq WHERE qq.deck_id = d.id ORDER BY qq.created_at DESC, qq.rowid DESC LIMIT 1) AS last_query_at, " +
  "(SELECT CASE WHEN qq.founder_response IS NULL OR qq.founder_response = '' THEN 0 ELSE 1 END FROM queries qq " +
  "   WHERE qq.deck_id = d.id ORDER BY qq.created_at DESC, qq.rowid DESC LIMIT 1) AS last_query_answered, " +
  // W7-E — every evaluator on the deck (migration 0058), first assignee included.
  "(SELECT GROUP_CONCAT(da.evaluator_id, '||') FROM deck_assignments da WHERE da.deck_id = d.id) AS assignee_ids, " +
  // Issue 27/29 — the intro call's schedule + status.
  "(SELECT ca.scheduled_at FROM calls ca WHERE ca.deck_id = d.id AND ca.status != 'cancelled' ORDER BY ca.scheduled_at DESC LIMIT 1) AS call_at, " +
  "(SELECT ca.status FROM calls ca WHERE ca.deck_id = d.id AND ca.status != 'cancelled' ORDER BY ca.scheduled_at DESC LIMIT 1) AS call_status, " +
  // Issue 31 — how, when and by whom the startup left the active pipeline.
  "(SELECT pe.from_stage FROM pipeline_events pe WHERE pe.deck_id = d.id AND pe.to_stage IN ('rejected', 'archived') ORDER BY pe.created_at DESC, pe.rowid DESC LIMIT 1) AS exit_from, " +
  "(SELECT pe.action FROM pipeline_events pe WHERE pe.deck_id = d.id AND pe.to_stage IN ('rejected', 'archived') ORDER BY pe.created_at DESC, pe.rowid DESC LIMIT 1) AS exit_action, " +
  "(SELECT pe.note FROM pipeline_events pe WHERE pe.deck_id = d.id AND pe.to_stage IN ('rejected', 'archived') ORDER BY pe.created_at DESC, pe.rowid DESC LIMIT 1) AS exit_note, " +
  "(SELECT pe.created_at FROM pipeline_events pe WHERE pe.deck_id = d.id AND pe.to_stage IN ('rejected', 'archived') ORDER BY pe.created_at DESC, pe.rowid DESC LIMIT 1) AS exit_at, " +
  "(SELECT au.name FROM pipeline_events pe LEFT JOIN users au ON au.id = pe.actor_id WHERE pe.deck_id = d.id AND pe.to_stage IN ('rejected', 'archived') ORDER BY pe.created_at DESC, pe.rowid DESC LIMIT 1) AS exit_by, " +
  // Issues 29/30 — the onboarding row (may be absent = everything pending).
  "ob.payment_status AS payment_status, ob.documents_status AS documents_status, " +
  "ob.curation_stage AS curation_stage, ob.progress AS onboarding_progress, lead.name AS onboarding_lead";

interface DeckRow {
  id: string;
  name: string;
  sector: string | null;
  stage: string | null;
  city: string | null;
  founder: string | null;
  founder_email: string | null;
  founder_phone: string | null;
  missing_fields: string | null;
  complete?: number | null;
  ai_complete?: number | null;
  intake_flag: string | null;
  intake_flag_note: string | null;
  related_deck_id: string | null;
  content_version: number | null;
  ai_score: number | null;
  signal: string | null;
  status: string;
  ai_error: string | null;
  ai_attempts: number | null;
  ai_failed_at: string | null;
  tags?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  last_event_at?: string | null;
  contact_edited_at?: string | null;
  send_to_assign_at?: string | null;
  ai_eval_count?: number | null;
  last_query_at?: string | null;
  last_query_answered?: number | null;
  query_count?: number | null;
  assigned_to?: string | null;
  assigned_to_name?: string | null;
  program_name?: string | null;
  cohort_name?: string | null;
  program_ai_weight_pct?: number | null;
  cohort_ai_weight_pct?: number | null;
  shortlist_min?: number | null;
  human_avg?: number | null;
  weak_areas?: string | null;
  missing_sections?: string | null;
  assigned_at?: string | null;
  assignee_submitted?: number | null;
  assignee_ids?: string | null;
  call_at?: string | null;
  call_status?: string | null;
  exit_from?: string | null;
  exit_action?: string | null;
  exit_note?: string | null;
  exit_at?: string | null;
  exit_by?: string | null;
  payment_status?: string | null;
  documents_status?: string | null;
  curation_stage?: string | null;
  onboarding_progress?: number | null;
  onboarding_lead?: string | null;
}

export type AiState = "ok" | "in_progress" | "retrying" | "failed";

/** Where a deck actually is in the AI pipeline, as opposed to what it says. */
function aiStateOf(row: DeckRow): AiState {
  if (row.status !== "pending_ai") return "ok";
  if (row.ai_failed_at) return "failed";
  return row.ai_error ? "retrying" : "in_progress";
}

function statusLabel(edition: Edition, status: string): string {
  return getStage(edition, status)?.label ?? status;
}

/** Transitions the current role may perform from a deck's stage (action buttons). */
function actionsFor(edition: Edition, status: string, role: Role) {
  return allowedTransitions(edition, status, role).map((t) => ({
    action: t.action,
    label: t.label,
    to: t.to,
  }));
}

/** Split a GROUP_CONCAT('||') column into a list, de-duped and in order. */
function splitList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split("||")) {
    const t = part.trim();
    if (t) seen.add(t);
  }
  return [...seen];
}

/** At most this many tags per deck, each at most this long. */
const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 24;

/** `decks.tags` is a JSON array of strings; anything else reads as no tags. */
export function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t): t is string => typeof t === "string");
  } catch {
    return [];
  }
}

/** Normalise a submitted tag list: trimmed, lowercased, de-duped, bounded. */
export function normaliseTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim().replace(/\s+/g, " ").toLowerCase().slice(0, MAX_TAG_LENGTH);
    if (!tag || out.includes(tag)) continue;
    out.push(tag);
    if (out.length === MAX_TAGS) break;
  }
  return out;
}

/** The two scoring-framework values the shortlist hint is judged by. */
type ShortlistSettings = Pick<ScoringSettings, "aiWeightPct" | "shortlistThreshold">;

/**
 * The shortlist hint on a deck view — the SAME judgement the shortlist check in
 * `routes/pipeline.ts` enforces on the transition, at the same split and against
 * the same floor.
 *
 * Wave 2 integration §9, closed by `W7-A`: this used to call `decisionScore`
 * without its third argument, so the hint blended AI and jury at the DEFAULT
 * 50/50 while the transition blended at the org's configured `ai_weight_pct`
 * (40/60 as shipped). It also compared against the programme floor only, while
 * the transition falls back to the org-wide shortlist threshold. A deck could
 * render as shortlistable and then be refused. `scoring` is required, not
 * defaulted, so a new call site cannot quietly reintroduce the default split.
 * Pinned by `test/worker/alldecks-shortlist-hint.test.ts`.
 */
function shortlistHint(row: DeckRow, scoring: ShortlistSettings) {
  // V4-WEIGHT (0074): the split is the deck's OWN — its cohort's, else its
  // programme's, else the organisation's. Resolved here rather than at the
  // call sites for the same reason the third argument above is required: one
  // place decides which weight a deck is judged at.
  const weight = aiWeightFor(
    row.cohort_ai_weight_pct,
    row.program_ai_weight_pct,
    scoring.aiWeightPct,
  );
  const decision = decisionScore(
    row.ai_score,
    typeof row.human_avg === "number" ? [row.human_avg] : [],
    weight.pct,
  );
  const { minimum, source } = shortlistFloor(row.shortlist_min, scoring.shortlistThreshold);
  // Unscored: only a floor a PROGRAMME set blocks (pipeline.ts, and plan §8).
  const blocked = decision === null ? source === "program" : decision < minimum;
  return { decision, blocked, weight };
}

function toDeckView(edition: Edition, row: DeckRow, role: Role, scoring: ShortlistSettings) {
  const missingFields = parseMissingFields(row.missing_fields);
  // The number a shortlist decision is judged on — the composite form of the
  // workbench's AI · My · Average column (see shared/scoring.ts decisionScore).
  const { decision, blocked, weight } = shortlistHint(row, scoring);
  const shortlistMin = row.shortlist_min ?? null;
  return {
    id: row.id,
    name: row.name,
    sector: row.sector ?? undefined,
    stage: row.stage ?? undefined,
    city: row.city ?? undefined,
    founder: row.founder ?? undefined,
    founderEmail: row.founder_email ?? undefined,
    founderPhone: row.founder_phone ?? undefined,
    missingFields,
    // V4-ROUTE — `decks.complete`, the AI's own "I could read and score this".
    // Blended with `missingFields` into one mark by `isDeckComplete`.
    complete: row.complete !== 0,
    // S1-DASH (0075) — the un-ANDed verdict behind it. Absent reads as true,
    // matching the column's DEFAULT 1 and `complete`'s own convention.
    aiComplete: row.ai_complete !== 0,
    intakeFlag: (row.intake_flag as "duplicate" | "returning" | null) ?? undefined,
    intakeNote: row.intake_flag_note ?? undefined,
    relatedDeckId: row.related_deck_id ?? undefined,
    contentVersion: row.content_version ?? 1,
    aiScore: row.ai_score ?? undefined,
    decisionScore: decision ?? undefined,
    // Which split produced `decisionScore`, so a screen showing the number can
    // say where it came from instead of implying the org control moved it.
    //
    // NOT for founders. `GET /api/config/scoring` refuses them outright — "the
    // framework tells them nothing they should know about how their deck is
    // judged internally" — and this is a value off that same framework, so
    // sending it on their own deck would route around that refusal. They keep
    // every field they have today; these two are simply absent.
    ...(role === "founder" ? {} : { aiWeightPct: weight.pct, aiWeightSource: weight.source }),
    shortlistMin: shortlistMin ?? undefined,
    // Pre-flagged for the UI so a juror sees the guardrail before clicking; the
    // server re-checks on the transition either way — with the same judgement.
    shortlistBlocked: blocked,
    signal: (row.signal as string | null) ?? undefined,
    status: statusLabel(edition, row.status),
    statusId: row.status,
    // §9: "Pending AI" used to mean both "running" and "permanently stuck".
    // `aiState` is the difference, and `aiError` is the reason the old UI
    // hardcoded as "no AI key configured yet" regardless of what went wrong.
    aiState: aiStateOf(row),
    aiError: classifyEvalError(row.ai_error) ?? undefined,
    aiErrorDetail: row.ai_error ?? undefined,
    aiAttempts: row.ai_attempts ?? 0,
    tags: parseTags(row.tags),
    weakAreas: splitList(row.weak_areas),
    missingSections: splitList(row.missing_sections),
    // Aug-2026 stage-screen columns (issues 25–31).
    juryScore: typeof row.human_avg === "number" ? row.human_avg : undefined,
    assignedAt: row.assigned_at ?? undefined,
    assigneeSubmitted: (row.assignee_submitted ?? 0) > 0,
    callScheduledAt: row.call_at ?? undefined,
    callStatus: row.call_status ?? undefined,
    exitFromLabel: row.exit_from ? statusLabel(edition, row.exit_from) : undefined,
    exitAction: row.exit_action ?? undefined,
    exitNote: row.exit_note ?? undefined,
    exitAt: row.exit_at ?? undefined,
    exitBy: row.exit_by ?? undefined,
    paymentStatus: row.payment_status ?? undefined,
    documentsStatus: row.documents_status ?? undefined,
    curationStage: row.curation_stage ?? undefined,
    onboardingProgress: row.onboarding_progress ?? undefined,
    onboardingLead: row.onboarding_lead ?? undefined,
    uploadedAt: row.created_at ?? undefined,
    // V3-DASH — the Dashboard sorts by this and prints it as "· 2h ago".
    lastActivityAt: latestTimestamp(row.last_event_at, row.updated_at, row.created_at),
    queried: (row.query_count ?? 0) > 0,
    contactEditedAt: row.contact_edited_at ?? undefined,
    // Screening — the three fields `screeningStatus` (`shared/deckStats.ts`)
    // needs and no row carried until now. All derived; no column was added.
    sendToAssignAt: row.send_to_assign_at ?? undefined,
    // Issue 5 — the one field behind the `reevaluated` status word. A number,
    // not a boolean: `screeningStatus` asks "more than once", and a count also
    // lets the row say how many times without a second subquery.
    evaluationRuns: row.ai_eval_count ?? 0,
    lastQueryAt: row.last_query_at ?? undefined,
    // Only meaningful when there IS a last query, and `isQueryUnanswered` reads
    // `queried` first, so a deck with no history simply never asks.
    lastQueryAnswered: (row.last_query_answered ?? 0) > 0,
    assignedTo: row.assigned_to ?? undefined,
    assignedToName: row.assigned_to_name ?? undefined,
    assigneeIds: [...new Set([...(row.assigned_to ? [row.assigned_to] : []), ...splitList(row.assignee_ids)])],
    programName: row.program_name ?? undefined,
    cohortName: row.cohort_name ?? undefined,
    actions: actionsFor(edition, row.status, role),
  };
}

/**
 * Editions where **Query membership is a recorded action** (client feedback
 * row 3), enforced by `GET /api/decks?list=query` above. `undefined` elsewhere
 * means "take `shared/queries.ts`'s own default", so this table adds a reading
 * and never hides one.
 */
const ROW3_RECORDED_QUERY: Record<Edition, boolean> = { incubator: true, vc: false };

/**
 * Editions where the **AI screening gate** narrows `?list=assign` (tester issue
 * 8, 2026-10-01).
 *
 * The client's third check is "Rating >= threshold?", and until this the Assign
 * roster never asked it: five production decks scoring 2.66, 3.19, 4.00, 4.85
 * and 5.25 were all on the Assign list against a configured gate of 5, so the
 * one deck that cleared it sat among four that his own spec sends to Reject.
 *
 * **VC is false and the table is here to say so out loud.** `ASSIGNABLE_STAGES.vc`
 * is empty, so `deckListRoute` can never answer "assign" for a VC deal and the
 * filter is unreachable there by construction — but the VC edition is out of
 * scope by instruction today, and "unreachable by construction" is a property
 * of another file that a reader of this one cannot see. Same shape and same
 * reason as `ROW3_RECORDED_QUERY` above.
 */
const AI_GATE_NARROWS_ASSIGN: Record<Edition, boolean> = { incubator: true, vc: false };

/**
 * Editions where the **first two screening checks** narrow the two rosters
 * (client, 2026-10-02).
 *
 * His flow, verbatim: *"if a deck is incomplete contact details firstly … send
 * to query or send to assign should be not active and also not show up in
 * assign or query screen"* and *"if a deck is incomplete deck (NOT contact
 * details), it should have send to query not send to assign and also not show
 * up in assign screen"*.
 *
 * Same shape and same reason as the two tables above, and the VC arm is false
 * for the same reason: his screening spec is the incubator's, and the edition is
 * out of scope by instruction. On VC the Assign half is unreachable anyway
 * (`ASSIGNABLE_STAGES.vc` is empty) but the QUERY half would not be — VC's own
 * auto-listing rules came from the VC prototype (F0274, F0341) and flipping
 * this for both editions would delete them without his having asked.
 */
const SCREENING_NARROWS_LISTS: Record<Edition, boolean> = { incubator: true, vc: false };

/** `?list=` — the enforced screen list, or the whole table when absent. */
function parseListParam(raw: string | undefined): Exclude<DeckListRoute, null> | null {
  return raw === "assign" || raw === "query" ? raw : null;
}

// ── Row scope: which decks a caller may read at all ──────────────────────────
//
// P0-1 (`docs/plan_roles_incubator.md` §5 and §7). Until this, the only row
// filter on `GET /api/decks` was `role === "founder"`, so a juror's response
// carried EVERY deck in the edition — founder name, email, phone, city, sector,
// tags and stage — and "My Pipeline", "Evaluated" and "My Archive" were client-
// side filters over it. Measured 2026-09-23 as `inc_jury`: 15 decks returned, 7
// actually assigned, 8 of the rest carrying full founder contact.
// `DashboardPage.tsx:899` said so in its own words — "F0193 asks the API to
// scope this; until it does, the screen does". This is the API doing it.
//
// The shape is lifted from `CallsPage.tsx:685`, the one place that already got
// it right — "read-only participants (jury, IC members, analysts) see only the
// decks they're actually on a call for ... plus any they were delegated to
// schedule" — and moved off the screen onto the query, because a screen that
// filters is not a scope.
//
// The union is deliberately the same set those screens already draw, so nothing
// that rendered before this stops rendering:
//   • assigned to them — `ASSIGNEE_PAIRS_SQL`, i.e. `decks.assigned_to` UNION
//     `deck_assignments` (W7-E: a deck can carry several evaluators, and rows
//     written before migration 0058 only have the column);
//   • on a call for the deck — by user id OR by the account's email, the same
//     two halves as `ON_CALL_SQL` in `routes/calls.ts`, which is how §8's
//     "jury/IC members involved in a call can view their calls" is already
//     enforced on `/api/calls`. Without this half the jury's own thirteen-column
//     "My Intro calls" screen loses its rows: it joins the calls listing to THIS
//     response for the AI score, the parameter matrix and the average;
//   • delegated to schedule that deck's call (W9-E, `call_schedulers`).
//
// **Incubator `jury` only.** The VC read-only roles are a different question and
// are deliberately untouched: an IC member's Dashboard pool is a STAGE — "every
// deal that has reached the committee" (`DashboardPage.tsx:915`) — not an
// allocation, so the same clause would change what that screen means. That call
// belongs to whoever scopes the VC lane, not to this one.
const ASSIGNEE_SCOPED_ROLES = ["jury"] as const;

/** Is this caller's read narrowed to their own decks? */
function scopesToOwnDecks(role: Role): boolean {
  return (ASSIGNEE_SCOPED_ROLES as readonly string[]).includes(role);
}

/**
 * The predicate, against the `decks` row aliased `d`. Binds the caller's user id
 * FOUR times, in the order written — see `ownDecksBinds`.
 */
const OWN_DECKS_SQL =
  `(d.id IN (SELECT deck_id FROM (${ASSIGNEE_PAIRS_SQL}) WHERE evaluator_id = ?) ` +
  "OR EXISTS (SELECT 1 FROM calls ca JOIN call_participants cp ON cp.call_id = ca.id " +
  "WHERE ca.deck_id = d.id AND (cp.user_id = ? OR lower(cp.email) = (SELECT lower(email) FROM users WHERE id = ?))) " +
  "OR EXISTS (SELECT 1 FROM call_schedulers cs WHERE cs.deck_id = d.id AND cs.user_id = ?))";

function ownDecksBinds(userId: string): string[] {
  return [userId, userId, userId, userId];
}

/**
 * May this caller read this ONE deck? The by-id reads below (`/:id`,
 * `/:id/report`, `/:id/versions`, `/:id/file`) all resolved any deck in the
 * edition, so scoping the listing alone would have hidden the index and left the
 * same founder contact one request away. Costs a query only for the roles that
 * are actually scoped; everyone else short-circuits.
 */
async function canReadDeck(
  db: D1Database,
  user: SessionUser,
  deckId: string,
): Promise<boolean> {
  if (!scopesToOwnDecks(user.role)) return true;
  // T1-DECKS — the workspace predicate goes on FIRST, so an id from another
  // customer fails here rather than falling through to OWN_DECKS_SQL. It takes the
  // whole `SessionUser` now instead of `role`/`userId`: the previous signature had
  // no way to see the tenant, and threading it as a sixth scalar is how a caller
  // ends up passing the wrong one.
  const q = scoped(scopeOf(user)).on("d").and("d.id = ?", deckId).and(OWN_DECKS_SQL, ...ownDecksBinds(user.id));
  const row = await db
    .prepare(`SELECT 1 AS n FROM decks d ${q.whereClause()}`)
    .bind(...q.binds)
    .first<{ n: number }>();
  return Boolean(row);
}

/**
 * The workspace predicate for ONE deck by id. Not a predicate of its own — it is
 * exactly `scoped(scopeOf(user)).on(alias).and("<alias>.id = ?", id)`, in the order
 * T0's helper emits — but this file does that at eighteen sites, and an eighteen-way
 * copy is how one of them ends up binding `edition` alone again.
 *
 * `alias` defaults to `d` for the SELECTs; UPDATE takes no alias in SQLite, so those
 * callers pass `"decks"` and get the same predicate qualified by the table name,
 * which SQLite accepts in an UPDATE's WHERE (verified).
 */
function oneDeck(user: SessionUser, deckId: string, alias = "d") {
  return scoped(scopeOf(user)).on(alias).and(`${alias}.id = ?`, deckId);
}

/** GET /api/decks — decks in the caller's edition (Review-decks table),
 *  optionally filtered by `programId` / `cohortId` (toolbar filter dropdowns).
 *  Founders are isolated to their own submissions (portal scope).
 *
 *  V4-ROUTE — `?list=assign` / `?list=query` return the Assign roster and the
 *  founder-queries list, partitioned by `deckListRoute` HERE rather than by
 *  each screen's own predicate. One function decides, so a deck marked
 *  incomplete cannot be served to Assign whatever route walked it to its
 *  stage. Without the parameter the response is what it always was — the
 *  Dashboard shows every deck, and removes none. */
decks.get("/", async (c) => {
  const { id, edition, role } = c.var.user;
  const programId = c.req.query("programId");
  const cohortId = c.req.query("cohortId");
  const list = parseListParam(c.req.query("list"));
  // Aug-2026 issue 2 — deck search & tags. `q` matches the startup, founder,
  // sector or city; `tag` narrows to one tag.
  const q = (c.req.query("q") ?? "").trim();
  const tag = (c.req.query("tag") ?? "").trim().toLowerCase();

  // ── THE PREDICATE THIS WHOLE WAVE EXISTS FOR ────────────────────────────────
  // This was `["d.edition = ?"]` and nothing else, and `edition` has two values,
  // so every accelerator shared a bucket: a brand-new second customer with zero
  // decks signed in and saw all 15 of the first customer's, with founder names,
  // emails and phones (`plan_multitenancy.md` §2 B1, "the highest-value data on
  // the platform"). `scoped(scopeOf(user)).on("d")` binds BOTH halves of the
  // workspace key, and `and()` takes each later fragment with its binds so the
  // two cannot drift — which is the mistake a sweep of this size makes.
  const qy = scoped(scopeOf(c.var.user)).on("d");
  if (role === "founder") qy.and("d.uploaded_by = ?", id);
  // P0-1 — a juror's rows are their own allocation plus the calls they are on.
  // See `OWN_DECKS_SQL` above for why this is the API's job and not a screen's.
  if (scopesToOwnDecks(role)) qy.and(OWN_DECKS_SQL, ...ownDecksBinds(id));
  if (programId) qy.and("d.program_id = ?", programId);
  if (cohortId) qy.and("d.cohort_id = ?", cohortId);
  if (q) {
    // LIKE with escaped wildcards — the term is user input, not a pattern. One
    // bound value per column: SQLite's numbered placeholders can't be mixed with
    // the positional `?`s the other clauses use.
    const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    const cols = ["d.name", "d.founder", "d.sector", "d.city", "d.founder_email"];
    qy.and(
      `(${cols.map((col) => `${col} LIKE ? ESCAPE '\\'`).join(" OR ")})`,
      ...cols.map(() => like),
    );
  }
  if (tag) {
    // Tags are stored as a lowercase JSON array, so a quoted substring match is
    // exact per element without needing json_each.
    qy.and("d.tags LIKE ?", `%"${tag.replace(/[%_\\]/g, "")}"%`);
  }

  const sql =
    `SELECT ${DECK_COLUMNS}, ${DECK_DERIVED} FROM decks d ${DECK_JOINS} ` +
    `${qy.whereClause()} ORDER BY d.created_at DESC`;
  const rows = (await c.env.DB.prepare(sql).bind(...qy.binds).all<DeckRow>()).results;

  // Blind scoring has to hold HERE too. `withholdsAiScore` was applied only on
  // GET /api/decks/:id, so with `show_ai_score_to_jury` off a juror still saw the
  // AI score, decision score and signal on All decks — the screen they pass
  // through on the way to scoring. Withholding on the detail route alone does not
  // make scoring independent. Found at Wave 2 integration.
  //
  // Blindness is per (deck, evaluator) and lifts once they have submitted for
  // that deck, so fetch the set they have submitted for rather than blanking the
  // whole list. One extra query, and only when the toggle is actually off.
  const scoring = await loadScoringSettings(c.env.DB, scopeOf(c.var.user));
  // The partition runs on the mapped view, so the server and the screens read
  // the same shape through the same function — never two implementations of it.
  // That property is why `deriveQuery` is passed rather than forked on here:
  // the answer still comes out of `deckListRoute` and there is still one
  // implementation of it.
  //
  // ── ROW 3 · `?list=query` NOW MEANS "QUERIED" ────────────────────────────
  // The client asked that a deck reach the Query screen only when an operator
  // SENDS it there, and his reason is worth keeping where the code is: a deck
  // with incomplete contact details cannot be emailed, for want of contact
  // details. The build derived Query membership instead — `ASSIGNABLE_STAGES ∧
  // ¬isDeckComplete`, plus the flag stages, plus "has areas needing response" —
  // so a deck the AI marked Incomplete was ON the Query list with nobody having
  // decided anything, and the Dashboard armed Send to Query from the same
  // function. That is what made the live defect in `routes/pipeline.ts`
  // reachable: `POST /decks/:id/queries` falls back to a placeholder address
  // when the deck has no founder email, so a deck listed for want of an email
  // could be emailed to `founder@portal.local`. Nothing arms that automatically
  // any more (the path itself is F-FOUL's to close — handed over in the note).
  //
  // The ASSIGN arm is unchanged, and under both readings the two lists still
  // partition. A deck that is incomplete and has not been sent is now on
  // NEITHER list, and it is not lost: the uploaded status screen draws every
  // deck, always — "all decks, including archived, stay on the uploaded status
  // screen", his own display rule.
  //
  // Incubator only, and per edition on purpose (the reasoning is written out on
  // `QUERY_MEMBERSHIP_IS_DERIVED_PENDING_ROW3` in `shared/queries.ts`): his
  // screening spec is the incubator's, and VC's own auto-listing rules came
  // from the VC prototype — F0274, an unflagged deal in analyst scoring is not
  // listed; F0341, five working days. Flipping both editions would delete those
  // without his having asked.
  //
  // ── WHY THIS IS AN OVERRIDE AND NOT THE SHARED DEFAULT (read before "tidying"
  // it into `shared/queries.ts`) ───────────────────────────────────────────────
  // S0-VOCAB shipped the new reading behind that per-edition flag with both arms
  // still `true`, so that the ONE-LINE flip could land with the tests that move
  // with it. Measured in this session, flipping the shared default moves **21
  // tests across three files** — `test/client/queryPage.test.tsx` (14),
  // `test/client/deckHandoff.test.tsx` (6) and `test/client/allDecks.test.tsx`
  // (1) — and all three belong to sessions running in parallel with this one
  // (S2-CHROME and S2-DASH), which are rewriting those same files for the same
  // client feedback. So the SERVER half of row 3 lands here, where its own
  // enforcement is, and the shared default flips with the client half. Both
  // halves still go through `deckListRoute` and there is still exactly one
  // implementation of the rule — which is the property the paragraph above is
  // protecting, and it is not the same thing as one call site.
  const deriveQuery = ROW3_RECORDED_QUERY[edition] ? false : undefined;
  /**
   * ── THE AI GATE, AS A POST-FILTER ON THE ASSIGN ARM (tester issue 8) ──────
   *
   * The client's three checks are deck, contact, then **rating >= threshold**,
   * and only a deck that passes all three is "Complete · Send to Assign".
   * `deckListRoute` asks the first two (through `isDeckComplete`) and has never
   * asked the third, so the Assign roster held every evaluated complete deck
   * whatever it scored — five of them in production this morning, four below
   * the org's gate of 5.
   *
   * **Deliberately NOT a `gate` parameter on `deckListRoute`.** That function is
   * re-entered from inside the STATUS vocabulary (`isQueriedSinkCurrent` ->
   * `isScreeningIncompleteTile` -> `matchesV3Stat`, ~44 references), so a
   * required parameter there would cascade through the tile predicates and
   * change what the six stat boxes mean in order to fix one list. An optional
   * parameter only this call site passes would work, and it would put the rule
   * in the shared function while leaving it off for every other caller — a
   * function whose answer depends on which argument you remembered. The rule
   * belongs where it is ENFORCED, which is the same reasoning the row-3
   * paragraph above gives for `deriveQuery` being an override here.
   *
   * **The gate is skipped on a deck already handed over** (`isAllocatedDeck`:
   * the Send-to-Assign marker, `assigned_to`, or the `assigned` /
   * `jury_evaluation` stages). Column 1 of the Assign screen deliberately keeps
   * allocated rows so a second juror can be added, and a deck scored before the
   * gate was raised — or before it was read at all, which was every deck until
   * today — must not drop off the screen it is already on. It is also exactly
   * `screeningStatus`'s own precedence: the `assigned` sink is answered before
   * the rating check ever runs, so the status vocabulary never calls an
   * allocated deck "Below threshold" and now neither does the list.
   */
  const gated = (v: Parameters<typeof ratingAtOrAboveGate>[0]) =>
    !AI_GATE_NARROWS_ASSIGN[edition] ||
    isAllocatedDeck(v) ||
    ratingAtOrAboveGate(v, scoring.aiGateThreshold);
  /**
   * ── THE FIRST TWO CHECKS, AS A POST-FILTER TOO (client, 2026-10-02) ───────
   *
   * His flow adds LIST MEMBERSHIP to what his §5 action matrix already decided:
   * an incomplete deck is off the Assign roster, and an incomplete CONTACT is
   * off the Query roster as well — "you cannot email a founder you cannot
   * reach", which is the same reason he gave for row 3. The whitelists in
   * `DashboardPage.tsx` already withhold the two handoffs at those statuses;
   * this is the half that was missing, and it is the half a screen cannot fake.
   *
   * **Beside `gated` and not inside `deckListRoute`, for the reason written on
   * `gated` above and measured again here.** That function is re-entered from
   * inside the STATUS vocabulary (`isQueriedSinkCurrent` ->
   * `isScreeningIncompleteTile` -> `matchesV3Stat`, ~44 references), so teaching
   * it the new rule would change what the six stat boxes count in order to fix
   * two lists — and his own display rule is the opposite of that: "all decks,
   * including archived, stay on the uploaded status screen". The tiles must keep
   * counting every deck; only the two rosters narrow.
   *
   * **The axes are `deckComplete` / `contactComplete` from `shared/deckStats.ts`
   * — the STATUS's own two — and deliberately not `isDeckComplete`
   * (`shared/queries.ts`), which `deckListRoute` already applied on the Assign
   * arm.** The two disagree on a real row: `isDeckComplete` reads the frozen
   * ANDed `decks.complete` column, and `POST /api/queries/:id/respond` raises
   * that column to 1 without re-reading the deck and without touching
   * `ai_complete`, so a deck the model never managed to read can carry
   * `complete = 1 ∧ ai_complete = 0`. Archive it, restore it (`archived ->
   * ai_evaluated`, no model run) and it joins the Assign roster while its own
   * Status pill reads "Incomplete decks". Asking the status's axes is what makes
   * "no row on Assign is labelled incomplete" true rather than usually true.
   *
   * **The deck axis narrows ASSIGN ONLY.** `docs/spec_screening_flow.md` §3
   * item 1: a deck whose FILE could not be read keeps Send to Query active and
   * it is that state's only exit, so it stays on the Query roster.
   */
  const screened = (v: Parameters<typeof deckComplete>[0], which: Exclude<DeckListRoute, null>) =>
    !SCREENING_NARROWS_LISTS[edition] ||
    (contactComplete(v) && (which === "query" || deckComplete(v)));
  const routed = <
    V extends Parameters<typeof deckListRoute>[0] &
      Parameters<typeof gated>[0] & { queried?: boolean },
  >(
    views: V[],
  ) =>
    list === null
      ? views
      : views.filter(
          (v) =>
            deckListRoute(v, edition, { queried: v.queried === true, deriveQuery }) === list &&
            screened(v, list) &&
            (list !== "assign" || gated(v)),
        );
  // The partition runs on the UNBLINDED views, which is why the two branches
  // below map first and blank afterwards. Routing is not a visibility question:
  // `ratingAtOrAboveGate` reads an absent score as "not below the gate", so
  // filtering the already-blanked rows would have given a juror mid-blind-scoring
  // a different Assign roster from the PM's.
  const views = rows.map((r) => toDeckView(edition, r, role, scoring));
  if (!withholdsAiScore(scoring, { isEvaluator: isAssignableEvaluator(edition, role), hasSubmitted: false })) {
    return c.json({ decks: routed(views) });
  }
  const submitted = new Set(
    (
      await (() => {
        // `evaluations` has no tenant column: it is owned through its deck
        // (`TENANT_OWNER`), so the scope arrives as a JOIN. The predicate is
        // redundant while `evaluator_id` is the caller's own — but this is one of
        // the 24 `FROM evaluations` sites §5b counted, only 7 of which carried a
        // JOIN, and "redundant here" is exactly the reasoning that leaves the
        // other seventeen unscoped.
        const qs = scoped(scopeOf(c.var.user));
        const joins = qs.viaParent("evaluations", "ev");
        qs.and("ev.evaluator_id = ?", id);
        return c.env.DB.prepare(`SELECT ev.deck_id FROM evaluations ev ${joins} ${qs.whereClause()}`)
          .bind(...qs.binds)
          .all<{ deck_id: string }>();
      })()
    ).results.map((r) => r.deck_id),
  );
  return c.json({
    decks: routed(views).map((view) => {
      if (submitted.has(view.id)) return view;
      return {
        ...view,
        aiScore: undefined,
        decisionScore: undefined,
        signal: undefined,
        shortlistBlocked: false,
        aiScoreWithheld: true as const,
      };
    }),
  });
});

// ── Tags (Aug-2026 issue 2 — search & tag deck facility) ─────────────────────

/** Roles that may re-tag a deck: everyone on the internal team, not founders. */
function canTag(role: Role): boolean {
  return role !== "founder";
}

/** GET /api/decks/tags — every tag in use in the caller's edition, sorted. */
decks.get("/tags", async (c) => {
  // The tag vocabulary is built from deck rows, so an unscoped read publishes
  // another customer's tag names — the one piece of deck text that reaches a
  // screen without a deck row around it.
  const qt = scoped(scopeOf(c.var.user)).on("d").andRaw("d.tags IS NOT NULL").andRaw("d.tags != ''");
  const rows = (
    await c.env.DB.prepare(`SELECT d.tags FROM decks d ${qt.whereClause()}`)
      .bind(...qt.binds)
      .all<{ tags: string | null }>()
  ).results;
  const seen = new Set<string>();
  for (const r of rows) for (const t of parseTags(r.tags)) seen.add(t);
  return c.json({ tags: [...seen].sort() });
});

/** PUT /api/decks/:id/tags — replace a deck's tag list. Body: { tags: string[] }. */
decks.put("/:id/tags", async (c) => {
  const { role } = c.var.user;
  if (!canTag(role)) return c.json({ error: "forbidden" }, 403);
  const id = c.req.param("id");
  const qr = oneDeck(c.var.user, id);
  const exists = await c.env.DB.prepare(`SELECT d.id FROM decks d ${qr.whereClause()}`)
    .bind(...qr.binds)
    .first<{ id: string }>();
  if (!exists) return c.json({ error: "not_found" }, 404);

  const body = (await c.req.json().catch(() => ({}))) as { tags?: unknown };
  const tags = normaliseTags(body.tags);
  // The write carries the same predicate as the read. A 404 above and an
  // unscoped UPDATE below would be a tenancy check that only reports.
  const qw = oneDeck(c.var.user, id, "decks");
  await c.env.DB.prepare(`UPDATE decks SET tags = ? ${qw.whereClause()}`)
    .bind(tags.length > 0 ? JSON.stringify(tags) : null, ...qw.binds)
    .run();
  return c.json({ ok: true, tags });
});

const VERDICT_LABELS: Record<string, string> = {
  advanced: "Advanced — AI gate passed",
  below_gate: "Rejected — below AI gate",
  incomplete: "Incomplete — needs founder details",
};

/** GET /api/decks/:id — extraction + per-parameter AI scores (report drawer). */
decks.get("/:id", async (c) => {
  const { id: userId, edition, role } = c.var.user;
  const id = c.req.param("id");
  const qd = oneDeck(c.var.user, id);
  const row = await c.env.DB.prepare(
    `SELECT ${DECK_COLUMNS}, d.uploaded_by, ${DECK_DERIVED} FROM decks d ${DECK_JOINS} ` +
      qd.whereClause(),
  )
    .bind(...qd.binds)
    .first<DeckRow & { uploaded_by: string | null }>();
  if (!row) return c.json({ error: "not_found" }, 404);
  // Founders may only open their own submissions.
  if (role === "founder" && row.uploaded_by !== userId) return c.json({ error: "not_found" }, 404);
  // P0-1 — and a juror only the decks in their scope. `not_found`, not
  // `forbidden`: a 403 would confirm the deck exists, which is half of what the
  // listing was leaking.
  if (!(await canReadDeck(c.env.DB, c.var.user, id))) return c.json({ error: "not_found" }, 404);

  // `deck_extractions` holds the TEXT the model read out of the PDF — the deck's
  // contents, section by section. Owned through its deck; scoped with the owner
  // join so the statement names the owner.
  const qx = scoped(scopeOf(c.var.user));
  const xJoin = qx.viaParent("deck_extractions", "x");
  qx.and("x.deck_id = ?", id);
  const extraction = (
    await c.env.DB.prepare(
      `SELECT x.label, x.heading, x.text, x.missing FROM deck_extractions x ${xJoin} ` +
        `${qx.whereClause()} ORDER BY x.sort_order`,
    )
      .bind(...qx.binds)
      .all<{ label: string; heading: string | null; text: string | null; missing: number }>()
  ).results.map((e) => ({
    label: e.label,
    heading: e.heading ?? undefined,
    text: e.text ?? "",
    missing: e.missing === 1,
  }));

  const qsc = scoped(scopeOf(c.var.user));
  const scJoin = qsc.viaParent("scores", "s");
  qsc.and("s.deck_id = ?", id).andRaw("s.evaluator_kind = 'ai'");
  const scores = (
    await c.env.DB.prepare(
      "SELECT p.key AS key, p.name AS label, p.weight AS weight, s.value AS value, s.comment AS comment " +
        `FROM scores s ${scJoin} JOIN parameters p ON p.id = s.parameter_id ` +
        `${qsc.whereClause()} ORDER BY p.sort_order`,
    )
      .bind(...qsc.binds)
      .all<{ key: string; label: string; weight: number; value: number; comment: string | null }>()
  ).results;

  const qev = scoped(scopeOf(c.var.user));
  const evJoin = qev.viaParent("evaluations", "e");
  qev.and("e.deck_id = ?", id).andRaw("e.evaluator_id IS NULL");
  const evaluation = await c.env.DB.prepare(
    `SELECT e.weighted_total, e.verdict FROM evaluations e ${evJoin} ${qev.whereClause()}`,
  )
    .bind(...qev.binds)
    .first<{ weighted_total: number | null; verdict: string | null }>();

  // ── Blind scoring (F0106) ──────────────────────────────────────────────────
  // Admin console → Scoring framework → "Show AI score to jury before they
  // score" · "Turn off for blind independent jury evaluation".
  //
  // Withheld HERE, in the payload, not hidden in the client: an evaluator who
  // has not yet submitted for this deck receives no AI per-parameter scores, no
  // AI composite and no AI verdict, and `aiScoreWithheld` tells the workbench to
  // say so. Submitting reveals it — the point is independence before scoring,
  // not secrecy afterwards. Staff who oversee rather than score are unaffected.
  const scoring = await loadScoringSettings(c.env.DB, scopeOf(c.var.user));
  const qsub = scoped(scopeOf(c.var.user));
  const subJoin = qsub.viaParent("evaluations", "e");
  qsub.and("e.deck_id = ?", id).and("e.evaluator_id = ?", userId);
  const submitted = await c.env.DB.prepare(
    `SELECT 1 AS n FROM evaluations e ${subJoin} ${qsub.whereClause()}`,
  )
    .bind(...qsub.binds)
    .first<{ n: number }>();
  const blind = withholdsAiScore(scoring, {
    isEvaluator: isAssignableEvaluator(edition, role),
    hasSubmitted: Boolean(submitted),
  });

  const view = toDeckView(edition, row, role, scoring);
  return c.json({
    deck: blind ? { ...view, aiScore: undefined, signal: undefined } : view,
    extraction,
    scores: blind ? [] : scores,
    versions: await loadVersions(c, id),
    weightedTotal: blind ? undefined : evaluation?.weighted_total ?? row.ai_score ?? undefined,
    verdict:
      blind || !evaluation?.verdict
        ? undefined
        : VERDICT_LABELS[evaluation.verdict] ?? evaluation.verdict,
    ...(blind ? { aiScoreWithheld: true } : {}),
  });
});

// ── Sign-up / curation state (Aug-2026 issues 29 & 30) ───────────────────────

const PAYMENT_STATUSES = ["pending", "partial", "paid", "waived"];
const DOCUMENT_STATUSES = ["pending", "partial", "complete"];

/** Who may record sign-up / curation progress. */
const ONBOARDING_ROLES = ["program_associate", "program_manager", "admin", "partner"] as const;

/**
 * PUT /api/decks/:id/onboarding — record payment / documents / curation state.
 *
 * Issue 29 wants Payment status and Documents status on the Sign up Pipeline;
 * issue 30 wants Curation stage, a jury-member lead and Progress on Onboard
 * ready. One row per deck, created on first write.
 */
decks.put("/:id/onboarding", requireTask("onboard", ...ONBOARDING_ROLES), async (c) => {
  const { edition, id: actorId } = c.var.user;
  const id = c.req.param("id");
  const qg = oneDeck(c.var.user, id);
  const deck = await c.env.DB.prepare(`SELECT d.id FROM decks d ${qg.whereClause()}`)
    .bind(...qg.binds)
    .first<{ id: string }>();
  if (!deck) return c.json({ error: "not_found" }, 404);

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const qob = scoped(scopeOf(c.var.user));
  const obJoin = qob.viaParent("deck_onboarding", "ob");
  qob.and("ob.deck_id = ?", id);
  const existing = await c.env.DB.prepare(
    "SELECT ob.payment_status, ob.documents_status, ob.curation_stage, ob.progress, ob.lead_user_id, ob.notes " +
      `FROM deck_onboarding ob ${obJoin} ${qob.whereClause()}`,
  )
    .bind(...qob.binds)
    .first<{
      payment_status: string;
      documents_status: string;
      curation_stage: string | null;
      progress: number;
      lead_user_id: string | null;
      notes: string | null;
    }>();

  const pick = (value: unknown, allowed: string[], fallback: string) =>
    typeof value === "string" && allowed.includes(value) ? value : fallback;
  const text = (value: unknown, fallback: string | null) =>
    typeof value === "string" ? (value.trim() || null) : fallback;

  const payment = pick(body.paymentStatus, PAYMENT_STATUSES, existing?.payment_status ?? "pending");
  const documents = pick(
    body.documentsStatus,
    DOCUMENT_STATUSES,
    existing?.documents_status ?? "pending",
  );
  const stage = text(body.curationStage, existing?.curation_stage ?? null);
  const notes = text(body.notes, existing?.notes ?? null);
  const rawProgress = Number(body.progress);
  const progress = Number.isFinite(rawProgress)
    ? Math.max(0, Math.min(100, Math.round(rawProgress)))
    : (existing?.progress ?? 0);

  let leadId = existing?.lead_user_id ?? null;
  if (typeof body.leadUserId === "string") {
    const candidate = body.leadUserId.trim();
    if (candidate === "") {
      leadId = null;
    } else {
      // A lead must be a colleague, not merely somebody in the same edition:
      // this id comes from the request body, so it is the one place in the route
      // where another customer's user could be named outright.
      const ql = scoped(scopeOf(c.var.user)).on("u").and("u.id = ?", candidate).andRaw("u.active = 1");
      const lead = await c.env.DB.prepare(`SELECT u.id FROM users u ${ql.whereClause()}`)
        .bind(...ql.binds)
        .first<{ id: string }>();
      if (!lead) return c.json({ error: "invalid_lead" }, 400);
      leadId = lead.id;
    }
  }

  await c.env.DB.prepare(
    "INSERT INTO deck_onboarding (deck_id, payment_status, documents_status, curation_stage, progress, lead_user_id, notes, updated_at, updated_by) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(deck_id) DO UPDATE SET payment_status = excluded.payment_status, " +
      "documents_status = excluded.documents_status, curation_stage = excluded.curation_stage, " +
      "progress = excluded.progress, lead_user_id = excluded.lead_user_id, notes = excluded.notes, " +
      "updated_at = excluded.updated_at, updated_by = excluded.updated_by",
  )
    .bind(id, payment, documents, stage, progress, leadId, notes, new Date().toISOString(), actorId)
    .run();

  const qu = oneDeck(c.var.user, id);
  const updated = await c.env.DB.prepare(
    `SELECT ${DECK_COLUMNS}, ${DECK_DERIVED} FROM decks d ${DECK_JOINS} ${qu.whereClause()}`,
  )
    .bind(...qu.binds)
    .first<DeckRow>();
  // The returned view carries the shortlist hint, which needs the org's split.
  const scoring = updated ? await loadScoringSettings(c.env.DB, scopeOf(c.var.user)) : null;
  return c.json({
    ok: true,
    deck: updated && scoring ? toDeckView(edition, updated, c.var.user.role, scoring) : null,
  });
});

// ── Manual override of the auto-recognised details (Aug-2026 issue 12) ───────

/** Who may correct a deck's recognised details: the intake/evaluation staff. */
const EDIT_DECK_ROLES = [
  "program_associate",
  "program_manager",
  "admin",
  "analyst",
  "associate",
  "partner",
] as const;

/**
 * PATCH /api/decks/:id — override what the AI recognised.
 *
 * Issue 12: "startup name, stage, sector, cohort must be automatically
 * recognized with manual over-ride facility". The recognition happens in
 * `ai/evaluate.ts`; this is the override. Only the fields present in the body
 * are touched, and writing a name clears `name_auto` so a later re-score can't
 * quietly undo the correction.
 */
decks.patch("/:id", requireTask("upload", ...EDIT_DECK_ROLES), async (c) => {
  const { edition } = c.var.user;
  const id = c.req.param("id");
  const qg = oneDeck(c.var.user, id);
  const existing = await c.env.DB.prepare(`SELECT d.id FROM decks d ${qg.whereClause()}`)
    .bind(...qg.binds)
    .first<{ id: string }>();
  if (!existing) return c.json({ error: "not_found" }, 404);

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const text = (v: unknown): string | null | undefined => {
    if (typeof v !== "string") return undefined;
    const t = v.trim();
    return t === "" ? null : t;
  };

  const sets: string[] = [];
  const binds: unknown[] = [];
  const columns: Record<string, string> = {
    name: "name",
    stage: "stage",
    sector: "sector",
    city: "city",
    founder: "founder",
    founderEmail: "founder_email",
    founderPhone: "founder_phone",
    programId: "program_id",
    cohortId: "cohort_id",
  };
  // 21-Sep item 6 — the four fields the Dashboard's inline edit exposes, which
  // are what "Contact Details Edited" is about. A change to `sector` or a
  // programme re-assignment is an edit too, but it is not a CONTACT edit and
  // must not claim to be one.
  const CONTACT_FIELDS = new Set(["founder", "founderEmail", "founderPhone", "city"]);
  const contactEdited: string[] = [];
  for (const [field, column] of Object.entries(columns)) {
    const value = text(body[field]);
    if (value === undefined) continue;
    // A startup name is the one field that must never be blanked out.
    if (field === "name" && value === null) continue;
    sets.push(`${column} = ?`);
    binds.push(value);
    if (field === "name") sets.push("name_auto = 0");
    if (CONTACT_FIELDS.has(field)) contactEdited.push(field);
  }
  if (sets.length === 0) return c.json({ error: "nothing_to_update" }, 400);

  sets.push("updated_at = ?");
  binds.push(new Date().toISOString());
  // The SET list's binds come EARLIER in the statement than the builder's, which
  // is the bind-order rule in `src/shared/tenant.ts`: head binds first, then
  // `q.binds`.
  const qw = oneDeck(c.var.user, id, "decks");
  await c.env.DB.prepare(`UPDATE decks SET ${sets.join(", ")} ${qw.whereClause()}`)
    .bind(...binds, ...qw.binds)
    .run();

  // Re-derive what is still missing so the deck's Incomplete state follows the
  // correction instead of going stale.
  const qrd = oneDeck(c.var.user, id);
  const row = await c.env.DB.prepare(
    "SELECT d.founder, d.founder_email, d.founder_phone, d.city, d.sector, d.status, " +
      `d.ai_complete, d.complete FROM decks d ${qrd.whereClause()}`,
  )
    .bind(...qrd.binds)
    .first<{
      founder: string | null;
      founder_email: string | null;
      founder_phone: string | null;
      city: string | null;
      sector: string | null;
      status: string | null;
      ai_complete: number | null;
      complete: number | null;
    }>();
  if (row) {
    const missing = missingIntakeFields({
      founder: row.founder,
      founderEmail: row.founder_email,
      founderPhone: row.founder_phone,
      city: row.city,
      sector: row.sector,
    });
    // ── S1-DASH item 3 · the upward-only re-derive (plan §8.1, §12.2) ───────
    //
    // The gap §8.1 reports: a deck held back ONLY by missing founder details
    // kept `complete = 0` forever, so it routed to Query with nothing left to
    // ask. Raise it here — and only ever raise it:
    //
    //   · the intake list is now empty, AND
    //   · `ai_complete` says the model itself passed the deck.
    //
    // Both arms matter. Without the second, this would launder an unreadable
    // deck into Assign by typing a phone number; that is the confusion 0075
    // exists to end. Never lowering is route-partition.test.ts's contract —
    // "(b) blanking a required detail" pins `complete === true` immediately
    // after the blanking, because routing follows the LIVE missing list and
    // the column must not move under it.
    //
    // A deck evaluated before 0075 carries `ai_complete = complete`, so one
    // stopped by missing details reads 0 and this guard correctly declines to
    // raise it: the cause was never recorded and cannot be guessed. It needs a
    // re-evaluation, not a backfill. Said plainly in the migration and in §12.
    const raise = missing.length === 0 && row.ai_complete !== 0 && row.complete === 0;
    await c.env.DB.prepare(
      raise
        ? "UPDATE decks SET missing_fields = ?, complete = 1 WHERE id = ?"
        : "UPDATE decks SET missing_fields = ? WHERE id = ?",
    )
      .bind(missing.length > 0 ? missing.join(",") : null, id)
      .run();
  }

  // ── 21-Sep item 6 · "Contact Details Edited" ────────────────────────────
  //
  // The client's row asks the Status cell to say this after an Edit. It could
  // not: this handler UPDATEd the deck and wrote NO `pipeline_events` row, so
  // there was no record to render and the chip had no source. One event per
  // contact edit fixes both halves — the chip, and the deck's own history,
  // which until now showed the correction as if it had never happened.
  //
  // `from_stage === to_stage` deliberately: an edit is not a transition and
  // must not read as one. The exit-reason columns select on
  // `to_stage IN ('rejected','archived')`, so this never pollutes them;
  // `last_event_at` does move, which is right — an edit IS activity.
  if (contactEdited.length > 0 && row) {
    // `decks.status` is the PIPELINE stage. `decks.stage` is the startup's
    // funding stage ("Seed", "Pre-seed") and is not this at all.
    const stage = row.status ?? null;
    await c.env.DB.prepare(
      "INSERT INTO pipeline_events (id, deck_id, actor_id, from_stage, to_stage, action, note, created_at) " +
        "VALUES (?, ?, ?, ?, ?, 'edit_contact', ?, ?)",
    )
      .bind(
        `${id}_evt_${crypto.randomUUID()}`,
        id,
        c.var.user.id,
        stage,
        stage ?? "",
        contactEdited.sort().join(","),
        new Date().toISOString(),
      )
      .run();
  }

  const qu = oneDeck(c.var.user, id);
  const updated = await c.env.DB.prepare(
    `SELECT ${DECK_COLUMNS}, ${DECK_DERIVED} FROM decks d ${DECK_JOINS} ${qu.whereClause()}`,
  )
    .bind(...qu.binds)
    .first<DeckRow>();
  // The returned view carries the shortlist hint, which needs the org's split.
  const scoring = updated ? await loadScoringSettings(c.env.DB, scopeOf(c.var.user)) : null;
  return c.json({
    ok: true,
    deck: updated && scoring ? toDeckView(edition, updated, c.var.user.role, scoring) : null,
  });
});

// ── Consolidated evaluation report (Aug-2026 issues 20/21/23/24) ─────────────
//
// One report per deck with a COLUMN PER EVALUATOR, so the table grows as the
// deck passes hands (AI → program associate → jury → program manager). Core
// areas and role-scoped additional parameters are returned separately so the
// screen can render the "Core Parameters" and "Addl. parameters" tabs.
//
// Issue 21 — the hierarchy: a viewer only ever receives the columns of
// evaluators at or below their own rank (`canSeeEvaluatorScores`). The
// filtering happens HERE, on the server: a lower-ranked evaluator's browser
// never receives a higher-ranked evaluator's numbers at all.

interface ReportScoreRow {
  parameter_id: string;
  evaluator_id: string | null;
  evaluator_kind: string;
  value: number;
  comment: string | null;
  evaluator_name: string | null;
  evaluator_role: string | null;
  evaluator_title: string | null;
  evaluator_initials: string | null;
}

interface ReportParamRow {
  id: string;
  key: string;
  name: string;
  weight: number;
  informational: number;
  role_scope: string | null;
}

// ── Send to Query · the recorded click ───────────────────────────────────────
//
// Roles that may send a deck to the Query screen — the same list
// `POST /api/decks/:id/queries` (`routes/pipeline.ts`) gates the compose-and-send
// with, because this is the same decision one step earlier.
const SEND_TO_QUERY_ROLES = [
  "program_associate",
  "program_manager",
  "admin",
  "analyst",
  "associate",
  "partner",
] as const;

/**
 * POST /api/decks/:id/send-to-query — record that the operator sent this deck
 * to Query, by raising a **pending** clarification on it.
 *
 * ── Why this route exists, and it is row 3's other half ─────────────────────
 * Row 3 makes Query membership a recorded action. Before it, `deckListRoute`
 * DERIVED membership from incompleteness, so a deck arrived on the Query screen
 * with nobody having decided anything, and the Dashboard's "Send to Query" was
 * pure navigation — `navigate("/app/query")`, writing nothing, on a deck that
 * was already listed.
 *
 * Delete the derivation and leave the button as navigation and the product has a
 * hole in it: the only thing that writes a `queries` row is the compose-and-send
 * on the Query screen, and the deck cannot reach that screen until a `queries`
 * row exists. Send to Query would navigate to a list the deck is not on, and
 * `?list=query` would be a screen an operator could never populate.
 *
 * **The prototype already answers this and the build had lost it.** Its
 * `upSendToQuery` pushes the deck onto the Query list as `pending` BEFORE any
 * email goes out — which is why `queryStatusOf` (`shared/queries.ts`) has a
 * Pending status at all, and why its own comment says a flagged deck nobody has
 * emailed yet is Pending. So the recorded send is a pending query: the deck
 * joins the list, the operator composes there, and `POST /decks/:id/queries`
 * does the sending exactly as it does today.
 *
 * **Nothing is emailed by this click, deliberately.** That is what keeps the
 * defect the client's own row-3 reason names out of reach: `POST
 * /decks/:id/queries` falls back to a placeholder address when the deck has no
 * founder email, so a click that both listed AND mailed would reintroduce
 * exactly the send he is complaining about. Listing is free; mailing needs an
 * address.
 *
 * **No marker event, and that is not an omission.** The `queries` row IS the
 * record — `DeckView.queried` is `query_count > 0` and the screening sink reads
 * it — so a `send_to_query` pipeline event would be a second authority for one
 * fact, which is how the three thresholds happened. `send_to_assign` needs a
 * marker only because it has no domain row to be recorded in.
 */
decks.post("/:id/send-to-query", requireTask("query", ...SEND_TO_QUERY_ROLES), async (c) => {
  const { edition } = c.var.user;
  const id = c.req.param("id");
  const qg = oneDeck(c.var.user, id);
  const row = await c.env.DB.prepare(`SELECT d.id, d.missing_fields FROM decks d ${qg.whereClause()}`)
    .bind(...qg.binds)
    .first<{ id: string; missing_fields: string | null }>();
  if (!row) return c.json({ error: "not_found" }, 404);

  // ── The contact axis, on the CLICK as well as on the list (issue 1) ───────
  //
  // The `?list=query` filter above keeps an unreachable founder off the Query
  // screen; without this, the click still writes the pending `queries` row, and
  // that row is what `screeningStatus` reads as the `Incomplete, Queried` SINK.
  // The deck would latch — row 7 empties the whitelist on a sink — while being
  // on no list at all: an un-actionable deck, created by a button. The rule
  // belongs on both halves or on neither.
  //
  // Same 409 and the same `contact_incomplete` code as the compose-and-send in
  // `routes/pipeline.ts`, so a screen needs one message for one refusal. That
  // route refuses on REACHABILITY (no deliverable address) and this one on the
  // client's whole contact axis — the difference is a live contradiction between
  // his flow and two e2e fixtures, written up in the handoff rather than
  // resolved here; the narrower of the two cannot be the one that guards
  // membership, because membership is what he asked about.
  //
  // The DECK axis is deliberately not consulted: §3 item 1 makes Send to Query
  // the unreadable deck's only exit.
  if (SCREENING_NARROWS_LISTS[edition] && !contactComplete({ missingFields: parseMissingFields(row.missing_fields) })) {
    return c.json({ error: "contact_incomplete", missingFields: parseMissingFields(row.missing_fields) }, 409);
  }

  // Idempotent on the thing that matters: if the deck already has a query
  // nobody has answered, it is already ON the list and a second pending row
  // would only push the no-response clock back. An ANSWERED history does not
  // block a fresh send — that is the resubmit loop working.
  const qq = scoped(scopeOf(c.var.user));
  const qqJoin = qq.viaParent("queries", "q");
  qq.and("q.deck_id = ?", id).andRaw("q.founder_response IS NULL");
  const open = await c.env.DB.prepare(
    `SELECT q.id FROM queries q ${qqJoin} ${qq.whereClause()} LIMIT 1`,
  )
    .bind(...qq.binds)
    .first<{ id: string }>();
  if (!open) {
    await c.env.DB.prepare(
      "INSERT INTO queries (id, deck_id, questions, email_status, created_at) VALUES (?, ?, '', 'pending', ?)",
    )
      .bind(`qry_${crypto.randomUUID()}`, id, new Date().toISOString())
      .run();
  }

  const qu = oneDeck(c.var.user, id);
  const updated = await c.env.DB.prepare(
    `SELECT ${DECK_COLUMNS}, ${DECK_DERIVED} FROM decks d ${DECK_JOINS} ${qu.whereClause()}`,
  )
    .bind(...qu.binds)
    .first<DeckRow>();
  const scoring = updated ? await loadScoringSettings(c.env.DB, scopeOf(c.var.user)) : null;
  return c.json({
    ok: true,
    // `false` when the deck was already on the list, so the screen can say
    // "already queried" rather than claiming it just did something.
    raised: !open,
    deck: updated && scoring ? toDeckView(edition, updated, c.var.user.role, scoring) : null,
  });
});

// ── Send to Assign · the recorded click ──────────────────────────────────────
//
// Roles that may send a deck to the Assign screen. The same list as the
// `assign_jury` transition in `src/pipeline/incubator.ts`, because it is the
// same decision one step earlier: whoever may put a juror on a deck may put the
// deck in front of the jurors.
const SEND_TO_ASSIGN_ROLES = ["program_manager", "program_associate", "admin"] as const;

/**
 * POST /api/decks/:id/send-to-assign — record that the operator sent this deck
 * to Assign.
 *
 * ── Why a marker and not a stage ────────────────────────────────────────────
 * The client's screening matrix gives "Complete" exactly one active action,
 * Send to Assign, and his row 7 latches the deck once it fires. Until now that
 * button was NAVIGATION — the Dashboard called `navigate("/app/assign")` and
 * wrote nothing down — so there was no record to latch on and no way to tell a
 * deck that had been sent from one that merely could be.
 *
 * The obvious implementation is the `assigned` stage, and it is the wrong one.
 * `POST /decks/:id/transition` will move a deck to `assigned` with
 * `assigned_to` still NULL, which is exactly the shape the client filed as his
 * row 12 Foul — "startups without any decks, assigned to Jury". His
 * Send-to-Assign row and his row 12 pull in opposite directions, and this is
 * what satisfies both: the deck joins the Assign roster and latches, while
 * `assigned_to` keeps meaning a real evaluator and the stage keeps meaning a
 * real assignment.
 *
 * So it is a `pipeline_events` row with `from_stage === to_stage` — the same
 * non-transition marker shape as `edit_contact` in `PATCH /api/decks/:id`
 * above, which also documents why it is safe: the `exit_*` derived columns
 * select on `to_stage IN ('rejected','archived')`, so a marker can never be
 * mistaken for the way a startup left the pipeline. `last_event_at` does move,
 * which is right — sending a deck to Assign IS activity on it.
 *
 * Idempotent by reading, not by constraint: sending twice writes a second
 * marker and `send_to_assign_at` is a MAX(), so the latch is unaffected and the
 * history keeps both clicks. A second click is a fact about what the operator
 * did, not an error to refuse.
 */
decks.post("/:id/send-to-assign", requireTask("assign", ...SEND_TO_ASSIGN_ROLES), async (c) => {
  const { edition } = c.var.user;
  const id = c.req.param("id");
  const qg = oneDeck(c.var.user, id);
  const row = await c.env.DB.prepare(
    `SELECT d.status, d.ai_complete, d.missing_fields FROM decks d ${qg.whereClause()}`,
  )
    .bind(...qg.binds)
    .first<{ status: string | null; ai_complete: number | null; missing_fields: string | null }>();
  if (!row) return c.json({ error: "not_found" }, 404);

  // ── BOTH axes, on the click as well as on the list (issue 1) ──────────────
  //
  // The marker is the ONLY authority for the `AI Evaluated, Assigned` sink, and
  // the sink latches the row — so writing one on an incomplete deck would make
  // the Dashboard announce a deck as assigned while `?list=assign` refuses it,
  // which is the two-authorities defect this route was built to avoid in the
  // first place. His flow is the same on both halves: an incomplete deck, on
  // either axis, is off the Assign screen.
  //
  // The RATING check is deliberately not re-asked here. The roster skips the
  // gate for an already-allocated deck on purpose (`isAllocatedDeck` — a deck
  // scored before the gate was raised must not drop off the screen it is being
  // worked on), so refusing the marker on the gate would contradict the carve-out
  // the list depends on. The gate is withheld where it belongs: the whitelist
  // offers Reject, not Send to Assign, at `belowThreshold`.
  const screening = {
    aiComplete: row.ai_complete !== 0,
    missingFields: parseMissingFields(row.missing_fields),
    statusId: row.status ?? undefined,
  };
  if (SCREENING_NARROWS_LISTS[edition] && !(deckComplete(screening) && contactComplete(screening))) {
    return c.json({ error: "deck_incomplete", missingFields: screening.missingFields }, 409);
  }

  // `decks.status` is the PIPELINE stage; `decks.stage` is the startup's
  // FUNDING stage ("Seed", "Pre-seed") and is not this at all. The same trap
  // the `edit_contact` writer above names.
  const stage = row.status ?? null;
  await c.env.DB.prepare(
    "INSERT INTO pipeline_events (id, deck_id, actor_id, from_stage, to_stage, action, note, created_at) " +
      "VALUES (?, ?, ?, ?, ?, 'send_to_assign', NULL, ?)",
  )
    .bind(`${id}_evt_${crypto.randomUUID()}`, id, c.var.user.id, stage, stage ?? "", new Date().toISOString())
    .run();

  const qu = oneDeck(c.var.user, id);
  const updated = await c.env.DB.prepare(
    `SELECT ${DECK_COLUMNS}, ${DECK_DERIVED} FROM decks d ${DECK_JOINS} ${qu.whereClause()}`,
  )
    .bind(...qu.binds)
    .first<DeckRow>();
  const scoring = updated ? await loadScoringSettings(c.env.DB, scopeOf(c.var.user)) : null;
  return c.json({
    ok: true,
    deck: updated && scoring ? toDeckView(edition, updated, c.var.user.role, scoring) : null,
  });
});

/**
 * GET /api/decks/:id/report?stage=assign|intro — the evaluation report,
 * hierarchy-filtered and stage-aware (incubator spec §8.4 / §13).
 *
 * `stage` is the screen the report was opened FROM. It decides which role
 * sections the Addl. parameters tab carries and whether each is the viewer's
 * own (editable) or someone else's (read-only / completed) — see
 * `shared/reportStage.ts`, which is the rule. Absent or unrecognised, the
 * report is single-role. Stage-awareness only ever REMOVES sections: the
 * issue-21 hierarchy and peer-visibility filtering of columns below is
 * untouched, so no stage can reveal a score the viewer could not already see.
 */
decks.get("/:id/report", async (c) => {
  const { id: viewerId, edition, role } = c.var.user;
  if (role === "founder") return c.json({ error: "forbidden" }, 403);
  const id = c.req.param("id");
  const layout = reportLayout(edition, parseReportStage(c.req.query("stage")), role);

  const qd = oneDeck(c.var.user, id);
  const deckRow = await c.env.DB.prepare(
    `SELECT ${DECK_COLUMNS}, ${DECK_DERIVED} FROM decks d ${DECK_JOINS} ${qd.whereClause()}`,
  )
    .bind(...qd.binds)
    .first<DeckRow>();
  if (!deckRow) return c.json({ error: "not_found" }, 404);
  // P0-1 — the report carries the same founder block as the listing row.
  if (!(await canReadDeck(c.env.DB, c.var.user, id))) return c.json({ error: "not_found" }, 404);

  // `parameters` is tenant-OWNED (it carries the column), so the scope is direct.
  // The rubric is the customer's own, and an unscoped read would print another
  // customer's parameter names down the side of this report.
  const qp = scoped(scopeOf(c.var.user)).on("p").andRaw("p.active = 1");
  const params = (
    await c.env.DB.prepare(
      "SELECT p.id, p.key, p.name, p.weight, p.informational, p.role_scope FROM parameters p " +
        `${qp.whereClause()} ORDER BY p.sort_order`,
    )
      .bind(...qp.binds)
      .all<ReportParamRow>()
  ).results;

  // `scores` carries no tenant column — it is owned through its deck, and
  // `viaParent` emits that join from `TENANT_OWNER`. The deck above was already
  // resolved in the caller's workspace, so this is belt-and-braces; it is also one
  // of the 13 `FROM scores` sites §5b counted, and the belt is what stops the next
  // reader of this file assuming the deck guard travels with the statement.
  const qs = scoped(scopeOf(c.var.user));
  const scoreJoin = qs.viaParent("scores", "s");
  qs.and("s.deck_id = ?", id);
  const scoreRows = (
    await c.env.DB.prepare(
      "SELECT s.parameter_id, s.evaluator_id, s.evaluator_kind, s.value, s.comment, " +
        "u.name AS evaluator_name, u.role AS evaluator_role, u.title AS evaluator_title, " +
        "u.initials AS evaluator_initials " +
        // The `users` LEFT JOIN is deliberately NOT given a tenant condition of
        // its own: `evaluator_id` is NULL on every AI row, and an inner-flavoured
        // condition would drop the AI column from the report. The rows are already
        // fenced by the scoped parent join above.
        `FROM scores s ${scoreJoin} LEFT JOIN users u ON u.id = s.evaluator_id ${qs.whereClause()}`,
    )
      .bind(...qs.binds)
      .all<ReportScoreRow>()
  ).results;

  // Evaluators are sourced from BOTH the roll-up and the per-parameter scores: an
  // evaluator who has submitted a total but whose per-parameter detail predates
  // this report still earns a column (issue 20 — the report widens as the deck
  // passes hands), it just has empty cells.
  const qe = scoped(scopeOf(c.var.user));
  const evalJoin = qe.viaParent("evaluations", "e");
  qe.and("e.deck_id = ?", id);
  const evaluationRows = (
    await c.env.DB.prepare(
      "SELECT e.evaluator_id, e.weighted_total, e.remarks, e.submitted_at, " +
        "u.name AS evaluator_name, u.role AS evaluator_role, u.title AS evaluator_title, " +
        "u.initials AS evaluator_initials " +
        // No tenant condition on the `users` join — see the note on `scoreRows`.
        `FROM evaluations e ${evalJoin} LEFT JOIN users u ON u.id = e.evaluator_id ${qe.whereClause()}`,
    )
      .bind(...qe.binds)
      .all<{
        evaluator_id: string | null;
        weighted_total: number | null;
        remarks: string | null;
        submitted_at: string | null;
        evaluator_name: string | null;
        evaluator_role: string | null;
        evaluator_title: string | null;
        evaluator_initials: string | null;
      }>()
  ).results;

  // ── Columns ────────────────────────────────────────────────────────────────
  interface Column {
    id: string;
    kind: "ai" | "human";
    name: string;
    role?: string;
    roleLabel?: string;
    title?: string;
    initials?: string;
    rank: number;
    total?: number;
    remarks?: string;
    submittedAt?: string;
  }

  const seenEvaluators = new Map<string, Column>();
  let hidden = 0;

  // Both config reads below are the VIEWER's workspace, from the session — the
  // toggles and the matrix are the customer's own. Not the deck's edition: the
  // deck row is already this workspace's, because `oneDeck` scoped it above.
  const scope = scopeOf(c.var.user);

  // ── Peer visibility (F0109) ───────────────────────────────────────────────
  // Admin console → Scoring framework → "Jury can see each other's scores" ·
  // "Turn off for fully independent scoring rounds". It ships **OFF** — the
  // only default-off toggle in the section — while the build behaved as if it
  // were always on.
  //
  // Off, an evaluator sees the AI column and their own, and nothing else. On,
  // the role rule below still applies on top: the two are a conjunction, not a
  // replacement. Roles that oversee rather than score — admin, superuser — are
  // outside the toggle entirely.
  const scoring = await loadScoringSettings(c.env.DB, scope);
  // V4-WEIGHT (0074) — the split THIS deck is judged at, not the org's bare
  // value: its cohort's, else its programme's, else the organisation's.
  const workbenchWeight = aiWeightFor(
    deckRow.cohort_ai_weight_pct,
    deckRow.program_ai_weight_pct,
    scoring.aiWeightPct,
  );
  const peerRestricted = !scoring.jurySeesPeerScores && isAssignableEvaluator(edition, role);

  // ── The role rule (V3 item 13) ────────────────────────────────────────────
  // What used to be the fixed `EVALUATION_RANK` ladder is now the admin
  // console's configurable `Score visibility matrix` — "Viewer (row) → can see
  // scores of (column)". The filter stays HERE, on the server: a viewer's
  // browser never receives a column the matrix denies, and never receives its
  // CELLS either (see the `visibleEvaluators` pass below). Pairs the matrix
  // does not draw — `admin` is in neither edition's — fall through to the
  // ladder, so nothing outside the 4×4 / 5×5 changed.
  const visibility = await loadScoreVisibility(c.env.DB, scope);

  // ── Blind scoring (F0106) — the third route that has to hold it ───────────
  // "Show AI score to jury before they score" · off for blind independent jury
  // evaluation. It was enforced on GET /api/decks/:id, and Wave 2 integration
  // found and closed the same hole on the LIST route with the note that
  // "withholding on the detail route alone does not make scoring independent".
  // This route was missed, and it is the widest of the three: an evaluator who
  // had not submitted still received every AI per-parameter score AND its
  // rationale here, so opening the report was a way round the toggle from all
  // seven screens that render it. Measured on the seed before the fix: 13 of 13
  // AI cells, with comments, for a juror whose deck detail correctly said
  // `aiScoreWithheld`. Dropped HERE, in the payload — the browser never gets it.
  //
  // Blindness is per (deck, evaluator) and lifts on submission; this deck's
  // evaluations are already loaded, so it costs no extra query.
  const blind = withholdsAiScore(scoring, {
    isEvaluator: isAssignableEvaluator(edition, role),
    hasSubmitted: evaluationRows.some((e) => e.evaluator_id === viewerId),
  });

  const columns: Column[] = blind ? [] : [{ id: "ai", kind: "ai", name: "AI", rank: 0 }];

  const addEvaluator = (person: {
    evaluator_id: string | null;
    evaluator_name: string | null;
    evaluator_role: string | null;
    evaluator_title: string | null;
    evaluator_initials: string | null;
  }) => {
    if (!person.evaluator_id || seenEvaluators.has(person.evaluator_id)) return;
    const evaluatorRole = (person.evaluator_role ?? "") as Role;
    // Issue 21 / item 13 — your own column is always visible whatever the
    // matrix says: identity beats role. The matrix decides everyone else.
    const visible =
      person.evaluator_id === viewerId ||
      (!peerRestricted && canSeeEvaluatorScoresIn(visibility, edition, role, evaluatorRole));
    if (!visible) {
      hidden += 1;
      seenEvaluators.set(person.evaluator_id, {
        id: person.evaluator_id,
        kind: "human",
        name: "",
        rank: -1,
      });
      return;
    }
    seenEvaluators.set(person.evaluator_id, {
      id: person.evaluator_id,
      kind: "human",
      name: person.evaluator_name ?? "Evaluator",
      role: evaluatorRole,
      roleLabel: roleLabel(edition, evaluatorRole),
      title: person.evaluator_title ?? undefined,
      initials: person.evaluator_initials ?? undefined,
      rank: evaluationRank(edition, evaluatorRole),
    });
  };

  for (const r of evaluationRows) addEvaluator(r);
  for (const r of scoreRows) {
    if (r.evaluator_kind !== "human") continue;
    addEvaluator(r);
  }

  const visibleEvaluators = [...seenEvaluators.values()]
    .filter((col) => col.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));

  const totals = new Map<string, { total?: number; remarks?: string; submittedAt?: string }>();
  for (const e of evaluationRows) {
    totals.set(e.evaluator_id ?? "ai", {
      total: e.weighted_total ?? undefined,
      remarks: e.remarks ?? undefined,
      submittedAt: e.submitted_at ?? undefined,
    });
  }
  for (const col of [...columns, ...visibleEvaluators]) {
    const t = totals.get(col.id);
    if (t) Object.assign(col, t);
  }
  columns.push(...visibleEvaluators);
  const visibleIds = new Set(columns.map((col) => col.id));

  // ── Cells ──────────────────────────────────────────────────────────────────
  const byParam = new Map<string, Record<string, { value: number; comment?: string }>>();
  for (const r of scoreRows) {
    const colId = r.evaluator_kind === "ai" ? "ai" : r.evaluator_id;
    if (!colId || !visibleIds.has(colId)) continue;
    const cells = byParam.get(r.parameter_id) ?? {};
    cells[colId] = { value: r.value, comment: r.comment ?? undefined };
    byParam.set(r.parameter_id, cells);
  }

  // "Include AI evidence quotes in reports" · "Show which deck text drove each
  // area's AI score". The AI's per-parameter justification is what this build
  // has as evidence; with the toggle off the report carries the numbers only.
  // (A verbatim deck excerpt alongside it is the other half of F0110 and is not
  // built — see §9.)
  const stripAiEvidence = !scoring.includeAiEvidence;
  const toRow = (p: ReportParamRow) => {
    const cells = byParam.get(p.id) ?? {};
    return {
      key: p.key,
      name: p.name,
      weight: p.weight,
      roleScope: p.role_scope ?? undefined,
      cells:
        stripAiEvidence && cells.ai
          ? { ...cells, ai: { value: cells.ai.value } }
          : cells,
    };
  };

  const core = params.filter((p) => p.informational === 0).map(toRow);

  // Additional parameters grouped by the role that owns them (issue 24), in
  // the stage's section order, carrying the stage's mode (§8.4). A role the
  // stage does not name is left out entirely — rows and cells both.
  const groups = new Map<
    string,
    {
      role: string;
      roleLabel: string;
      mode: (typeof layout.sections)[number]["mode"];
      readOnly: boolean;
      rows: ReturnType<typeof toRow>[];
    }
  >();
  for (const section of layout.sections) {
    groups.set(section.role, {
      role: section.role,
      roleLabel: roleLabel(edition, section.role),
      mode: section.mode,
      readOnly: section.mode !== "editable",
      rows: [],
    });
  }
  for (const p of params) {
    if (p.informational === 0 || !p.role_scope) continue;
    groups.get(p.role_scope)?.rows.push(toRow(p));
  }

  return c.json({
    deck: toDeckView(edition, deckRow, role, scoring),
    columns,
    core,
    // A section whose role has no parameters configured has nothing to show.
    additional: [...groups.values()].filter((g) => g.rows.length > 0),
    stage: layout.stage,
    stageAware: layout.stageAware,
    // How many evaluators exist above the viewer in the hierarchy. The screen
    // says so plainly rather than pretending nobody has scored.
    hiddenEvaluators: hidden,
    // Why they are hidden: an independent scoring round rather than rank.
    peerScoresHidden: peerRestricted,
    // The AI column is withheld until this evaluator submits (F0106), exactly
    // as GET /api/decks/:id reports it.
    ...(blind ? { aiScoreWithheld: true as const } : {}),
    scoring: {
      showThreeScoreView: scoring.showThreeScoreView,
      showScoreDrift: scoring.showScoreDrift,
      includeAiEvidence: scoring.includeAiEvidence,
      scoreScale: scoring.scoreScale,
      // V4-WEIGHT (0074) — the workbench's live "Average" must blend at the
      // split this deck is actually judged at, which is its cohort's or its
      // programme's when either has one. Sending the org value here while
      // `decisionScore` above used a different one is the W7-A defect again.
      aiWeightPct: workbenchWeight.pct,
      aiWeightSource: workbenchWeight.source,
    },
  });
});

// ── Deck versioning (Session 5) ──────────────────────────────────────────────

interface VersionRow {
  id: string;
  version: number;
  file_name: string | null;
  size_bytes: number | null;
  note: string | null;
  created_at: string;
  uploaded_by_name: string | null;
}

async function loadVersions(c: Context<AppEnv>, deckId: string) {
  // `deck_versions` is owned through its deck. Both callers resolve the deck in the
  // caller's workspace first, so this join is the second fence rather than the
  // first — and it is the one that travels with the statement.
  const qv = scoped(scopeOf(c.var.user));
  const join = qv.viaParent("deck_versions", "v");
  qv.and("v.deck_id = ?", deckId);
  const rows = (
    await c.env.DB.prepare(
      "SELECT v.id, v.version, v.file_name, v.size_bytes, v.note, v.created_at, u.name AS uploaded_by_name " +
        `FROM deck_versions v ${join} LEFT JOIN users u ON u.id = v.uploaded_by ` +
        `${qv.whereClause()} ORDER BY v.version DESC`,
    )
      .bind(...qv.binds)
      .all<VersionRow>()
  ).results;
  return rows.map((v) => ({
    id: v.id,
    version: v.version,
    fileName: v.file_name ?? undefined,
    sizeBytes: v.size_bytes ?? undefined,
    note: v.note ?? undefined,
    uploadedByName: v.uploaded_by_name ?? undefined,
    createdAt: v.created_at,
  }));
}

/** GET /api/decks/:id/versions — the deck's upload history (newest first). */
decks.get("/:id/versions", async (c) => {
  const { id: userId, role } = c.var.user;
  const id = c.req.param("id");
  const qg = oneDeck(c.var.user, id);
  const row = await c.env.DB.prepare(`SELECT d.id, d.uploaded_by FROM decks d ${qg.whereClause()}`)
    .bind(...qg.binds)
    .first<{ id: string; uploaded_by: string | null }>();
  if (!row) return c.json({ error: "not_found" }, 404);
  if (role === "founder" && row.uploaded_by !== userId) return c.json({ error: "not_found" }, 404);
  if (!(await canReadDeck(c.env.DB, c.var.user, id))) return c.json({ error: "not_found" }, 404);
  return c.json({ versions: await loadVersions(c, id) });
});

/** GET /api/decks/:id/file — stream the deck's PDF from R2 (in-app viewer).
 *  Edition-scoped like the report; founders may only stream their own uploads. */
decks.get("/:id/file", async (c) => {
  const { id: userId, role } = c.var.user;
  const id = c.req.param("id");
  // The PDF itself. R2 keys are flat and carry no tenant prefix (§2's closing
  // note), so this D1 lookup is the ONLY thing standing between a deck id and
  // another customer's deck file — which is why it is scoped and not merely
  // edition-filtered.
  const qg = oneDeck(c.var.user, id);
  const row = await c.env.DB.prepare(`SELECT d.r2_key, d.uploaded_by FROM decks d ${qg.whereClause()}`)
    .bind(...qg.binds)
    .first<{ r2_key: string | null; uploaded_by: string | null }>();
  if (!row) return c.json({ error: "not_found" }, 404);
  if (role === "founder" && row.uploaded_by !== userId) return c.json({ error: "not_found" }, 404);
  // P0-1 — scoping the listing but streaming any PDF by id would hide the index
  // and leave the deck itself open.
  if (!(await canReadDeck(c.env.DB, c.var.user, id))) return c.json({ error: "not_found" }, 404);
  // No stored PDF yet (seed decks / still pending) — the viewer shows its
  // graceful "not stored" state on a 404.
  if (!row.r2_key) return c.json({ error: "no_pdf" }, 404);

  const object = await c.env.DECKS.get(row.r2_key);
  if (!object) return c.json({ error: "no_pdf" }, 404);

  const headers = new Headers();
  headers.set("content-type", "application/pdf");
  headers.set("content-disposition", `inline; filename="deck-${id}.pdf"`);
  headers.set("cache-control", "private, max-age=300");
  headers.set("etag", object.httpEtag);
  headers.set("content-length", String(object.size));
  return new Response(object.body, { headers });
});

// Team roles that may trigger an AI re-score. Founders are excluded; the guard
// blocks a needless re-run regardless of who asks.
const RESCORE_ROLES = [
  "jury",
  "program_associate",
  "program_manager",
  "admin",
  "analyst",
  "associate",
  "partner",
] as const;

/**
 * Roles that may re-drive a stranded evaluation. Narrower than `RESCORE_ROLES`:
 * a re-drive can RESERVE a credit (the terminal failure gave one back), so it
 * belongs to the roles that own intake and the credit budget — not to a juror
 * who just happens to notice a stuck deck.
 */
const RETRY_AI_ROLES = [
  "program_associate",
  "program_manager",
  "admin",
  "analyst",
  "associate",
  "partner",
] as const;

/**
 * POST /api/decks/:id/rescore — re-run the AI evaluation, but only when it would
 * produce something new. The AI is nondeterministic, so we refuse to re-score a
 * deck whose CONTENT and scoring CRITERIA are both unchanged since the last AI
 * run (→ 409 already_scored). A criteria change (admin edits weights / prompt /
 * additional params → org_settings.criteria_version bumps) or a content change
 * (a new PDF version → decks.content_version bumps) unblocks it.
 */
decks.post("/:id/rescore", requireTask("evaluate", ...RESCORE_ROLES), async (c) => {
  const id = c.req.param("id");
  // With AI pre-scoring switched off there is no pass to re-run — say so
  // rather than quietly moving the deck's stage from a "re-score" button.
  const scoring = await loadScoringSettings(c.env.DB, scopeOf(c.var.user));
  if (!scoring.aiPreScoringEnabled) return c.json({ error: "ai_disabled" }, 409);
  const qg = oneDeck(c.var.user, id);
  const deck = await c.env.DB.prepare(
    `SELECT d.id, d.r2_key, d.content_version FROM decks d ${qg.whereClause()}`,
  )
    .bind(...qg.binds)
    .first<{ id: string; r2_key: string | null; content_version: number | null }>();
  if (!deck) return c.json({ error: "not_found" }, 404);

  const qpe = scoped(scopeOf(c.var.user));
  const peJoin = qpe.viaParent("evaluations", "e");
  qpe.and("e.deck_id = ?", id).andRaw("e.evaluator_id IS NULL");
  const priorEval = await c.env.DB.prepare(
    `SELECT e.scored_criteria_version, e.scored_content_version FROM evaluations e ${peJoin} ${qpe.whereClause()}`,
  )
    .bind(...qpe.binds)
    .first<{ scored_criteria_version: number | null; scored_content_version: number | null }>();
  const qo = scoped(scopeOf(c.var.user)).on("os");
  const org = await c.env.DB.prepare(`SELECT os.criteria_version FROM org_settings os ${qo.whereClause()}`)
    .bind(...qo.binds)
    .first<{ criteria_version: number | null }>();
  const currentCriteria = org?.criteria_version ?? 1;
  const currentContent = deck.content_version ?? 1;

  // Guard first, on metadata alone (no R2 read): an existing AI evaluation whose
  // criteria + content versions still match is blocked — nothing changed.
  if (
    priorEval &&
    priorEval.scored_criteria_version === currentCriteria &&
    priorEval.scored_content_version === currentContent
  ) {
    return c.json({ error: "already_scored" }, 409);
  }

  // Something changed (or it was never scored) → we must actually re-run, which
  // needs a stored PDF.
  if (!deck.r2_key) return c.json({ error: "no_pdf" }, 409);

  try {
    const result = await evaluateDeck(c.env, id);
    return c.json({ ok: true, rescored: true, result });
  } catch (err) {
    console.error(`rescore failed for ${id}:`, err);
    return c.json({ error: "evaluation_failed" }, 502);
  }
});

interface DeckMeta {
  name?: string;
  sector?: string;
  stage?: string;
  city?: string;
  founder?: string;
  founderEmail?: string;
  founderPhone?: string;
  programId?: string;
  cohortId?: string;
}

/** Read the deck metadata (and the Session-5 founder/contact columns) off an
 *  upload form. Blank strings collapse to undefined so they never overwrite an
 *  AI-extracted value with "". */
function metaFromForm(form: FormData | null): DeckMeta {
  const s = (k: string) => ((form?.get(k) as string) || "").trim() || undefined;
  return {
    name: s("name"),
    sector: s("sector"),
    stage: s("stage"),
    city: s("city"),
    founder: s("founder"),
    founderEmail: s("founderEmail"),
    founderPhone: s("founderPhone"),
    programId: s("programId"),
    cohortId: s("cohortId"),
  };
}

async function storeDeck(
  c: Context<AppEnv>,
  file: File,
  meta: DeckMeta,
): Promise<string> {
  const id = `deck_${crypto.randomUUID()}`;
  const key = versionKey(id, 1);
  // V4 integration — hand R2 the File, do not materialise it.
  //
  // `await file.arrayBuffer()` copied the whole deck into the isolate on top of
  // the `File` itself, so a 50 MB upload (the new ceiling) held ~100 MB live
  // against a 128 MB Workers isolate limit — and exceeding that limit kills the
  // isolate rather than throwing something catchable. `R2Bucket.put` accepts a
  // Blob (a File is one) and streams it, so the copy is simply unnecessary.
  // miniflare does not enforce the cap, which is why local green proved nothing.
  await c.env.DECKS.put(key, file, {
    httpMetadata: { contentType: "application/pdf" },
  });
  // ── THE WRITE SIDE, WHICH IS THE SILENT HALF ────────────────────────────────
  // This is the ONLY place a `decks` row is created. `tenant_id` carries
  // `DEFAULT 't_default'` (SQLite offers no other way to backfill a NOT NULL
  // column), so an INSERT that simply omitted it would answer 201, put the row in
  // the first customer's workspace, and look entirely correct. `insertScope`
  // returns the columns, the placeholders and the binds together, so the column
  // cannot be named without the value.
  const t = insertScope(scopeOf(c.var.user));
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO decks (id, ${t.columns}, name, name_auto, sector, stage, city, founder, founder_email, founder_phone, ` +
        "program_id, cohort_id, status, r2_key, uploaded_by, complete) " +
        `VALUES (?, ${t.placeholders}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_ai', ?, ?, 1)`,
    ).bind(
      id,
      ...t.binds,
      meta.name || file.name.replace(/\.pdf$/i, "") || "Untitled deck",
      // Aug-2026 issue 12 — a name derived from the file name is PROVISIONAL:
      // the AI extraction replaces it with the startup's real name. A name the
      // uploader typed is authoritative and never overwritten.
      meta.name ? 0 : 1,
      meta.sector ?? null,
      meta.stage ?? null,
      meta.city ?? null,
      meta.founder ?? null,
      meta.founderEmail ?? null,
      meta.founderPhone ?? null,
      meta.programId ?? null,
      meta.cohortId ?? null,
      key,
      c.var.user.id,
    ),
    // Version 1 of the deck's upload history — a re-upload appends to this.
    versionStatement(c.env, {
      deckId: id,
      version: 1,
      key,
      file,
      note: "Initial upload",
      uploadedBy: c.var.user.id,
    }),
  ]);

  // W3-B producer — "New pitchdeck submitted". Here rather than in the two
  // upload routes because this is the only place a deck row is created, so the
  // alert fires exactly once per deck whether it arrived singly or in a bulk
  // batch. After the batch, so it can never describe a deck that failed to
  // store; keyed on the deck id, so it can never fire twice for one.
  const deckName = meta.name || file.name.replace(/\.pdf$/i, "") || "Untitled deck";
  await emitNotification(c.env, {
    event: "deck_submitted",
    edition: c.var.user.edition,
    title: `New pitchdeck submitted: ${deckName}`,
    body:
      `${deckName} was uploaded by ${c.var.user.name} and is queued for AI pre-scoring.\n\n` +
      "Open it in ai.STARTUPJURY to follow the evaluation.",
    link: `/app/decks/${id}`,
    deckId: id,
    actorId: c.var.user.id,
    dedupeKey: `deck_submitted:${id}`,
  });

  return id;
}

/**
 * Run the soft duplicate / returning-company check for a freshly stored deck and
 * record it. Deliberately runs BEFORE the AI call: every evaluation costs a
 * credit, so the point of the duplicate alert is to warn while it's still cheap
 * (§8). `evaluateDeck` re-runs it afterwards with the extracted founder details,
 * which is what catches duplicates in a bulk upload (filenames only up front).
 */
async function flagIntake(
  c: Context<AppEnv>,
  deckId: string,
  meta: DeckMeta,
  name: string,
): Promise<IntakeMatch[]> {
  const classification = await detectIntakeFlags(c.env, scopeOf(c.var.user), {
    name,
    founder: meta.founder,
    founderEmail: meta.founderEmail,
    founderPhone: meta.founderPhone,
    city: meta.city,
    sector: meta.sector,
    fundingStage: meta.stage,
    cohortId: meta.cohortId,
    selfId: deckId,
  });
  if (classification.flag) {
    await intakeFlagStatement(c.env, deckId, classification).run();
  }
  return classification.matches;
}

// Credit accounting lives in `decks/versions.ts` (shared with the public founder
// resubmit route); these wrappers just bind it to the caller's edition.
// The authenticated upload paths DO have a session, so they pass the full scope
// rather than the edition. The two aliases keep their names so the eight call sites
// below read unchanged.
const reserveCredits = (c: Context<AppEnv>, n: number) =>
  reserveEditionCredits(c.env, scopeOf(c.var.user), n);
const refundCredits = (c: Context<AppEnv>, n: number) =>
  refundEditionCredits(c.env, scopeOf(c.var.user), n);

/** POST /api/decks/upload — single deck → R2 → evaluate directly (synchronous). */
decks.post("/upload", async (c) => {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!isPdf(file)) return c.json({ error: "pdf_required" }, 400);
  if (file.size > MAX_PDF_BYTES) return c.json({ error: "pdf_too_large" }, 413);

  // One upload = one credit; reserve before storing so an empty balance blocks.
  if (!(await reserveCredits(c, 1))) return c.json({ error: "no_credits" }, 402);

  const meta = metaFromForm(form);
  // W7-B — programme/cohort validated, sector resolved from the workspace.
  Object.assign(meta, await resolveIntakeContext(c.env, scopeOf(c.var.user), meta));
  let id: string;
  try {
    id = await storeDeck(c, file, meta);
  } catch (err) {
    // Store failed after the credit was reserved — give it back, then surface.
    await refundCredits(c, 1);
    throw err;
  }

  // Soft duplicate / returning check while it's still cheap (before the AI run).
  const matches = await flagIntake(c, id, meta, meta.name || file.name.replace(/\.pdf$/i, ""));

  try {
    const result = await evaluateDeck(c.env, id);
    return c.json({
      deckId: id,
      evaluated: true,
      result,
      // The post-extraction re-check supersedes the pre-AI one when it found more.
      matches: result.intakeFlag ? undefined : matches,
    });
  } catch (err) {
    // A synchronous model/billing error must not strand the deck at pending_ai
    // with nothing re-driving it (§9). Record WHY, then hand it to the retrying
    // queue consumer so it still gets scored once the condition clears.
    console.error(`single-upload evaluation failed for ${id}; enqueueing retry:`, err);
    await recordEvalFailure(c.env, id, err);
    try {
      await c.env.EVAL_QUEUE.send({ deckId: id });
    } catch (qerr) {
      // Nothing can re-drive it now except the cron sweep, and the queue itself
      // is broken — so give up here, refund, and say so, rather than reporting a
      // "pending" that will never resolve.
      console.error(`failed to enqueue retry for ${id}:`, qerr);
      await markEvalTerminal(c.env, id, summariseError(err));
      return c.json(
        {
          deckId: id,
          evaluated: false,
          error: "evaluation_failed",
          reason: classifyEvalError(summariseError(err)),
          matches,
        },
        202,
      );
    }
    return c.json(
      {
        deckId: id,
        evaluated: false,
        error: "evaluation_pending",
        // The real cause, so the upload screen can stop guessing "no AI key".
        reason: classifyEvalError(summariseError(err)),
        matches,
      },
      202,
    );
  }
});

/**
 * POST /api/decks/:id/retry-ai — manual re-drive for a deck stuck (or failed) at
 * `pending_ai`. The §9 lever an operator reaches for once the underlying cause
 * (billing, a key, a rate limit) is fixed: it clears the failure state, resets
 * the attempt counter and re-enqueues.
 *
 * No credit is charged — the original upload already paid for this evaluation,
 * and if it was refunded on a terminal failure the re-drive re-reserves it.
 */
decks.post("/:id/retry-ai", requireTask("upload", ...RETRY_AI_ROLES), async (c) => {
  const user = c.var.user;
  const qg = oneDeck(user, c.req.param("id"));
  const deck = await c.env.DB.prepare(
    `SELECT d.id, d.status, d.ai_credit_refunded FROM decks d ${qg.whereClause()}`,
  )
    .bind(...qg.binds)
    .first<{ id: string; status: string; ai_credit_refunded: number }>();
  if (!deck) return c.json({ error: "not_found" }, 404);
  if (deck.status !== "pending_ai") return c.json({ error: "not_pending" }, 409);

  // A terminal failure gave the credit back; re-driving spends it again. If the
  // balance is empty the deck stays exactly as it was.
  if (deck.ai_credit_refunded === 1) {
    if (!(await reserveCredits(c, 1))) return c.json({ error: "no_credits" }, 402);
    // Scoped like every other write in this file, not because the id could be
    // another customer's — `oneDeck` above already settled that — but so the grep
    // in `docs/parity-requests/T1-DECKS.md` ("no `.bind(deck.id)` on a statement
    // whose WHERE the builder owns") comes back clean and stays a usable check.
    const qc = oneDeck(user, deck.id, "decks");
    await c.env.DB.prepare(`UPDATE decks SET ai_credit_refunded = 0 ${qc.whereClause()}`)
      .bind(...qc.binds)
      .run();
  }

  await clearEvalFailure(c.env, deck.id);
  try {
    await c.env.EVAL_QUEUE.send({ deckId: deck.id });
  } catch (err) {
    await recordEvalFailure(c.env, deck.id, err);
    return c.json({ error: "enqueue_failed" }, 502);
  }
  return c.json({ ok: true, deckId: deck.id, queued: true });
});

/** One row of the bulk-upload report — accepted or rejected, per file. */
interface BulkRow {
  file: string;
  ok: boolean;
  deckId?: string;
  error?: "pdf_required" | "pdf_too_large" | "store_failed";
  /** Soft duplicate / returning alert raised at intake (never a rejection). */
  flag?: "duplicate" | "returning";
  note?: string;
}

/**
 * POST /api/decks/bulk — many decks → R2 → enqueue one eval job each.
 *
 * Per-file validation: a non-PDF or oversized file is **reported, not fatal** —
 * the valid decks still upload and the caller gets a per-row error to show
 * (§8 "surface per-row errors"). Credits are reserved for the accepted files
 * only, all-or-nothing, so a partial batch never uploads on a short balance.
 */
decks.post("/bulk", async (c) => {
  const form = await c.req.formData().catch(() => null);
  const entries = form?.getAll("files") ?? [];

  const rows: BulkRow[] = [];
  const accepted: File[] = [];
  for (const entry of entries) {
    const label = entry instanceof File ? entry.name : "unnamed";
    if (!isPdf(entry)) {
      rows.push({ file: label, ok: false, error: "pdf_required" });
    } else if (entry.size > MAX_PDF_BYTES) {
      rows.push({ file: label, ok: false, error: "pdf_too_large" });
    } else {
      accepted.push(entry);
    }
  }
  if (accepted.length === 0) {
    return c.json({ error: "pdf_required", count: 0, deckIds: [], results: rows }, 400);
  }

  // W7-B (F0223) — the operator's programme, cohort and workspace sector apply
  // to EVERY deck in the batch; only per-deck details are left to the AI.
  const context = await resolveIntakeContext(c.env, scopeOf(c.var.user), metaFromForm(form));

  if (!(await reserveCredits(c, accepted.length))) {
    return c.json({ error: "no_credits" }, 402);
  }

  const deckIds: string[] = [];
  try {
    for (const file of accepted) {
      const name = file.name.replace(/\.pdf$/i, "");
      // No per-deck meta on a bulk upload — the file name is only a PROVISIONAL
      // label (storeDeck marks it name_auto), replaced by the startup name the
      // AI reads off the deck (issue 12).
      const id = await storeDeck(c, file, context);
      await c.env.EVAL_QUEUE.send({ deckId: id });
      deckIds.push(id);
      // Filename-only match up front (cost-driven); evaluateDeck re-checks with
      // the extracted founder details once the queue consumer scores the deck.
      const matches = await flagIntake(c, id, { name, cohortId: context.cohortId }, name);
      rows.push({
        file: file.name,
        ok: true,
        deckId: id,
        flag: matches[0]?.flag,
        note: matches[0]?.reason,
      });
    }
  } catch (err) {
    // Refund the credits reserved for files we didn't get to store/enqueue, so a
    // mid-batch failure only charges for the decks that actually landed.
    await refundCredits(c, accepted.length - deckIds.length);
    throw err;
  }
  return c.json({ count: deckIds.length, deckIds, results: rows });
});

// ── Deck re-upload (new version) ─────────────────────────────────────────────

// Who may replace a deck's PDF: the intake/evaluation staff, plus the founder who
// submitted it (the Session-6 resubmit loop lands the founder here via a
// tokenized link). Jury/IC evaluate, they don't re-submit decks.
const REUPLOAD_ROLES = [
  "founder",
  "program_associate",
  "program_manager",
  "admin",
  "analyst",
  "associate",
] as const;

/**
 * POST /api/decks/:id/version — re-upload a deck as a NEW version.
 *
 * The deck row is kept (so its pipeline history, queries and assignments survive);
 * the new PDF is stored beside the old one, appended to `deck_versions`, and
 * `content_version` is bumped — which is exactly the signal the AI rescore guard
 * (Session 1) waits for, so the deck is re-scored automatically. This is the
 * mechanism Session 6's incomplete-resubmit loop drives.
 */
decks.post("/:id/version", requireTask("upload", ...REUPLOAD_ROLES), async (c) => {
  const { id: userId, edition, role } = c.var.user;
  const id = c.req.param("id");

  const qg = oneDeck(c.var.user, id);
  const deck = await c.env.DB.prepare(
    `SELECT d.id, d.uploaded_by, d.content_version FROM decks d ${qg.whereClause()}`,
  )
    .bind(...qg.binds)
    .first<{ id: string; uploaded_by: string | null; content_version: number | null }>();
  if (!deck) return c.json({ error: "not_found" }, 404);
  // A founder may only replace their own submission.
  if (role === "founder" && deck.uploaded_by !== userId) return c.json({ error: "not_found" }, 404);

  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!isPdf(file)) return c.json({ error: "pdf_required" }, 400);
  if (file.size > MAX_PDF_BYTES) return c.json({ error: "pdf_too_large" }, 413);
  const note = ((form?.get("note") as string) || "").trim() || "Re-uploaded deck";

  // Shared with the public tokenized founder resubmit (`routes/resubmit.ts`), so
  // both paths spend credits, lay out R2 and bump content_version identically.
  const added = await addDeckVersion(c.env, {
    deckId: id,
    edition,
    contentVersion: deck.content_version,
    file,
    note,
    uploadedBy: userId,
  });
  if (!added.ok) return c.json({ error: "no_credits" }, 402);
  if (!added.evaluated) {
    return c.json(
      { ok: true, deckId: id, version: added.version, evaluated: false, error: "evaluation_pending" },
      202,
    );
  }
  return c.json({ ok: true, deckId: id, version: added.version, evaluated: true, result: added.result });
});

export default decks;
