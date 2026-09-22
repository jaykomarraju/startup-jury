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
 * with its own builder, because its denominator excludes archived decks and
 * `build()` below divides by `decks.length`. It is superuser-only; the six
 * described here still serve admin, PM, PA and the VC edition unchanged.
 *
 * Each edition has its own six (`STAT_ORDER`): the incubator's cohort stages
 * (`AISJ_IC_SuserV15`) and the VC edition's deal funnel (`AISJ_VC_Superuser_V8`
 * — Uploaded · Incomplete · AI Evaluated · In Diligence · IC ready · Onboard
 * ready, F0437 / F0440). The VC IC member's build replaces the six outright
 * with a first-person set ("Awaiting my vote", F0434) — `icMemberStats`.
 */
import type { Edition } from "./roles";
import { vcPipeline } from "../pipeline/vc";

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
// V3-DASH — the incubator SUPERUSER dashboard (`AISJ_SuperuserV3.HTM`)
// ═══════════════════════════════════════════════════════════════════════════
//
// The reshared superuser prototype replaces the six boxes above with a
// different six, and only for the superuser: the admin, program-manager,
// program-associate and jury prototypes were NOT reshared, so `STAT_ORDER`
// and `build()` keep drawing their screens exactly as they do today. Nothing
// in this block is reachable from any other role or edition.
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
 */
export type V3StatusKey = "aieval" | "noteval" | "incompleteDeck" | "incompleteContact";

/** The four words, as the Status pill prints them. */
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
  /** `decks.missing_fields` — required intake columns nobody supplied. */
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
 * announce a verdict its own stage contradicts. This costs the two words
 * nothing: an evaluation lands a deck at `ai_evaluated` or `incomplete`, both
 * of which `v3DeckState` answers, so a deck that has a verdict is never
 * `noteval`. Pinned in `deckStats.test.ts`.
 *
 * **This refines the Status WORD only; it does not move a tile.** `v3DeckState`
 * and `matchesV3Stat` are untouched, so the six boxes still partition exactly
 * as `adData[].state` does and every count is the one V3-DASH measured. The
 * consequence, which is the old `v3-incomplete-mark` tag's situation in
 * reverse: a deck evaluated and THEN stripped of a required detail (plan §4.1
 * case (b)) reads "Incomplete contact details" while still counting under the
 * **AI Evaluated** tile. It was AI-evaluated; it is also not assignable. Both
 * are true, and the row now says the second one in words instead of a chip.
 */
export function v3StatusKey(deck: CompletenessDeck): V3StatusKey {
  const state = v3DeckState(deck);
  if (state === "noteval") return "noteval";
  if (deck.aiComplete === false) return "incompleteDeck";
  if ((deck.missingFields ?? []).length > 0) return "incompleteContact";
  return state === "incomplete" ? "incompleteDeck" : state;
}

/**
 * The table filter, verbatim from `adRenderTable()`:
 *
 *   if(activeStat==='archived') show=d.archived;
 *   else if(d.archived)        show=false;
 *   else if(activeStat==='all')show=true;
 *   else if(activeStat==='shortlisted') show=!!d.shortlisted;
 *   else show=(d.state===activeStat);
 *
 * `assigned` is not a v3 box; it is accepted here only while the Assigned tile
 * is retained pending Q7 (see `V3_TILES`).
 */
export function matchesV3Stat(deck: StatDeck, key: V3StatKey | "assigned"): boolean {
  if (key === "archived") return isArchivedDeck(deck);
  if (isArchivedDeck(deck)) return false;
  if (key === "all") return true;
  if (key === "shortlisted") return SHORTLISTED_STAGES.includes(deck.statusId ?? "");
  if (key === "assigned") return Boolean(deck.assignedTo) || ASSIGNED_STAGES.includes(deck.statusId ?? "");
  return v3DeckState(deck) === key;
}

/**
 * **Q7 / plan §4 — the Assigned tile.** v3 deletes it, which reverses Aug-2026
 * issue 4 (quoted at `STAT_ORDER.incubator`'s fifth entry above). The plan's
 * instruction while Q7 is unanswered is to build the new set and LEAVE ASSIGNED
 * IN PLACE, so it is retained here in its old relative position — immediately
 * before Shortlisted, which is where issue 4 put it.
 *
 * Answering Q7 "yes, delete it" is deleting the one entry flagged below and
 * flipping this constant; nothing else refers to it.
 */
export const ASSIGNED_TILE_RETAINED_PENDING_Q7 = true;

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
  // ── Q7: delete this one line to ship the prototype's six. ──
  ...(ASSIGNED_TILE_RETAINED_PENDING_Q7
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
  // The denominator, and `matchesV3Stat(d, "all")`'s own answer — every tile's
  // count therefore comes from the SAME predicate the table filter uses, so a
  // tile can never disagree with the rows its view draws.
  const active = decks.filter((d) => !isArchivedDeck(d));
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
