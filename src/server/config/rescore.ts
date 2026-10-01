// Re-scoring after a parameter-weight change (Phase 6). A weight edit must
// recompute the stored weighted totals — this is the `shared/scoring` seam.
//
// For every deck in the edition we recompute the AI weighted total (and each
// human evaluator's roll-up) from the persisted per-parameter `scores` rows
// using the CURRENT parameter weights, over the full rubric denominator (an
// unscored parameter counts 0 — mirrors the evaluate.ts gate semantics). Only
// the numeric score / signal / roll-up changes: the pipeline stage is never
// moved, so a weight edit can't rewind a deck that has already advanced. Decks
// the AI flagged as incomplete keep their `flagged` signal.

import { composite, signalTag } from "../../shared/scoring";
import { scoped, type TenantScope } from "../../shared/tenant";
import { scoringSettingsFor } from "./scoringSettings";
import type { Env } from "../types";

interface ScoreJoinRow {
  deck_id: string;
  deck_signal: string | null;
  evaluator_id: string | null;
  evaluator_kind: string;
  parameter_id: string;
  value: number;
}

interface Group {
  deckId: string;
  deckSignal: string | null;
  evaluatorId: string | null;
  kind: string;
  values: Map<string, number>;
}

export interface RescoreResult {
  decks: number;
  evaluations: number;
}

/**
 * Recompute every stored weighted total in ONE WORKSPACE against current weights.
 *
 * `scope`, not an `Edition`, and strictly: both call sites are in
 * `routes/config.ts`, so there is no foreign caller to bridge for and no reason
 * to accept the weaker argument `config/scope.ts` exists for.
 *
 * This is a WRITE over every deck the predicate selects, which makes an
 * insufficient predicate worse here than on a read: unscoped, a weight edit in
 * one customer's console rewrote `decks.ai_score`, `decks.signal`,
 * `decks.updated_at` and every `evaluations.weighted_total` of every other
 * customer in the same edition — against THIS customer's parameter weights. The
 * two `UPDATE`s below stay keyed by `deck_id` alone because their ids come from
 * the scoped join above and from nowhere else; `scores` and `evaluations` carry
 * no tenant column of their own and are reached through `decks` (§5b's proxy
 * bucket, `TENANT_OWNER`).
 */
export async function rescoreEdition(env: Env, scope: TenantScope): Promise<RescoreResult> {
  // W2-A — the org's composite formula, so a re-score reproduces exactly what
  // the evaluation path would compute today (a median org gets medians back).
  const { compositeFormula } = await scoringSettingsFor(env, scope);
  const pq = scoped(scope).on("p").andRaw("p.active = 1");
  const params = (
    await env.DB.prepare(`SELECT p.id, p.weight FROM parameters p ${pq.whereClause()}`)
      .bind(...pq.binds)
      .all<{ id: string; weight: number }>()
  ).results;

  const dq = scoped(scope).on("d");
  const rows = (
    await env.DB.prepare(
      "SELECT s.deck_id, d.signal AS deck_signal, s.evaluator_id, s.evaluator_kind, s.parameter_id, s.value " +
        `FROM scores s JOIN decks d ON d.id = s.deck_id ${dq.whereClause()}`,
    )
      .bind(...dq.binds)
      .all<ScoreJoinRow>()
  ).results;

  // Group persisted scores by (deck, evaluator). AI rows use evaluator_id NULL.
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const key = `${r.deck_id}::${r.evaluator_id ?? "AI"}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        deckId: r.deck_id,
        deckSignal: r.deck_signal,
        evaluatorId: r.evaluator_id,
        kind: r.evaluator_kind,
        values: new Map(),
      };
      groups.set(key, g);
    }
    g.values.set(r.parameter_id, r.value);
  }

  const ts = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];
  let decks = 0;
  let evaluations = 0;
  for (const g of groups.values()) {
    const total = composite(
      params.map((p) => ({ weight: p.weight, value: g.values.get(p.id) ?? 0 })),
      compositeFormula,
    );
    if (g.kind === "ai" && g.evaluatorId === null) {
      // Preserve a flagged (incomplete) deck's signal; otherwise re-band it.
      const signal = g.deckSignal === "flagged" ? "flagged" : signalTag(total);
      stmts.push(
        env.DB.prepare("UPDATE evaluations SET weighted_total = ? WHERE deck_id = ? AND evaluator_id IS NULL").bind(
          total,
          g.deckId,
        ),
        env.DB.prepare("UPDATE decks SET ai_score = ?, signal = ?, updated_at = ? WHERE id = ?").bind(
          total,
          signal,
          ts,
          g.deckId,
        ),
      );
      decks += 1;
    } else if (g.evaluatorId) {
      stmts.push(
        env.DB.prepare("UPDATE evaluations SET weighted_total = ? WHERE deck_id = ? AND evaluator_id = ?").bind(
          total,
          g.deckId,
          g.evaluatorId,
        ),
      );
      evaluations += 1;
    }
  }
  if (stmts.length > 0) await env.DB.batch(stmts);
  return { decks, evaluations };
}
