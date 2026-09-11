/**
 * Reading and writing `crm_connections` + `crm_field_mappings`.
 *
 * The one rule this file exists to enforce: **a credential never leaves here.**
 * `toView` is the only function that produces something a response body may
 * carry, and it maps the credential columns down to
 * `{ configured, hint, ref, setAt }` — presence and a masked tail. There is no
 * code path from a stored secret to a GET because no secret is stored (see
 * `migrations/0043_crm_sync.sql`).
 */

import type { Env } from "../types";
import type { Edition } from "../../shared/roles";
import {
  CRM_PROVIDERS,
  CRM_PROVIDER_BLURBS,
  CRM_PROVIDER_LABELS,
  type CrmConnectionView,
  type CrmDirection,
  type CrmFieldMapping,
  type CrmMappingDirection,
  type CrmProvider,
  type CrmSchedule,
  type CrmStatus,
  type CrmSyncLogView,
} from "../../shared/crm";

export interface ConnectionRow {
  id: string;
  edition: string;
  provider: string;
  status: string;
  base_url: string | null;
  webhook_path: string | null;
  trigger_field: string | null;
  trigger_value: string | null;
  monthly_deck_cap: number | null;
  score_writeback_field: string | null;
  auto_approve_within_cap: number;
  write_back_scores: number;
  last_sync_at: string | null;
  last_sync_count: number | null;
  last_error: string | null;
  sync_direction: string;
  sync_schedule: string;
  credential_ref: string | null;
  credential_hint: string | null;
  credential_set_at: string | null;
  connected_at: string | null;
}

interface MappingRow {
  connection_id: string;
  crm_field: string;
  app_field: string;
  direction: string;
  sort_order: number;
}

const COLUMNS =
  "id, edition, provider, status, base_url, webhook_path, trigger_field, trigger_value, " +
  "monthly_deck_cap, score_writeback_field, auto_approve_within_cap, write_back_scores, " +
  "last_sync_at, last_sync_count, last_error, sync_direction, sync_schedule, " +
  "credential_ref, credential_hint, credential_set_at, connected_at";

export async function loadConnection(
  env: Env,
  edition: Edition,
  provider: CrmProvider,
): Promise<ConnectionRow | null> {
  return env.DB.prepare(
    `SELECT ${COLUMNS} FROM crm_connections WHERE edition = ? AND provider = ?`,
  )
    .bind(edition, provider)
    .first<ConnectionRow>();
}

async function loadMappings(env: Env, connectionIds: string[]): Promise<MappingRow[]> {
  if (connectionIds.length === 0) return [];
  const marks = connectionIds.map(() => "?").join(", ");
  const res = await env.DB.prepare(
    "SELECT connection_id, crm_field, app_field, direction, sort_order FROM crm_field_mappings " +
      `WHERE connection_id IN (${marks}) ORDER BY sort_order, rowid`,
  )
    .bind(...connectionIds)
    .all<MappingRow>();
  return res.results;
}

/** "Last sync: 4 Jun 2026 · 11:42 am · 3 deals pulled" — the prototype `.crm-sub`. */
export function summarize(row: ConnectionRow): string {
  if (row.status === "error" && row.last_error) return `Sync error — ${row.last_error}`;
  if (row.status === "inactive" || !row.last_sync_at) {
    return CRM_PROVIDER_BLURBS[row.provider as CrmProvider] ?? "Not connected";
  }
  const when = formatSyncTime(row.last_sync_at);
  const n = row.last_sync_count ?? 0;
  return `Last sync: ${when} · ${n} deal${n === 1 ? "" : "s"} pulled`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2026-06-04 11:42:00` → `4 Jun 2026 · 11:42 am`. Falls back to the raw value. */
export function formatSyncTime(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d, hh, mm] = m;
  const hour = Number(hh);
  const suffix = hour < 12 ? "am" : "pm";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${Number(d)} ${MONTHS[Number(mo) - 1]} ${y} · ${h12}:${mm} ${suffix}`;
}

/**
 * A connection as the API returns it. Credentials collapse to presence + a
 * masked hint; `credential_hint` is written already masked, and this re-masks
 * defensively so a hand-edited row cannot leak through either.
 */
export function toView(row: ConnectionRow, mappings: MappingRow[]): CrmConnectionView {
  const provider = row.provider as CrmProvider;
  return {
    provider,
    label: CRM_PROVIDER_LABELS[provider] ?? provider,
    status: row.status as CrmStatus,
    summary: summarize(row),
    baseUrl: row.base_url,
    webhookPath: row.webhook_path,
    syncDirection: row.sync_direction as CrmDirection,
    syncSchedule: row.sync_schedule as CrmSchedule,
    triggerField: row.trigger_field,
    triggerValue: row.trigger_value,
    monthlyDeckCap: row.monthly_deck_cap,
    scoreWritebackField: row.score_writeback_field,
    autoApproveWithinCap: row.auto_approve_within_cap === 1,
    writeBackScores: row.write_back_scores === 1,
    lastSyncAt: row.last_sync_at,
    lastSyncCount: row.last_sync_count,
    lastError: row.last_error,
    connectedAt: row.connected_at,
    credential: {
      configured: Boolean(row.credential_ref),
      hint: maskHint(row.credential_hint),
      ref: row.credential_ref,
      setAt: row.credential_set_at,
    },
    mappings: mappings
      .filter((m) => m.connection_id === row.id)
      .map((m) => ({
        crmField: m.crm_field,
        appField: m.app_field,
        direction: m.direction as CrmMappingDirection,
      })),
  };
}

/**
 * The masked tail shown next to a configured credential. Built from the last
 * four characters, so it identifies the key without being any part of a usable
 * one — the same convention a card's last-4 uses.
 */
export function maskHint(value: string | null): string | null {
  if (!value) return null;
  const tail = value.slice(-4);
  return `••••${tail}`;
}

/**
 * All four providers for an edition, in the prototype's row order, whether or
 * not they have ever been connected. `0037` seeds a row per (edition,
 * provider), so a missing row means a hand-edited database rather than a normal
 * state — it is synthesised as inactive rather than dropped from the list.
 */
export async function listConnections(env: Env, edition: Edition): Promise<CrmConnectionView[]> {
  const rows = (
    await env.DB.prepare(`SELECT ${COLUMNS} FROM crm_connections WHERE edition = ?`)
      .bind(edition)
      .all<ConnectionRow>()
  ).results;
  const mappings = await loadMappings(
    env,
    rows.map((r) => r.id),
  );
  return CRM_PROVIDERS.map((provider) => {
    const row = rows.find((r) => r.provider === provider);
    return row ? toView(row, mappings) : toView(blankRow(edition, provider), []);
  });
}

function blankRow(edition: Edition, provider: CrmProvider): ConnectionRow {
  return {
    id: `crm_${edition}_${provider}`,
    edition,
    provider,
    status: "inactive",
    base_url: null,
    webhook_path: null,
    trigger_field: null,
    trigger_value: null,
    monthly_deck_cap: null,
    score_writeback_field: null,
    auto_approve_within_cap: 0,
    write_back_scores: 0,
    last_sync_at: null,
    last_sync_count: null,
    last_error: null,
    sync_direction: "pull",
    sync_schedule: "manual",
    credential_ref: null,
    credential_hint: null,
    credential_set_at: null,
    connected_at: null,
  };
}

/** Replace a connection's mapping set wholesale — the editor saves all rows. */
export async function replaceMappings(
  env: Env,
  connectionId: string,
  mappings: CrmFieldMapping[],
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    env.DB.prepare("DELETE FROM crm_field_mappings WHERE connection_id = ?").bind(connectionId),
  ];
  mappings.forEach((m, i) => {
    statements.push(
      env.DB.prepare(
        "INSERT INTO crm_field_mappings (id, connection_id, crm_field, app_field, direction, sort_order) " +
          "VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(`${connectionId}_m${i + 1}`, connectionId, m.crmField, m.appField, m.direction, i + 1),
    );
  });
  await env.DB.batch(statements);
}

/** The most recent sync attempts for a connection — the section's telemetry. */
export async function listSyncLog(
  env: Env,
  connectionId: string,
  limit = 20,
): Promise<CrmSyncLogView[]> {
  const res = await env.DB.prepare(
    "SELECT id, provider, direction, operation, status, deck_id, record_count, payload_json, error, created_at " +
      "FROM crm_sync_log WHERE connection_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?",
  )
    .bind(connectionId, limit)
    .all<{
      id: string;
      provider: string;
      direction: string;
      operation: string;
      status: string;
      deck_id: string | null;
      record_count: number;
      payload_json: string | null;
      error: string | null;
      created_at: string;
    }>();

  return res.results.map((r) => ({
    id: r.id,
    provider: r.provider as CrmConnectionView["provider"],
    direction: r.direction,
    operation: r.operation as CrmSyncLogView["operation"],
    status: r.status as CrmSyncLogView["status"],
    deckId: r.deck_id,
    recordCount: r.record_count,
    payload: safeParse(r.payload_json),
    error: r.error,
    createdAt: r.created_at,
  }));
}

function safeParse(json: string | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}
