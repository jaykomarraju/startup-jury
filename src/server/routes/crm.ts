/**
 * W3-D — Admin console → Organisation → **CRM sync** (`admin/s-crm.html`).
 *
 * The prototype's section is four provider rows with Connect / Configure /
 * Disconnect and one filter-rules card; this route is that section's whole
 * persistence surface plus the two things a working integration needs and the
 * prototype does not draw — field mapping, and sync direction + schedule.
 *
 * §1.3 governs the session: interface-complete, provider-stubbed. Every write
 * lands in D1 and every *sync* lands in `crm_sync_log` with `status='recorded'`
 * — `src/server/crm/provider.ts` explains why that is not `'sent'`. No vendor
 * SDK and no network call is on the critical path.
 *
 * **Credentials are write-only.** `POST /:provider/connect` accepts one, stores
 * a *reference* to the Worker secret plus a masked tail, and discards the
 * value; no response body on this router carries a credential, and nothing here
 * logs a request body. The GET-never-returns-a-credential test in
 * `test/worker/crm.test.ts` is the standing proof.
 *
 * Mounted on its own path per the plan's §10 server-route ownership note.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../types";
import type { Edition } from "../../shared/roles";
import { requireAuth, requireTask } from "../auth/middleware";
import { isCredentialRef } from "../crm/provider";
import {
  listConnections,
  listSyncLog,
  loadConnection,
  maskHint,
  replaceMappings,
  type ConnectionRow,
} from "../crm/store";
import { runPull } from "../crm/sync";
import {
  describeMappingError,
  isCrmDirection,
  isCrmProvider,
  isCrmSchedule,
  validateMappings,
  type CrmProvider,
} from "../../shared/crm";

const crm = new Hono<AppEnv>();
crm.use("*", requireAuth);
// The whole section is admin + superuser. F0038 proposes opening `nt` and `al`
// to every internal role; CRM stays admin-only in that proposal, and giving a
// jury member a Connect button would be the prototype oversight §1.2 warns of.
// Wave 3 integration: `requireTask`, not `requireRole`. W3-A converted every
// other console surface (config, users, anchors, questions, permissions) so that
// revoking the `adminconsole` cell closes the console AND its API in one place —
// §8 Q16 states that as a property. W3-D landed in the same wave and kept the
// old shape, so CRM's API stayed open to an admin whose console cell had been
// revoked. The role list is unchanged; the task is ANDed onto it.
crm.use("*", requireTask("adminconsole", "admin"));

/** Resolve `:provider` against the caller's edition. 400 unknown, 404 missing. */
async function resolve(
  c: Context<AppEnv>,
): Promise<{ row: ConnectionRow; edition: Edition } | Response> {
  const provider = c.req.param("provider");
  if (!isCrmProvider(provider)) return c.json({ error: "unknown_provider" }, 400);
  const edition = c.var.user.edition;
  const row = await loadConnection(c.env, edition, provider as CrmProvider);
  if (!row) return c.json({ error: "not_found" }, 404);
  return { row, edition };
}

async function connectionsResponse(c: Context<AppEnv>) {
  const edition = c.var.user.edition;
  return c.json({ edition, connections: await listConnections(c.env, edition) });
}

/**
 * GET /api/crm — all four providers for the caller's edition with their status,
 * settings, filter rules and field mappings. Never a credential.
 */
crm.get("/", async (c) => connectionsResponse(c));

/** GET /api/crm/:provider/log — recent sync attempts (the section's telemetry). */
crm.get("/:provider/log", async (c) => {
  const found = await resolve(c);
  if (found instanceof Response) return found;
  return c.json({ entries: await listSyncLog(c.env, found.row.id) });
});

const trimmed = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
};

interface ConnectBody {
  baseUrl?: string | null;
  webhookPath?: string | null;
  /** Write-only. Never persisted, never echoed, never logged. */
  credential?: string | null;
  /** Which Worker secret a live deployment reads this provider's key from. */
  credentialRef?: string | null;
}

/**
 * POST /api/crm/:provider/connect — bring a provider live.
 *
 * The credential is consumed and dropped: what persists is `credential_ref`
 * (the Worker-secret name), a masked tail so an operator can recognise which
 * key is in play, and the time it was set. `migrations/0043_crm_sync.sql` and
 * `src/server/crm/provider.ts` carry the rationale.
 *
 * Custom API connects on a webhook path rather than a credential, which is what
 * the prototype's fourth row ("Connect any CRM via webhook or REST API") means.
 */
crm.post("/:provider/connect", async (c) => {
  const found = await resolve(c);
  if (found instanceof Response) return found;
  const { row } = found;

  const body = (await c.req.json().catch(() => ({}))) as ConnectBody;
  const credential = trimmed(body.credential);
  const webhookPath = trimmed(body.webhookPath) ?? row.webhook_path;

  if (row.provider === "custom") {
    if (!webhookPath) return c.json({ error: "webhook_path_required" }, 400);
  } else if (!credential && !row.credential_ref) {
    return c.json({ error: "credential_required" }, 400);
  }

  const now = new Date().toISOString();
  // Default the secret name from the provider so the common case needs no
  // input; an operator running several workspaces can override it.
  const credentialRef = credential
    ? (trimmed(body.credentialRef) ?? `CRM_${row.provider.toUpperCase()}_TOKEN`)
    : row.credential_ref;
  // The ref names a Worker binding, so an unconstrained value would let an
  // administrator point this at ANTHROPIC_API_KEY or any other secret in `env`.
  // `secretFor` refuses anything outside the CRM_* namespace; refuse it here too
  // so the connection cannot be stored in a state that silently never resolves.
  // Wave 3 integration.
  if (credential && !isCredentialRef(credentialRef)) {
    return c.json({ error: "invalid_credential_ref" }, 400);
  }

  await c.env.DB.prepare(
    "UPDATE crm_connections SET status = 'live', base_url = ?, webhook_path = ?, " +
      "credential_ref = ?, credential_hint = ?, credential_set_at = ?, " +
      "connected_at = COALESCE(connected_at, ?), last_error = NULL, updated_at = ? WHERE id = ?",
  )
    .bind(
      trimmed(body.baseUrl) ?? row.base_url,
      webhookPath,
      credentialRef,
      credential ? maskHint(credential) : row.credential_hint,
      credential ? now : row.credential_set_at,
      now,
      now,
      row.id,
    )
    .run();

  return connectionsResponse(c);
});

/**
 * POST /api/crm/:provider/disconnect — the prototype's Disconnect.
 *
 * Clears the credential reference and hint so a reconnect must supply the key
 * again, and keeps the filter rules and mappings: an admin who disconnects to
 * rotate a token should not have to rebuild the configuration. History in
 * `crm_sync_log` is untouched — it is an audit record.
 */
crm.post("/:provider/disconnect", async (c) => {
  const found = await resolve(c);
  if (found instanceof Response) return found;

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    "UPDATE crm_connections SET status = 'inactive', credential_ref = NULL, credential_hint = NULL, " +
      "credential_set_at = NULL, connected_at = NULL, last_error = NULL, updated_at = ? WHERE id = ?",
  )
    .bind(now, found.row.id)
    .run();

  return connectionsResponse(c);
});

interface ConfigureBody {
  baseUrl?: string | null;
  webhookPath?: string | null;
  syncDirection?: string;
  syncSchedule?: string;
  triggerField?: string | null;
  triggerValue?: string | null;
  monthlyDeckCap?: number | null;
  scoreWritebackField?: string | null;
  autoApproveWithinCap?: boolean;
  writeBackScores?: boolean;
  mappings?: unknown;
}

/**
 * PUT /api/crm/:provider — the Configure form and the filter-rules card,
 * saved together because the console has one global Save changes button.
 *
 * Validation refuses the combinations that would silently do nothing: a trigger
 * value with no field to match it on, write-back enabled with no target field,
 * and a negative or non-integer monthly cap. Field mappings go through
 * `validateMappings`, which owns the duplicate and unknown-field rules.
 */
crm.put("/:provider", async (c) => {
  const found = await resolve(c);
  if (found instanceof Response) return found;
  const { row } = found;

  const body = (await c.req.json().catch(() => ({}))) as ConfigureBody;
  const has = (k: keyof ConfigureBody) => Object.prototype.hasOwnProperty.call(body, k);

  const syncDirection = has("syncDirection") ? body.syncDirection : row.sync_direction;
  if (!isCrmDirection(syncDirection)) return c.json({ error: "invalid_direction" }, 400);

  const syncSchedule = has("syncSchedule") ? body.syncSchedule : row.sync_schedule;
  if (!isCrmSchedule(syncSchedule)) return c.json({ error: "invalid_schedule" }, 400);

  let monthlyDeckCap = row.monthly_deck_cap;
  if (has("monthlyDeckCap")) {
    const raw = body.monthlyDeckCap;
    if (raw === null || raw === undefined) {
      monthlyDeckCap = null;
    } else if (!Number.isInteger(raw) || (raw as number) < 0) {
      return c.json({ error: "invalid_monthly_cap" }, 400);
    } else {
      monthlyDeckCap = raw as number;
    }
  }

  const triggerField = has("triggerField") ? trimmed(body.triggerField) : row.trigger_field;
  const triggerValue = has("triggerValue") ? trimmed(body.triggerValue) : row.trigger_value;
  if (triggerValue && !triggerField) return c.json({ error: "trigger_field_required" }, 400);

  const scoreWritebackField = has("scoreWritebackField")
    ? trimmed(body.scoreWritebackField)
    : row.score_writeback_field;
  const writeBackScores = has("writeBackScores")
    ? body.writeBackScores === true
    : row.write_back_scores === 1;
  if (writeBackScores && !scoreWritebackField) {
    return c.json({ error: "writeback_field_required" }, 400);
  }

  const autoApprove = has("autoApproveWithinCap")
    ? body.autoApproveWithinCap === true
    : row.auto_approve_within_cap === 1;

  if (has("mappings")) {
    const result = validateMappings(body.mappings);
    if (!result.ok) {
      return c.json(
        {
          error: "invalid_mappings",
          reason: result.error,
          index: result.index,
          message: describeMappingError(result),
        },
        400,
      );
    }
    await replaceMappings(c.env, row.id, result.mappings);
  }

  await c.env.DB.prepare(
    "UPDATE crm_connections SET base_url = ?, webhook_path = ?, sync_direction = ?, sync_schedule = ?, " +
      "trigger_field = ?, trigger_value = ?, monthly_deck_cap = ?, score_writeback_field = ?, " +
      "auto_approve_within_cap = ?, write_back_scores = ?, updated_at = ? WHERE id = ?",
  )
    .bind(
      has("baseUrl") ? trimmed(body.baseUrl) : row.base_url,
      has("webhookPath") ? trimmed(body.webhookPath) : row.webhook_path,
      syncDirection,
      syncSchedule,
      triggerField,
      triggerValue,
      monthlyDeckCap,
      scoreWritebackField,
      autoApprove ? 1 : 0,
      writeBackScores ? 1 : 0,
      new Date().toISOString(),
      row.id,
    )
    .run();

  return connectionsResponse(c);
});

/**
 * POST /api/crm/:provider/sync — the section's "Sync now".
 *
 * Records the attempt; performs nothing while no provider client is configured
 * (§1.3). The response carries the recorded row so the operator can see exactly
 * what would have gone out, which is the point of a stub that records.
 */
crm.post("/:provider/sync", async (c) => {
  const found = await resolve(c);
  if (found instanceof Response) return found;

  const { record, limit, used } = await runPull(c.env, found.row);
  const edition = c.var.user.edition;
  return c.json({
    attempt: {
      id: record.id,
      status: record.status,
      operation: record.operation,
      recordCount: record.recordCount ?? 0,
      payload: record.payload,
      error: record.error,
      createdAt: record.createdAt,
    },
    cap: { limit, usedThisMonth: used, monthlyDeckCap: found.row.monthly_deck_cap },
    connections: await listConnections(c.env, edition),
  });
});

export { crm };
export default crm;
