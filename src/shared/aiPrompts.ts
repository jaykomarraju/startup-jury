import type { Plan } from "./plans";

/**
 * The v3 superuser prototype's own thirteen core AI prompts — **recorded, not
 * applied.** See `Q62` in `docs/plan_v3_superuser.md` §4.
 *
 * Copied VERBATIM from `CORE_PROMPTS` in the v3 prototype's base64 admin
 * console (`ADMIN_B64` → `admin.html`, section `s-wt`). A plain grep of
 * `AISJ_SuperuserV3.HTM` finds none of this; it has to be decoded first with
 * `docs/prototype/tools/decode-embedded.py`, which is why six client items were
 * once scoped as having "no prototype backing".
 *
 * ## Why these are not what the application evaluates against
 *
 * Item 11 asks for an AI prompt per evaluation area, and the prototype
 * pre-fills its editor with these. But the core areas are **not** without
 * guidance today: migration `0027` (W2-B) wrote a real extraction prompt for
 * all 26 core rows — 13 per edition — and `src/server/ai/evaluate.ts` has
 * rendered them into the rubric ever since. So item 11 is a request for the
 * EDITOR, which did not exist, over content that did.
 *
 * Swapping the two is not a neutral act. `0027`'s prompts are extraction
 * instructions written for this pipeline ("Look for credible TAM/SAM/SOM built
 * bottom-up and a reachable beachhead. Flag top-down-only sizing."). These
 * thirteen are section headings — "What can kill this?" — each followed by an
 * identical 200-character boilerplate tail about the follow-up email. Adopting
 * them would change what the model is asked on every incubator deck, and the
 * only evidence for doing so is that a prototype's editor shows them as
 * placeholder copy.
 *
 * So migration `0071` takes the org's CURRENT prompt as its shipped default —
 * `Restore default` returns you to the text you were evaluating against — and
 * these stay here, intact and asserted, as a one-line switch if the client
 * confirms they are the intended content (Q62).
 */
export const PROTOTYPE_CORE_PROMPTS: Readonly<Record<string, string>> = {
  problem_market_clarity:
    "Does the problem matter, and to whom? Evaluate against the rubric anchors below. If signals are weak, missing, or contradictory, this area is flagged as missing and pointed out to the founder in the follow-up email (the founder then responds with an updated deck).",
  solution_value_prop:
    "Is the solution clearly better? Evaluate against the rubric anchors below. If signals are weak, missing, or contradictory, this area is flagged as missing and pointed out to the founder in the follow-up email (the founder then responds with an updated deck).",
  market_size:
    "Is the opportunity real and reachable? Evaluate against the rubric anchors below. If signals are weak, missing, or contradictory, this area is flagged as missing and pointed out to the founder in the follow-up email (the founder then responds with an updated deck).",
  product_technology:
    "Can this actually be built and scaled? Evaluate against the rubric anchors below. If signals are weak, missing, or contradictory, this area is flagged as missing and pointed out to the founder in the follow-up email (the founder then responds with an updated deck).",
  business_model:
    "Does the business make sense? Evaluate against the rubric anchors below. If signals are weak, missing, or contradictory, this area is flagged as missing and pointed out to the founder in the follow-up email (the founder then responds with an updated deck).",
  traction_validation:
    "Has reality said ‘yes’? Evaluate against the rubric anchors below. If signals are weak, missing, or contradictory, this area is flagged as missing and pointed out to the founder in the follow-up email (the founder then responds with an updated deck).",
  competitive_landscape:
    "Do they understand the battlefield? Evaluate against the rubric anchors below. If signals are weak, missing, or contradictory, this area is flagged as missing and pointed out to the founder in the follow-up email (the founder then responds with an updated deck).",
  gtm_strategy:
    "Can they reach customers efficiently? Evaluate against the rubric anchors below. If signals are weak, missing, or contradictory, this area is flagged as missing and pointed out to the founder in the follow-up email (the founder then responds with an updated deck).",
  team_execution:
    "Can this team pull it off? Evaluate against the rubric anchors below. If signals are weak, missing, or contradictory, this area is flagged as missing and pointed out to the founder in the follow-up email (the founder then responds with an updated deck).",
  business_risks:
    "What can kill this? Evaluate against the rubric anchors below. If signals are weak, missing, or contradictory, this area is flagged as missing and pointed out to the founder in the follow-up email (the founder then responds with an updated deck).",
  business_attractiveness:
    "Is the upside worth the risk? Evaluate against the rubric anchors below. If signals are weak, missing, or contradictory, this area is flagged as missing and pointed out to the founder in the follow-up email (the founder then responds with an updated deck).",
  climate_impact:
    "Is the impact real, measurable, and additional? 🌍 Evaluate against the rubric anchors below. If signals are weak, missing, or contradictory, this area is flagged as missing and pointed out to the founder in the follow-up email (the founder then responds with an updated deck).",
  storytelling:
    "Is the narrative clear and memorable? Evaluate against the rubric anchors below. If signals are weak, missing, or contradictory, this area is flagged as missing and pointed out to the founder in the follow-up email (the founder then responds with an updated deck).",
};

/** The two parameter sets the Seat-configurability grid has a row for. */
export const PARAM_SETS = ["core", "addl"] as const;
export type ParamSet = (typeof PARAM_SETS)[number];

/** `Parameter set` column, verbatim from the prototype's `cfg-table`. */
export const PARAM_SET_LABELS: Record<ParamSet, string> = {
  core: "Core parameters",
  addl: "Addl. parameters",
};

/** The grey second line under each row label. */
export const PARAM_SET_SUBLABELS: Record<ParamSet, string> = {
  core: "13 evaluation areas & prompts",
  addl: "3 role-configurable parameters",
};

/**
 * Item 12 — which seat tiers may CONFIGURE which parameter set.
 *
 * The prototype holds this as `var CFG_CAP={core:{standard:false,pro:true,
 * premium:true}, addl:{standard:false,pro:false,premium:true}}` and mutates it
 * from `cfgTog()`; it resets on reload because the prototype has no
 * persistence. `seat_capabilities` (migration 0071) is that store.
 *
 * It is an EDIT PERMISSION, not per-tier prompt content: all three tiers read
 * the same 13 core prompts and the same 9 additional ones.
 *
 * The defaults below are the prototype's own, stated in its footnote as
 * "Standard — none · Pro — core only · Premium — core + additional" — which is
 * **exactly** the ladder `planAllowsCore` / `planAllowsAdditional` have
 * hard-coded since `src/shared/plans.ts` was written. So an org that never
 * touches the new grid behaves identically to today; that equivalence is
 * asserted rather than assumed (`test/worker/aiPrompts.test.ts`).
 */
export type SeatCapability = Record<ParamSet, Record<Plan, boolean>>;

export const DEFAULT_SEAT_CAPABILITY: SeatCapability = {
  core: { standard: false, pro: true, premium: true },
  addl: { standard: false, pro: false, premium: true },
};

/** A fresh, mutable copy — never hand a caller the shared default to edit. */
export function defaultSeatCapability(): SeatCapability {
  return {
    core: { ...DEFAULT_SEAT_CAPABILITY.core },
    addl: { ...DEFAULT_SEAT_CAPABILITY.addl },
  };
}

export function isParamSet(v: unknown): v is ParamSet {
  return typeof v === "string" && (PARAM_SETS as readonly string[]).includes(v);
}

/**
 * The grid's footnote. The tier names are interpolated from `PLAN_LABELS` so a
 * rename cannot leave the sentence describing tiers that no longer exist.
 */
export const SEAT_CAPABILITY_FOOTNOTE =
  "Turn a capability on for a seat to let that tier configure the set. Current defaults: " +
  "Standard — none · Pro — core only · Premium — core + additional.";

// ── Restore ──────────────────────────────────────────────────────────────────

/**
 * The confirmations the prototype puts through `aisjAsk()` before a restore.
 * Verbatim, because a destructive confirm is exactly the string a user reads
 * most carefully — and because "13" in the core one is a count the screen must
 * keep honest if the area set ever changes (`coreRestoreAllPrompt`).
 */
export const RESTORE_ONE_CONFIRM =
  "Reset this AI prompt to the shipped default? Your edits will be lost.";

export function coreRestoreAllConfirm(areaCount: number): string {
  return (
    `Reset ALL ${areaCount} core AI prompts to their shipped defaults? ` +
    "Every core prompt edit will be lost."
  );
}

export const ADDITIONAL_RESTORE_ALL_CONFIRM =
  "Reset ALL additional-parameter prompts (all roles) to their shipped defaults? " +
  "These edits will be lost.";
