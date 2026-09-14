/**
 * The six All-decks stat boxes and the pipeline-progress rail derived from them
 * (Aug-2026 issues 4, 5 and 7).
 *
 * Issue 4/5 renamed the last two boxes to **Assigned** and **Shortlisted**, and
 * issue 7 requires the right rail's "Pipeline progress" items to be *the same
 * titles as the stat boxes* — so both come from this one list. `Uploaded` is the
 * denominator, exactly as the prototype's `mpProgress()` treats `data-stat="all"`.
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
