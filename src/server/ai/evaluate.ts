// AI evaluation: send an R2 pitch-deck PDF to Claude, parse structured
// extraction + per-parameter scores, apply the `score > 5` gate, and persist.
// Called directly on single upload and by the Queue consumer for bulk.
//
// The Anthropic call is a raw `fetch` (per the Cloudflare-only plan) forced
// through a single tool so the response is deterministic JSON. `evaluateDeck`
// takes an injectable `callModel` so tests can supply a mocked response.

import type { Edition } from "../../shared/roles";
import { composite, signalTag } from "../../shared/scoring";
import { RUBRIC_BANDS, type CompositeFormula } from "../../shared/types";
import { scoringSettingsFor } from "../config/scoringSettings";
import { maybeAutoClarify } from "../config/autoQuery";
import {
  mergeIntakeDetails,
  missingIntakeFields,
  type IntakeDetails,
  type IntakeField,
  type IntakeFlag,
} from "../../shared/intake";
import { detectIntakeFlags } from "../intake";
import { notifyIncompleteDeck } from "../resubmit";
import type { Env } from "../types";

const DEFAULT_MODEL = "claude-sonnet-5";
const GATE = 5; // strictly-greater-than gate from the flow diagram.

/*
 * Determinism (Session 5, corrected in Session 7). The Jul-24 demo asked for
 * run-to-run score variance within ~10%. Two settings do the work, both applied
 * in `callAnthropic`:
 *
 *   - `thinking: { type: "disabled" }` — no sampled reasoning preamble to diverge.
 *   - a forced `tool_choice` — the response shape is fixed, so only the numbers
 *     can move, never the structure.
 *
 * The prompt is deterministic too: parameters are ordered by `sort_order` and the
 * anchor bands are sorted, so the same deck + rubric always produces
 * byte-identical request text.
 *
 * THERE IS NO `temperature`, AND ITS ABSENCE IS NOT AN OVERSIGHT. Session 5 sent
 * `temperature: 0` as the strongest determinism lever available (the Messages API
 * has no seed parameter). `claude-sonnet-5` REJECTS non-default sampling
 * parameters with a 400 — "temperature is deprecated for this model" — so every
 * live evaluation failed and stranded its deck at `pending_ai`. That is exactly
 * the §9 symptom, and it is what the Session-7 cron sweep surfaced on the
 * production demo. Do NOT re-add it; steer through the prompt instead.
 *
 * Residual-variance expectation: most re-runs identical, occasional
 * single-parameter drift of ±1 from serving-stack non-determinism, so a weighted
 * composite within roughly ±0.3/10 — inside the ~10% target. The real protection
 * against needless drift is the Session-1 rescore guard: we do not re-run at all
 * unless the deck content or the admin's criteria changed.
 */

/** Pass/fail landing stages per edition once the AI gate is applied. */
const PASS_STAGE: Record<Edition, string> = {
  incubator: "ai_evaluated",
  vc: "analyst_scoring",
};
const FAIL_STAGE: Record<Edition, string> = {
  incubator: "rejected",
  vc: "archived",
};

/**
 * Where a deck lands when the org has turned **AI pre-scoring off** (admin
 * console → Scoring framework, `ai_pre_scoring_enabled`). No model call, no
 * scores, no gate — a human picks the deck up instead. The incubator has an
 * explicit human-triage stage; the VC pipeline's first human stage is analyst
 * scoring, which is the same idea one step further along.
 */
const SKIP_AI_STAGE: Record<Edition, string> = {
  incubator: "manual_review",
  vc: "analyst_scoring",
};

export interface ParameterRow {
  id: string;
  key: string;
  name: string;
  weight: number;
  /** Additional / role-scoped param — assistive, never in the weighted composite. */
  informational?: boolean;
  /** Configurable AI extraction prompt (additional params); core areas leave this null. */
  prompt?: string | null;
}

/** Deck-derived values substituted into an additional param's `{{...}}` prompt. */
export interface PromptContext {
  startupName?: string | null;
  sector?: string | null;
  stage?: string | null;
  programType?: string | null;
}

/** Fill an additional-param prompt's template variables from the deck context.
 *  Unknown / unprovided placeholders are left intact for the model to infer. */
export function substituteVars(text: string, ctx: PromptContext): string {
  const map: Record<string, string | null | undefined> = {
    startup_name: ctx.startupName,
    sector: ctx.sector,
    stage: ctx.stage,
    program_type: ctx.programType,
  };
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, name: string) => {
    const v = map[name];
    return v != null && v !== "" ? v : whole;
  });
}

/**
 * One row of `parameter_rubric_bands` (0027) — the per-parameter anchor text on
 * the specs' five-band scale.
 *
 * W2-B replaced the global four-band `rubric_anchors` table this file used to
 * read (dropped in `0039`). That table gave every area the same four generic
 * anchors, which is the opposite of what the rubric is for: "9–10" means
 * something different for Climate Impact than for Storytelling.
 */
export interface ParameterBandRow {
  parameter_id: string;
  band_index: number;
  band_label: string;
  band_name: string;
  description: string | null;
}

/** Raw structured payload the model returns via the `submit_evaluation` tool. */
export interface RawEvaluation {
  complete?: boolean;
  founder?: string | null;
  /** Aug-2026 issue 12 — auto-recognised company identity (overridable). */
  startup_name?: string | null;
  funding_stage?: string | null;
  /** Required intake detail read off the deck (Session 5 — upload validation).
   *  A bulk upload types nothing, so the extraction is the only source. */
  founder_email?: string | null;
  founder_phone?: string | null;
  city?: string | null;
  sector?: string | null;
  extractions?: Array<{
    label?: string;
    heading?: string | null;
    text?: string | null;
    missing?: boolean;
  }>;
  scores?: Array<{ key?: string; value?: number; comment?: string | null }>;
}

export interface ExtractionRow {
  label: string;
  heading: string | null;
  text: string | null;
  missing: boolean;
}

export interface ScoreRow {
  parameterId: string;
  key: string;
  value: number;
  comment: string | null;
}

/** Normalised, validated evaluation ready to persist. */
export interface ParsedEvaluation {
  complete: boolean;
  founder: string | null;
  /** Company identity read off the deck (issue 12); either may be null. */
  recognized: { startupName: string | null; fundingStage: string | null };
  /** Contact/company detail the model read off the deck (may be all-null). */
  details: IntakeDetails;
  extractions: ExtractionRow[];
  scores: ScoreRow[];
}

export interface EvaluationResult {
  deckId: string;
  weightedTotal: number;
  signal: string;
  status: string;
  gatePassed: boolean;
  complete: boolean;
  /** Required intake columns still absent after merging form + extraction. A
   *  non-empty list forces the deck Incomplete regardless of the score (§8). */
  missingFields: IntakeField[];
  /** The merged founder/contact detail now stored on the deck. */
  details: IntakeDetails;
  /** The startup name + funding stage now stored (issue 12 auto-recognition). */
  recognized: { name: string; stage: string | null };
  /** Soft duplicate / returning-company alert, or null. Never blocks. */
  intakeFlag: IntakeFlag | null;
  intakeNote: string | null;
  /** True when the org has AI pre-scoring off — no model call was made. */
  aiSkipped?: boolean;
}

export interface AnthropicRequest {
  apiKey?: string;
  model: string;
  system: string;
  tool: AnthropicTool;
  userText: string;
  pdfBase64: string;
}

/** Injectable seam: returns the raw `submit_evaluation` tool input. */
export type ModelCaller = (req: AnthropicRequest) => Promise<RawEvaluation>;

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

// ── Prompt + tool construction (pure) ────────────────────────────────────────

/** Build the forced tool whose input is the whole structured evaluation. */
export function buildTool(params: ParameterRow[]): AnthropicTool {
  return {
    name: "submit_evaluation",
    description:
      "Return the structured extraction of the pitch deck and a 0–10 score for " +
      "every rubric parameter. Call this exactly once.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        complete: {
          type: "boolean",
          description:
            "false if the deck is missing essential slides or the founder's " +
            "identity/contact cannot be determined (marks it Incomplete).",
        },
        founder: {
          type: ["string", "null"],
          description: "The founder or primary contact's full name, or null if absent.",
        },
        // Aug-2026 issue 12 — the startup name and funding stage are recognised
        // from the deck so a bulk upload doesn't inherit a file name, and a
        // single upload can be left blank. Anything the uploader typed wins.
        startup_name: {
          type: ["string", "null"],
          description:
            "The startup/company name exactly as printed on the deck, or null if the deck " +
            "does not state one. Never invent one.",
        },
        funding_stage: {
          type: ["string", "null"],
          description:
            "The round the startup is raising, as one of 'Pre-seed', 'Seed', 'Series A' or " +
            "'Series B+', or null if the deck does not say.",
        },
        // Session 5 — the required intake columns. A bulk upload types nothing, so
        // these extractions are the only source of the founder's contact detail;
        // anything the deck doesn't state must come back null (never guessed), so
        // the upload validation can mark the deck Incomplete and ask for it.
        founder_email: {
          type: ["string", "null"],
          description:
            "The founder/primary contact's email address exactly as printed in the deck, " +
            "or null if the deck does not state one. Never invent or infer an address.",
        },
        founder_phone: {
          type: ["string", "null"],
          description:
            "The founder/primary contact's phone number exactly as printed in the deck, " +
            "or null if the deck does not state one. Never invent one.",
        },
        city: {
          type: ["string", "null"],
          description:
            "The startup's primary city / headquarters as stated in the deck, or null if absent.",
        },
        sector: {
          type: ["string", "null"],
          description:
            "The startup's industry sector in two or three words (e.g. 'B2B FinTech'), or null if unclear.",
        },
        extractions: {
          type: "array",
          description: "One entry per key slide (Cover, Problem, Market, Traction, Team, Ask…).",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              label: { type: "string", description: "Slide label, e.g. 'Traction'." },
              heading: { type: ["string", "null"] },
              text: { type: ["string", "null"], description: "A concise summary of the slide." },
              missing: { type: "boolean", description: "true if this expected slide is absent." },
            },
            required: ["label"],
          },
        },
        scores: {
          type: "array",
          description: "Exactly one score per rubric parameter key listed in the prompt.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              key: { type: "string", enum: params.map((p) => p.key) },
              value: { type: "number", description: "Integer 0–10 per the rubric bands." },
              comment: { type: ["string", "null"], description: "One-line justification." },
            },
            required: ["key", "value"],
          },
        },
      },
      required: ["complete", "extractions", "scores"],
    },
  };
}

/** System prompt: role + org override (org's custom prompt is appended). */
export function buildSystemPrompt(orgOverride?: string | null): string {
  const base =
    "You are ai.STARTUPJURY, an expert venture analyst. You read a startup pitch " +
    "deck (provided as a PDF) and produce a rigorous, evidence-based evaluation: " +
    "extract the key slides and score each rubric parameter 0–10 using the anchor " +
    "bands. Be objective and calibrated — reserve 8–10 for genuinely strong signals. " +
    "You must respond only by calling the submit_evaluation tool.";
  return orgOverride ? `${base}\n\nOrganisation guidance:\n${orgOverride.trim()}` : base;
}

/**
 * User prompt: the rubric (parameters + weights + per-area anchors) and the
 * shared band scale.
 *
 * Core areas form the weighted composite; role-scoped additional params are
 * listed separately as assistive lenses, each with its configurable prompt
 * (deck-context variables substituted). Both are scored, but only the core
 * areas count toward the composite (additional params carry weight 0).
 *
 * W2-B — every parameter now carries its **own** AI guidance prompt and its
 * **own** five band anchors, both editable in Admin console → Rubric anchors.
 * Before this, a core area's `prompt` was silently dropped and every area was
 * given the same four generic bands, so the admin section would have rendered
 * without changing a single score.
 */
export function buildUserPrompt(
  params: ParameterRow[],
  bands: ParameterBandRow[],
  ctx: PromptContext = {},
): string {
  const core = params.filter((p) => !p.informational);
  const additional = params.filter((p) => p.informational);

  /** A parameter's five anchors, deepest band last; omitted when none is written. */
  const anchorsFor = (p: ParameterRow): string => {
    const written = RUBRIC_BANDS.map((spec) => ({
      spec,
      row: bands.find((b) => b.parameter_id === p.id && b.band_index === spec.index),
    })).filter((b) => b.row?.description);
    if (written.length === 0) return "";
    return written
      .map((b) => `    ${b.row!.band_label} ${b.row!.band_name}: ${b.row!.description}`)
      .join("\n");
  };

  const rubric = core
    .map((p) => {
      const head = `- ${p.key} — ${p.name} (weight ${p.weight})`;
      const guidance = p.prompt ? `\n  Guidance: ${substituteVars(p.prompt, ctx)}` : "";
      const anchors = anchorsFor(p);
      return `${head}${guidance}${anchors ? `\n  Anchors:\n${anchors}` : ""}`;
    })
    .join("\n");
  const bandScale = RUBRIC_BANDS.map((b) => `- ${b.label}: ${b.name}`).join("\n");

  let additionalBlock = "";
  if (additional.length > 0) {
    const items = additional
      .map((p) => {
        const guidance = p.prompt ? substituteVars(p.prompt, ctx) : `Score ${p.name} 0–10.`;
        const anchors = anchorsFor(p);
        return `- ${p.key} — ${p.name}\n  Guidance: ${guidance}${anchors ? `\n  Anchors:\n${anchors}` : ""}`;
      })
      .join("\n");
    additionalBlock =
      `\nAdditional parameters (assistive — score each 0–10 using its guidance, but ` +
      `they do NOT count toward the weighted composite):\n${items}\n`;
  }

  return (
    "Evaluate the attached pitch deck.\n\n" +
    `Score every one of these ${params.length} parameters (use the exact key).\n\n` +
    `Core rubric (weighted — these form the composite):\n${rubric}\n` +
    additionalBlock +
    `\nScore bands (apply consistently — where an area lists its own anchors ` +
    `above, those take precedence):\n${bandScale}\n\n` +
    "Extract the founder's contact details (name, email, phone, city) and the " +
    "startup's sector exactly as stated in the deck — return null for anything the " +
    "deck does not state; do not guess. Extract the key slides, flag any missing " +
    "essential slides, and set complete=false if the deck is not evaluable. Then " +
    "call submit_evaluation with one score per parameter key above."
  );
}

// ── Parsing + scoring (pure) ─────────────────────────────────────────────────

function clampScore(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
  return Math.max(0, Math.min(10, n));
}

/** Validate + normalise the raw tool input against the known parameter set. */
export function parseEvaluation(raw: RawEvaluation, params: ParameterRow[]): ParsedEvaluation {
  const byKey = new Map(params.map((p) => [p.key, p]));
  const scores: ScoreRow[] = [];
  const seen = new Set<string>();
  for (const s of raw.scores ?? []) {
    const key = typeof s.key === "string" ? s.key : "";
    const param = byKey.get(key);
    if (!param || seen.has(key)) continue;
    seen.add(key);
    scores.push({
      parameterId: param.id,
      key,
      value: clampScore(s.value),
      comment: typeof s.comment === "string" ? s.comment : null,
    });
  }

  const extractions: ExtractionRow[] = (raw.extractions ?? [])
    .filter((e) => typeof e.label === "string" && e.label.length > 0)
    .map((e) => ({
      label: e.label as string,
      heading: typeof e.heading === "string" ? e.heading : null,
      text: typeof e.text === "string" ? e.text : null,
      missing: e.missing === true,
    }));

  const text = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null;
  const founder = text(raw.founder);

  return {
    complete: raw.complete !== false,
    founder,
    recognized: {
      startupName: text(raw.startup_name),
      fundingStage: text(raw.funding_stage),
    },
    details: {
      founder,
      founderEmail: text(raw.founder_email),
      founderPhone: text(raw.founder_phone),
      city: text(raw.city),
      sector: text(raw.sector),
    },
    extractions,
    scores,
  };
}

/** Weighted total, signal band, gate outcome, and next pipeline stage. */
export function computeResult(
  parsed: ParsedEvaluation,
  params: ParameterRow[],
  edition: Edition,
  formula: CompositeFormula = "weighted_average",
): { weightedTotal: number; signal: string; gatePassed: boolean; status: string } {
  const scoreByKey = new Map(parsed.scores.map((s) => [s.key, s.value]));
  // Score every rubric parameter over the FULL weight denominator: a parameter
  // the model didn't return counts as 0, so a partial/truncated response can't
  // inflate the composite past the gate. W2-A: the aggregation itself is the
  // org's configured `composite_formula`, not always a weighted average.
  const total = composite(
    params.map((p) => ({ weight: p.weight, value: scoreByKey.get(p.key) ?? 0 })),
    formula,
  );

  // A deck the model flagged, or one it could not score at all, is Incomplete —
  // never silently gated to rejected/advanced (that would mask a failed eval).
  if (!parsed.complete || parsed.scores.length === 0) {
    return { weightedTotal: total, signal: "flagged", gatePassed: false, status: "incomplete" };
  }

  const gatePassed = total > GATE;
  return {
    weightedTotal: total,
    signal: signalTag(total),
    gatePassed,
    status: gatePassed ? PASS_STAGE[edition] : FAIL_STAGE[edition],
  };
}

// ── Anthropic call (raw fetch) ───────────────────────────────────────────────

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

/** Default model caller: POST /v1/messages with the PDF as a document block. */
export const callAnthropic: ModelCaller = async (req) => {
  if (!req.apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": req.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: req.model,
      max_tokens: 4096,
      // Determinism (see the module header): no sampled thinking, and a forced
      // tool so only the numbers can vary run to run. NB no `temperature` —
      // claude-sonnet-5 rejects it with a 400.
      thinking: { type: "disabled" },
      system: req.system,
      tools: [req.tool],
      tool_choice: { type: "tool", name: req.tool.name },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: req.pdfBase64 },
            },
            { type: "text", text: req.userText },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as {
    content?: Array<{ type: string; name?: string; input?: unknown }>;
  };
  const block = body.content?.find((b) => b.type === "tool_use" && b.name === "submit_evaluation");
  if (!block?.input) throw new Error("Anthropic response missing submit_evaluation tool_use");
  return block.input as RawEvaluation;
};

// ── Orchestration ────────────────────────────────────────────────────────────

interface DeckRow {
  id: string;
  edition: Edition;
  status: string;
  r2_key: string | null;
  content_version: number | null;
  name: string | null;
  /** 1 = the current name is a provisional file-name stand-in (issue 12). */
  name_auto?: number | null;
  sector: string | null;
  stage: string | null;
  city: string | null;
  founder: string | null;
  founder_email: string | null;
  founder_phone: string | null;
  cohort_id: string | null;
  uploaded_by: string | null;
}

/** Fires when a deck lands Incomplete — see `server/resubmit.ts`. */
export type IncompleteNotifier = typeof notifyIncompleteDeck;

export interface EvaluateOptions {
  callModel?: ModelCaller;
  now?: () => string;
  /**
   * Injectable seam for the Incomplete → founder notification (Session 6),
   * matching the `callModel` / `now` pattern. Defaults to the real notifier,
   * so every call site (single upload, bulk queue, rescore, re-upload) gets the
   * behaviour without repeating it. Pass a stub to assert on it in tests.
   */
  notify?: IncompleteNotifier;
}

/**
 * The AI-off path. Moves the deck out of the AI queue into the edition's first
 * human stage, records the reason in `pipeline_events`, and clears any stale
 * AI-health state so the cron sweep does not keep re-driving it. Deliberately
 * leaves an existing `ai_score` / `signal` / `scores` alone: turning the engine
 * off should not erase what it produced while it was on.
 */
async function skipAiEvaluation(
  env: Env,
  deck: DeckRow,
  now: () => string,
): Promise<EvaluationResult> {
  const ts = now();
  const status = SKIP_AI_STAGE[deck.edition];
  if (deck.status !== status) {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE decks SET status = ?, updated_at = ?, ai_error = NULL, ai_failed_at = NULL, ai_attempts = 0 WHERE id = ?",
      ).bind(status, ts, deck.id),
      env.DB.prepare(
        "INSERT INTO pipeline_events (id, deck_id, actor_id, from_stage, to_stage, action, note, created_at) VALUES (?, ?, NULL, ?, ?, 'ai_skipped', ?, ?)",
      ).bind(
        `${deck.id}_evt_${crypto.randomUUID()}`,
        deck.id,
        deck.status,
        status,
        "AI pre-scoring is switched off for this organisation",
        ts,
      ),
    ]);
  }
  return {
    deckId: deck.id,
    recognized: { name: deck.name ?? "Untitled deck", stage: deck.stage ?? null },
    weightedTotal: 0,
    // `absent` was the retired four-band key. W2-B's 0039 renamed it to
    // `insufficient` and deleted it from SIGNAL_STYLES; W2-A wrote this AI-off
    // path while `absent` was still valid. Neither branch was broken alone —
    // merged, an org with AI pre-scoring OFF got a signal the client cannot
    // render and SignalTag threw on the Upload screen. `EvaluationResult.signal`
    // is typed `string` and UploadPage casts it, so typecheck saw nothing.
    // Fixed at Wave 2 integration.
    signal: "insufficient",
    status,
    gatePassed: false,
    complete: true,
    missingFields: [],
    details: {
      founder: deck.founder,
      founderEmail: deck.founder_email,
      founderPhone: deck.founder_phone,
      city: deck.city,
      sector: deck.sector,
    },
    intakeFlag: null,
    intakeNote: null,
    aiSkipped: true,
  };
}

/**
 * Evaluate one deck end-to-end: R2 PDF → Claude → parse → gate → persist.
 * Writes `deck_extractions`, AI `scores`, an `evaluations` roll-up, the deck's
 * ai_score/signal/status/founder, and a `pipeline_events` audit row.
 */
export async function evaluateDeck(
  env: Env,
  deckId: string,
  opts: EvaluateOptions = {},
): Promise<EvaluationResult> {
  const callModel = opts.callModel ?? callAnthropic;
  const now = opts.now ?? (() => new Date().toISOString());
  const notify = opts.notify ?? notifyIncompleteDeck;

  const deck = await env.DB.prepare(
    "SELECT id, edition, status, r2_key, content_version, name, name_auto, sector, stage, city, " +
      "founder, founder_email, founder_phone, cohort_id, uploaded_by FROM decks WHERE id = ?",
  )
    .bind(deckId)
    .first<DeckRow>();
  if (!deck) throw new Error(`deck not found: ${deckId}`);

  // ── AI pre-scoring switch (admin console → Scoring framework) ─────────────
  // "AI reads and scores every deck before jury sees it". Off means OFF: no R2
  // read, no model call, no scores, no gate. The deck leaves the AI queue for
  // the edition's first human stage and says so in its audit trail, so nothing
  // strands at `pending_ai` waiting for a pass that will never run.
  const settings = await scoringSettingsFor(env, deck.edition);
  if (!settings.aiPreScoringEnabled) {
    return skipAiEvaluation(env, deck, now);
  }

  if (!deck.r2_key) throw new Error(`deck has no R2 key: ${deckId}`);

  const params = (
    await env.DB.prepare(
      "SELECT id, key, name, weight, informational, prompt FROM parameters WHERE edition = ? AND active = 1 ORDER BY sort_order",
    )
      .bind(deck.edition)
      .all<{ id: string; key: string; name: string; weight: number; informational: number; prompt: string | null }>()
  ).results.map((p) => ({
    id: p.id,
    key: p.key,
    name: p.name,
    weight: p.weight,
    informational: p.informational === 1,
    prompt: p.prompt,
  }));
  const bands = (
    await env.DB.prepare(
      "SELECT b.parameter_id, b.band_index, b.band_label, b.band_name, b.description " +
        "FROM parameter_rubric_bands b JOIN parameters p ON p.id = b.parameter_id " +
        "WHERE p.edition = ? AND p.active = 1",
    )
      .bind(deck.edition)
      .all<ParameterBandRow>()
  ).results;
  const org = await env.DB.prepare(
    "SELECT ai_system_prompt, criteria_version FROM org_settings WHERE edition = ?",
  )
    .bind(deck.edition)
    .first<{ ai_system_prompt: string | null; criteria_version: number | null }>();

  const object = await env.DECKS.get(deck.r2_key);
  if (!object) throw new Error(`R2 object missing: ${deck.r2_key}`);
  const pdfBase64 = bytesToBase64(new Uint8Array(await object.arrayBuffer()));

  const tool = buildTool(params);
  const raw = await callModel({
    apiKey: env.ANTHROPIC_API_KEY,
    model: env.ANTHROPIC_MODEL ?? DEFAULT_MODEL,
    system: buildSystemPrompt(org?.ai_system_prompt ?? null),
    userText: buildUserPrompt(params, bands, {
      startupName: deck.name,
      sector: deck.sector,
      stage: deck.stage,
      programType: deck.edition === "vc" ? "venture fund" : "incubator",
    }),
    tool,
    pdfBase64,
  });

  const parsed = parseEvaluation(raw, params);

  // ── Upload validation (Session 5) ──────────────────────────────────────────
  // Whatever the uploader typed wins; the extraction fills the blanks (which is
  // how a bulk upload — where nothing is typed — gets its founder details). Any
  // required column still missing marks the deck INCOMPLETE regardless of the
  // score, so the founder is asked for it (Session 6 emails the missing list).
  const details = mergeIntakeDetails(
    {
      founder: deck.founder,
      founderEmail: deck.founder_email,
      founderPhone: deck.founder_phone,
      city: deck.city,
      sector: deck.sector,
    },
    parsed.details,
  );
  const missingFields = missingIntakeFields(details);

  // Aug-2026 issue 12 — auto-recognise the startup name and funding stage. The
  // uploader's own values always win: `name_auto` is only set when the server
  // fell back to the file name, and `stage` is only filled when it was blank.
  const recognizedName =
    deck.name_auto === 1 && parsed.recognized.startupName ? parsed.recognized.startupName : null;
  const effectiveName = recognizedName ?? deck.name;
  const effectiveStage = deck.stage ?? parsed.recognized.fundingStage;
  const effective: ParsedEvaluation = {
    ...parsed,
    complete: parsed.complete && missingFields.length === 0,
  };

  const { weightedTotal: total, signal, gatePassed, status } = computeResult(
    effective,
    params,
    deck.edition,
    settings.compositeFormula,
  );

  // Soft duplicate / returning-company alert, re-run now that the extraction has
  // filled in the founder's identity (a bulk upload had only a filename before).
  const intake = await detectIntakeFlags(env, deck.edition, {
    ...details,
    name: deck.name ?? "",
    fundingStage: deck.stage,
    cohortId: deck.cohort_id,
    selfId: deckId,
  });
  const intakeNote = intake.matches[0]?.reason ?? null;

  const ts = now();

  const stmts: D1PreparedStatement[] = [
    env.DB.prepare("DELETE FROM deck_extractions WHERE deck_id = ?").bind(deckId),
    env.DB.prepare("DELETE FROM scores WHERE deck_id = ? AND evaluator_kind = 'ai'").bind(deckId),
    env.DB.prepare("DELETE FROM evaluations WHERE deck_id = ? AND evaluator_id IS NULL").bind(deckId),
  ];
  parsed.extractions.forEach((e, i) => {
    stmts.push(
      env.DB.prepare(
        "INSERT INTO deck_extractions (id, deck_id, label, heading, text, sort_order, missing) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind(`${deckId}_ext_${i}`, deckId, e.label, e.heading, e.text, i, e.missing ? 1 : 0),
    );
  });
  parsed.scores.forEach((s, i) => {
    stmts.push(
      env.DB.prepare(
        "INSERT INTO scores (id, deck_id, evaluator_id, evaluator_kind, parameter_id, value, comment, created_at) VALUES (?, ?, NULL, 'ai', ?, ?, ?, ?)",
      ).bind(`${deckId}_ai_${i}`, deckId, s.parameterId, s.value, s.comment, ts),
    );
  });
  const verdict = !effective.complete ? "incomplete" : gatePassed ? "advanced" : "below_gate";
  // Stamp the criteria/content versions this AI run scored under so the rescore
  // guard (routes/decks.ts /rescore) can tell whether anything material changed.
  const criteriaVersion = org?.criteria_version ?? 1;
  const contentVersion = deck.content_version ?? 1;
  stmts.push(
    env.DB.prepare(
      "INSERT INTO evaluations (id, deck_id, evaluator_id, weighted_total, verdict, remarks, submitted_at, scored_criteria_version, scored_content_version) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)",
    ).bind(`${deckId}_ai_eval`, deckId, total, verdict, "AI evaluation", ts, criteriaVersion, contentVersion),
  );
  stmts.push(
    env.DB.prepare(
      // A successful evaluation also clears the §9 AI-health state in the SAME
      // statement — a deck can't be both scored and "failed", and doing it here
      // means every caller (upload, queue, re-score, re-upload, the cron sweep)
      // gets the reset for free.
      "UPDATE decks SET ai_score = ?, signal = ?, status = ?, name = ?, name_auto = ?, " +
        "stage = ?, founder = ?, founder_email = ?, " +
        "founder_phone = ?, city = ?, sector = ?, missing_fields = ?, intake_flag = ?, " +
        "intake_flag_note = ?, related_deck_id = ?, complete = ?, updated_at = ?, " +
        "ai_error = NULL, ai_failed_at = NULL, ai_attempts = 0 WHERE id = ?",
    ).bind(
      total,
      signal,
      status,
      effectiveName,
      recognizedName ? 0 : (deck.name_auto ?? 0),
      effectiveStage,
      details.founder ?? null,
      details.founderEmail ?? null,
      details.founderPhone ?? null,
      details.city ?? null,
      details.sector ?? null,
      missingFields.length > 0 ? missingFields.join(",") : null,
      intake.flag,
      intakeNote,
      intake.matches[0]?.deckId ?? null,
      effective.complete ? 1 : 0,
      ts,
      deckId,
    ),
  );
  stmts.push(
    env.DB.prepare(
      "INSERT INTO pipeline_events (id, deck_id, actor_id, from_stage, to_stage, action, note, created_at) VALUES (?, ?, NULL, ?, ?, 'ai_evaluated', ?, ?)",
    ).bind(
      `${deckId}_evt_${crypto.randomUUID()}`,
      deckId,
      deck.status,
      status,
      `AI weighted total ${total.toFixed(2)} · ${verdict}`,
      ts,
    ),
  );

  await env.DB.batch(stmts);

  // ── Incomplete → notify the founder (Session 6) ────────────────────────────
  // Runs only after the batch commits, so the email can never describe a state
  // the database doesn't hold. Deliberately non-fatal: a mail failure must not
  // fail the evaluation (the caller would re-enqueue and re-score a deck that
  // was scored perfectly well). `notifyIncompleteDeck` is itself idempotent on
  // the deck's content version, so a retry does not double-send.
  if (status === "incomplete") {
    try {
      await notify(
        env,
        {
          deckId,
          deckName: deck.name ?? "your pitch deck",
          edition: deck.edition,
          contentVersion: deck.content_version ?? 1,
          founderName: details.founder,
          founderEmail: details.founderEmail,
          uploadedBy: deck.uploaded_by,
          missingFields,
        },
        now,
      );
    } catch (err) {
      console.error(`incomplete-deck notification failed for ${deckId}:`, err);
    }
  }

  // ── Auto-triggered clarification (admin console → Scoring framework) ───────
  // "Send targeted questions to startup when AI detects weak signal". Runs
  // after the batch commits for the same reason the Incomplete notification
  // does, is a no-op when the toggle is off, and never fails the evaluation.
  try {
    await maybeAutoClarify(
      env,
      {
        deckId,
        edition: deck.edition,
        deckName: effectiveName ?? "your pitch deck",
        founderName: details.founder ?? null,
        founderEmail: details.founderEmail ?? null,
        uploadedBy: deck.uploaded_by,
        missingFields,
      },
      now,
    );
  } catch (err) {
    console.error(`auto-clarification failed for ${deckId}:`, err);
  }

  return {
    deckId,
    recognized: { name: effectiveName ?? "Untitled deck", stage: effectiveStage ?? null },
    weightedTotal: total,
    signal,
    status,
    gatePassed,
    complete: effective.complete,
    missingFields,
    details,
    intakeFlag: intake.flag,
    intakeNote,
  };
}
