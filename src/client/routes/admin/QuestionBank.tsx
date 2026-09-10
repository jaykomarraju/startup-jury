/**
 * Admin console → Evaluation → **Clarification question bank** (`s-qb`).
 *
 * The prototype draws thirteen `.qb-area` accordions — one per scored
 * evaluation area — each with a `<n> questions` count chip and a body of
 * `.q-row`s carrying a monospace `Q1…Qn` ordinal, the question, and an `Edit`
 * affordance. 68 questions in all: five per area, eight for Climate Impact &
 * Integrity. The prototype's Edit is a dead span; this one edits, and the
 * section adds the three actions its own sub-title promises but the prototype
 * never wired — add, delete and reorder.
 *
 * Ordinals are POSITIONAL, so moving a row is a `seq` rewrite of the whole
 * area (`PUT /api/questions/reorder`) rather than a swap. Deleting is soft:
 * the row stays with `active = 0` so a clarification already sent still reads
 * back with the question the founder was actually asked.
 *
 * Every action saves immediately, so the console's global **Save changes**
 * button only lights up while a row is mid-edit — pressing it commits that
 * row, which is the only unsaved state this section can hold.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChartLine,
  Check,
  ChevronDown,
  Cpu,
  Diamond,
  Globe,
  Leaf,
  Lightbulb,
  MoveDown,
  MoveUp,
  Pencil,
  Plus,
  Presentation,
  Rocket,
  Store,
  Swords,
  Target,
  Trash2,
  TriangleAlert,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { Card, Button, EmptyState } from "../../components";
import { useAdminSave } from "./saveContext";

// ── The API. `src/client/api.ts` belongs to another session this wave, so the
// bank's four calls live with the only screen that makes them (plan §2.2).

interface BankQuestion {
  id: string;
  seq: number;
  text: string;
}

interface BankArea {
  parameterId: string;
  key: string;
  name: string;
  questions: BankQuestion[];
}

async function callBank<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/questions${path}`, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  if (!res.ok) throw new Error(`question bank request failed: ${res.status}`);
  return (await res.json()) as T;
}

const bankApi = {
  list: () => callBank<{ areas: BankArea[] }>(""),
  add: (parameterId: string, text: string) =>
    callBank<{ question: BankQuestion }>("", {
      method: "POST",
      body: JSON.stringify({ parameterId, text }),
    }),
  edit: (id: string, text: string) =>
    callBank<{ question: BankQuestion }>(`/${id}`, {
      method: "PUT",
      body: JSON.stringify({ text }),
    }),
  remove: (id: string) => callBank<{ ok: true }>(`/${id}`, { method: "DELETE" }),
  reorder: (parameterId: string, ids: string[]) =>
    callBank<{ ok: true }>("/reorder", {
      method: "PUT",
      body: JSON.stringify({ parameterId, ids }),
    }),
};

/**
 * The prototype's per-accordion Tabler glyph, by parameter key — `ti-target`,
 * `ti-bulb`, `ti-world`, … in `s-qb.html`'s own order.
 */
const AREA_ICONS: Record<string, LucideIcon> = {
  problem_market_clarity: Target,
  solution_value_prop: Lightbulb,
  market_size: Globe,
  product_technology: Cpu,
  business_model: Store,
  traction_validation: ChartLine,
  competitive_landscape: Swords,
  gtm_strategy: Rocket,
  team_execution: Users,
  business_risks: TriangleAlert,
  business_attractiveness: Diamond,
  climate_impact: Leaf,
  storytelling: Presentation,
};

/** Matches the server's own cap, so a too-long question never round-trips. */
const MAX_QUESTION_LENGTH = 400;

type Draft = { kind: "edit"; id: string; text: string } | { kind: "add"; text: string };

export function QuestionBankSection() {
  const [areas, setAreas] = useState<BankArea[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  // The prototype opens on its first accordion and leaves the rest closed.
  const [open, setOpen] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      bankApi
        .list()
        .then((r) => {
          setAreas(r.areas);
          setOpen((cur) => cur ?? r.areas[0]?.parameterId ?? null);
        })
        .catch(() => setLoadError(true)),
    [],
  );

  useEffect(() => {
    load();
  }, [load]);

  const setDraft = useCallback((parameterId: string, draft: Draft | null) => {
    setDrafts((d) => {
      const next = { ...d };
      if (draft) next[parameterId] = draft;
      else delete next[parameterId];
      return next;
    });
  }, []);

  /** The one open editor, if any — what the console's Save button commits. */
  const pending = useMemo(() => {
    const entry = Object.entries(drafts).find(([, d]) => d.text.trim().length > 0);
    return entry ? { parameterId: entry[0], draft: entry[1] } : null;
  }, [drafts]);

  const commit = useCallback(
    async (parameterId: string, draft: Draft) => {
      const text = draft.text.trim();
      if (!text) return;
      setBusy(parameterId);
      setError(null);
      try {
        if (draft.kind === "add") await bankApi.add(parameterId, text);
        else await bankApi.edit(draft.id, text);
        setDraft(parameterId, null);
        await load();
      } catch {
        setError("Couldn't save the question. Try again.");
      } finally {
        setBusy(null);
      }
    },
    [load, setDraft],
  );

  useAdminSave({
    dirty: pending !== null,
    saving: busy !== null,
    hint: "Question bank edits save as you make them.",
    onSave: () => {
      if (pending) return commit(pending.parameterId, pending.draft);
    },
  });

  async function remove(area: BankArea, question: BankQuestion) {
    setBusy(area.parameterId);
    setError(null);
    try {
      await bankApi.remove(question.id);
      setDraft(area.parameterId, null);
      await load();
    } catch {
      setError("Couldn't delete the question. Try again.");
    } finally {
      setBusy(null);
    }
  }

  /** Move one question one place up (-1) or down (+1) and rewrite the area. */
  async function move(area: BankArea, index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= area.questions.length) return;
    const ids = area.questions.map((q) => q.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    // Optimistic: the ordinals renumber before the round trip, so a click and
    // its effect are not separated by a network hop.
    setAreas(
      (cur) =>
        cur?.map((a) =>
          a.parameterId === area.parameterId
            ? {
                ...a,
                questions: ids.map((id, i) => ({
                  ...a.questions.find((q) => q.id === id)!,
                  seq: i + 1,
                })),
              }
            : a,
        ) ?? cur,
    );
    setBusy(area.parameterId);
    setError(null);
    try {
      await bankApi.reorder(area.parameterId, ids);
      await load();
    } catch {
      setError("Couldn't reorder the questions. Try again.");
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight text-fg">
          Clarification question bank
        </h2>
        <p className="mt-0.5 max-w-3xl text-[13px] text-fg-muted">
          These questions are auto-triggered to the startup when the AI detects weak, missing, or
          contradictory signal in a given area. Replicated from the BRD; edit or add questions per
          area.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-[13px] text-signal-flagged">
          {error}
        </p>
      )}

      {loadError ? (
        <Card>
          <EmptyState
            icon="CircleHelp"
            title="Couldn't load the question bank"
            description="Try reloading the console."
          />
        </Card>
      ) : !areas ? (
        <Card>
          <p className="text-sm text-fg-muted">Loading the question bank…</p>
        </Card>
      ) : (
        <Card className="flex flex-col gap-[7px] p-3">
          {areas.map((area) => {
            const Icon = AREA_ICONS[area.key] ?? Target;
            const isOpen = open === area.parameterId;
            const draft = drafts[area.parameterId];
            const areaBusy = busy === area.parameterId;
            return (
              <div
                key={area.parameterId}
                data-testid={`qb-area-${area.key}`}
                className="overflow-hidden rounded-lg border border-line"
              >
                {/* `.qb-head` — icon, name, count chip, chevron. */}
                <button
                  type="button"
                  data-testid={`qb-head-${area.key}`}
                  aria-expanded={isOpen}
                  onClick={() => {
                    // Closing an accordion drops the draft it was holding, so
                    // the title bar's Save can never commit an edit the admin
                    // has already navigated away from.
                    if (isOpen) setDraft(area.parameterId, null);
                    setOpen(isOpen ? null : area.parameterId);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] transition-colors ${
                    isOpen
                      ? "border-b border-line bg-olive-lt"
                      : "bg-surface-2 hover:bg-olive-lt/60"
                  }`}
                >
                  <Icon
                    className="h-[15px] w-[15px] shrink-0"
                    style={{ color: "var(--ac-olive)" }}
                  />
                  <span className="flex-1 font-semibold text-fg">{area.name}</span>
                  <span
                    data-testid={`qb-count-${area.key}`}
                    className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold text-fg-muted"
                  >
                    {area.questions.length} question
                    {area.questions.length === 1 ? "" : "s"}
                  </span>
                  <ChevronDown
                    className={`h-[15px] w-[15px] shrink-0 text-fg-muted transition-transform ${isOpen ? "rotate-180" : ""}`}
                  />
                </button>

                {isOpen && (
                  <div className="bg-surface px-3 py-2">
                    {area.questions.length === 0 && !draft && (
                      <p className="py-2 text-[13px] text-fg-muted">
                        No questions left in this area — the AI will name it as weak without asking
                        anything specific.
                      </p>
                    )}

                    {area.questions.map((question, i) => {
                      const editing = draft?.kind === "edit" && draft.id === question.id;
                      return (
                        <div
                          key={question.id}
                          className="flex items-start gap-2 border-b border-line/60 py-1.5 text-[13px] leading-[1.4] text-fg-2 last:border-b-0"
                        >
                          <span className="mt-[3px] w-[18px] shrink-0 font-mono text-[10px] font-bold text-fg-muted">
                            Q{i + 1}
                          </span>
                          {editing ? (
                            <>
                              <input
                                autoFocus
                                className="sj-input h-8 flex-1 py-0 text-[13px]"
                                aria-label={`Edit question ${i + 1} of ${area.name}`}
                                maxLength={MAX_QUESTION_LENGTH}
                                value={draft.text}
                                onChange={(e) =>
                                  setDraft(area.parameterId, {
                                    ...draft,
                                    text: e.target.value,
                                  })
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") commit(area.parameterId, draft);
                                  if (e.key === "Escape") setDraft(area.parameterId, null);
                                }}
                              />
                              <Button
                                size="sm"
                                variant="primary"
                                disabled={areaBusy || !draft.text.trim()}
                                onClick={() => commit(area.parameterId, draft)}
                              >
                                <Check className="h-3.5 w-3.5" />
                                Save
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label="Cancel"
                                onClick={() => setDraft(area.parameterId, null)}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <span className="flex-1">{question.text}</span>
                              <span className="flex shrink-0 items-center gap-0.5">
                                <IconAction
                                  icon={MoveUp}
                                  label={`Move question ${i + 1} of ${area.name} up`}
                                  disabled={i === 0 || areaBusy}
                                  onClick={() => move(area, i, -1)}
                                />
                                <IconAction
                                  icon={MoveDown}
                                  label={`Move question ${i + 1} of ${area.name} down`}
                                  disabled={i === area.questions.length - 1 || areaBusy}
                                  onClick={() => move(area, i, 1)}
                                />
                                <button
                                  type="button"
                                  className="ml-1 inline-flex items-center gap-1 text-[11px] font-medium text-gold-dk hover:underline disabled:opacity-40"
                                  disabled={areaBusy}
                                  aria-label={`Edit question ${i + 1} of ${area.name}`}
                                  onClick={() =>
                                    setDraft(area.parameterId, {
                                      kind: "edit",
                                      id: question.id,
                                      text: question.text,
                                    })
                                  }
                                >
                                  <Pencil className="h-3 w-3" />
                                  Edit
                                </button>
                                <IconAction
                                  icon={Trash2}
                                  label={`Delete question ${i + 1} of ${area.name}`}
                                  disabled={areaBusy}
                                  onClick={() => remove(area, question)}
                                />
                              </span>
                            </>
                          )}
                        </div>
                      );
                    })}

                    {/* Add — the sub-title's "edit or add questions per area". */}
                    <div className="pt-2">
                      {draft?.kind === "add" ? (
                        <div className="flex items-start gap-2">
                          <span className="mt-[9px] w-[18px] shrink-0 font-mono text-[10px] font-bold text-fg-muted">
                            Q{area.questions.length + 1}
                          </span>
                          <input
                            autoFocus
                            className="sj-input h-8 flex-1 py-0 text-[13px]"
                            aria-label={`New question for ${area.name}`}
                            maxLength={MAX_QUESTION_LENGTH}
                            placeholder="What should the founder be asked about this area?"
                            value={draft.text}
                            onChange={(e) =>
                              setDraft(area.parameterId, {
                                ...draft,
                                text: e.target.value,
                              })
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commit(area.parameterId, draft);
                              if (e.key === "Escape") setDraft(area.parameterId, null);
                            }}
                          />
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={areaBusy || !draft.text.trim()}
                            onClick={() => commit(area.parameterId, draft)}
                          >
                            <Check className="h-3.5 w-3.5" />
                            Add
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label="Cancel"
                            onClick={() => setDraft(area.parameterId, null)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          disabled={areaBusy}
                          onClick={() =>
                            setDraft(area.parameterId, {
                              kind: "add",
                              text: "",
                            })
                          }
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add question
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}

function IconAction({
  icon: Icon,
  label,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent"
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
