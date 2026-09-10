import { useCallback, useEffect, useMemo, useState } from "react";
import { Lightbulb, RotateCw, Save, SlidersHorizontal } from "lucide-react";
import { Card, Button } from "../../components";
import { useAuth } from "../../auth/useAuth";
import { ADDITIONAL_PARAM_OWNERS, roleLabel, type Edition, type Role } from "../../../shared/roles";
import { RUBRIC_BANDS } from "../../../shared/types";
import { useAdminSave } from "./saveContext";

/**
 * Admin console → Evaluation → **Rubric anchors** (`admin/s-rb.html`).
 *
 * For each evaluation area: an **AI guidance prompt** — what the AI should look
 * for — and what each score band means on the specs' five-band scale. Both are
 * read by `src/server/ai/evaluate.ts` when a deck is scored, so this section
 * changes results rather than just describing them; a save bumps the edition's
 * `criteria_version`, which is what makes a re-score available.
 *
 * **22 areas, not the prototype's 3.** The prototype's picker still carries the
 * stale P1/P2/P3 taxonomy (Super User · Program Manager · Jury Member); the
 * shipped model and specs §6.2 have **nine** role parameters per edition, three
 * for each of three owner roles. Plan §8 Q10 settles this in favour of the spec,
 * so the picker lists 13 core + 9 role = 22, and the configurable block below
 * renders nine cards in three role groups rather than three cards.
 */

/**
 * The prototype's per-band label colours (`RUBRICS[].c` in `admin/_scripts.js`)
 * — literal hex there, and literal here for the same reason `AdminConsole.tsx`
 * scopes `--ac-olive`: the console is a separate document with its own palette,
 * and `src/client/index.css` is a §2.2 serialisation-hazard file.
 */
const BAND_COLORS = ["#16A34A", "#3F7A3F", "#854F0B", "#9A3412", "#791F1F"] as const;

/** `cpUpd()` — "AI+ Super User · AI++ Program Manager · AI+++ Jury Member". */
const TIERS = ["AI+", "AI++", "AI+++"] as const;

interface BandView {
  index: number;
  label: string;
  name: string;
  min: number;
  max: number;
  description: string | null;
}

interface AnchorParameter {
  id: string;
  key: string;
  name: string;
  informational: boolean;
  roleScope?: string;
  sortOrder: number;
  prompt: string | null;
  bands: BandView[];
}

/** One area's editable state: the guidance prompt plus five anchor strings. */
interface Draft {
  prompt: string;
  bands: string[];
}

function draftOf(p: AnchorParameter): Draft {
  return {
    prompt: p.prompt ?? "",
    bands: RUBRIC_BANDS.map((spec) => {
      const b = p.bands.find((x) => x.index === spec.index);
      return b?.description ?? "";
    }),
  };
}

function sameDraft(a: Draft, b: Draft): boolean {
  return a.prompt === b.prompt && a.bands.every((v, i) => v === b.bands[i]);
}

// The section fetches directly rather than through `src/client/api.ts`: that
// file is shared by every wave and this session owns none of it. A later
// consolidation can lift these two into it (recorded in §9).
async function fetchAnchors(): Promise<AnchorParameter[]> {
  const r = await fetch("/api/anchors");
  if (!r.ok) throw new Error(`anchors: ${r.status}`);
  const body = (await r.json()) as { parameters: AnchorParameter[] };
  return body.parameters;
}

async function putAnchors(id: string, draft: Draft): Promise<void> {
  const r = await fetch(`/api/anchors/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt: draft.prompt,
      bands: draft.bands.map((description, index) => ({ index, description })),
    }),
  });
  if (!r.ok) throw new Error(`anchors: ${r.status}`);
}

/** `AI+` / `AI++` / `AI+++` by owner role, in `ADDITIONAL_PARAM_OWNERS` order. */
function tierFor(edition: Edition, roleScope: string | undefined): string | null {
  const owners = ADDITIONAL_PARAM_OWNERS[edition];
  const i = owners.indexOf(roleScope as Role);
  return i >= 0 ? TIERS[i] : null;
}

export function RubricAnchorsSection() {
  const { user } = useAuth();
  const edition: Edition = user?.edition ?? "incubator";

  const [params, setParams] = useState<AnchorParameter[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  /**
   * Read the server's anchors and seed the drafts.
   *
   * It **must not** blanket-overwrite `drafts`: a load can land while the admin
   * is typing. `<StrictMode>` double-invokes the mount effect in development,
   * so the very first render fires two fetches and the slower one used to wipe
   * anything edited in between — an e2e save-and-reload caught exactly that,
   * intermittently. A draft is therefore seeded only when the parameter has
   * none, or when `resetIds` names it because we have just saved it.
   */
  const load = useCallback(async (resetIds?: string[]) => {
    try {
      const rows = await fetchAnchors();
      setParams(rows);
      setDrafts((prev) => {
        const next = { ...prev };
        for (const p of rows) {
          if (!(p.id in next) || resetIds?.includes(p.id)) next[p.id] = draftOf(p);
        }
        return next;
      });
      setSelected((cur) => cur ?? rows[0]?.id ?? null);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const core = useMemo(() => (params ?? []).filter((p) => !p.informational), [params]);
  const additional = useMemo(() => (params ?? []).filter((p) => p.informational), [params]);

  /** The nine role parameters as three owner-role groups, in owner order. */
  const roleGroups = useMemo(() => {
    return ADDITIONAL_PARAM_OWNERS[edition]
      .map((role, i) => ({
        role,
        tier: TIERS[i],
        label: roleLabel(edition, role),
        params: additional.filter((p) => p.roleScope === role),
      }))
      .filter((g) => g.params.length > 0);
  }, [additional, edition]);

  const dirtyIds = useMemo(() => {
    if (!params) return [];
    return params.filter((p) => !sameDraft(drafts[p.id] ?? draftOf(p), draftOf(p))).map((p) => p.id);
  }, [params, drafts]);

  const save = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      setSaving(true);
      setSaveError(null);
      setSavedNote(null);
      try {
        for (const id of ids) {
          const draft = drafts[id];
          if (draft) await putAnchors(id, draft);
        }
        const names = ids
          .map((id) => params?.find((p) => p.id === id)?.name)
          .filter(Boolean)
          .join(", ");
        // Re-seed only what was saved, so an edit in progress on another area
        // is not discarded by this refresh.
        await load(ids);
        setSavedNote(`Rubric anchors saved for ${names}.`);
      } catch {
        setSaveError("Couldn't save the anchors. Your edits are still here — try again.");
      } finally {
        setSaving(false);
      }
    },
    [drafts, params, load],
  );

  // The console title bar's global Save changes button becomes this section's.
  useAdminSave({
    dirty: dirtyIds.length > 0,
    saving,
    hint: "No anchor edits to save",
    onSave: () => save(dirtyIds),
  });

  /** Discard every unsaved edit — the prototype's Revert re-reads stored values. */
  const revert = useCallback(() => {
    if (!params) return;
    setDrafts(Object.fromEntries(params.map((p) => [p.id, draftOf(p)])));
    setSaveError(null);
    setSavedNote(null);
  }, [params]);

  const setDraft = useCallback(
    (id: string, next: Partial<Draft>) => {
      // Fall back to the parameter's stored values rather than spreading
      // `undefined`, so a partial edit can never produce a draft missing a key.
      const base = (id: string) => {
        const p = params?.find((x) => x.id === id);
        return p ? draftOf(p) : { prompt: "", bands: RUBRIC_BANDS.map(() => "") };
      };
      setDrafts((d) => ({ ...d, [id]: { ...(d[id] ?? base(id)), ...next } }));
    },
    [params],
  );

  const heading = (
    <div>
      <h2 className="text-base font-semibold tracking-tight text-fg">Rubric anchors</h2>
      <p className="mt-0.5 max-w-3xl text-[13px] text-fg-muted">
        For each area or parameter, write an AI guidance prompt (what the AI should look for) and
        define what each score band means on the BRD five-band scale (0–2 · 3–4 · 5–6 · 7–8 · 9–10).
      </p>
    </div>
  );

  if (loadError) {
    return (
      <div className="flex flex-col gap-3">
        {heading}
        <Card>
          <p className="text-[13px] text-fg-muted">
            Couldn&rsquo;t load the rubric anchors.{" "}
            <button className="text-olive underline" onClick={() => void load()}>
              Retry
            </button>
          </p>
        </Card>
      </div>
    );
  }

  if (!params) {
    return (
      <div className="flex flex-col gap-3">
        {heading}
        <Card>
          <p className="text-[13px] text-fg-muted">Loading anchors&hellip;</p>
        </Card>
      </div>
    );
  }

  const current = params.find((p) => p.id === selected) ?? params[0];

  return (
    <div className="flex flex-col gap-3">
      {heading}

      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="u-label">Evaluation area</span>
            <select
              aria-label="Evaluation area"
              className="h-8 rounded-[7px] border border-line bg-surface px-2 text-item text-fg"
              value={current?.id ?? ""}
              onChange={(e) => {
                setSelected(e.target.value);
                // A "saved for Storytelling" note must not linger above Climate.
                setSavedNote(null);
                setSaveError(null);
              }}
            >
              <optgroup label="Core evaluation areas">
                {core.map((p, i) => (
                  <option key={p.id} value={p.id}>
                    {String(i + 1).padStart(2, "0")} · {p.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Additional configurable parameters">
                {additional.map((p) => {
                  const tier = tierFor(edition, p.roleScope);
                  const owner = p.roleScope ? roleLabel(edition, p.roleScope as Role) : "";
                  return (
                    <option key={p.id} value={p.id}>
                      {tier ? `${tier} · ` : ""}
                      {owner} — {p.name}
                    </option>
                  );
                })}
              </optgroup>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="u-label">Scale</span>
            {/* Disabled in the prototype too — the five-band scale is fixed by
                the BRD; only the anchor text per band is editable. */}
            <select
              aria-label="Scale"
              disabled
              className="h-8 rounded-[7px] border border-line bg-surface-2 px-2 text-item text-fg-muted"
              value="brd5"
              onChange={() => {}}
            >
              <option value="brd5">BRD 5-band (0–2 · 3–4 · 5–6 · 7–8 · 9–10)</option>
            </select>
          </label>
        </div>

        {current && (
          <div className="mt-3.5">
            <AnchorEditor
              key={current.id}
              param={current}
              draft={drafts[current.id] ?? draftOf(current)}
              onChange={(next) => setDraft(current.id, next)}
            />
            <div className="mt-3.5 flex items-center gap-2">
              <Button
                variant="primary"
                disabled={saving || !dirtyIds.includes(current.id)}
                onClick={() => void save([current.id])}
              >
                <Save className="h-3.5 w-3.5" />
                Save anchors
              </Button>
              <Button onClick={revert} disabled={saving || dirtyIds.length === 0}>
                <RotateCw className="h-3.5 w-3.5" />
                Revert
              </Button>
              {savedNote && <span className="text-ui text-olive">{savedNote}</span>}
              {saveError && <span className="text-ui text-signal-flagged">{saveError}</span>}
            </div>
          </div>
        )}
      </Card>

      <section aria-label="Configurable parameter anchors" className="flex flex-col gap-3">
        <div>
          <h3 className="text-base font-semibold tracking-tight text-fg">
            Configurable parameter anchors
          </h3>
          <p className="mt-0.5 max-w-3xl text-[13px] text-fg-muted">
            Define the five-band rubric anchors for each of the nine additional configurable
            parameters — three for each of the {roleGroups.length} owner roles.
          </p>
        </div>

        {roleGroups.map((group) => (
          <div key={group.role} className="flex flex-col gap-3">
            {group.params.map((p) => (
              <Card key={p.id}>
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="h-3.5 w-3.5 text-fg-muted" aria-hidden="true" />
                  <span className="text-item font-semibold text-fg">{group.label}</span>
                  <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
                    {group.tier}
                  </span>
                  <span className="text-ui text-fg-muted">{p.name}</span>
                </div>
                <div className="mt-2.5">
                  <AnchorEditor
                    param={p}
                    draft={drafts[p.id] ?? draftOf(p)}
                    onChange={(next) => setDraft(p.id, next)}
                    labelSuffix=" (configurable)"
                  />
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Button
                    variant="primary"
                    disabled={saving || !dirtyIds.includes(p.id)}
                    onClick={() => void save([p.id])}
                  >
                    <Save className="h-3.5 w-3.5" />
                    Save anchors
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        ))}
      </section>
    </div>
  );
}

/**
 * One area's editor — the guidance prompt, a rule, then five band textareas.
 *
 * Every band always renders, including the nine role parameters `0027`
 * scaffolded with NULL text: an area with nothing written yet must show five
 * empty boxes to write into, not an empty pane.
 */
function AnchorEditor({
  param,
  draft,
  onChange,
  labelSuffix = "",
}: {
  param: AnchorParameter;
  draft: Draft;
  onChange: (next: Partial<Draft>) => void;
  /** Disambiguates the labels when the same parameter is editable twice on the
   *  page — the picker above and its own card below, exactly as the prototype
   *  renders P1–P3 in both places. */
  labelSuffix?: string;
}) {
  return (
    <>
      <div>
        <span className="u-label flex items-center gap-1.5 text-olive">
          <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />
          AI guidance prompt — what should the AI look for?
        </span>
        <textarea
          aria-label={`AI guidance prompt — ${param.name}${labelSuffix}`}
          className="mt-1 min-h-[78px] w-full rounded-[7px] border border-line bg-surface p-2 text-item text-fg"
          placeholder="Tell the AI what signals, evidence and red flags to weigh when scoring this…"
          value={draft.prompt}
          onChange={(e) => onChange({ prompt: e.target.value })}
        />
        <p className="mt-0.5 text-[10.5px] text-fg-muted">
          Guides the evaluation; the band anchors below define how the 0–10 score maps.
        </p>
      </div>
      <div className="my-2.5 h-px bg-line" />
      <div className="flex flex-col gap-2.5">
        {RUBRIC_BANDS.map((spec, i) => (
          <div key={spec.index}>
            <span className="u-label" style={{ color: BAND_COLORS[i] }}>
              {spec.label} · band anchor
            </span>
            <textarea
              aria-label={`${spec.label} band anchor — ${param.name}${labelSuffix}`}
              className="mt-1 min-h-[52px] w-full rounded-[7px] border border-line bg-surface p-2 text-item text-fg"
              placeholder={`Describe what a ${spec.label} score means for this area…`}
              value={draft.bands[i] ?? ""}
              onChange={(e) =>
                onChange({ bands: draft.bands.map((v, j) => (j === i ? e.target.value : v)) })
              }
            />
          </div>
        ))}
      </div>
    </>
  );
}
