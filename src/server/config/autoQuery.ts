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
 *
 * ── 1-Oct-2026 · the trigger fired on everything ──────────────────────────
 * Measured against production: all ELEVEN decks the tester uploaded carried a
 * `queries` row at `email_status = 'sent'` with a fully composed letter and no
 * reply — including the five whose contact details were complete and the six
 * whose were not. Two causes, both here, neither tested (`grep maybeAutoClarify
 * test/` returned nothing):
 *
 *   · every missing CONTACT column arrived as an "area", so a blank phone
 *     number alone raised a letter asking the founder about their own phone
 *     number (`clarifiableAreas`);
 *   · nothing asked whether there was a founder to mail, and the recipient fell
 *     back through the UPLOADER to `founder@portal.local`, so the usual outcome
 *     of a staff upload was mailing the analyst as the founder
 *     (`clarificationRecipient`).
 *
 * Those `queries` rows are what latched the tester's Dashboard: a row with
 * `queried = true` collapses an `incomplete` deck's status to "queried", whose
 * active-action whitelist is empty — so Edit and Archive, which the spec DOES
 * grant it, were unreachable. The latch is `DashboardPage`'s; the rows were
 * ours.
 */
import {
  areasNeedingResponse,
  buildQueryMessage,
  type BankArea,
  type ResponseArea,
} from "../../shared/queries";
import { isValidEmail, type IntakeField } from "../../shared/intake";
import { isWeakSignal } from "../../shared/scoring";
import { buildQueryEmail, sendEmail } from "../email/outbox";
import { scoped, type TenantScope } from "../../shared/tenant";
import type { Env } from "../types";
import { scoringSettingsFor } from "./scoringSettings";
import type { Edition } from "../../shared/roles";

export interface AutoClarifyInput {
  deckId: string;
  edition: Edition;
  /**
   * The deck's owning customer (`decks.tenant_id`).
   *
   * REQUIRED. It was optional while the tenancy wave was in flight, because the
   * sole caller — `ai/evaluate.ts`, T1-DECKS' file — built this input from a
   * `decks` row whose `SELECT` did not carry `tenant_id`, and adding it was that
   * session's work. T1-DECKS added it; T1 integration made this required.
   *
   * It matters more here than the field count suggests. `maybeAutoClarify` reads
   * the scoring settings, the weak areas and the QUESTION BANK, then MAILS the
   * result to a founder. Without the tenant, a second customer's founder would be
   * asked the FIRST customer's clarification questions, over email, in the second
   * customer's name.
   */
  tenantId: string;
  deckName: string;
  founderName: string | null;
  /**
   * The founder's own address, as the evaluation merged it (form value first,
   * extraction second). **The only address this module will mail**, and the
   * reason `uploadedBy` is no longer here: see `autoClarifyBlock`.
   */
  founderEmail: string | null;
  /** Required intake columns the evaluation could not fill. */
  missingFields: readonly IntakeField[];
}

/** Why no clarification was raised — everything except the de-duplication. */
export type AutoClarifyBlock = "disabled" | "no_contact" | "no_weak_signal";

export interface AutoClarifyResult {
  /** True when a query row was created and an email handed to the outbox. */
  triggered: boolean;
  reason?: AutoClarifyBlock | "already_open";
  queryId?: string;
  areas?: ResponseArea[];
}

/**
 * The areas worth putting to a founder — everything the deck needs answered
 * EXCEPT the founder's own contact columns.
 *
 * `areasNeedingResponse` emits one `detail` area per absent intake column, and
 * that is right for the Query screen's "Parameters needing response" list — but
 * it must not be what FIRES a letter. A blank phone number was enough to
 * compose "Dear Founder, thank you for…" and mail it, which is both the wrong
 * question (we are asking the founder for the address we are asking at) and
 * the wrong letter: a deck missing intake columns already gets
 * `notifyIncompleteDeck`'s resubmit mail from the same evaluation. So the
 * contact gaps are dropped from the trigger AND from the letter, and the
 * clarification is what the toggle says it is — weak or missing SIGNAL.
 *
 * Stated honestly: inside `maybeAutoClarify` this filter is now defence in
 * depth, because `no_contact` already requires an empty `missingFields` and
 * `detail` areas are derived from nothing else. It is load-bearing in
 * `autoClarifyBlock`, which callers reach with a deck's areas and no contact
 * gate of their own — `routes/questions.ts` being the one that must.
 */
export function clarifiableAreas(areas: readonly ResponseArea[]): ResponseArea[] {
  return areas.filter((a) => a.kind !== "detail");
}

export interface AutoClarifyGate {
  autoClarification: boolean;
  founderEmail: string | null;
  missingFields: readonly IntakeField[];
  areas: readonly ResponseArea[];
}

/**
 * Does the automatic clarification fire? **This is the authoritative predicate**
 * (1-Oct-2026, tester issue 4) — `shouldAutoClarify` in `src/shared/queries.ts`
 * answers the same question for the Query screen's `triggered` flag and knows
 * only about the toggle and the area count, so it says yes where this says no.
 * Closing that is one import in `src/server/routes/questions.ts`; see
 * `docs/parity-requests/OCT1-AUTOQUERY.md`.
 *
 * `no_contact` is the client's own "Contact complete?" branch, which his
 * decision tree answers with *Query disabled* — and the tester's words for it
 * were "you cannot send any Email Query too if contact details are not
 * available". Both halves are checked because they fail differently: an absent
 * or unusable `founderEmail` means there is nobody to mail, and a non-empty
 * `missingFields` means the deck is in his INCOMPLETE CONTACT state, where the
 * founder is being asked to complete their details, not to defend a score.
 *
 * **This is stricter than the manual route** (`POST /decks/:id/queries`, which
 * refuses on reachability alone), and the asymmetry is the point. A deck with an
 * incomplete contact block has already had `notifyIncompleteDeck`'s resubmit
 * letter out of the SAME evaluation; a second automatic letter a second later,
 * about overlapping things, is precisely the eleven-for-eleven noise the tester
 * reported. An operator who opens the Query screen and composes by hand is a
 * person deciding, and keeps the looser rule.
 */
export function autoClarifyBlock(gate: AutoClarifyGate): AutoClarifyBlock | null {
  if (!gate.autoClarification) return "disabled";
  if (!clarificationRecipient(gate)) return "no_contact";
  if (clarifiableAreas(gate.areas).length === 0) return "no_weak_signal";
  return null;
}

/**
 * The one address a clarification may go to, or null.
 *
 * There is no fallback on purpose. The chain this replaces was
 * `founderEmail ?? uploader?.email ?? "founder@portal.local"`, whose COMMON
 * outcome was the staff analyst who uploaded the deck receiving "Dear Founder,
 * thank you for submitting…" about a company they do not run — and whose other
 * outcome was a letter addressed to a domain that does not exist. A deck we
 * cannot reach the founder of is not queried at all.
 */
export function clarificationRecipient(
  gate: Pick<AutoClarifyGate, "founderEmail" | "missingFields">,
): string | null {
  const email = gate.founderEmail?.trim() ?? "";
  if (gate.missingFields.length > 0) return null;
  return isValidEmail(email) ? email : null;
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
 * the org has the toggle on, the founder is REACHABLE, and the deck actually has
 * weak or missing signal.
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
  const scope: TenantScope = { tenantId: input.tenantId, edition: input.edition };
  const settings = await scoringSettingsFor(env, scope);
  if (!settings.autoClarification) return { triggered: false, reason: "disabled" };

  // Asked BEFORE the two weak-area reads, not after: on the six production decks
  // sitting at `incomplete` this is the entire answer, and composing a letter we
  // have nowhere to send is work that ends in a `queries` row claiming
  // `email_status = 'sent'`. The three gates below are `autoClarifyBlock`'s, in
  // its order, built from its own two helpers so the pure predicate and this
  // path cannot drift.
  const recipient = clarificationRecipient(input);
  if (!recipient) return { triggered: false, reason: "no_contact" };

  const { weak, sections } = await weakAreasFor(env, scope, input.deckId);
  const areas = clarifiableAreas(
    areasNeedingResponse({
      missingFields: input.missingFields,
      missingSections: sections,
      weakAreas: weak,
    }),
  );
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

  // THE UPLOADER LOOKUP IS GONE, and what it was for is the defect. It resolved
  // `uploadedBy` to a `users` row so the address and the greeting could fall back
  // to it — so a staff bulk upload mailed the analyst as if they were the
  // founder. T1 integration scoped that lookup to stop it finding a STRANGER;
  // 1-Oct removes the question. `clarificationRecipient` has already proved that
  // `founderEmail` is usable and that no intake column is missing, which means
  // `founderName` is present too (`missingIntakeFields` reports `founder`), so
  // there is nothing left for a fallback to cover.
  const { subject, body } = buildQueryEmail({
    deckName: input.deckName,
    founderName: input.founderName,
    questions,
  });
  await sendEmail(
    env,
    {
      kind: "founder_query",
      toEmail: recipient,
      toName: input.founderName,
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
