/**
 * W2-B — Admin console → Evaluation → **Rubric anchors** (`admin/s-rb.html`).
 *
 * Two things per evaluation area: the **AI guidance prompt** ("what should the
 * AI look for?", `parameters.prompt`) and the **five band anchors** on the
 * specs' §7 scale (`parameter_rubric_bands`, migration 0027). Both feed the
 * evaluator — `src/server/ai/evaluate.ts` renders them into the user prompt —
 * so an edit here changes how decks are scored, which is why a write bumps
 * `criteria_version` and makes a re-score available (F0164).
 *
 * Mounted on its own path rather than under `/api/config` because three Wave 2
 * sessions were each about to claim `routes/config.ts`; see the plan's §10
 * server-route ownership note.
 *
 * The prototype's *Revert* is a client-side re-read, so there is no revert
 * endpoint: the section simply re-GETs and discards its drafts.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../types";
import type { Edition } from "../../shared/roles";
import { RUBRIC_BANDS } from "../../shared/types";
import { requireAuth, requireRole } from "../auth/middleware";

const anchors = new Hono<AppEnv>();
anchors.use("*", requireAuth);

interface ParamRow {
  id: string;
  key: string;
  name: string;
  informational: number;
  role_scope: string | null;
  prompt: string | null;
  sort_order: number;
}

interface BandRow {
  parameter_id: string;
  band_index: number;
  band_label: string;
  band_name: string;
  min_score: number;
  max_score: number;
  description: string | null;
}

export interface AnchorBandView {
  index: number;
  label: string;
  name: string;
  min: number;
  max: number;
  /** The editable anchor text. `null` = never written (the role params ship scaffolded). */
  description: string | null;
}

export interface AnchorParameterView {
  id: string;
  key: string;
  name: string;
  /** Informational params are the nine role-scoped ones; the other 13 are core. */
  informational: boolean;
  roleScope?: string;
  sortOrder: number;
  prompt: string | null;
  bands: AnchorBandView[];
}

/**
 * The five band rows for a parameter, in band order, back-filled from
 * `RUBRIC_BANDS` for any band `0027` did not scaffold. A parameter added later
 * has no rows at all, and the editor must still render five textareas rather
 * than nothing — that is the "scaffolded role parameter" case in the tests.
 */
function bandsFor(rows: BandRow[]): AnchorBandView[] {
  return RUBRIC_BANDS.map((spec) => {
    const row = rows.find((r) => r.band_index === spec.index);
    return {
      index: spec.index,
      label: row?.band_label ?? spec.label,
      name: row?.band_name ?? spec.name,
      min: row?.min_score ?? spec.min,
      max: row?.max_score ?? spec.max,
      description: row?.description ?? null,
    };
  });
}

async function loadEdition(c: Context<AppEnv>, edition: Edition): Promise<AnchorParameterView[]> {
  const params = (
    await c.env.DB.prepare(
      "SELECT id, key, name, informational, role_scope, prompt, sort_order " +
        "FROM parameters WHERE edition = ? AND active = 1 ORDER BY sort_order",
    )
      .bind(edition)
      .all<ParamRow>()
  ).results;

  const bands = (
    await c.env.DB.prepare(
      "SELECT b.parameter_id, b.band_index, b.band_label, b.band_name, b.min_score, b.max_score, b.description " +
        "FROM parameter_rubric_bands b JOIN parameters p ON p.id = b.parameter_id " +
        "WHERE p.edition = ? AND p.active = 1 ORDER BY b.band_index",
    )
      .bind(edition)
      .all<BandRow>()
  ).results;

  return params.map((p) => ({
    id: p.id,
    key: p.key,
    name: p.name,
    informational: p.informational === 1,
    roleScope: p.role_scope ?? undefined,
    sortOrder: p.sort_order,
    prompt: p.prompt,
    bands: bandsFor(bands.filter((b) => b.parameter_id === p.id)),
  }));
}

/**
 * GET /api/anchors — every active parameter in the caller's edition with its
 * prompt and five bands. 22 rows per edition (13 core + 9 role-scoped), which
 * is what the section's area picker lists — NOT the prototype's stale P1/P2/P3
 * trio (plan §8 Q10).
 */
anchors.get("/", requireRole("admin"), async (c) => {
  const edition = c.var.user.edition;
  return c.json({ edition, parameters: await loadEdition(c, edition) });
});

interface AnchorWriteBody {
  prompt: string | null;
  bands: Array<{ index: number; description: string | null }>;
}

/**
 * PUT /api/anchors/:parameterId — save one area's prompt and band anchors.
 *
 * Only the fields present are written, so the section can save the prompt
 * alone. An empty string is stored as NULL: a blank anchor means "not written"
 * and must fall back to the band label, not to an empty line in the AI prompt.
 */
anchors.put("/:parameterId", requireRole("admin"), async (c) => {
  const edition = c.var.user.edition;
  const parameterId = c.req.param("parameterId");
  const body = (await c.req.json().catch(() => ({}))) as Partial<AnchorWriteBody>;

  const param = await c.env.DB.prepare(
    "SELECT id FROM parameters WHERE id = ? AND edition = ? AND active = 1",
  )
    .bind(parameterId, edition)
    .first<{ id: string }>();
  if (!param) return c.json({ error: "not_found" }, 404);

  const blank = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t === "" ? null : t;
  };

  const statements: D1PreparedStatement[] = [];

  if (Object.prototype.hasOwnProperty.call(body, "prompt")) {
    statements.push(
      c.env.DB.prepare("UPDATE parameters SET prompt = ? WHERE id = ?").bind(
        blank(body.prompt),
        parameterId,
      ),
    );
  }

  if (Array.isArray(body.bands)) {
    for (const band of body.bands) {
      const spec = RUBRIC_BANDS.find((b) => b.index === band?.index);
      if (!spec) return c.json({ error: "invalid_band" }, 400);
      // UPSERT so a parameter created after 0027 — with no scaffolded rows —
      // still saves. `id` mirrors 0027's `<parameter_id>_b<index>` convention.
      statements.push(
        c.env.DB.prepare(
          "INSERT INTO parameter_rubric_bands " +
            "(id, parameter_id, band_index, band_label, band_name, min_score, max_score, description) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
            "ON CONFLICT (parameter_id, band_index) DO UPDATE SET description = excluded.description",
        ).bind(
          `${parameterId}_b${spec.index}`,
          parameterId,
          spec.index,
          spec.label,
          spec.name,
          spec.min,
          spec.max,
          blank(band.description),
        ),
      );
    }
  }

  if (statements.length === 0) return c.json({ error: "nothing_to_save" }, 400);

  // Anchors and the guidance prompt are what the AI scores against, so an edit
  // invalidates the previous run exactly as a weight change does (F0164). The
  // re-score itself stays opt-in via POST /api/decks/:id/rescore.
  statements.push(
    c.env.DB.prepare(
      "UPDATE org_settings SET criteria_version = criteria_version + 1 WHERE edition = ?",
    ).bind(edition),
  );
  await c.env.DB.batch(statements);

  const parameters = await loadEdition(c, edition);
  const saved = parameters.find((p) => p.id === parameterId);
  return c.json({ ok: true, parameter: saved });
});

export { anchors };
export default anchors;
