/**
 * Client calls for the Scoring framework and Area weights console sections.
 *
 * Deliberately its own module rather than an append to `src/client/api.ts`:
 * three Wave 2 sessions land in parallel and `api.ts` is the file all three
 * would otherwise touch. `ApiError` and the payload types come from `api.ts`;
 * only the four routes W2-A added live here. Folding this back into `api.ts` is
 * a later tidy-up, not a behaviour change (§9).
 */
import { ApiError, type ConfigParam } from "../../api";
import type { ReweightInput, ScoringSettings } from "../../../shared/scoring";
import type { VisibilityMatrix } from "../../../shared/scoreVisibility";
import type { Edition } from "../../../shared/roles";

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

/** V3 item 13 — both `Score visibility matrix` cards, RESOLVED by the server. */
export type VisibilityByEdition = Record<Edition, VisibilityMatrix>;

/**
 * V4-WEIGHT — the real decks the **AI weight** control previews against, and
 * how many decks it cannot move because their programme or cohort carries its
 * own split (migration 0074).
 *
 * The server sends the two HALVES of the blend, never a blended number: the
 * console blends them with `decisionScore`, the same helper every screen and
 * the shortlist transition use, so the preview cannot drift from the truth.
 */
export interface WeightPreview {
  decks: ReweightInput[];
  pinnedDecks: number;
}

export interface ScoringFrameworkView {
  scoring: ScoringSettings;
  visibility: VisibilityByEdition;
  /** Cohort rating bands — they live on `org_settings`, not this table. */
  thresholdBest: number;
  thresholdMediocre: number;
  /** False for a staff role that may read the framework but not change it. */
  editable: boolean;
  weightPreview?: WeightPreview;
}

/** GET /api/config/scoring — any authed non-founder. */
export function getScoringFramework(): Promise<ScoringFrameworkView> {
  return fetch("/api/config/scoring").then((r) => json<ScoringFrameworkView>(r));
}

/**
 * PUT /api/config/scoring-framework — the whole section in one save, matrices
 * included: `s-fw` carries no save control of its own and the console's title
 * bar has a single **Save changes** (F0168).
 */
export function saveScoringFramework(
  settings: ScoringSettings,
  visibility?: Partial<VisibilityByEdition>,
) {
  return send<{
    ok: true;
    scoring: ScoringSettings;
    visibility: VisibilityByEdition;
    rescored: { decks: number; evaluations: number };
  }>("PUT", "/api/config/scoring-framework", { ...settings, visibility });
}

/** PUT /api/config/additional-params/:id/permit — the *Permit configuration* pill. */
export function setConfigPermitted(id: string, permitted: boolean) {
  return send<{ ok: true; id: string; permitted: boolean }>(
    "PUT",
    `/api/config/additional-params/${id}/permit`,
    { permitted },
  );
}

/**
 * A cached read of the org's scoring settings for screens OUTSIDE the console
 * that have to honour them (the evaluator workbench's three-score view and its
 * input scale). One request per session: these change rarely, every screen that
 * needs them would otherwise re-fetch, and a stale value for one navigation is
 * far cheaper than a request on every deck the juror opens.
 */
let cached: Promise<ScoringSettings> | null = null;

export function scoringSettings(): Promise<ScoringSettings> {
  cached ??= getScoringFramework()
    .then((r) => r.scoring)
    .catch((err) => {
      // Don't cache a failure — a transient 500 must not disable the toggles
      // for the rest of the session.
      cached = null;
      throw err;
    });
  return cached;
}

/** Drop the cache after a save so the workbench picks the change up. */
export function invalidateScoringSettings(): void {
  cached = null;
}

export type { ConfigParam };
