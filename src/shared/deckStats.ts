/**
 * The six All-decks stat boxes and the pipeline-progress rail derived from them
 * (Aug-2026 issues 4, 5 and 7).
 *
 * Issue 4/5 renamed the last two boxes to **Assigned** and **Shortlisted**, and
 * issue 7 requires the right rail's "Pipeline progress" items to be *the same
 * titles as the stat boxes* — so both come from this one list. `Uploaded` is the
 * denominator, exactly as the prototype's `mpProgress()` treats `data-stat="all"`.
 *
 * **V3-DASH** adds a THIRD incubator set at the foot of this file —
 * `v3DeckStats` / `matchesV3Stat`, the reshared superuser prototype's six —
 * with its own builder, because its tiles are a different partition and it
 * pins Uploaded's own bar to 100. It is superuser-only; the six described here
 * still serve admin, PM, PA and the VC edition unchanged. (Its denominator
 * once excluded archived decks; since 2026-09-23 archiving is a STATE rather
 * than a move, so Uploaded — and therefore the denominator — holds them.)
 *
 * Each edition has its own six (`STAT_ORDER`): the incubator's cohort stages
 * (`AISJ_IC_SuserV15`) and the VC edition's deal funnel (`AISJ_VC_Superuser_V8`
 * — Uploaded · Incomplete · AI Evaluated · In Diligence · IC ready · Onboard
 * ready, F0437 / F0440). The VC IC member's build replaces the six outright
 * with a first-person set ("Awaiting my vote", F0434) — `icMemberStats`.
 */
import type { Edition } from "./roles";
import { vcPipeline } from "../pipeline/vc";
// The five-working-day rule the founder-query list already uses for "Overdue".
// `queries.ts` does not import this file, so this direction is the acyclic one.
import { deckListRoute, queryDueAt } from "./queries";
import type { IntakeField } from "./intake";

/** The incubator's six boxes (the prototype's `data-stat` keys). */
export type DeckStatKey =
  | "all"
  | "pending"
  | "incomplete"
  | "evaluated"
  | "assigned"
  | "shortlisted";

/**
 * The VC staff boxes. The prototype reuses the incubator's `data-stat` keys for
 * them (its "pending" box is Incomplete, its "assigned" box IC ready…); these
 * names say what each one selects instead.
 */
export type VcStatKey = "uploaded" | "vcIncomplete" | "aiEvaluated" | "inDiligence" | "icReady" | "onboardReady";

/** The VC IC member's boxes (`AISJ_VC_IC_member_V2` `data-stat`). */
export type IcStatKey = "atIc" | "myvote" | "myeval" | "agenda" | "pipeline" | "funded";

export type StatKey = DeckStatKey | VcStatKey;

/** The minimum a deck must expose to be counted. */
export interface StatDeck {
  id?: string;
  aiScore?: number;
  statusId?: string;
  signal?: string;
  assignedTo?: string;
  /** ISO / SQLite timestamp — the Uploaded box's "+N since yesterday / this week". */
  uploadedAt?: string;
  /**
   * `decks.query_count > 0` — the deck has been Sent to Query. **A tile input,
   * not only a status input** (S0-VOCAB / C10): the client's `Incomplete,
   * Queried` sink is counted in the **Incomplete** box, and a queried deck can
   * be sitting at a post-AI stage. See `isScreeningIncompleteTile`.
   */
  queried?: boolean;
  /**
   * The `send_to_assign` marker `pipeline_events` carries with
   * `from_stage === to_stage` — S2-SERVER writes it, and it is the ONLY
   * authority for the `AI Evaluated, Assigned` sink. Absent on every row until
   * that session lands, which is why it is optional here rather than required.
   */
  sendToAssignAt?: string | null;
}

/** Stages that mean "this deck cleared the shortlist bar" (incubator). */
const SHORTLISTED_STAGES = ["shortlisted", "intro", "signup", "onboard_ready"];

/** Stages that mean "allocated to an evaluator and being worked" (incubator). */
const ASSIGNED_STAGES: readonly string[] = ["assigned", "jury_evaluation"];

// ── The VC deal funnel ───────────────────────────────────────────────────────

const VC_ORDER = vcPipeline.stages.map((s) => s.id);

/**
 * Has this deal REACHED `stage`? The VC boxes are a funnel, not six pipeline
 * positions: the prototype's `adData` files a deal that is Onboard ready under
 * AI Evaluated, In Diligence and IC ready as well (`st: 'all incomplete
 * evaluated assigned shortlisted'`), and its seeded counts only add up that way
 * (24 uploaded → 20 AI evaluated → 8 → 5 → 3). An archived deal has left the
 * funnel; it counts as uploaded and AI evaluated, never as further along.
 */
export function vcReached(statusId: string | undefined, stage: string): boolean {
  if (!statusId || statusId === "archived") return false;
  const at = VC_ORDER.indexOf(statusId);
  return at >= 0 && at >= VC_ORDER.indexOf(stage);
}

/** Not yet through the AI: still at intake, or stopped there as Incomplete. */
const VC_PRE_AI = ["uploaded", "pending_ai", "incomplete"];

/**
 * A VC deal's furthest funnel box, as the Uploaded view's **Stage** pill names
 * it (the prototype's `adData[].label`). Two words the prototype never needs —
 * a deal still with the AI, and one that has left the pipeline — are the
 * pipeline's own labels.
 */
export function vcFunnelLabel(statusId: string | undefined): {
  label: string;
  key: VcStatKey | null;
} {
  const s = statusId ?? "";
  if (s === "incomplete") return { label: "Incomplete", key: "vcIncomplete" };
  if (s === "archived") return { label: "Archived", key: null };
  if (VC_PRE_AI.includes(s) || !VC_ORDER.includes(s)) return { label: "Pending AI", key: null };
  if (vcReached(s, "alignment_call")) return { label: "Onboard ready", key: "onboardReady" };
  if (vcReached(s, "ic_review")) return { label: "IC ready", key: "icReady" };
  if (vcReached(s, "investment_dd")) return { label: "In Diligence", key: "inDiligence" };
  return { label: "AI Evaluated", key: "aiEvaluated" };
}

// ── The table of boxes ───────────────────────────────────────────────────────

export interface DeckStat<K extends string = StatKey> {
  key: K;
  label: string;
  value: number;
  sublabel: string;
  /** Percentage of the Uploaded total (0–100). */
  progress: number;
  /** CSS colour token for the bar + the pipeline-progress dot. */
  color: string;
}

function pct(n: number, total: number): number {
  return total === 0 ? 0 : Math.round((n / total) * 100);
}

/** SQLite's "YYYY-MM-DD HH:MM:SS" is UTC with no zone; ISO strings parse as-is. */
function parseTs(iso: string): number {
  return Date.parse(iso.endsWith("Z") || iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
}

function uploadedSince(decks: StatDeck[], since: number): number {
  return decks.filter((d) => d.uploadedAt && parseTs(d.uploadedAt) >= since).length;
}

interface StatDef<K extends string, D> {
  key: K;
  label: string;
  /** `panel-alldecks.html`'s `.scf` bar colour. */
  color: string;
  matches: (deck: D) => boolean;
  sub: (n: number, total: number, decks: D[], now: number) => string;
}

const DAY = 86_400_000;

const STAT_ORDER: { incubator: StatDef<DeckStatKey, StatDeck>[]; vc: StatDef<VcStatKey, StatDeck>[] } = {
  // `AISJ_IC_SuserV15` — copy and bar colours as the prototype draws them (F0323).
  incubator: [
    {
      key: "all",
      label: "Uploaded",
      color: "var(--olive)",
      matches: () => true,
      sub: (_n, _t, decks, now) => `+${uploadedSince(decks, now - DAY)} since yesterday`,
    },
    {
      key: "pending",
      label: "Pending",
      color: "var(--amber)",
      matches: (d) => d.aiScore === undefined && d.statusId !== "incomplete",
      sub: () => "Awaiting evaluation",
    },
    {
      key: "incomplete",
      label: "Incomplete",
      color: "var(--red)",
      matches: (d) => d.statusId === "incomplete" || d.signal === "flagged",
      sub: () => "Missing slides",
    },
    {
      key: "evaluated",
      label: "AI Evaluated",
      color: "var(--olive)",
      matches: (d) => d.aiScore !== undefined,
      sub: (n, total) => `${pct(n, total)}% of uploaded`,
    },
    // Issue 4 — the fifth box is ASSIGNED: explicitly allocated to someone, or
    // sitting in a scoring stage.
    {
      key: "assigned",
      label: "Assigned",
      color: "var(--blue)",
      matches: (d) => Boolean(d.assignedTo) || ASSIGNED_STAGES.includes(d.statusId ?? ""),
      sub: (n, total) => `${pct(n, total)}% of uploaded`,
    },
    // Issue 5 — the sixth box is SHORTLISTED.
    {
      key: "shortlisted",
      label: "Shortlisted",
      color: "var(--green)",
      matches: (d) => SHORTLISTED_STAGES.includes(d.statusId ?? ""),
      sub: (n, total) => `${pct(n, total)}% shortlist rate`,
    },
  ],
  // `AISJ_VC_Superuser_V8` panel-alldecks.html:32-37 — the same six in the
  // Admin, Partner, Associate and Analyst builds (md5-identical).
  vc: [
    {
      key: "uploaded",
      label: "Uploaded",
      color: "var(--olive)",
      matches: () => true,
      sub: (_n, _t, decks, now) => `+${uploadedSince(decks, now - 7 * DAY)} this week`,
    },
    {
      key: "vcIncomplete",
      label: "Incomplete",
      color: "var(--red)",
      matches: (d) => d.statusId === "incomplete",
      sub: () => "Missing materials",
    },
    {
      // Through the AI and not stopped as Incomplete. Read off the STAGE, not
      // the score, so blind scoring (which withholds `aiScore` from an evaluator
      // who has not submitted) cannot empty the box.
      key: "aiEvaluated",
      label: "AI Evaluated",
      color: "var(--olive)",
      matches: (d) => !VC_PRE_AI.includes(d.statusId ?? "") && VC_ORDER.includes(d.statusId ?? ""),
      sub: (n, total) => `${pct(n, total)}% of uploaded`,
    },
    {
      key: "inDiligence",
      label: "In Diligence",
      color: "var(--amber)",
      matches: (d) => vcReached(d.statusId, "investment_dd"),
      sub: () => "Active diligence",
    },
    {
      key: "icReady",
      label: "IC ready",
      color: "var(--blue)",
      matches: (d) => vcReached(d.statusId, "ic_review"),
      sub: () => "Queued for committee",
    },
    {
      // Cleared by the committee and the Managing Partner's Invest: the
      // alignment call, term sheet, legal DD and the onboard-ready deal itself.
      key: "onboardReady",
      label: "Onboard ready",
      color: "var(--green)",
      matches: (d) => vcReached(d.statusId, "alignment_call"),
      sub: () => "Cleared to onboard",
    },
  ],
};

function build<K extends string, D>(defs: StatDef<K, D>[], decks: D[], now: number): DeckStat<K>[] {
  const total = decks.length;
  return defs.map((def, i) => {
    const value = decks.filter(def.matches).length;
    return {
      key: def.key,
      label: def.label,
      value,
      sublabel: def.sub(value, total, decks, now),
      progress: i === 0 ? 100 : pct(value, total),
      color: def.color,
    };
  });
}

/** The six staff stat boxes for an edition, in the order the design puts them. */
export function deckStats(edition: "incubator", decks: StatDeck[], now?: number): DeckStat<DeckStatKey>[];
export function deckStats(edition: "vc", decks: StatDeck[], now?: number): DeckStat<VcStatKey>[];
export function deckStats(edition: Edition, decks: StatDeck[], now?: number): DeckStat[];
export function deckStats(edition: Edition, decks: StatDeck[], now = Date.now()): DeckStat[] {
  return edition === "vc" ? build(STAT_ORDER.vc, decks, now) : build(STAT_ORDER.incubator, decks, now);
}

/** Does a deck belong under a stat box (the table filter)? A key the edition does not draw matches nothing. */
export function matchesStat(edition: Edition, deck: StatDeck, key: StatKey): boolean {
  const defs: StatDef<string, StatDeck>[] = STAT_ORDER[edition];
  return defs.find((d) => d.key === key)?.matches(deck) ?? false;
}

/**
 * The right rail's Pipeline progress (issue 7): the same titles as the stat
 * boxes, minus the first ("Uploaded" / "At IC") total, which is the denominator.
 */
export function pipelineProgress<K extends string>(stats: DeckStat<K>[]): DeckStat<K>[] {
  return stats.slice(1);
}

// ── The VC IC member: "Awaiting my vote" ─────────────────────────────────────

/** The committee member's own ballot on a deal: a vote, none, or not loaded yet. */
export type MyBallot = string | null | undefined;

/** The deal pipeline after the committee has cleared a deal, before it closes. */
export const IC_PIPELINE_STAGES = ["alignment_call", "term_sheet", "legal_dd"] as const;

export interface IcStatDeck extends StatDeck {
  id: string;
}

/**
 * Which IC-member box a deal sits under (`AISJ_VC_IC_member_V2` `adData[].st`).
 *
 *  • **At IC** — every deal that has reached the committee (IC review onward),
 *    the member's whole pool.
 *  • **Awaiting my vote** — in IC review and this member has cast no ballot.
 *  • **Evaluated by me** — this member has cast a ballot on it.
 *  • **On agenda** — in IC review: before the committee now. There is no IC
 *    meeting calendar, so this is not "next meeting" (§8).
 *  • **Investment pipeline** — cleared and executing toward close.
 *  • **Funded** — closed: onboard ready.
 *
 * The Managing Partner's decision sits under At IC only: the vote has closed and
 * the deal is not yet cleared.
 */
export function matchesIcStat(deck: StatDeck, key: IcStatKey, myBallot: MyBallot): boolean {
  const s = deck.statusId ?? "";
  switch (key) {
    case "atIc":
      return vcReached(s, "ic_review");
    case "myvote":
      return s === "ic_review" && myBallot === null;
    case "myeval":
      return vcReached(s, "ic_review") && typeof myBallot === "string";
    case "agenda":
      return s === "ic_review";
    case "pipeline":
      return (IC_PIPELINE_STAGES as readonly string[]).includes(s);
    case "funded":
      return s === "onboard_ready";
  }
}

const IC_TILES: { key: IcStatKey; label: string; color: string; sub: (decks: IcStatDeck[]) => string }[] = [
  { key: "atIc", label: "At IC", color: "var(--olive)", sub: () => "In committee review" },
  { key: "myvote", label: "Awaiting my vote", color: "var(--red)", sub: () => "Need my score" },
  { key: "myeval", label: "Evaluated by me", color: "var(--olive)", sub: () => "I've scored" },
  { key: "agenda", label: "On agenda", color: "var(--blue)", sub: () => "Before the committee" },
  {
    key: "pipeline",
    label: "Investment pipeline",
    color: "var(--amber)",
    // The prototype's "2 term sheet · 1 stalled" — nothing records a stall, so
    // the split is by the stage each deal is at.
    sub: (decks) => {
      const at = (stage: string) => decks.filter((d) => d.statusId === stage).length;
      return `${at("term_sheet")} term sheet · ${at("legal_dd")} legal DD`;
    },
  },
  // "₹30 Cr deployed" needs a deployment amount no deck carries (F0447).
  { key: "funded", label: "Funded", color: "var(--green)", sub: () => "Closed deals" },
];

/** The IC member's six boxes. `ballots` maps deck id → this member's vote. */
export function icMemberStats(decks: IcStatDeck[], ballots: Record<string, MyBallot>): DeckStat<IcStatKey>[] {
  const pool = decks.filter((d) => matchesIcStat(d, "atIc", ballots[d.id]));
  const total = pool.length;
  return IC_TILES.map((t, i) => {
    const mine = pool.filter((d) => matchesIcStat(d, t.key, ballots[d.id]));
    return {
      key: t.key,
      label: t.label,
      value: mine.length,
      sublabel: t.sub(mine),
      progress: i === 0 ? 100 : pct(mine.length, total),
      color: t.color,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// V3-DASH — the incubator STAFF dashboard (`AISJ_SuperuserV3.HTM`)
// ═══════════════════════════════════════════════════════════════════════════
//
// The reshared superuser prototype replaces the six boxes above with a
// different set. **R1-DASH widened it from the superuser to the admin,
// programme manager and programme associate** on the client's written
// instruction (`docs/plan_roles_incubator.md` §2 item 1, §6 Q-A) — those three
// prototypes were NOT reshared, so this is a recorded deviation from them, not
// a gap closed.
//
// The JURY is not in that set and must not be added. `DashboardPage`'s `isJury`
// shadows `isV3Dash` at the three TABLE sites but NOT at `homeTitle` or the
// sub-line, so adding them is not the no-op the plan calls it — it retitles
// their screen "Dashboard" over tables that do not change (measured; see the
// note on the predicate itself). Their five-tile screen is already built
// verbatim from their own prototype, so there is nothing to widen either way.
//
// ── `STAT_ORDER.incubator` IS NOW ORPHANED ────────────────────────────────
// The admin, PM and PA were its whole live audience — the superuser left at
// V3-DASH and the jury never used it. `build(STAT_ORDER.incubator)`
// and `matchesStat("incubator", …)` still compile, are still unit-tested, and
// are still correct — but nothing in the running product calls them any more
// (VC staff have their own `STAT_ORDER.vc`, the jury has `juryTiles`). Left in
// place so the widening stays revertible by one predicate while Q-A is
// unanswered in writing; deleting it is a Wave R+1 cleanup with its own review.
//
// Source, verbatim (`_scripts.js` `adUpdateStats` / `adRenderTable`, and
// `panel-alldecks.html`'s six `.stat-card`s):
//
//   var c={all:0,aieval:0,noteval:0,incomplete:0,shortlisted:0,archived:0};
//   adData.forEach(function(d){
//     if(d.archived){c.archived++;return;}          // ← archived counts ONCE
//     c.all++;
//     if(d.state==='aieval')c.aieval++;
//     else if(d.state==='noteval')c.noteval++;
//     else if(d.state==='incomplete')c.incomplete++;
//     if(d.shortlisted)c.shortlisted++;
//   });
//   var pct=(k==='all')?100:(c.all?Math.round(c[k]/c.all*100):0);
//
// **The denominator is `c.all`, the NON-archived count — not `adData.length`.**
// `build()` above divides by `decks.length`, which is right for the old sets
// (they have no archived exclusion) and silently wrong for these. One archived
// deck in the workspace moves every other tile's percentage; no test on the old
// path notices, because the old path has no archived tile to disagree with.
// That is why this set has its own builder rather than another `STAT_ORDER` row.

/** The v3 superuser boxes (`panel-alldecks.html` `data-stat`, in draw order). */
export type V3StatKey = "all" | "aieval" | "noteval" | "incomplete" | "archived" | "shortlisted";

/**
 * The prototype's `adData[].state` — one of three, per deck, mutually
 * exclusive. Our pipeline has thirteen stages, so the three are read off it:
 *
 *   • **incomplete** — the same predicate the old Incomplete box uses, so a
 *     deck does not change box on the way to the new design.
 *   • **aieval** — through the AI: at `ai_evaluated` or past it, or carrying a
 *     score. Read off the STAGE first so blind scoring (which withholds
 *     `aiScore` from an evaluator who has not submitted) cannot empty the box —
 *     the same reasoning as the VC `aiEvaluated` box above.
 *   • **noteval** — everything else: `uploaded`, `pending_ai`, `manual_review`.
 *
 * Order matters: the three must PARTITION the non-archived decks, exactly as
 * `adData[].state` does, or the three tiles stop summing to Uploaded.
 */
export type V3DeckState = "aieval" | "noteval" | "incomplete";

/** Stages a deck can only be at once the AI has run (`incubatorPipeline`). */
const POST_AI_STAGES: readonly string[] = [
  "ai_evaluated",
  "assigned",
  "jury_evaluation",
  "shortlisted",
  "intro",
  "signup",
  "onboard_ready",
  "rejected",
  "archived",
];

/** An archived deck is counted ONLY in Archived, and appears in no other view. */
export function isArchivedDeck(deck: StatDeck): boolean {
  return deck.statusId === "archived";
}

/**
 * **Has this deck already been handed to the Assign side?**
 *
 * The Assigned tile's predicate, lifted out of `matchesV3Stat` so the one other
 * caller that needs it is not a second copy of it (`routes/decks.ts`, where the
 * AI gate's `?list=assign` post-filter has to leave an already-handed deck
 * alone). Three facts, and they are not redundant: the MARKER is the recorded
 * Send-to-Assign click, which is what the client's map files under the Assigned
 * box; `assignedTo` and the two stages are what "allocated to an evaluator" has
 * meant since Aug-2026 issue 4, and the marker does not replace them —
 * `POST /decks/:id/transition` will reach `assigned` with no marker written.
 */
export function isAllocatedDeck(deck: StatDeck): boolean {
  return Boolean(deck.sendToAssignAt) || Boolean(deck.assignedTo) || ASSIGNED_STAGES.includes(deck.statusId ?? "");
}

export function v3DeckState(deck: StatDeck): V3DeckState {
  if (deck.statusId === "incomplete" || deck.signal === "flagged") return "incomplete";
  if (POST_AI_STAGES.includes(deck.statusId ?? "") || deck.aiScore !== undefined) return "aieval";
  return "noteval";
}

// ── The Status column's words (S1-DASH · item 3) ─────────────────────────────

/**
 * The Status column's vocabulary — the prototype's three (`adRenderTable`'s
 * `stMap`) plus the one the client asked for on 2026-09-21:
 *
 *   "Incomplete deck" and "Incomplete contact details" as SEPARATE statuses.
 *
 * Those are the two causes of `complete = 0` that plan §8.1 records as
 * indistinguishable, which is why this needed `decks.ai_complete` (migration
 * 0075) before it could be written at all: `decks.complete` is the AND of
 * them, and nothing else on the row remembers which arm failed.
 *
 * **This is a deliberate deviation from the prototype** — `stMap` has three
 * entries and the fourth word appears nowhere in `AISJ_SuperuserV3.HTM`. It is
 * the client's own request, recorded here so the next parity capture reads it
 * as intended rather than reverting it.
 *
 * ── SUPERSEDED 2026-09-30 by `ScreeningStatus` at the foot of this file ─────
 * The client's 24-Sep spec replaces these four words with thirteen statuses and
 * three sinks, and it replaces the SHAPE of the derivation too: his statuses
 * depend on what was done to the deck and in what order, so "Incomplete contact
 * details" and "Incomplete contact details, Edited" have identical columns.
 *
 * **These three exports are kept alive only because their consumers are other
 * sessions' files** — `DashboardPage.tsx:1806` (S2-DASH) and
 * `test/worker/ai-complete.test.ts:254` (S2-SERVER). Do not write new callers.
 * Deleting them is S2-DASH's last step; nothing here depends on them.
 *
 * @deprecated Use `screeningStatus` / `SCREENING_STATUS_LABELS`.
 */
export type V3StatusKey = "aieval" | "noteval" | "incompleteDeck" | "incompleteContact";

/**
 * The four words, as the Status pill prints them.
 *
 * @deprecated Use `SCREENING_STATUS_LABELS`. See `V3StatusKey`.
 */
export const V3_STATUS_LABELS: Record<V3StatusKey, string> = {
  aieval: "AI Evaluated",
  noteval: "Not AI Evaluated",
  incompleteDeck: "Incomplete deck",
  incompleteContact: "Incomplete contact details",
};

/** What the Status word needs beyond the tile predicate's `StatDeck`. */
export interface CompletenessDeck extends StatDeck {
  /** `decks.ai_complete` — the model's verdict alone. Absent reads as true. */
  aiComplete?: boolean;
  /**
   * `decks.missing_fields` — required intake columns nobody supplied.
   *
   * Left as `readonly string[]` on purpose: the superseded `v3StatusKey` only
   * asks whether the list is empty, and narrowing it to `IntakeField` would move
   * `test/worker/ai-complete.test.ts` (S2-SERVER's file) for no gain. The
   * successor `ScreeningDeck` IS narrowed, because it hands its deck to
   * `deckListRoute`.
   */
  missingFields?: readonly string[];
}

/**
 * The Status word for one deck, as a function of the pair 0075 made readable:
 *
 *   ai_complete = 0                        -> Incomplete deck
 *   ai_complete = 1 AND missing_fields set -> Incomplete contact details
 *   ai_complete = 1 AND nothing missing    -> the AI-evaluation state
 *
 * Deck before contacts, so a deck that fails BOTH says the thing the operator
 * cannot fix by typing — there is no point asking a founder for a phone number
 * when the deck itself could not be read.
 *
 * The third line falls through to `v3DeckState`, and its `incomplete` arm
 * (stage `incomplete`, or signal `flagged`) resolves to **Incomplete deck**:
 * that is the manual `flag_incomplete` route, where a human called the deck
 * incomplete and no intake list was ever written. Saying "contact details"
 * there would name a cause nothing recorded.
 *
 * **Neither incomplete word is spoken before the AI has run** — a deck at
 * `noteval` says *Not AI Evaluated*, whatever the columns hold. There is no
 * verdict yet, so any value in them is a STALE one from a previous run, and
 * the shipped resubmit loop produces exactly that: `POST /queries/:id/respond`
 * moves an `incomplete` deck back to `uploaded` and sets `complete = 1`
 * (routes/pipeline.ts) without re-reading the deck, so the row would otherwise
 * announce a verdict its own stage contradicts.
 *
 * **That justification is narrower than it first reads, and the wave-integration
 * audit was right to say so.** `POST /queries/:id/respond` is the path for a
 * deck the model could not complete; a deck the model READ and then had a
 * detail stripped from does not travel it. So the guard earns its place for the
 * resubmit loop and for pre-migration rows, not as the universal claim the
 * first draft of this comment made. It still costs nothing: an evaluation lands
 * a deck at `ai_evaluated` or `incomplete`, both of which `v3DeckState`
 * answers, so a deck that has a verdict is never `noteval`. Pinned in
 * `deckStats.test.ts`.
 *
 * **This refines the Status WORD only; it does not move a tile.** `v3DeckState`
 * and `matchesV3Stat` are untouched, so the six boxes still partition exactly
 * as `adData[].state` does and every count is the one V3-DASH measured. The
 * consequence, which is the old `v3-incomplete-mark` tag's situation in
 * reverse: a deck evaluated and THEN stripped of a required detail (plan §4.1
 * case (b)) reads "Incomplete contact details" while still counting under the
 * **AI Evaluated** tile. It was AI-evaluated; it is also not assignable. Both
 * are true, and the row now says the second one in words instead of a chip.
 *
 * @deprecated Use `screeningStatus`. See `V3StatusKey` for why it still exists.
 */
export function v3StatusKey(deck: CompletenessDeck): V3StatusKey {
  const state = v3DeckState(deck);
  if (state === "noteval") return "noteval";
  if (deck.aiComplete === false) return "incompleteDeck";
  if ((deck.missingFields ?? []).length > 0) return "incompleteContact";
  if (state !== "incomplete") return state;
  // The fall-through is the MANUAL `flag_incomplete` route — a human called the
  // deck incomplete, no intake list was written and no model verdict exists —
  // so "Incomplete deck" is the only cause that was ever recorded.
  //
  // But a deck the model READ (`ai_complete = 1`) whose intake list has since
  // been emptied reaches here too: the operator typed the missing phone number
  // and `PATCH /api/decks/:id` raised `complete`, while the STAGE still lags at
  // `incomplete` until the resubmit loop moves it. Calling that "Incomplete
  // deck" names the one cause its own `ai_complete = 1` rules out, and it is
  // the word the operator sees the instant they fix the thing they were asked
  // to fix. It reads as its verdict instead, exactly as the reverse asymmetry
  // above does: the WORD describes the deck, the TILE describes the pipeline.
  return deck.aiComplete === true ? "aieval" : "incompleteDeck";
}

/**
 * The table filter. The prototype's `adRenderTable()` reads:
 *
 *   if(activeStat==='archived') show=d.archived;
 *   else if(d.archived)        show=false;     // <- NOT ours; see below
 *   else if(activeStat==='all')show=true;
 *   else if(activeStat==='shortlisted') show=!!d.shortlisted;
 *   else show=(d.state===activeStat);
 *
 * **The second line is a deliberate deviation, 2026-09-23.** Taken verbatim it
 * makes Archive a RELOCATION: the row leaves All the moment it is archived and
 * is only findable by switching tiles. The client's instruction is that
 * archiving sets a STATE — the deck stays in the list and says "Archived" —
 * which is also what their own row asks for ("After actions, Status would
 * change to … 'Archived'"): a status a row never shows again because the row is
 * gone is not a status. So `all` is answered BEFORE the archived test.
 *
 * Archived decks still do not count under the WORKING tiles. Their state is
 * Archived; letting them also sit under AI Evaluated would double-count them
 * and make the six boxes overlap, which is the one thing the tile set must not
 * do. So the order is: Archived tile, then All, then the working tiles.
 *
 * `assigned` is not a v3 box; it is accepted here only while the Assigned tile
 * is retained pending Q7 (see `V3_TILES`).
 */
export function matchesV3Stat(deck: StatDeck, key: V3StatKey | "assigned"): boolean {
  if (key === "archived") return isArchivedDeck(deck);
  // All holds every deck, archived included — that is what "a state, not a
  // move" means at the level of the list.
  if (key === "all") return true;
  if (isArchivedDeck(deck)) return false;
  if (key === "shortlisted") return SHORTLISTED_STAGES.includes(deck.statusId ?? "");
  if (key === "assigned") return isAllocatedDeck(deck);
  // ── C10 · the one tile predicate the client's spec moves ──────────────────
  // His sink map files `Incomplete, Queried` under the **Incomplete** box, and
  // `queried` is not a stage: `POST_AI_STAGES` contains `ai_evaluated`, so a
  // deck queried out of the evaluated population counted under AI Evaluated.
  // So Queried is answered here, as a tile predicate in its own right — the
  // deck's STAGE is never moved, which is what would have broken every other
  // count on the screen.
  //
  // It is answered BEFORE the other two working tiles, and the other two then
  // decline it, because the three must PARTITION the non-archived decks or the
  // tiles stop summing to Uploaded (the invariant this file's own builder
  // comment calls "the one thing the tile set must not do"). The alternative —
  // folding `queried` into `v3DeckState` — reaches the same partition but also
  // moves the deprecated `v3StatusKey`, whose consumers are S2-DASH's and
  // S2-SERVER's files, so it is deliberately not done here.
  if (key === "incomplete") return isScreeningIncompleteTile(deck);
  if (isScreeningIncompleteTile(deck)) return false;
  return v3DeckState(deck) === key;
}

/**
 * The **Incomplete** box's predicate, C10's one change: the old three-way
 * `v3DeckState` answer, OR the `Incomplete, Queried` sink is current.
 *
 * **"Queried and not yet resolved", not "has ever been queried"** — and the
 * difference is a measured defect, not a nicety. `queried` is
 * `decks.query_count > 0`, which is PERMANENT: a deck queried months ago, whose
 * founder answered, which was re-scored and shortlisted, still carries it.
 * Counting that under Incomplete was wrong by two tiles, and it was caught by
 * `allDecks.test.tsx`'s denominator test on its GreenRoute row (`shortlisted`,
 * `aiScore: 9.1`, `queried: true`) — S2-DASH's file, which stayed green. His
 * sink is `Incomplete, **Queried**`; a deck review has picked back up is
 * neither.
 *
 * `edition` defaults to `incubator` because the whole screening vocabulary is
 * the incubator's (his §5 matrix, his §4 diagram and his six stat boxes are all
 * the incubator superuser Dashboard, and the v3 tiles exist only there).
 */
export function isScreeningIncompleteTile(deck: ScreeningDeck, edition: Edition = "incubator"): boolean {
  return v3DeckState(deck) === "incomplete" || isQueriedSinkCurrent(deck, edition);
}

/**
 * Is the `Incomplete, Queried` sink still this deck's answer?
 *
 * Sent to Query — **the recorded action, never a derivation, which is his row
 * 3** — and not since resolved. Two things resolve it, and they are the two ways
 * out the product actually has:
 *
 *  1. **Review picked it back up and it is assignable.** Asked through
 *     `deckListRoute`, so "belongs on Assign" has one authority and not a second
 *     implementation here. `deriveQuery: false`, because the question is about
 *     the Assign arm, which row 3 does not touch — reading the flag here would
 *     make this predicate change meaning when S2-SERVER flips it.
 *  2. **It advanced past screening** — Shortlisted and beyond, or Rejected: the
 *     stages his own matrix hands to another screen or to another whitelist.
 *     (Archived never reaches here: `screeningStatus` answers it first, and
 *     `matchesV3Stat` excludes archived rows from every working tile.)
 *
 * This is deliberately **not** `deckListRoute(...) === "query"`. Under the
 * retained derivation that is true of an incomplete evaluated deck **nobody
 * sent** — the exact thing row 3 deletes — so using it would have let the
 * derivation back in through the status vocabulary after taking it out of the
 * partition. Measured: it moved `manual_review` out of Not AI Evaluated and
 * reddened two of this file's own denominator tests.
 */
function isQueriedSinkCurrent(deck: ScreeningDeck, edition: Edition): boolean {
  if (deck.queried !== true) return false;
  if (deckListRoute(deck, edition, { queried: true, deriveQuery: false }) === "assign") return false;
  const stage = deck.statusId ?? "";
  return !SHORTLISTED_STAGES.includes(stage) && stage !== "rejected";
}

/**
 * **Q7 is ANSWERED, and the answer is keep it.** This was "retained pending Q7"
 * — v3 deleted the Assigned tile, which reversed Aug-2026 issue 4, and the
 * instruction was to build the new set and leave Assigned in place until the
 * client said. His 24-Sep spec says. Its FINAL STATUSES map, verbatim:
 *
 *   "Complete · Edited, all complete  ->  AI Evaluated, Assigned  ->  Assigned"
 *
 * — the third column is the stat box the sink is counted in, so the Assigned
 * box is required by his own document. It keeps its issue-4 position,
 * immediately before Shortlisted.
 *
 * Kept as a named constant rather than inlined because the tile list below is
 * asserted literally in `deckStats.test.ts`, and a reader who finds the seventh
 * entry there should find the sentence that put it there.
 */
export const ASSIGNED_TILE_CONFIRMED_BY_FINAL_STATUS_MAP = true;

interface V3Tile {
  key: V3StatKey | "assigned";
  label: string;
  /** `.scf` bar colour, from the prototype's inline `background:`. */
  color: string;
  /** `.scs` — STATIC prose in v3; the computed "+3 since yesterday" strings are gone. */
  sub: string;
}

/** The six, in `panel-alldecks.html`'s own order (plus Assigned pending Q7). */
const V3_TILES: V3Tile[] = [
  { key: "all", label: "Uploaded", color: "var(--olive)", sub: "All decks in the pipeline" },
  { key: "aieval", label: "AI Evaluated", color: "var(--green)", sub: "Scored by AI" },
  { key: "noteval", label: "Not AI Evaluated", color: "var(--amber)", sub: "Awaiting AI score" },
  { key: "incomplete", label: "Incomplete", color: "var(--red)", sub: "Deck missing slides" },
  { key: "archived", label: "Archived", color: "var(--text-3)", sub: "Set aside" },
  // ── Q7, answered: his FINAL STATUSES map counts a sink in this box. ──
  ...(ASSIGNED_TILE_CONFIRMED_BY_FINAL_STATUS_MAP
    ? [{ key: "assigned" as const, label: "Assigned", color: "var(--blue)", sub: "Allocated to an evaluator" }]
    : []),
  { key: "shortlisted", label: "Shortlisted", color: "var(--purple)", sub: "Advanced to signup" },
];

/**
 * The v3 superuser boxes. `progress` divides by the NON-ARCHIVED count, which
 * is what `adUpdateStats` means by `c.all` — including for Archived itself,
 * whose bar the prototype computes the same way (so it can exceed 100% in a
 * workspace that is mostly archived; that is the prototype's own arithmetic).
 */
export function v3DeckStats(decks: StatDeck[]): DeckStat<V3StatKey | "assigned">[] {
  // The denominator IS the All tile, and it is `matchesV3Stat(d, "all")`'s own
  // answer — every tile's count therefore comes from the SAME predicate the
  // table filter uses, so a tile can never disagree with the rows its view
  // draws. Since archiving became a state rather than a move, All holds
  // archived decks too, so they are in the denominator as well: they are still
  // decks in this workspace, and a percentage that quietly shrinks its own base
  // each time a row is archived would make every other tile drift upward.
  const active = decks.filter((d) => matchesV3Stat(d, "all"));
  return V3_TILES.map((t) => {
    const value = decks.filter((d) => matchesV3Stat(d, t.key)).length;
    return {
      key: t.key,
      label: t.label,
      value,
      sublabel: t.sub,
      progress: t.key === "all" ? 100 : pct(value, active.length),
      color: t.color,
    };
  });
}

// ── "· 2h ago" — the row clock the v3 table sorts on ─────────────────────────

/**
 * The latest of a set of timestamps, as an ISO string — `undefined` if none
 * parse. Used by `GET /api/decks` to fold a deck's last pipeline event, its own
 * `updated_at` and its `created_at` into one `lastActivityAt`.
 *
 * It compares PARSED instants, never strings: D1 writes `datetime('now')`
 * ("2026-09-20 10:00:00") in some places and `new Date().toISOString()`
 * ("2026-09-20T09:00:00.000Z") in others, and those two formats do not sort
 * lexicographically against each other — the space sorts below "T", so a plain
 * `MAX()` would pick the ISO value every time regardless of which is later.
 */
export function latestTimestamp(...values: (string | null | undefined)[]): string | undefined {
  let bestAt = Number.NEGATIVE_INFINITY;
  let best: string | undefined;
  for (const v of values) {
    if (!v) continue;
    const t = parseTs(v);
    if (Number.isNaN(t) || t <= bestAt) continue;
    bestAt = t;
    best = v;
  }
  return best;
}

// ═══════════════════════════════════════════════════════════════════════════
// S0-VOCAB — the screening status vocabulary (the client's 24-Sep spec)
// ═══════════════════════════════════════════════════════════════════════════
//
// Source: "Deck Screening Logic: Status & Action Flow" v1.0, September 2026 —
// its §4 flow diagram and §5 status/button matrix, transcribed at
// `docs/spec_screening_flow.md`. The readings shipped below are
// `docs/plan_screening.md` §2's, conflict by conflict, and they are NOT to be
// re-resolved here: his three lists (an 11-row matrix, a 6-word status list, a
// 3-entry final-status map) do not agree, §2 catalogues fourteen conflicts with
// the reading to ship, and a fifteenth resolution invented in code is how a
// wave loses a week. Where a reading still looks wrong it is a question in the
// handoff note, not a different `if`.
//
// ── What replaces what ─────────────────────────────────────────────────────
// `v3StatusKey` above is a pure function of two columns. This is not: his
// statuses depend on WHAT WAS DONE to the deck and in what order.
// "Incomplete contact details" and "Incomplete contact details, Edited" have
// IDENTICAL columns — only `contactEditedAt` separates them. That is why this
// is an action-history derivation and could not be reached by renaming strings.
//
// ── Derived, never persisted ───────────────────────────────────────────────
// All thirteen statuses and all three sinks are a FUNCTION of fields
// `toDeckView` already serves. No new column on `decks`, no new table, and
// three existing columns are specifically NOT reused:
//
//   · `decks.status`  holds the 13-stage pipeline, and `routes/decks.ts:924-925`
//     already warns in as many words that it is not the startup's funding stage
//     either. A third meaning on one column is how the second one went wrong.
//   · `decks.signal`  is the rating BAND from `signalTag` (`shared/scoring.ts`),
//     and its `'flagged'` value is already the incomplete marker read by
//     `v3DeckState` above — two live jobs on one column already.
//   · `decks.complete` is redundant: `isDeckComplete` (`shared/queries.ts`)
//     re-derives it at read time from the two columns that actually move.
//
// The only schema in this whole wave is S2-SERVER's
// `org_scoring_settings.ai_gate_threshold` (migration 0082) — the THRESHOLD,
// not the machine. Which is why `gate` below is a required PARAMETER: a
// hardcoded constant cannot be a per-organisation setting, and leaving a
// fallback constant beside the setting is how this product came to have three
// thresholds (the AI gate, `shortlist_threshold`, and the cohort bands).

/**
 * The client's eleven intermediate statuses, plus the two his lists imply but
 * do not name. Thirteen, and every one of them derived.
 *
 * The keys are ours; the WORDS are his (`SCREENING_STATUS_LABELS`).
 */
export type ScreeningStatus =
  /** I1 · `D ∧ ¬C` — the deck reads, a required intake column is blank. */
  | "incompleteContact"
  /** I2 · `¬D ∧ C` — the model could not complete the deck; contacts are fine. */
  | "incompleteDeck"
  /** I3 · `¬D ∧ ¬C` — C2: a real word at last. See `SCREENING_STATUS_LABELS`. */
  | "bothIncomplete"
  /** I4 · `D ∧ C ∧ ¬R` — scored, under the gate. Unreachable until S2-SERVER. */
  | "belowThreshold"
  /** I5 · stage `rejected`. */
  | "rejected"
  /** I6 · `D ∧ C ∧ R` — the one status that can be Sent to Assign. */
  | "complete"
  /** I7 · the transient re-check. `screeningStatus` NEVER returns it — see below. */
  | "contactEdited"
  /** I8 · `contactEditedAt ∧ ¬C`. */
  | "incompleteContactEdited"
  /** I9 · `contactEditedAt ∧ C ∧ ¬D`. */
  | "incompleteDeckEdited"
  /** I10 · `contactEditedAt ∧ C ∧ D ∧ ¬R`. */
  | "belowThresholdEdited"
  /** I11 · `contactEditedAt ∧ C ∧ D ∧ R`. */
  | "completeEdited"
  /** C3 · the word his row 6 deletes and his own stat box still needs. */
  | "awaitingAi"
  /** His §7 open item · queried, five working days gone, no answer. */
  | "noResponse";

/**
 * The three finals his FINAL STATUSES map names. Reaching one empties the
 * operator's action whitelist (his feedback row 7's latch) — with exactly one
 * exception, `noResponse`, which is C7 and is the only way row 7 and his own
 * open item can both hold.
 */
export type ScreeningSink = "queried" | "assigned" | "archived";

export type ScreeningValue = ScreeningStatus | ScreeningSink;

/**
 * His words, verbatim where he wrote them.
 *
 * Two entries carry a decided conflict:
 *
 *  · **`assigned` is "AI Evaluated, Assigned", one string, everywhere (C1).**
 *    His numbered row 6 says `Complete, Assigned`; his matrix AND his FINAL
 *    STATUSES map both say `AI Evaluated, Assigned`. Two of his three lists
 *    agree, and the agreeing one is the authoritative stat-box map. Row 6's
 *    variant is informal shorthand.
 *  · **`awaitingAi` is "Awaiting AI evaluation" (C3).** His row 6 deletes "Not
 *    AI Evaluated" — but that is a stat BOX as well as a word (`V3_TILES`
 *    above), and `inc_deck_pitchloop` sits in it at `pending_ai`. A populated
 *    stat box whose rows have nothing to say is worse than a seventh word.
 *
 * `bothIncomplete` is his own phrase from the §5 matrix, and making it a real
 * word is C2. Today deck-before-contact deliberately collapses it into
 * `incompleteDeck` (`v3StatusKey` above), and two live seed decks are in that
 * collapse — `inc_deck_payroute` and `inc_deck_meera_incomplete`, both
 * `ai_complete = 0 AND missing_fields = 'founderPhone'`. The DATA has always
 * distinguished the pair; only the label did not.
 */
export const SCREENING_STATUS_LABELS: Record<ScreeningValue, string> = {
  incompleteContact: "Incomplete contact details",
  incompleteDeck: "Incomplete decks",
  bothIncomplete: "Both incomplete",
  belowThreshold: "Below threshold",
  rejected: "Rejected",
  complete: "Complete",
  contactEdited: "Contact details edited",
  incompleteContactEdited: "Incomplete contact details, Edited",
  incompleteDeckEdited: "Incomplete decks, Edited",
  belowThresholdEdited: "Below threshold, Edited",
  completeEdited: "Complete, Edited",
  awaitingAi: "Awaiting AI evaluation",
  noResponse: "No response",
  queried: "Incomplete, Queried",
  assigned: "AI Evaluated, Assigned",
  archived: "Archived",
};

/**
 * The displayed pill set, in the order his §4 flow diagram walks it — which is
 * also the STATUS column's sort order (S2-DASH's new column sort reads
 * `screeningStatusRank`, not the label).
 *
 * **Sorting on the string would be wrong**, and worth saying once: alphabetical
 * puts "AI Evaluated, Assigned" first and "Archived" second, so the two ends of
 * the pipeline sit adjacent and read as if archiving were a kind of assignment.
 * The flow's own order groups each pair with its Edited twin.
 */
export const SCREENING_STATUS_ORDER: readonly ScreeningValue[] = [
  "awaitingAi",
  "bothIncomplete",
  "incompleteDeck",
  "incompleteDeckEdited",
  "incompleteContact",
  "incompleteContactEdited",
  "contactEdited",
  "belowThreshold",
  "belowThresholdEdited",
  "rejected",
  "complete",
  "completeEdited",
  "noResponse",
  "queried",
  "assigned",
  "archived",
];

/**
 * **The sort/filter dropdown's option list — C2, and the one place his own
 * document cannot be reconstructed from the repo.**
 *
 * C2's reading: *row 6 is the filter option list; the matrix is the displayed
 * pill set.* That is the only reading under which both of his lists can be
 * true — a filter list may be coarser than a display value, but it may not omit
 * the value a row actually shows. So the two are exported SEPARATELY, and this
 * one is a superset of his six rather than a guess at which six.
 *
 * What the conflicts PROVE row 6 omits, and nothing more: `Both incomplete`,
 * `Below threshold`, `Rejected` and `Archived` (C2) and `Not AI Evaluated`
 * (C3) — five words, which leaves eleven here and not six. **His verbatim
 * six-word list is not transcribed anywhere in this repo** (`spec_screening_flow.md`
 * transcribes the §4 diagram and the §5 matrix; row 6 survives only as the four
 * conflict rows that quote parts of it). Narrowing eleven to six needs the
 * list, so it is a question in the handoff, not a fifteenth resolution invented
 * here. Shipping the wider list is the safe direction: every value a row can
 * show is filterable, which is the property C2's reasoning turns on.
 *
 * `ROW6_PROVEN_OMISSIONS` is the five; `SCREENING_FILTER_OPTIONS` is what
 * survives them.
 */
export const ROW6_PROVEN_OMISSIONS: readonly ScreeningValue[] = [
  "bothIncomplete",
  "belowThreshold",
  "rejected",
  "archived",
  "awaitingAi",
];

/** The eleven that survive those five. See `ROW6_PROVEN_OMISSIONS` above. */
export const SCREENING_FILTER_OPTIONS: readonly ScreeningValue[] = SCREENING_STATUS_ORDER.filter(
  (v) => !ROW6_PROVEN_OMISSIONS.includes(v),
);

/** Rank in `SCREENING_STATUS_ORDER`; unknown values sort last, never crash. */
export function screeningStatusRank(value: ScreeningValue): number {
  const at = SCREENING_STATUS_ORDER.indexOf(value);
  return at < 0 ? SCREENING_STATUS_ORDER.length : at;
}

/** Which stat box a sink is counted in — his FINAL STATUSES map's third column. */
export const SCREENING_SINK_TILE: Record<ScreeningSink, V3StatKey | "assigned"> = {
  queried: "incomplete",
  assigned: "assigned",
  archived: "archived",
};

const SCREENING_SINKS: readonly ScreeningValue[] = ["queried", "assigned", "archived"];

/** Is this a final status? Reaching one empties the whitelist (row 7). */
export function isScreeningSink(value: ScreeningValue): value is ScreeningSink {
  return SCREENING_SINKS.includes(value);
}

/**
 * Everything the derivation reads. **Every field is optional on purpose**: two
 * of them do not exist on any row yet — `sendToAssignAt` and the two
 * no-response fields are S2-SERVER's to serve — and a status function that
 * throws on the shape it is given today is a status function no other session
 * can build against. An absent field takes the reading that cannot invent a
 * problem: see each one.
 */
export interface ScreeningDeck extends StatDeck {
  /**
   * `D` — `decks.ai_complete` (migration 0075), served as `aiComplete`. **Absent
   * reads as COMPLETE**, matching the column's own `DEFAULT 1`: a caller that
   * forgot to select it loses a word, it does not turn every row red.
   */
  aiComplete?: boolean;
  /** `C` — `decks.missing_fields`. Empty (or absent) is complete. */
  missingFields?: readonly IntakeField[];
  /** `decks.complete` — read only by `deckListRoute`, never by the status itself. */
  complete?: boolean;
  /**
   * `A = Edit` — `pipeline_events.action='edit_contact'`, served as
   * `contactEditedAt` (`routes/decks.ts:121`, written from a `CONTACT_FIELDS`
   * set of exactly his four fields). Already persisted; this is the whole
   * reason his machine is expressible without a migration.
   */
  contactEditedAt?: string | null;
  /** The latest `queries.created_at` — S2-SERVER's first no-response field. */
  lastQueryAt?: string | null;
  /** Whether that query was answered — S2-SERVER's second no-response field. */
  lastQueryAnswered?: boolean;
}

/** What `screeningStatus` needs besides the deck. */
export interface ScreeningOptions {
  /**
   * `org_scoring_settings.ai_gate_threshold` (migration 0082, default 5.0).
   *
   * **Required, and deliberately not defaulted.** His check (3) is the AI
   * SCREENING GATE — not `shortlist_threshold` (7.0) and not the cohort bands
   * `threshold_best`/`threshold_mediocre` (C12); `routes/decks.ts:95-100`
   * already records a past confusion between two of the three. A fallback
   * constant here would be a fourth.
   */
  gate: number;
  /** For the no-response window. Defaults to `Date.now()`. */
  now?: number;
  /**
   * Defaults to `incubator`, because the whole vocabulary is the incubator's:
   * his §5 matrix, his §4 diagram and his six stat boxes are all the incubator
   * superuser Dashboard. It is read for one thing only — which stages keep a
   * queried deck on the Query list — and that rule is already per edition.
   */
  edition?: Edition;
}

/**
 * `D` — the model's own verdict.
 *
 * **Absent reads as complete** (`ai_complete`'s own `DEFAULT 1`) — with one
 * exception, carried forward verbatim from `v3StatusKey` because deleting it
 * would ship a new defect: the MANUAL `flag_incomplete` route
 * (`manual_review -> incomplete`) writes no intake list and runs no model, so a
 * human-flagged deck has `aiComplete` absent and `missingFields` empty. Reading
 * that as `D ∧ C` would call it **Complete** and offer Send to Assign on a deck
 * an operator had just set aside. So an absent verdict on a row that says
 * `incomplete` — stage `incomplete`, or signal `flagged` — is read as ¬D, which
 * is the only cause that was ever recorded about it.
 *
 * A RECORDED verdict always wins over the stage. That is the regression plan
 * §12.9 found in the first version of this rule: a deck the model read
 * (`ai_complete = 1`) whose intake list has since been emptied still sits at
 * stage `incomplete` until the resubmit loop moves it, and blaming the deck
 * there names the one cause its own column rules out.
 */
function deckComplete(deck: ScreeningDeck): boolean {
  if (deck.aiComplete !== undefined) return deck.aiComplete;
  return v3DeckState(deck) !== "incomplete";
}

/** `C` — the intake checklist. */
function contactComplete(deck: ScreeningDeck): boolean {
  return (deck.missingFields ?? []).length === 0;
}

/**
 * `R` — "at or above the threshold", his words, so **`>=`** (C13). The build
 * shipped `total > GATE` from a different diagram, which rejects a deck scoring
 * exactly 5.0 that his spec calls Complete; S2-SERVER changes the one character
 * at `evaluate.ts:488` and this agrees with it.
 *
 * **An absent score is not below the gate.** A juror who has not submitted gets
 * `aiScore: undefined` from the list route (blind scoring), and the same view
 * feeds this function; calling that deck "Below threshold" would announce a
 * verdict the caller was not allowed to see. It is the same reading as `D` and
 * `C` above: absent never invents a problem.
 *
 * ── EXPORTED 2026-10-01, AND WHY IT IS EXPORTED FROM *HERE* (tester issue 8) ──
 * `GET /api/decks?list=assign` served five decks scoring 2.66–5.25 against a
 * gate of 5, because `deckListRoute` partitions the two screens and has never
 * known about the gate. The fix is a post-filter in `routes/decks.ts` and it
 * needs this predicate — `>=`, and an absent score is not below — rather than a
 * second `score < gate` written at the call site, which is how a number on one
 * 0–10 scale becomes three.
 *
 * It could not move to `queries.ts` beside `deckListRoute`: THIS file imports
 * `deckListRoute` FROM that one (`isQueriedSinkCurrent`), so the reverse import
 * is a cycle. Exporting from here costs nothing — `routes/decks.ts` already
 * imports `latestTimestamp` from this module — and leaves the status vocabulary
 * untouched, which the alternative (a required `gate` on `deckListRoute`) does
 * not: that cascades through `isQueriedSinkCurrent` -> `isScreeningIncompleteTile`
 * -> `matchesV3Stat` and its ~44 references, changing what the tile predicates
 * mean in order to fix a list.
 */
export function ratingAtOrAboveGate(deck: ScreeningDeck, gate: number): boolean {
  return deck.aiScore === undefined || deck.aiScore >= gate;
}

/**
 * **His §7 open item.** A queried deck whose founder has not answered inside the
 * five working days the product already uses for "overdue"
 * (`QUERY_RESPONSE_WORKING_DAYS`, `shared/queries.ts`).
 *
 * This is the C7 exception to his row 7 latch, and it is also the ONE action
 * S2-DASH re-arms on a latched sink ("Archive (no response)"): row 7 forbids
 * any action on a queried deck, his open item requires archiving exactly those
 * decks, and the two cannot both hold literally.
 *
 * Returns false while `lastQueryAt` is unserved, so it is inert until
 * S2-SERVER adds the two subqueries — `DeckView.queried` is a boolean over
 * `query_count` and throws away exactly the timestamp this needs.
 */
export function isQueryUnanswered(deck: ScreeningDeck, now = Date.now()): boolean {
  if (deck.queried !== true || deck.lastQueryAnswered === true || !deck.lastQueryAt) return false;
  return now > queryDueAt(deck.lastQueryAt).getTime();
}

/**
 * **One deck's screening status.** His §4 flow diagram, in his order.
 *
 * ── The order, and why it is his and not tidier ────────────────────────────
 *
 * **Sinks first (row 7).** "No button active once Send to Query / Send to
 * Assign / Archive has fired", so a deck that reached a final must not be
 * re-described by an intermediate predicate that still happens to hold.
 * Archived outranks the other two because it is the only terminal one: a deck
 * queried and then archived is Archived.
 *
 * **Row 7's latch and the shipped resubmit loop also conflict, and this is the
 * narrowest resolution.** `Incomplete, Queried` is read while the deck is ON
 * the Query list, not forever after any query. Read literally, row 7 latches a
 * queried deck for good — but `POST /api/queries/:id/respond` moves an
 * `incomplete` deck back to `uploaded` and it is re-scored from there, which is
 * the product's only designed recovery from Incomplete. A latch that outlives
 * that strands every deck whose founder did as they were asked, which is the
 * same class of defect as C7 (his own open item, which needs the latch broken
 * for the founders who did NOT answer). So the latch binds while the deck is
 * unresolved — and "resolved" asks `deckListRoute`, so "belongs on Assign" has
 * one authority and not a second implementation. Recorded as a client question
 * rather than resolved as a preference.
 *
 * **Then the fresh branch: deck, then contact, then rating.** His fixed check
 * order, and it is already exactly the order the build uses — `v3StatusKey`
 * above and `computeResult` (`ai/evaluate.ts:484-489`, which short-circuits on
 * completeness before applying the gate). Nobody needs to re-argue precedence.
 * Note that with `bothIncomplete` now a real word the first two checks are a
 * complete 4-way table over `(D, C)` and their order is no longer load-bearing;
 * what the order still decides is that **rating is asked last, and only of a
 * deck that is complete on both axes**.
 *
 * **The edited branch reverses it: contact, then deck, then rating.** That is
 * his own asymmetry, drawn twice in his own diagram, and it is not a slip we
 * tidy: the edit branch exists BECAUSE somebody edited the contact details, so
 * the first thing it re-asks is whether that worked. Its visible consequence is
 * that **there is no "Both incomplete, Edited"** — a deck that fails both axes
 * after an edit reads "Incomplete contact details, Edited", because contact was
 * asked first. His eleven rows have no such state and this order is why.
 *
 * ── The one status this function never returns ──────────────────────────────
 * **I7, `contactEdited`.** His "Contact details edited" row is a system
 * re-check with no buttons of its own, and it lasts for the duration of one
 * `PATCH /api/decks/:id` — the re-check is synchronous with the save. Nothing
 * on the row can express "re-check in flight", and nothing should: storing it
 * would be storing a request. S2-DASH renders it from the in-flight save
 * (generalising `rowBusy`, `DashboardPage.tsx:1474`), which is why the key and
 * the label are exported and the derivation is not.
 */
export function screeningStatus(deck: ScreeningDeck, opts: ScreeningOptions): ScreeningValue {
  // ── The three sinks (row 7's latch) ──────────────────────────────────────
  if (isArchivedDeck(deck)) return "archived";
  // The MARKER, never the `assigned` stage: `POST /decks/:id/transition` will
  // move a deck to `assigned` with `assigned_to` still NULL, which is exactly
  // the shape of his own row 12 Foul. The marker lets the deck latch and join
  // the Assign roster while `assigned_to` keeps meaning a real evaluator.
  if (deck.sendToAssignAt) return "assigned";
  // `Incomplete, Queried` holds while the SENT deck is unresolved, not forever
  // after any query — see `isQueriedSinkCurrent` for the fixture that proves the
  // difference, and the note above for the conflict it exposes.
  if (isQueriedSinkCurrent(deck, opts.edition ?? "incubator")) {
    // C7 · the narrowest exception that satisfies both row 7 and his open item.
    return isQueryUnanswered(deck, opts.now) ? "noResponse" : "queried";
  }

  // Rejected is an INTERMEDIATE in his matrix, not a final — its whitelist is
  // Archive, and Archive is what takes it to the Archived sink above.
  if (deck.statusId === "rejected") return "rejected";

  // ── C3 · before the AI has run there is no verdict to report ─────────────
  // Deliberately the NOTEVAL TILE's own predicate and not a stage list, so the
  // pill and the box can never disagree — which is the whole point of C3. It
  // also preserves a shipped guard: the resubmit loop
  // (`POST /queries/:id/respond`) walks an `incomplete` deck back to `uploaded`
  // and raises `complete` WITHOUT re-reading the deck, so the two completeness
  // columns still hold the previous run's verdict. Speaking either incomplete
  // word there would announce a verdict the row's own stage contradicts.
  if (v3DeckState(deck) === "noteval") return "awaitingAi";

  const d = deckComplete(deck);
  const c = contactComplete(deck);
  const r = ratingAtOrAboveGate(deck, opts.gate);

  // ── The edited branch: contact, then deck, then rating ───────────────────
  if (deck.contactEditedAt) {
    if (!c) return "incompleteContactEdited";
    if (!d) return "incompleteDeckEdited";
    return r ? "completeEdited" : "belowThresholdEdited";
  }

  // ── The fresh branch: deck, then contact, then rating ────────────────────
  if (!d && !c) return "bothIncomplete";
  if (!c) return "incompleteContact";
  if (!d) return "incompleteDeck";
  return r ? "complete" : "belowThreshold";
}

/**
 * The Status cell as ONE sortable string — the prerequisite for S2-DASH's new
 * STATUS column sort.
 *
 * Today the cell is a pill plus up to four additive chips (Assigned, Queried,
 * Contact Details Edited, Archived, `DashboardPage.tsx:1804-1837`), and a
 * composite of five independent elements cannot be sorted. His
 * "Incomplete contact details, Edited" is a single composed VALUE, which is why
 * the Edited variants are their own statuses above rather than a chip beside a
 * base word: composing happened in the vocabulary, so the cell is one string
 * and the sort is `screeningStatusRank`.
 */
export function screeningStatusLabel(deck: ScreeningDeck, opts: ScreeningOptions): string {
  return SCREENING_STATUS_LABELS[screeningStatus(deck, opts)];
}
