/**
 * Client calls for Core Parameters and My Parameters (W8-B).
 *
 * Its own module rather than an append to `src/client/api.ts`, for the reason
 * `admin/scoringApi.ts` gives: `api.ts` is the file every parallel session would
 * otherwise touch, and W8-B does not own it. `ApiError` and `ConfigParam` come
 * from `api.ts`; only the parameter-configuration view and the fields W8-B added
 * to the parameter routes live here.
 */
import { ApiError, type ConfigParam } from "../api";
import type { Plan } from "../../shared/plans";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new ApiError(res.status, body);
  }
  return res.json() as Promise<T>;
}

function send<T>(method: string, path: string, body: unknown): Promise<T> {
  return fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => json<T>(r));
}

/** A parameter as the configuration view serves it. */
export interface ParamView extends ConfigParam {
  /** The scorer-facing description (spec §6.2, migration 0025). */
  description?: string;
  configPermitted?: boolean;
}

/** A role parameter, with the two answers only this view carries. */
export interface RoleParamView extends ParamView {
  /** False when switched off on My Parameters (0060) — kept, not scored. */
  enabled: boolean;
  /** Whether the signed-in member may change it (role, grant and plan). */
  editable: boolean;
}

/** `GET /api/config/parameters` — what the signed-in member may configure. */
export interface ParameterConfigView {
  /** The workspace plan (`org_settings.plan`). */
  plan: Plan;
  /** The member's own seat (`users.plan_tier`). */
  memberTier: Plan;
  /** The lower of the two — the one that governs (plan §8 Q116). */
  effectivePlan: Plan;
  coreConfigEnabled: boolean;
  additionalEnabled: boolean;
  /** Admin / superuser — the only roles that edit the core 13 (§8 Q6(a)). */
  coreEditor: boolean;
  /** The `configparams` editor set, before the plan is applied. */
  additionalEditor: boolean;
  coreParams: ParamView[];
  additionalParams: RoleParamView[];
}

export function getParameterConfig(): Promise<ParameterConfigView> {
  return fetch("/api/config/parameters").then((r) => json<ParameterConfigView>(r));
}

export interface CoreParamUpdate {
  id: string;
  weight: number;
  name?: string;
  /** The area's AI extraction prompt; an empty string clears it. */
  prompt?: string;
}

/** `PUT /api/config/parameters` — names, weights and prompts; re-scores the edition. */
export function saveCoreParams(params: CoreParamUpdate[]) {
  return send<{ ok: true; rescored: { decks: number; evaluations: number }; coreParams: ParamView[] }>(
    "PUT",
    "/api/config/parameters",
    { params },
  );
}

export interface RoleParamPatch {
  name?: string;
  description?: string;
  prompt?: string;
  enabled?: boolean;
}

/** `PUT /api/config/additional-params/:id` — label, description, prompt, on/off. */
export function saveRoleParam(id: string, patch: RoleParamPatch) {
  return send<{
    ok: true;
    param: { id: string; name: string; description?: string; prompt?: string; enabled: boolean };
  }>("PUT", `/api/config/additional-params/${id}`, patch);
}

/** `POST /api/config/additional-params` — fill an empty slot for a role. */
export function addRoleParam(body: { name: string; roleScope: string; description?: string; prompt?: string }) {
  return send<{ ok: true; param: RoleParamView }>("POST", "/api/config/additional-params", body);
}

/** `DELETE /api/config/additional-params/:id` — remove (retire) a role parameter. */
export function removeRoleParam(id: string) {
  return fetch(`/api/config/additional-params/${id}`, { method: "DELETE" }).then((r) => json<{ ok: true }>(r));
}
