/**
 * **Auto-triggered clarification questions** — the second toggle of the admin
 * console's AI-engine card (`admin/s-fw.html`): *"Send targeted questions to
 * startup when AI detects weak signal"*, shipped ON.
 *
 * F0041 / F0108: the clarification loop existed but was 100 % manual — nothing
 * fired it, and the question bank the prototype scopes to this trigger had
 * nothing to feed. This module is the trigger. It runs after an AI evaluation
 * commits, and it does nothing at all when `auto_clarification` is off, which
 * is what makes the toggle real rather than decorative.
 *
 * F0042: "weak signal" here is the **rubric** band (`WEAK_SIGNAL_MAX`), not the
 * All-Decks cohort threshold the shipped `weak_areas` query used. Moving a
 * cohort threshold must not silently re-target founder questions — they are two
 * unrelated scales, and `shared/scoring.ts` says so at the constant.
 *
 * The question TEXT is the shared default message today. `W2-C` owns the
 * curated question bank and replaces `questionsFor` with a bank read; the
 * trigger, the gating and the de-duplication stay here.
 */
import {
  areasNeedingResponse,
  buildQueryMessage,
  type BankArea,
  type ResponseArea,
} from "../../shared/queries";
import type { IntakeField } from "../../shared/intake";
import { isWeakSignal } from "../../shared/scoring";
import { buildQueryEmail, sendEmail } from "../email/outbox";
import { scoped, type TenantScope } from "../../shared/tenant";
import type { Env } from "../types";
import { scoringSettingsFor } from "./scoringSettings";
import { configScope } from "./scope";
import type { Edition } from "../../shared/roles";

export interface AutoClarifyInput {
  deckId: string;
  edition: Edition;
  /**
   * The deck's owning customer (`decks.tenant_id`).
   *
   * OPTIONAL, and the only optional scope field T1-CONFIG ships. The sole caller
   * is `ai/evaluate.ts:1149` — T1-DECKS' file — and it builds this input from a
   * `decks` row whose `SELECT` does not yet carry `tenant_id`. Adding it means
   * editing that statement and its `DeckRow` type, which is that session's work
   * and not safely done from this branch.
   *
   * Absent, it resolves to `DEFAULT_TENANT_ID`, which is today's behaviour. See
   * `config/scope.ts` for the ratchet that stops that becoming permanent:
   * `test/unit/config-scope-bridge.test.ts` lists this call site and fails when a
   * new one appears.
   */
  tenantId?: string;
  deckName: string;
  founderName: string | null;
  founderEmail: string | null;
  uploadedBy: string | null;
  /** Required intake columns the evaluation could not fill. */
  missingFields: IntakeField[];
}

export interface AutoClarifyResult {
  /** True when a query row was created and an email handed to the outbox. */
  triggered: boolean;
  reason?: "disabled" | "no_weak_signal" | "already_open";
  queryId?: string;
  areas?: ResponseArea[];
}

/**
 * The areas a founder is asked about: deck sections the extraction marked
 * absent, plus every core evaluation area the AI scored in the Weak or
 * Insufficient band. Informational / role-scoped parameters are excluded — they
 * are an internal lens, not something to put to a founder.
 */
async function weakAreasFor(
  env: Env,
  scope: TenantScope,
  deckId: string,
): Promise<{ weak: string[]; sections: string[] }> {
  // `scores` and `deck_extractions` are both deck-owned and the `deck_id` here
  // is the deck being evaluated, so the owner is already established one frame
  // up. The scope goes on `parameters` anyway: this statement resolves a score's
  // `parameter_id` to a NAME that ends up in a founder's letter, and the rubric
  // it resolves against must be this customer's.
  const q = scoped(scope).on("p").and("s.deck_id = ?", deckId).andRaw(
    "s.evaluator_kind = 'ai' AND p.informational = 0",
  );
  const scored = (
    await env.DB.prepare(
      "SELECT p.name AS name, s.value AS value FROM scores s JOIN parameters p ON p.id = s.parameter_id " +
        `${q.whereClause()} ORDER BY p.sort_order`,
    )
      .bind(...q.binds)
      .all<{ name: string; value: number }>()
  ).results;

  const sections = (
    await env.DB.prepare(
      "SELECT label FROM deck_extractions WHERE deck_id = ? AND missing = 1 ORDER BY sort_order",
    )
      .bind(deckId)
      .all<{ label: string }>()
  ).results.map((r) => r.label);

  return { weak: scored.filter((s) => isWeakSignal(s.value)).map((s) => s.name), sections };
}

/**
 * The clarification text, drawn from the curated question bank.
 *
 * `W2-C` landed the bank and `buildQueryMessage`'s `{ bank }` option, but this
 * producer — the AUTOMATIC path — was never switched over, so an auto-triggered
 * letter still went out as bare area labels while the manual one drew real
 * questions. Wired at Wave 2 integration. Passing no bank reproduces the old
 * wording exactly, which is the fallback when the query returns nothing.
 */
async function questionsFor(
  db: D1Database,
  scope: TenantScope,
  deckName: string,
  areas: ResponseArea[],
): Promise<string> {
  // `question_bank` has no tenant column: it is keyed to `parameters.id` and
  // reached through it (`TENANT_OWNER`). So the scope goes on `parameters`, and
  // it has to — this statement reads the WHOLE bank for the edition, which is
  // every customer's curated clarification questions, and then puts them in a
  // letter to a founder. The one place in this module where an insufficient
  // predicate leaves the building.
  const q = scoped(scope).on("p").andRaw("q.active = 1");
  const rows = (
    await db
      .prepare(
        `SELECT q.parameter_id AS parameterId, p.name AS name, q.text AS text
           FROM question_bank q JOIN parameters p ON p.id = q.parameter_id
          ${q.whereClause()}
          ORDER BY p.sort_order, q.seq`,
      )
      .bind(...q.binds)
      .all<{ parameterId: string; name: string; text: string }>()
  ).results;
  const byArea = new Map<string, BankArea>();
  for (const r of rows) {
    const entry = byArea.get(r.parameterId) ?? {
      parameterId: r.parameterId,
      name: r.name,
      questions: [],
    };
    entry.questions.push(r.text);
    byArea.set(r.parameterId, entry);
  }
  return buildQueryMessage(deckName, areas, { bank: [...byArea.values()] });
}

/**
 * Create and send one clarification query for a freshly evaluated deck, when
 * the org has the toggle on and the deck actually has weak or missing signal.
 *
 * Never throws: a clarification failure must not fail (and so re-drive) an
 * evaluation that was scored perfectly well — the same contract the Incomplete
 * notification already has. Idempotent per deck: an unresolved query already on
 * the deck means the founder has an open ask, so a second one is not raised.
 */
export async function maybeAutoClarify(
  env: Env,
  input: AutoClarifyInput,
  now: () => string = () => new Date().toISOString(),
): Promise<AutoClarifyResult> {
  const scope = configScope(
    input.tenantId ? { tenantId: input.tenantId, edition: input.edition } : input.edition,
  );
  const settings = await scoringSettingsFor(env, scope);
  if (!settings.autoClarification) return { triggered: false, reason: "disabled" };

  const { weak, sections } = await weakAreasFor(env, scope, input.deckId);
  const areas = areasNeedingResponse({
    missingFields: input.missingFields,
    missingSections: sections,
    weakAreas: weak,
  });
  if (areas.length === 0) return { triggered: false, reason: "no_weak_signal" };

  const open = await env.DB.prepare(
    "SELECT id FROM queries WHERE deck_id = ? AND resolved_at IS NULL LIMIT 1",
  )
    .bind(input.deckId)
    .first<{ id: string }>();
  if (open) return { triggered: false, reason: "already_open" };

  const ts = now();
  const queryId = `qry_${crypto.randomUUID()}`;
  const questions = await questionsFor(env.DB, scope, input.deckName, areas);
  await env.DB.prepare(
    "INSERT INTO queries (id, deck_id, questions, email_status, created_at) VALUES (?, ?, ?, 'sent', ?)",
  )
    .bind(queryId, input.deckId, questions, ts)
    .run();

  // Unscoped on purpose, and this is the one place in T1-CONFIG where adding the
  // predicate would be the bug. `input.tenantId` is optional (see above), so a
  // scoped read here would bind `DEFAULT_TENANT_ID` for every caller that has not
  // passed it — and then fail to find a SECOND customer's uploader, silently
  // falling back to `founder@portal.local` and mailing the clarification letter
  // into a void. `uploadedBy` comes off the deck being evaluated, so the owner is
  // already established; T1-DECKS can scope it once the deck row carries the key.
  const uploader = input.uploadedBy
    ? await env.DB.prepare("SELECT email, name FROM users WHERE id = ?")
        .bind(input.uploadedBy)
        .first<{ email: string; name: string }>()
    : null;
  const { subject, body } = buildQueryEmail({
    deckName: input.deckName,
    founderName: input.founderName ?? uploader?.name ?? null,
    questions,
  });
  await sendEmail(
    env,
    {
      kind: "founder_query",
      toEmail: input.founderEmail ?? uploader?.email ?? "founder@portal.local",
      toName: input.founderName ?? uploader?.name ?? null,
      subject,
      body,
      deckId: input.deckId,
      queryId,
      // One auto-query per deck per query row — a queue retry that re-evaluates
      // the same deck must not mail the founder twice.
      dedupeKey: `auto_query:${queryId}`,
    },
    now,
  );

  return { triggered: true, queryId, areas };
}
