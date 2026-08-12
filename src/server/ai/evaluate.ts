// AI evaluation: send an R2 pitch-deck PDF to Claude, parse structured
// extraction + per-parameter scores, apply the `score > 5` gate, and persist.
// Called directly on single upload and by the Queue consumer for bulk.
//
// The Anthropic call is a raw `fetch` (per the Cloudflare-only plan) forced
// through a single tool so the response is deterministic JSON. `evaluateDeck`
// takes an injectable `callModel` so tests can supply a mocked response.

import type { Edition } from "../../shared/roles";
import { weightedTotal, signalTag } from "../../shared/scoring";
import {
  mergeIntakeDetails,
  missingIntakeFields,
  type IntakeDetails,
  type IntakeField,
  type IntakeFlag,
} from "../../shared/intake";
import { detectIntakeFlags } from "../intake";
import type { Env } from "../types";

const DEFAULT_MODEL = "claude-sonnet-5";
const GATE = 5; // strictly-greater-than gate from the flow diagram.

/**
 * **Determinism (Session 5).** The Jul-24 demo asked for run-to-run score variance
 * within ~10%. Three settings do the work, all applied in `callAnthropic`:
 *
 *  - `temperature: 0` — greedy decoding. The Messages API has **no seed
 *    parameter**, so this is the strongest determinism lever available.
 *  - `thinking: { type: "disabled" }` — no sampled reasoning preamble to diverge.
 *  - a forced `tool_choice` — the response shape is fixed, so only the numbers can
 *    move, never the structure.
 *
 * The prompt is deterministic too: parameters are ordered by `sort_order` and the
 * anchor bands are sorted, so the same deck + rubric always produces byte-identical
 * request text.
 *
 * **Residual variance expectation.** Temperature 0 is not a guarantee — batching
 * and floating-point non-determinism in the serving stack can still flip a
 * near-tied token, and a per-parameter score is one token. Expect most re-runs to
 * be identical, occasional single-parameter drift of ±1, and therefore a weighted
 * composite within roughly ±0.3 of 10 (well inside the ~10% target). The real
 * protection against needless drift is the **rescore guard** (Session 1): we do not
 * re-run at all unless the deck content or the admin's criteria changed.
 */
const AI_TEMPERATURE = 0;

/** Pass/fail landing stages per edition once the AI gate is applied. */
const PASS_STAGE: Record<Edition, string> = {
  incubator: "ai_evaluated",
  vc: "analyst_scoring",
};
const FAIL_STAGE: Record<Edition, string> = {
  incubator: "rejected",
  vc: "archived",
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

export interface AnchorRow {
  band: string;
  min_score: number;
  max_score: number;
  label: string;
}

/** Raw structured payload the model returns via the `submit_evaluation` tool. */
export interface RawEvaluation {
  complete?: boolean;
  founder?: string | null;
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
  /** Soft duplicate / returning-company alert, or null. Never blocks. */
  intakeFlag: IntakeFlag | null;
  intakeNote: string | null;
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

/** User prompt: the rubric (parameters + weights) and the anchor bands.
 *  Core areas form the weighted composite; role-scoped additional params are
 *  listed separately as assistive lenses, each with its configurable prompt
 *  (deck-context variables substituted). Both are scored, but only the core
 *  areas count toward the composite (additional params carry weight 0). */
export function buildUserPrompt(
  params: ParameterRow[],
  anchors: AnchorRow[],
  ctx: PromptContext = {},
): string {
  const core = params.filter((p) => !p.informational);
  const additional = params.filter((p) => p.informational);

  const rubric = core.map((p) => `- ${p.key} — ${p.name} (weight ${p.weight})`).join("\n");
  const bands = anchors
    .slice()
    .sort((a, b) => b.min_score - a.min_score)
    .map((a) => `- ${a.min_score}–${a.max_score}: ${a.label}`)
    .join("\n");

  let additionalBlock = "";
  if (additional.length > 0) {
    const items = additional
      .map((p) => {
        const guidance = p.prompt ? substituteVars(p.prompt, ctx) : `Score ${p.name} 0–10.`;
        return `- ${p.key} — ${p.name}\n  Guidance: ${guidance}`;
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
    `\nAnchor bands (apply consistently):\n${bands}\n\n` +
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
): { weightedTotal: number; signal: string; gatePassed: boolean; status: string } {
  const scoreByKey = new Map(parsed.scores.map((s) => [s.key, s.value]));
  // Score every rubric parameter over the FULL weight denominator: a parameter
  // the model didn't return counts as 0, so a partial/truncated response can't
  // inflate the weighted total past the gate.
  const total = weightedTotal(
    params.map((p) => ({ weight: p.weight, value: scoreByKey.get(p.key) ?? 0 })),
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
      // Determinism (see AI_TEMPERATURE above): greedy decoding, no sampled
      // thinking, and a forced tool so only the numbers can vary run to run.
      temperature: AI_TEMPERATURE,
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
  sector: string | null;
  stage: string | null;
  city: string | null;
  founder: string | null;
  founder_email: string | null;
  founder_phone: string | null;
  cohort_id: string | null;
}

export interface EvaluateOptions {
  callModel?: ModelCaller;
  now?: () => string;
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

  const deck = await env.DB.prepare(
    "SELECT id, edition, status, r2_key, content_version, name, sector, stage, city, " +
      "founder, founder_email, founder_phone, cohort_id FROM decks WHERE id = ?",
  )
    .bind(deckId)
    .first<DeckRow>();
  if (!deck) throw new Error(`deck not found: ${deckId}`);
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
  const anchors = (
    await env.DB.prepare("SELECT band, min_score, max_score, label FROM rubric_anchors").all<AnchorRow>()
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
    userText: buildUserPrompt(params, anchors, {
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
  const effective: ParsedEvaluation = {
    ...parsed,
    complete: parsed.complete && missingFields.length === 0,
  };

  const { weightedTotal: total, signal, gatePassed, status } = computeResult(
    effective,
    params,
    deck.edition,
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
      "UPDATE decks SET ai_score = ?, signal = ?, status = ?, founder = ?, founder_email = ?, " +
        "founder_phone = ?, city = ?, sector = ?, missing_fields = ?, intake_flag = ?, " +
        "intake_flag_note = ?, related_deck_id = ?, complete = ?, updated_at = ? WHERE id = ?",
    ).bind(
      total,
      signal,
      status,
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

  return {
    deckId,
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
