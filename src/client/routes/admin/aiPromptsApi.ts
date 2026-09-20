/**
 * Client calls for the Area-weights section's **AI prompt** editors and the
 * **Seat configurability** grid (V3 items 11 and 12).
 *
 * Its own module for the reason `scoringApi.ts` states on its own first line:
 * several sessions land in parallel and `src/client/api.ts` is the file they
 * would all otherwise touch. Folding both back in is a later tidy-up (§9).
 */
import { ApiError } from "../../api";
import type { Plan } from "../../../shared/plans";
import type { ParamSet, SeatCapability } from "../../../shared/aiPrompts";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new ApiError(res.status, body);
  }
  return res.json() as Promise<T>;
}

function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  return fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  }).then((r) => json<T>(r));
}

/** One parameter's live and shipped prompt, as `GET /api/ai-prompts` returns it. */
export interface PromptView {
  id: string;
  key: string;
  name: string;
  informational: boolean;
  roleScope: string | null;
  prompt: string | null;
  promptDefault: string | null;
  isDefault: boolean;
}

export interface PromptsView {
  params: PromptView[];
  capability: SeatCapability;
  /** The caller's own effective seat tier. */
  tier: Plan;
  coreEditable: boolean;
  additionalEditable: boolean;
}

export function getPrompts(): Promise<PromptsView> {
  return fetch("/api/ai-prompts").then((r) => json<PromptsView>(r));
}

/** PUT /api/ai-prompts/params/:id — the row editor's Save. */
export function savePrompt(id: string, prompt: string) {
  return send<{ ok: true; param: PromptView }>("PUT", `/api/ai-prompts/params/${id}`, { prompt });
}

/** POST /api/ai-prompts/params/:id/restore — one row's `Restore default`. */
export function restorePrompt(id: string) {
  return send<{ ok: true; param: PromptView }>("POST", `/api/ai-prompts/params/${id}/restore`);
}

/** POST /api/ai-prompts/restore-all — one set's `Restore all …` button. */
export function restoreAllPrompts(set: ParamSet) {
  return send<{ ok: true; set: ParamSet; restored: number; params: PromptView[] }>(
    "POST",
    "/api/ai-prompts/restore-all",
    { set },
  );
}

/** PUT /api/ai-prompts/capability — one cell of the Seat-configurability grid. */
export function setSeatCapability(set: ParamSet, tier: Plan, allowed: boolean) {
  return send<{ ok: true; capability: SeatCapability }>("PUT", "/api/ai-prompts/capability", {
    set,
    tier,
    allowed,
  });
}
