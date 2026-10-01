/**
 * "Areas requiring response" — what the founder is asked to fix (Aug-2026
 * issues 16 and 17) — and the clarification letter that asks for it.
 *
 * The Query screen shows the areas twice: as the "Parameters needing response"
 * column on the list, and as the drill-down a startup name opens. Both come
 * from real evaluation state, in the order the founder should act on it:
 *
 *   1. Required intake columns nobody supplied (founder, email, phone, city,
 *      sector) — the deck is Incomplete until they exist.
 *   2. Deck sections the extraction found absent (Traction, Team, Ask…).
 *   3. Core evaluation areas the AI scored below the workspace's "mediocre"
 *      threshold — weak signal the deck needs to answer.
 *
 * ── W2-C · the clarification question bank ────────────────────────────────
 * Until now the letter listed area LABELS and nothing more: the founder was
 * told *which* area was thin but never asked the BRD's actual question
 * (findings F0030, F0096). The admin console's Clarification question bank
 * (`admin/s-qb.html`) holds 68 curated questions keyed to `parameters.id` —
 * five per area, eight for Climate Impact & Integrity — and its sub-title
 * promises they are "auto-triggered to the startup when the AI detects weak,
 * missing, or contradictory signal in a given area".
 *
 * `selectClarificationQuestions` is that selection, and `buildQueryMessage`
 * composes them into the letter. Both are pure: the caller supplies the bank
 * (the server reads it from D1, `src/server/routes/questions.ts`), so this
 * module stays usable from the worker and the client alike. Passing no bank
 * gives the letter with area bullets only — the Query screen's fallback when
 * the per-deck draft cannot be fetched.
 *
 * ── W7-C · the Query screen, to prototype parity ──────────────────────────
 * The list's row set, its status vocabulary and its CSV row; the one-letter-
 * per-founder composition a multi-founder send depends on (F0215); the link
 * placeholder the server swaps for a real tokenized URL (F0217); and the staff
 * preview of what the founder is asked (`#qview-founder`, F0275).
 */
import { INTAKE_FIELD_LABELS, type IntakeField } from "./intake";
import type { Edition } from "./roles";
import { rubricBand } from "./types";

export type AreaKind = "detail" | "section" | "parameter";

export interface ResponseArea {
  kind: AreaKind;
  label: string;
}

export interface AreaSource {
  /** `readonly` so callers holding a `readonly` list (deckStats.ts) can pass it. */
  missingFields?: readonly IntakeField[];
  missingSections?: string[];
  weakAreas?: string[];
}

export const AREA_KIND_LABELS: Record<AreaKind, string> = {
  detail: "Missing detail",
  section: "Missing slide",
  parameter: "Weak signal",
};

export function areasNeedingResponse(deck: AreaSource): ResponseArea[] {
  const areas: ResponseArea[] = [];
  const seen = new Set<string>();
  const push = (kind: AreaKind, label: string) => {
    const key = `${kind}:${label.toLowerCase()}`;
    if (!label || seen.has(key)) return;
    seen.add(key);
    areas.push({ kind, label });
  };
  for (const f of deck.missingFields ?? []) push("detail", INTAKE_FIELD_LABELS[f]);
  for (const s of deck.missingSections ?? []) push("section", s);
  for (const p of deck.weakAreas ?? []) push("parameter", p);
  return areas;
}

// ═══════════════════════════════════════════════════════════════════════════
// The question bank
// ═══════════════════════════════════════════════════════════════════════════

/**
 * One evaluation area's slice of the bank, as the caller loaded it.
 *
 * `questions` is already filtered to `active = 1` and ordered by `seq` — the
 * store is the only thing that knows those columns, and keeping the ordering
 * in SQL is what makes "reorder writes `seq`" observable end to end. A bank
 * row that was soft-deleted must NOT appear here even though it is still
 * readable on a query already sent.
 */
export interface BankArea {
  /** `parameters.id` — edition-scoped, which is how the bank is keyed. */
  parameterId: string;
  /** The area's display name; matches the `weakAreas` labels on a deck. */
  name: string;
  /** Active question text, in `seq` order. */
  questions: string[];
}

/** An area and the questions the founder is being asked about it. */
export interface AreaQuestions {
  area: string;
  questions: string[];
}

/** Area names compare on case and surrounding space only — never on wording. */
function areaKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * The bank questions a clarification should carry.
 *
 * Only **weak-signal** areas draw from the bank: a missing intake detail or an
 * absent slide is a request for a fact, not a question about an area, and the
 * bank has nothing keyed to either. Areas keep the order
 * `areasNeedingResponse` put them in, and an area with no active questions
 * left is dropped rather than emitted empty.
 */
export function selectClarificationQuestions(
  areas: ResponseArea[],
  bank: BankArea[],
): AreaQuestions[] {
  const byName = new Map<string, BankArea>();
  for (const a of bank) byName.set(areaKey(a.name), a);

  const out: AreaQuestions[] = [];
  const seen = new Set<string>();
  for (const area of areas) {
    if (area.kind !== "parameter") continue;
    const key = areaKey(area.label);
    if (seen.has(key)) continue;
    const entry = byName.get(key);
    if (!entry || entry.questions.length === 0) continue;
    seen.add(key);
    out.push({ area: entry.name, questions: [...entry.questions] });
  }
  return out;
}

/**
 * **NO LONGER ON THE LIVE PATH (1-Oct-2026).** Nothing in `src/` calls this.
 *
 * It answered "would the AI raise this letter?" from the toggle and the area
 * count alone, and the real trigger grew two more refusals that it could not
 * see: no deliverable founder address, and every area being a `detail` (a
 * missing phone is not something to write to the founder about — at the address
 * we are saying is missing). `GET /api/questions/draft/:id` reported this
 * function's answer as `triggered`, so the Query screen could promise a letter
 * the evaluation had already declined to send.
 *
 * The authoritative predicate is now `autoClarifyBlock` in
 * `src/server/config/autoQuery.ts`, which `maybeAutoClarify` itself is built
 * from, so the two cannot drift. **Do not re-wire this one into a route.**
 *
 * Kept because `test/worker/auto-clarify.test.ts` uses it to pin a real
 * invariant — the trigger never fires where this would not — which is a
 * one-way check worth having and is not expressible without it.
 */
export function shouldAutoClarify(opts: {
  autoClarification: boolean;
  areas: ResponseArea[];
}): boolean {
  return opts.autoClarification && opts.areas.length > 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// The letter
// ═══════════════════════════════════════════════════════════════════════════

export interface QueryMessageOptions {
  /**
   * The bank to draw from. Omitted (or empty) the letter is the pre-W2-C one:
   * a bullet list of area labels and nothing else.
   */
  bank?: BankArea[];
}

/** How long a founder has to answer — the prototype's "within 5 working days". */
export const QUERY_RESPONSE_WORKING_DAYS = 5;

/**
 * Stands in for the founder's tokenized link in the composed letter (F0217).
 *
 * The token is minted by the server at the moment the query is recorded — a
 * raw token is never stored and never shown to staff — so the compose card can
 * only show where the link will go. `withResponseLink` is the one substitution
 * between what the card shows and what the founder receives.
 */
export const RESPONSE_LINK_PLACEHOLDER = "[your secure response link]";

/**
 * Put the real link into a letter. An operator who deleted the placeholder
 * still sends a letter with a way back: the link is appended instead, so a
 * founder without an account is never stranded.
 */
export function withResponseLink(body: string, link: string): string {
  if (body.includes(RESPONSE_LINK_PLACEHOLDER)) return body.split(RESPONSE_LINK_PLACEHOLDER).join(link);
  return `${body.trimEnd()}\n\nRespond online: ${link}`;
}

/**
 * The default clarification letter for ONE deck (issue 16/18) — the copy of
 * the prototype's Body textarea (`panel-query.html` #qview-email), with the
 * deck's own flagged areas listed where the prototype had none.
 */
export function buildQueryMessage(
  deckName: string,
  areas: ResponseArea[],
  options: QueryMessageOptions = {},
): string {
  const asked = selectClarificationQuestions(areas, options.bank ?? []);
  const askedNames = new Set(asked.map((a) => areaKey(a.area)));

  // Areas the bank could not answer for still list as bullets — that is every
  // missing detail and slide, plus any weak area whose questions were all
  // deleted. An area the bank DID answer for gets its own block below instead
  // of being named twice.
  const bullets = areas
    .filter((a) => !(a.kind === "parameter" && askedNames.has(areaKey(a.label))))
    .map((a) => `• ${a.label} (${AREA_KIND_LABELS[a.kind].toLowerCase()})`);

  const blocks: string[] = [];
  for (const { area, questions } of asked) {
    blocks.push("", `${area} (${AREA_KIND_LABELS.parameter.toLowerCase()})`);
    questions.forEach((q, i) => blocks.push(`  ${i + 1}. ${q}`));
  }

  const nothingFlagged = bullets.length === 0 && blocks.length === 0;

  return [
    "Dear Founder,",
    "",
    `Thank you for submitting ${deckName}. As part of our evaluation, our review panel needs a few additional clarifications on areas where the deck signalled incomplete information:`,
    "",
    ...(nothingFlagged
      ? ["• (no specific areas flagged — please review your submission)"]
      : bullets),
    ...blocks,
    "",
    "Click the secure link below to respond to the flagged areas online:",
    "",
    `→ ${RESPONSE_LINK_PLACEHOLDER}`,
    "",
    `Responses are due within ${QUERY_RESPONSE_WORKING_DAYS} working days.`,
    "",
    "Warm regards,",
    "The Evaluation Team",
  ].join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// One letter per founder (F0215)
// ═══════════════════════════════════════════════════════════════════════════

export interface FounderLetter {
  deckId: string;
  deckName: string;
  areas: ResponseArea[];
  body: string;
}

/**
 * The letters a multi-founder send posts — one per deck, each built from THAT
 * deck's areas alone. Selecting three startups must never mail any founder
 * another startup's missing slides or weak areas: the areas are never unioned,
 * and the deck name in each letter is its own.
 */
export function composeFounderLetters(
  decks: ({ id: string; name: string } & AreaSource)[],
  options: QueryMessageOptions = {},
): FounderLetter[] {
  return decks.map((deck) => {
    const areas = areasNeedingResponse(deck);
    return { deckId: deck.id, deckName: deck.name, areas, body: buildQueryMessage(deck.name, areas, options) };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// The founder queries list (#qview-list)
// ═══════════════════════════════════════════════════════════════════════════

/** The prototype's `qStatusLabel` — exactly three, and nothing else. */
export type QueryListStatus = "pending" | "overdue" | "responded";

export const QUERY_STATUS_LABELS: Record<QueryListStatus, string> = {
  pending: "Pending",
  overdue: "Overdue",
  responded: "Responded",
};

/** The fields of a `queries` row the list reads. */
export interface QueryRecord {
  deck_id: string;
  founder_response: string | null;
  created_at: string;
}

/** D1's `datetime('now')` carries no zone and is UTC. ISO strings pass through. */
export function parseQueryTimestamp(value: string): Date {
  const sqlite = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/;
  return new Date(sqlite.test(value) ? `${value.replace(" ", "T")}Z` : value);
}

/** `days` weekdays after `from`, in UTC — Saturday and Sunday are not working days. */
export function addWorkingDays(from: Date, days: number): Date {
  const d = new Date(from.getTime());
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const weekday = d.getUTCDay();
    if (weekday !== 0 && weekday !== 6) added += 1;
  }
  return d;
}

/** When the answer to a query raised at `createdAt` falls due. */
export function queryDueAt(createdAt: string): Date {
  return addWorkingDays(parseQueryTimestamp(createdAt), QUERY_RESPONSE_WORKING_DAYS);
}

/** The newest query in a deck's history, whatever order the caller holds. */
export function latestQuery<Q extends QueryRecord>(queries: Q[]): Q | undefined {
  let latest: Q | undefined;
  for (const q of queries) {
    if (!latest || parseQueryTimestamp(q.created_at) > parseQueryTimestamp(latest.created_at)) latest = q;
  }
  return latest;
}

/**
 * A row's status, from its real query history.
 *
 * A flagged deck nobody has emailed yet is **Pending** — the prototype's
 * `upSendToQuery` puts a deck on this list as `pending` before any email goes
 * out. It is **Overdue** once an unanswered query is older than five working
 * days (F0341), and **Responded** once the founder answers the newest one.
 */
export function queryStatusOf(queries: QueryRecord[], now = Date.now()): QueryListStatus {
  const latest = latestQuery(queries);
  if (!latest) return "pending";
  if (latest.founder_response) return "responded";
  return now > queryDueAt(latest.created_at).getTime() ? "overdue" : "pending";
}

/** Stages a founder clarification is raised from. */
export const QUERYABLE_STAGES: Record<Edition, readonly string[]> = {
  // The AI flagged it Incomplete, or it is parked in manual review.
  incubator: ["incomplete", "manual_review"],
  // VC raises a query while the deal is being screened — the AI stopped it as
  // Incomplete, or the analyst and associate are scoring it — and not after:
  // from partner review on, a question for the founder is the partner call's,
  // not an intake clarification (W9-A confirmed, §8). The Upload review list's
  // Send to Query reaches the same stages, since an uploaded VC deal lands at
  // `pending_ai` and the AI moves it to `incomplete` or `analyst_scoring`.
  vc: ["incomplete", "analyst_scoring", "associate_review"],
};

/**
 * Where a deck waits between the founder's answer and review picking it back
 * up — `founder_response` moves an incubator deck `incomplete → uploaded`
 * (`src/pipeline/incubator.ts`), and it is re-scored from there.
 *
 * The VC pipeline has NO `founder_response` transition (`src/pipeline/vc.ts`):
 * a VC founder's answer changes no stage. So on VC an answered query stays
 * listed — as Responded — only while the deal is still in a queryable stage,
 * and drops off once the associate moves it on to partner review. The one VC
 * path back through intake is a founder resubmitting the deck through the
 * secure link, which re-scores it from `pending_ai`; `uploaded` is the VC
 * pipeline's initial stage, kept so a deal put back there is not lost either.
 */
export const AWAITING_REVIEW_STAGES: Record<Edition, readonly string[]> = {
  incubator: ["uploaded", "pending_ai"],
  vc: ["uploaded", "pending_ai"],
};

/** Stages that are an AI flag in themselves, whatever the areas say. */
const FLAG_STAGES = ["incomplete", "manual_review"];

// ═══════════════════════════════════════════════════════════════════════════
// V4-ROUTE — the routing invariant (the client's items 6 and 7)
// ═══════════════════════════════════════════════════════════════════════════
//
// His rule, verbatim (2026-09-20): *"in the stat box of 'Evaluated' only the
// ones that are marked 'complete' in the status column have to be sent to
// 'assign' … Similarly, the ones that are marked 'incomplete' have to go to
// 'Query'."*
//
// He is describing a guard on a bulk action that this build does not have —
// there is no multi-select and no Send to Assign on the Dashboard, and
// `V3_EXCLUDED_ACTIONS` withholds `assign_jury` for a stated reason (plan §4
// Q32). In our architecture the same sentence is a **routing invariant**: a
// complete deck belongs on Assign, an incomplete one on Query, and the two
// lists partition. `deckListRoute` is that invariant — one function, one
// answer per deck, so "on both screens" is not a state it can express.
//
// ── Where complete / incomplete comes from (measured, §4.1) ────────────────
// `decks.complete` (migrations/0001_init.sql:67, DEFAULT 1) is the mark. TWO
// things write it, not one — V4 integration corrected this comment, which said
// "the only thing":
//
//   · `src/server/ai/evaluate.ts` sets it from the AI's own read of the deck;
//   · `src/server/routes/pipeline.ts` (`POST /api/queries/:id/respond`) sets it
//     to 1 when a founder answers a clarification. That is the ONLY exit from
//     stage `incomplete` (`src/pipeline/incubator.ts`, `incomplete -> uploaded`
//     via `founder_response`), so it is the designed recovery path — but it
//     flips the mark with no AI re-read and without clearing `missing_fields`.
//     Untested in either direction; see §4.1.
//
// The AI's write is:
//
//     complete: parsed.complete && missingIntakeFields(details).length === 0
//
// `computeResult` then turns `!complete` into stage `incomplete` + signal
// `flagged`. So at the moment of evaluation the stage and the mark agree — and
// afterwards they drift, three ways, all three measured:
//
//   (a) `PATCH /api/decks/:id` re-derives `missing_fields` and neither
//       `complete` nor the stage, so filling in the missing phone leaves the
//       deck marked incomplete with nothing left to ask;
//   (b) the same edit in reverse — blanking a founder's email on an
//       `ai_evaluated` deck — leaves `complete = 1`, so a deck with a missing
//       required detail stayed assignable and reached no clarification;
//   (c) `manual_review → ai_evaluated` (`approve_review`) and
//       `rejected|archived → ai_evaluated` (`restore`) put a deck on Assign's
//       roster without consulting the mark at all: a deck at `complete = 0`
//       with `missing_fields` still set walked onto Assign in four requests.
//
// So the mark is re-derived HERE, at read time, from the two live columns,
// using evaluate.ts's own formula. Nothing is frozen and nothing can go stale.
//
// **Not `missingIntakeFields` on the live detail columns.** That was the
// obvious next step and it is wrong on real data: eleven VC seed deals carry
// `complete = 1` and empty `missing_fields` with no founder, email or phone at
// all, because a sourced deal has no founder submission behind it. Deriving
// from the columns marks all eleven incomplete. `missing_fields` is the
// recorded intake decision; the columns are not a proxy for it.

/** A deck, as far as the completeness mark is concerned. */
export interface DeckCompleteness {
  /** `decks.complete` — the AI's own "I could read and score this deck". */
  complete?: boolean;
  /** `decks.missing_fields` — required intake columns nobody supplied. */
  missingFields?: readonly IntakeField[];
}

/**
 * Is this deck marked **complete**?
 *
 * `evaluate.ts`'s formula, re-evaluated from the stored columns rather than
 * read back out of the frozen flag. An absent `complete` reads as complete,
 * matching the column's own `DEFAULT 1`: a caller that forgot to select it
 * loses the new arm of the invariant rather than emptying the Assign screen.
 * A worker test pins the field's presence on the response so that cannot pass
 * unnoticed.
 */
export function isDeckComplete(deck: DeckCompleteness): boolean {
  return deck.complete !== false && (deck.missingFields ?? []).length === 0;
}

/**
 * The stages the Assign screen's column 1 draws from — `AssignPage`'s
 * "Evaluated decks", which is `ai_evaluated` (awaiting an evaluator) plus
 * `assigned` (so a second juror can be added, which is why the prototype keeps
 * assigned rows badged rather than dropping them).
 *
 * **VC is empty, and that is not a placeholder.** The VC pipeline has neither
 * stage (`src/pipeline/vc.ts`), so column 1 has always been empty there and
 * the invariant cannot move a VC deal in either direction. The edition was not
 * rescoped; this keeps it measurably untouched.
 */
export const ASSIGNABLE_STAGES: Record<Edition, readonly string[]> = {
  incubator: ["ai_evaluated", "assigned"],
  vc: [],
};

/** Which of the two screens a deck belongs on — at most one, by construction. */
export type DeckListRoute = "assign" | "query" | null;

// ═══════════════════════════════════════════════════════════════════════════
// ROW 3 — Query membership stops being a derivation (S0-VOCAB, 2026-09-30)
// ═══════════════════════════════════════════════════════════════════════════
//
// The client's 24-Sep feedback row 3: decks with **incomplete decks or
// incomplete contact details must not reach the Query screen automatically** —
// only when Send to Query is clicked. That reverses V4-ROUTE's Query half (the
// block above) while leaving its Assign half exactly as it is.
//
// **His stated reason is a live defect, not a preference.**
// `POST /api/decks/:id/queries` emails a deck that has no contact details —
// `src/server/routes/pipeline.ts:770-771`:
//
//     const toEmail = deck.founder_email ?? uploader?.email ?? "founder@portal.local";
//
// — and then mints a resubmit token and sends both to that placeholder address.
// `deckListRoute` is what puts such a deck on the Query list with no click, and
// the Dashboard arms the button from the same function. Fixing the send is
// F-FOUL's and S2-SERVER's; stopping the automatic arming is this function's.
//
// ── What changes, precisely ────────────────────────────────────────────────
//   · `ASSIGNABLE_STAGES ∧ ¬isDeckComplete` no longer returns "query". It
//     returns null: the deck is off Assign, and it reaches Query when an
//     operator sends it there.
//   · `FLAG_STAGES` (`incomplete`, `manual_review`) no longer auto-lists. Stage
//     `incomplete` IS the AI's "this deck is incomplete" verdict, so listing on
//     it is precisely the derivation row 3 deletes.
//   · `areasNeedingResponse(deck) > 0` no longer auto-lists.
//   · The ASSIGN ARM IS UNTOUCHED, and so is the rule that keeps a deck with
//     query history listed while it is still in intake or review (F0214).
//
// ── Why this lands as a flag and not as a deletion ────────────────────────
// The plan (`docs/plan_screening.md` §6.1) gives row 3's two halves to
// S2-SERVER (`routes/decks.ts`'s `?list=` post-filter) and S2-DASH
// (`DashboardPage.tsx`'s enablement), and gives S0-VOCAB only the shared
// function. Three test files pin the OLD derivation and none of them belong to
// this session — `test/worker/route-partition.test.ts` (which is V4-ROUTE's
// negative control and belongs to no session in this wave),
// `test/worker/ai-complete.test.ts:153` and the Query/Assign client mocks. So
// both readings live here, the new one is fully specified and pinned in
// `test/unit/queries.test.ts`, and turning it on is the ONE-LINE flip below —
// owned by the session that also owns the tests that move with it. This is the
// same mechanism `ASSIGNED_TILE_RETAINED_PENDING_Q7` used in `deckStats.ts`,
// and that constant's own history is the argument for it: a decided question
// parked on a named constant got answered and flipped in one line.
//
// **The reading is not open. Only the flip is.** See the handoff note for the
// measured list of tests that move.

/**
 * Is Query membership still DERIVED from incompleteness?
 *
 * `true` is today's behaviour and the shipped default. **S2-SERVER sets
 * `incubator` to `false`** in the same change that makes `?list=query` mean
 * "queried", and re-owns the test files listed above. Individual callers can
 * override it per call with `opts.deriveQuery`.
 *
 * **Per edition, and that is the point of the shape** — every other list rule
 * in this file is already keyed on edition (`QUERYABLE_STAGES`,
 * `AWAITING_REVIEW_STAGES`, `ASSIGNABLE_STAGES`). His screening spec is the
 * INCUBATOR's: his §5 matrix, his §4 diagram and his stat boxes are all the
 * incubator superuser Dashboard, `ASSIGNABLE_STAGES.vc` is already empty, and
 * VC's auto-listing rules came from the VC prototype (F0274 — an unflagged deal
 * in analyst scoring is not listed; F0341 — five working days). Flipping both
 * editions on one boolean would delete those without him having asked. Whether
 * row 3 reaches the VC Query screen is a question in the handoff note.
 */
export const QUERY_MEMBERSHIP_IS_DERIVED_PENDING_ROW3: Record<Edition, boolean> = {
  incubator: true,
  vc: true,
};

/**
 * The one authority for items 6 and 7.
 *
 * A deck in the evaluated population goes to **Assign** when it is marked
 * complete and to **Query** when it is not — which is the client's sentence,
 * enforced on the list rather than on a button. Everything else keeps the
 * behaviour it had: the flagged and manual-review stages route to Query, as
 * does a deck with query history still in intake or review (so an ANSWERED
 * query stays listed as Responded with the founder's answer one click away —
 * F0214, which a strict reading of his words would have reversed).
 *
 * `queried` is `decks.query_count > 0`, i.e. `DeckView.queried`: the decision
 * needs only whether the deck has been queried, never when or by whom, which
 * is what lets the server evaluate it on the row it already selects.
 *
 * **Row 3 (2026-09-30) removes the Query arm's derivation** — see the block
 * above. `opts.deriveQuery` selects the reading; the Assign arm is the same
 * under both, and under BOTH readings the two lists still partition, which is
 * what the return type is for.
 */
export function deckListRoute(
  deck: AreaSource & DeckCompleteness & { statusId?: string },
  edition: Edition,
  opts: { queried: boolean; deriveQuery?: boolean },
): DeckListRoute {
  const stage = deck.statusId ?? "";
  const derive = opts.deriveQuery ?? QUERY_MEMBERSHIP_IS_DERIVED_PENDING_ROW3[edition];

  // ── The ASSIGN arm. Identical under both readings. ───────────────────────
  // The client's "stat box of Evaluated": a deck marked complete belongs on
  // Assign, and one that is not marked complete is off it. What row 3 takes
  // away is only the CONCLUSION that being off Assign puts it on Query.
  if (ASSIGNABLE_STAGES[edition].includes(stage)) {
    if (isDeckComplete(deck)) return "assign";
    // The pre-row-3 conclusion, retained behind the flag: off Assign therefore
    // on Query. This is the arm the client's row 3 names first.
    if (derive) return "query";
  }

  // ── The QUERY arm. ───────────────────────────────────────────────────────
  // Sent to Query, and still inside the stage window that keeps it listed.
  if (opts.queried) return isQueryStageWindow(deck, edition) ? "query" : null;
  // Row 3: nothing else reaches the Query screen. A deck that is incomplete and
  // has not been sent is on neither list — and it is not lost, because the
  // uploaded status screen draws EVERY deck, always ("all decks, including
  // archived, stay on the uploaded status screen", his own display rule).
  if (!derive) return null;

  // ── The rest of the pre-row-3 derivation. ────────────────────────────────
  if (!QUERYABLE_STAGES[edition].includes(stage)) return null;
  return FLAG_STAGES.includes(stage) || areasNeedingResponse(deck).length > 0 ? "query" : null;
}

/**
 * The stage window a QUERIED deck stays listed in: still being screened, or
 * waiting for review to pick the founder's answer back up.
 *
 * Unchanged by row 3 and named only so both arms above can share it. It is what
 * keeps F0214 true — an answered query stays listed as Responded with the
 * founder's answer one click away, instead of vanishing the moment they reply —
 * and what drops a deal that has moved past screening.
 */
function isQueryStageWindow(deck: { statusId?: string }, edition: Edition): boolean {
  const stage = deck.statusId ?? "";
  return QUERYABLE_STAGES[edition].includes(stage) || AWAITING_REVIEW_STAGES[edition].includes(stage);
}

/**
 * Does this deck belong on the founder queries list?
 *
 * A named reading of `deckListRoute`'s Query arm, kept because the suite
 * written against it (`test/unit/queries.test.ts`, "which decks the list
 * shows") is the control proving V4-ROUTE left every earlier listing decision
 * where it was. The Assign arm has no wrapper: nothing needs one.
 *
 *  • A deck with query history stays while it is still in intake or review —
 *    so an ANSWERED query remains listed as Responded, the founder's answer one
 *    click away (F0214), instead of vanishing the moment the founder replies.
 *  • A deck nobody has queried is listed only when there is something to ask:
 *    its stage is itself a flag, or it has areas needing a response. A VC deal
 *    in analyst scoring with nothing flagged is not "AI-flagged" (F0274).
 *  • V4-ROUTE — **and an evaluated deck that is marked incomplete**, which is
 *    the other half of the invariant: it is off Assign, so it has to be here.
 *    **This is the bullet row 3 deletes** — under the new reading such a deck is
 *    on neither list until Send to Query is clicked. See
 *    `QUERY_MEMBERSHIP_IS_DERIVED_PENDING_ROW3`.
 */
export function isQueryListed(
  deck: AreaSource & DeckCompleteness & { statusId?: string },
  queries: QueryRecord[],
  edition: Edition,
  opts: { deriveQuery?: boolean } = {},
): boolean {
  return deckListRoute(deck, edition, { queried: queries.length > 0, ...opts }) === "query";
}

/** The list's column set, in order, as the prototype's `.qtbl` heads it. */
export const QUERY_LIST_HEADERS = [
  "Startup",
  "Founder",
  "Phone",
  "Email",
  "Status",
  "Parameters needing response",
] as const;

/** One exported row, in `QUERY_LIST_HEADERS` order. */
export function queryListCsvRow(
  deck: { name: string; founder?: string; founderPhone?: string; founderEmail?: string } & AreaSource,
  status: QueryListStatus,
): string[] {
  return [
    deck.name,
    deck.founder ?? "",
    deck.founderPhone ?? "",
    deck.founderEmail ?? "",
    QUERY_STATUS_LABELS[status],
    areasNeedingResponse(deck)
      .map((a) => a.label)
      .join("; "),
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// The founder clarification flow (#qview-founder)
// ═══════════════════════════════════════════════════════════════════════════

/** An AI score row, as `GET /api/decks/:id` returns it. */
export interface ScoredArea {
  label: string;
  /** The area's percentage weight in the composite. */
  weight?: number;
  value: number;
  comment?: string | null;
}

export type FlaggedSignal = "weak" | "absent";
export type SufficientSignal = "strong" | "moderate";

export const SIGNAL_LABELS: Record<FlaggedSignal | SufficientSignal, string> = {
  weak: "Weak signal",
  absent: "Absent",
  strong: "Strong",
  moderate: "Moderate",
};

export interface FlaggedArea {
  label: string;
  kind: AreaKind;
  signal: FlaggedSignal;
  weight?: number;
  /** "What the AI found". */
  found: string;
  /** The bank's questions for the area, when it has any. */
  questions: string[];
}

export interface SufficientArea {
  label: string;
  signal: SufficientSignal;
  weight?: number;
}

export interface ClarificationFlow {
  flagged: FlaggedArea[];
  sufficient: SufficientArea[];
  /** Evaluation areas the AI scored. */
  total: number;
  strongCount: number;
  /** Share of the scored areas with sufficient signal, 0–100. */
  percent: number;
}

/**
 * What the founder is asked, area by area, and what is already fine — the
 * prototype's `#qview-founder`: the flagged blocks, the "Areas with sufficient
 * signal (no action needed)" roster, and the "N of M areas" completion bar.
 *
 * A weak area whose score sits in the rubric's Insufficient band (0–2) reads as
 * Absent; a missing slide or detail is Absent by definition. A sufficient area
 * is Strong from 7 and Moderate below — the specs' §7 bands.
 */
export function clarificationFlow(input: {
  deck: AreaSource;
  scores: ScoredArea[];
  questions: AreaQuestions[];
}): ClarificationFlow {
  const scoreByArea = new Map(input.scores.map((s) => [areaKey(s.label), s]));
  const questionsByArea = new Map(input.questions.map((q) => [areaKey(q.area), q.questions]));
  const weak = new Set((input.deck.weakAreas ?? []).map(areaKey));

  const flagged = areasNeedingResponse(input.deck).map((area): FlaggedArea => {
    if (area.kind === "parameter") {
      const score = scoreByArea.get(areaKey(area.label));
      return {
        label: area.label,
        kind: area.kind,
        signal: score && rubricBand(score.value).key === "insufficient" ? "absent" : "weak",
        weight: score?.weight,
        found: score?.comment?.trim() || "The deck's signal in this area is too weak to evaluate it.",
        questions: questionsByArea.get(areaKey(area.label)) ?? [],
      };
    }
    return {
      label: area.label,
      kind: area.kind,
      signal: "absent",
      found:
        area.kind === "section"
          ? `No ${area.label} section was found in the deck.`
          : `${area.label} was not found in the deck or the submission details.`,
      questions: [],
    };
  });

  const sufficient = input.scores
    .filter((s) => !weak.has(areaKey(s.label)))
    .map((s): SufficientArea => ({ label: s.label, signal: s.value >= 7 ? "strong" : "moderate", weight: s.weight }));

  const total = input.scores.length;
  return {
    flagged,
    sufficient,
    total,
    strongCount: sufficient.filter((s) => s.signal === "strong").length,
    percent: total > 0 ? Math.round((sufficient.length / total) * 100) : flagged.length > 0 ? 0 : 100,
  };
}
