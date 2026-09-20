import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ShieldCheck,
  ClipboardCheck,
  Gavel,
  Check,
  MessageSquareCode,
  Sparkles,
  History,
  RotateCcw,
  Save,
  Pencil,
  SlidersHorizontal,
} from "lucide-react";
import { Card } from "../../components";
import { useAuth } from "../../auth/useAuth";
import { getConfig, updateWeights, updateAdditionalParam, type ConfigParam } from "../../api";
import {
  REQUIRED_WEIGHT_TOTAL,
  weightBarWidth,
  weightTotal,
  weightTotalMessage,
} from "../../../shared/scoring";
import {
  ADDITIONAL_PARAM_OWNERS,
  MAX_ADDITIONAL_PER_ROLE,
  roleLabel,
  type Role,
} from "../../../shared/roles";
import { PLANS, PLAN_LABELS, type Plan } from "../../../shared/plans";
import {
  ADDITIONAL_RESTORE_ALL_CONFIRM,
  PARAM_SETS,
  PARAM_SET_LABELS,
  PARAM_SET_SUBLABELS,
  RESTORE_ONE_CONFIRM,
  SEAT_CAPABILITY_FOOTNOTE,
  coreRestoreAllConfirm,
  defaultSeatCapability,
  type ParamSet,
  type SeatCapability,
} from "../../../shared/aiPrompts";
import { useAdminSave } from "./saveContext";
import { setConfigPermitted } from "./scoringApi";
import {
  getPrompts,
  restoreAllPrompts,
  restorePrompt,
  savePrompt,
  setSeatCapability,
  type PromptView,
} from "./aiPromptsApi";

/**
 * Admin console → Evaluation → **Area weights** (prototype `admin/s-wt.html`).
 *
 * The 13 core evaluation areas with their percentage weights, a live total the
 * prototype insists must equal 100 % (F0153 — it is now enforced on the server
 * too), the bar scale `admin/_scripts.js` draws (`min(v·3.3, 100) %`, F0154),
 * and — in the same section rather than on a separate screen (F0155) — the
 * role-scoped *Additional configurable parameters* cards, each with its
 * AI+ / AI++ / AI+++ tier badge (F0078) and a `/ 10` score column.
 *
 * Area names are editable here (F0079: the server has always accepted a rename
 * on `PUT /api/config/parameters`; no screen ever sent one).
 *
 * ## Two designs, and why both are still here
 *
 * The **v3 superuser** reshare (2026-09-19) rewrote this section — items 11 and
 * 12 — but it reshared the SUPERUSER prototype only. `AISJ_ICAdmin_V6` and
 * `AISJ_VC_Superuser_V8` still draw the old section: `<th>Type</th>`, no prompt
 * column, no Seat-configurability card, and a per-parameter *Permit
 * configuration* pill. The console is reachable by admin and superuser
 * (`canOpenAdminConsole`), so rendering the new design for everyone would
 * change a screen for a role whose design the client did not revise.
 *
 * `V3_DESIGN` below is that line, and `test/client/areaWeights.test.tsx`
 * asserts both sides of it: the superuser sees `AI prompt`, and an incubator
 * ADMIN and a VC superuser still see `Type` and `Permit configuration`.
 *
 * All of the v3 half is inside the base64 `ADMIN_B64` console — a plain grep of
 * `AISJ_SuperuserV3.HTM` for `wt-prompt-btn`, `cfg-table` or `CORE_PROMPTS`
 * returns nothing. Decode with `docs/prototype/tools/decode-embedded.py`.
 */

/** The payload adds two columns 0025 introduced that `ConfigParam` predates. */
type ParamView = ConfigParam & { description?: string; configPermitted?: boolean };

/** Whether this principal gets the v3 Area-weights design (see the note above). */
export function usesV3AreaWeights(edition: string, role: string | undefined): boolean {
  return edition === "incubator" && role === "superuser";
}

/** `admin/s-wt.html` — the mono, zero-padded index cell. */
function IndexCell({ n }: { n: number }) {
  return (
    <td className="py-2 pr-3 font-mono text-[10px] text-fg-muted">{String(n).padStart(2, "0")}</td>
  );
}

function Pill({ children, tone }: { children: ReactNode; tone: "core" | "tier" }) {
  return (
    <span
      className="ml-2 inline-block rounded px-1.5 py-[1px] align-middle text-[9.5px] font-semibold uppercase tracking-wide"
      style={
        tone === "core"
          ? { background: "var(--color-surface-2)", color: "var(--color-fg-muted)" }
          : { background: "rgba(232,160,32,0.16)", color: "var(--ac-gold-dk, #BA7517)" }
      }
    >
      {children}
    </span>
  );
}

/** The prototype's `permit-btn`, driven by `permitTog` in `admin/_scripts.js`. */
function PermitButton({
  permitted,
  busy,
  disabled,
  onToggle,
}: {
  permitted: boolean;
  busy: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={permitted}
      disabled={busy || disabled}
      onClick={onToggle}
      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60"
      style={
        permitted
          ? {
              borderColor: "var(--ac-olive, #4A6644)",
              background: "var(--ac-olive, #4A6644)",
              color: "#fff",
            }
          : { borderColor: "var(--color-line)", color: "var(--color-fg-muted)" }
      }
    >
      {permitted && <Check className="h-3 w-3" aria-hidden="true" />}
      {permitted ? "Permitted" : "Permit configuration"}
    </button>
  );
}

/** AI+ · AI++ · AI+++ in the owner order the section renders (F0078). */
const TIER_BADGES = ["AI+", "AI++", "AI+++"] as const;
const OWNER_ICONS = [ShieldCheck, ClipboardCheck, Gavel] as const;

// ── v3 · the AI-prompt editor ────────────────────────────────────────────────

/** The prototype's `wt-prompt-btn` — one per row, toggling the editor below it. */
function PromptButton({ open, onClick, label }: { open: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-label={`AI prompt — ${label}`}
      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors"
      style={
        open
          ? {
              borderColor: "var(--ac-olive, #4A6644)",
              background: "var(--ac-olive, #4A6644)",
              color: "#fff",
            }
          : { borderColor: "var(--color-line)", color: "var(--color-fg-muted)" }
      }
    >
      <MessageSquareCode className="h-3 w-3" aria-hidden="true" />
      AI prompt
    </button>
  );
}

/**
 * The prototype's confirm before a restore is `aisjAsk(...)` — a modal with the
 * sentence and a yes/no. Here it is an inline strip under the button that asked
 * for it, which keeps the verbatim sentence on screen next to what it is about
 * and needs no focus trap. The wording is copied exactly; a destructive confirm
 * is the string a reader weighs most carefully.
 */
function ConfirmStrip({
  question,
  busy,
  onConfirm,
  onCancel,
}: {
  question: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-label={question}
      className="mt-2 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-[12px]"
      style={{ borderColor: "var(--color-line)", background: "var(--color-surface-2)" }}
    >
      <span className="text-fg-muted">{question}</span>
      <button
        type="button"
        disabled={busy}
        onClick={onConfirm}
        className="rounded-md px-2 py-1 text-[11.5px] font-semibold text-white disabled:opacity-60"
        style={{ background: "#791F1F" }}
      >
        {busy ? "Resetting…" : "Reset"}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onCancel}
        className="rounded-md border px-2 py-1 text-[11.5px] font-medium text-fg-muted disabled:opacity-60"
        style={{ borderColor: "var(--color-line)" }}
      >
        Cancel
      </button>
    </div>
  );
}

/**
 * The expander the prototype inserts as a `tr.wt-prow` below the clicked row:
 * a header (label, `Edit`↔`Save`, `Restore default`) and a textarea that stays
 * `disabled` until Edit is pressed.
 */
function PromptEditor({
  param,
  colSpan,
  readOnly,
  onSave,
  onRestore,
}: {
  param: PromptView;
  colSpan: number;
  readOnly: boolean;
  onSave: (text: string) => Promise<void>;
  onRestore: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(param.prompt ?? "");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // A sibling restore (Restore all) rewrites the prompt under an editor that is
  // merely OPEN; adopt it. An editor that is being TYPED IN keeps its draft —
  // taking the text out from under the cursor is the worse of the two wrongs.
  useEffect(() => {
    if (!editing) setText(param.prompt ?? "");
  }, [param.prompt, editing]);

  async function toggleEdit() {
    if (!editing) {
      setEditing(true);
      return;
    }
    setBusy(true);
    try {
      await onSave(text);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr data-testid={`prompt-row-${param.key}`}>
      <td colSpan={colSpan} className="pb-3">
        <div
          className="rounded-md border p-3"
          style={{ borderColor: "var(--color-line)", background: "var(--color-surface-2)" }}
        >
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: "var(--ac-olive, #4A6644)" }}
            >
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              AI prompt
            </span>
            <span className="grow" />
            <button
              type="button"
              disabled={readOnly || busy}
              onClick={() => void toggleEdit()}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-60"
              style={
                editing
                  ? {
                      borderColor: "var(--ac-olive, #4A6644)",
                      background: "var(--ac-olive, #4A6644)",
                      color: "#fff",
                    }
                  : { borderColor: "var(--color-line)", color: "var(--color-fg-muted)" }
              }
            >
              {editing ? (
                <Save className="h-3 w-3" aria-hidden="true" />
              ) : (
                <Pencil className="h-3 w-3" aria-hidden="true" />
              )}
              {editing ? "Save" : "Edit"}
            </button>
            <button
              type="button"
              disabled={readOnly || busy || param.isDefault}
              onClick={() => setConfirming(true)}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium text-fg-muted disabled:cursor-not-allowed disabled:opacity-60"
              style={{ borderColor: "var(--color-line)" }}
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              Restore default
            </button>
          </div>
          <textarea
            className="sj-input w-full text-[12.5px]"
            rows={4}
            disabled={!editing || readOnly}
            aria-label={`AI prompt — ${param.name}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {confirming && (
            <ConfirmStrip
              question={RESTORE_ONE_CONFIRM}
              busy={busy}
              onCancel={() => setConfirming(false)}
              onConfirm={() => {
                setBusy(true);
                void onRestore()
                  .then(() => {
                    setEditing(false);
                    setConfirming(false);
                  })
                  .finally(() => setBusy(false));
              }}
            />
          )}
        </div>
      </td>
    </tr>
  );
}

/** `Restore all core AI prompts` / `Restore all additional-parameter prompts`. */
function RestoreAllButton({
  label,
  question,
  disabled,
  onRestore,
}: {
  label: string;
  question: string;
  disabled: boolean;
  onRestore: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => setConfirming(true)}
        className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] font-medium text-fg-muted disabled:cursor-not-allowed disabled:opacity-60"
        style={{ borderColor: "var(--color-line)" }}
      >
        <History className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </button>
      {confirming && (
        <ConfirmStrip
          question={question}
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setBusy(true);
            void onRestore()
              .then(() => setConfirming(false))
              .finally(() => setBusy(false));
          }}
        />
      )}
    </div>
  );
}

// ── v3 · Seat configurability ────────────────────────────────────────────────

/** The prototype's `.tog`, in the repo's existing switch shape. */
function Toggle({
  checked,
  onChange,
  label,
  disabled,
  testId,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-testid={testId}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex h-[18px] w-[32px] shrink-0 items-center rounded-full p-[2px] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      style={{ background: checked ? "var(--ac-olive, #4A6644)" : "var(--color-line)" }}
    >
      <span
        className="h-[14px] w-[14px] rounded-full bg-white transition-transform"
        style={{ transform: checked ? "translateX(14px)" : "translateX(0)" }}
      />
    </button>
  );
}

/**
 * Item 12 — the `Seat configurability` card.
 *
 * An EDIT PERMISSION, not per-tier prompt content: every tier reads the same 13
 * core prompts and the same 9 additional ones. What the grid decides is who may
 * change them, and the server decides it too — `src/server/routes/aiPrompts.ts`
 * answers 402 on the write, so a hidden toggle is the courtesy and the 402 is
 * the rule.
 */
function SeatConfigurability({
  capability,
  readOnly,
  onToggle,
}: {
  capability: SeatCapability;
  readOnly: boolean;
  onToggle: (set: ParamSet, tier: Plan, allowed: boolean) => void;
}) {
  return (
    <>
      <div>
        <h3 className="text-[13.5px] font-semibold tracking-tight text-fg">Configurability</h3>
        <p className="mt-0.5 max-w-3xl text-[12.5px] text-fg-muted">
          Control which parameter sets each seat tier can configure — align this with your pricing
          approach. These toggles govern whether{" "}
          {PLANS.map((p, i) => (
            <span key={p}>
              {i > 0 ? (i === PLANS.length - 1 ? " and " : ", ") : ""}
              <strong className="text-fg">{PLAN_LABELS[p]}</strong>
            </span>
          ))}{" "}
          seats can edit the core and additional parameters across the platform.
        </p>
      </div>
      <Card>
        <div className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-fg">
          <SlidersHorizontal
            className="h-[15px] w-[15px]"
            style={{ color: "var(--ac-olive, #4A6644)" }}
            aria-hidden="true"
          />
          Seat configurability
        </div>
        <div className="overflow-x-auto">
          <table className="w-full max-w-[34rem] text-left">
            <thead>
              <tr className="border-b border-line text-fg-muted">
                <th className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide">
                  Parameter set
                </th>
                {PLANS.map((p) => (
                  <th
                    key={p}
                    className="py-2 pr-3 text-center text-[10px] font-medium uppercase tracking-wide"
                  >
                    {PLAN_LABELS[p]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {PARAM_SETS.map((set) => (
                <tr key={set}>
                  <td className="py-3 pr-3">
                    <div className="text-[12.5px] font-semibold text-fg">
                      {PARAM_SET_LABELS[set]}
                    </div>
                    <div className="mt-[1px] text-[10px] text-fg-muted">
                      {PARAM_SET_SUBLABELS[set]}
                    </div>
                  </td>
                  {PLANS.map((tier) => (
                    <td key={tier} className="py-3 pr-3 text-center">
                      <div className="flex justify-center">
                        <Toggle
                          checked={capability[set][tier]}
                          disabled={readOnly}
                          testId={`cfg-${set}-${tier}`}
                          label={`${PLAN_LABELS[tier]} seats may configure ${PARAM_SET_LABELS[set]}`}
                          onChange={(v) => onToggle(set, tier, v)}
                        />
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-fg-muted">{SEAT_CAPABILITY_FOOTNOTE}</p>
      </Card>
    </>
  );
}

// ── The section ──────────────────────────────────────────────────────────────

export function AreaWeightsSection() {
  const { user } = useAuth();
  const edition = user?.edition ?? "incubator";
  const canEdit = user?.role === "admin" || user?.role === "superuser";
  const v3 = usesV3AreaWeights(edition, user?.role);

  const [core, setCore] = useState<ParamView[] | null>(null);
  const [additional, setAdditional] = useState<ParamView[]>([]);
  const [locked, setLocked] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const [weights, setWeights] = useState<Record<string, number>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [permitBusy, setPermitBusy] = useState<string | null>(null);

  // v3 · prompts and the seat grid. Null until loaded; the section renders
  // without them so a prompts failure never blanks the weights table.
  const [prompts, setPrompts] = useState<Record<string, PromptView>>({});
  const [capability, setCapability] = useState<SeatCapability>(defaultSeatCapability);
  const [promptEditable, setPromptEditable] = useState({ core: false, addl: false });
  const [openPrompt, setOpenPrompt] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const cfg = await getConfig();
      const coreParams = cfg.coreParams as ParamView[];
      setCore(coreParams);
      setAdditional(cfg.additionalParams as ParamView[]);
      setLocked(!cfg.coreConfigEnabled);
      setWeights(Object.fromEntries(coreParams.map((p) => [p.id, p.weight])));
      setNames(
        Object.fromEntries([...coreParams, ...(cfg.additionalParams as ParamView[])].map((p) => [p.id, p.name])),
      );
      setDirty(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  const loadPrompts = useCallback(async () => {
    try {
      const view = await getPrompts();
      setPrompts(Object.fromEntries(view.params.map((p) => [p.id, p])));
      setCapability(view.capability);
      setPromptEditable({ core: view.coreEditable, addl: view.additionalEditable });
    } catch {
      // Non-fatal: the weights table is the section's job, the prompt column is
      // an addition to it. The buttons stay, disabled, rather than vanishing.
      setPromptEditable({ core: false, addl: false });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (v3) void loadPrompts();
  }, [v3, loadPrompts]);

  const total = useMemo(() => weightTotal(Object.values(weights)), [weights]);
  const footer = weightTotalMessage(total);
  const balanced = footer.ok;

  const save = useCallback(async () => {
    if (!core) return;
    setSaving(true);
    setSaveError(null);
    try {
      await updateWeights(
        core.map((p) => ({ id: p.id, weight: Number(weights[p.id]) || 0, name: names[p.id] })),
      );
      // Additional-parameter renames go through their own route (the weights
      // route only ever edits the weighted core areas).
      await Promise.all(
        additional
          .filter((p) => (names[p.id] ?? p.name) !== p.name)
          .map((p) => updateAdditionalParam(p.id, { name: names[p.id] })),
      );
      await load();
    } catch {
      setSaveError("Couldn't save. Every weight must be 0–100 and the total exactly 100 %.");
    } finally {
      setSaving(false);
    }
  }, [core, additional, weights, names, load]);

  useAdminSave(
    core && canEdit && !locked
      ? {
          dirty: dirty && balanced,
          saving,
          onSave: save,
          hint: !dirty ? "No unsaved changes" : footer.text,
        }
      : null,
  );

  async function togglePermit(p: ParamView) {
    setPermitBusy(p.id);
    setSaveError(null);
    const next = !p.configPermitted;
    try {
      await setConfigPermitted(p.id, next);
      setAdditional((rows) =>
        rows.map((r) => (r.id === p.id ? { ...r, configPermitted: next } : r)),
      );
    } catch {
      setSaveError("Couldn't change that permission. Try again.");
    } finally {
      setPermitBusy(null);
    }
  }

  const applyPrompt = useCallback((p: PromptView) => {
    setPrompts((all) => ({ ...all, [p.id]: p }));
  }, []);

  const onSavePrompt = useCallback(
    async (id: string, text: string) => {
      setSaveError(null);
      try {
        applyPrompt((await savePrompt(id, text)).param);
      } catch {
        setSaveError("Couldn't save that AI prompt. Try again.");
      }
    },
    [applyPrompt],
  );

  const onRestorePrompt = useCallback(
    async (id: string) => {
      setSaveError(null);
      try {
        applyPrompt((await restorePrompt(id)).param);
      } catch {
        setSaveError("Couldn't restore that AI prompt. Try again.");
      }
    },
    [applyPrompt],
  );

  const onRestoreAll = useCallback(async (set: ParamSet) => {
    setSaveError(null);
    try {
      const res = await restoreAllPrompts(set);
      setPrompts((all) => {
        const next = { ...all };
        for (const p of res.params) next[p.id] = p;
        return next;
      });
    } catch {
      setSaveError("Couldn't restore those AI prompts. Try again.");
    }
  }, []);

  const onToggleCapability = useCallback(
    (set: ParamSet, tier: Plan, allowed: boolean) => {
      // Optimistic: six toggles that each wait on a round trip read as broken.
      // The server's answer is authoritative and replaces this whole object.
      setCapability((cap) => ({ ...cap, [set]: { ...cap[set], [tier]: allowed } }));
      setSaveError(null);
      void setSeatCapability(set, tier, allowed)
        .then((res) => {
          setCapability(res.capability);
          // The grid can revoke the caller's own seat, so re-read what this
          // session may now do rather than leaving stale editors enabled.
          void loadPrompts();
        })
        .catch(() => {
          setCapability((cap) => ({ ...cap, [set]: { ...cap[set], [tier]: !allowed } }));
          setSaveError("Couldn't change that seat permission. Try again.");
        });
    },
    [loadPrompts],
  );

  if (loadError) {
    return (
      <Shell>
        <Card>
          <p className="text-[13px] text-fg-muted">
            Couldn&apos;t load the evaluation areas. Reload the console to try again.
          </p>
        </Card>
      </Shell>
    );
  }
  if (!core) {
    return (
      <Shell>
        <Card>
          <p className="text-[13px] text-fg-muted">Loading…</p>
        </Card>
      </Shell>
    );
  }

  const ro = !canEdit || locked;
  const owners = ADDITIONAL_PARAM_OWNERS[edition];
  const coreCols = 5;
  const addlCols = 4;

  /** The expander row, when this parameter's `AI prompt` button is open. */
  function promptRow(p: ParamView, set: ParamSet, colSpan: number): ReactNode {
    if (!v3 || openPrompt !== p.id) return null;
    const view = prompts[p.id];
    if (!view) return null;
    return (
      <PromptEditor
        key={`${p.id}-prompt`}
        param={view}
        colSpan={colSpan}
        readOnly={ro || !promptEditable[set]}
        onSave={(text) => onSavePrompt(p.id, text)}
        onRestore={() => onRestorePrompt(p.id)}
      />
    );
  }

  return (
    <Shell areaCount={core.length}>
      {locked && (
        <p className="rounded-md border border-line bg-surface-2 px-3 py-2 text-[12px] text-fg-muted">
          Read-only — configuring the core evaluation areas requires the Pro or Premium plan.
        </p>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left">
            <thead>
              <tr className="border-b border-line text-fg-muted">
                <th className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide">#</th>
                <th className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide">
                  Evaluation area
                </th>
                {/* v3 item 11: `<th>Type</th>` becomes `<th>AI prompt</th>`. */}
                <th className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide">
                  {v3 ? "AI prompt" : "Type"}
                </th>
                <th className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide">
                  Weight %
                </th>
                <th className="py-2 text-[10px] font-medium uppercase tracking-wide">Visual</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {core.map((p, i) => [
                <tr key={p.id}>
                  <IndexCell n={i + 1} />
                  <td className="py-2 pr-3">
                    <input
                      className="sj-input w-full min-w-[11rem] text-[13px]"
                      type="text"
                      disabled={ro}
                      aria-label={`${p.name} name`}
                      value={names[p.id] ?? p.name}
                      onChange={(e) => {
                        setNames((n) => ({ ...n, [p.id]: e.target.value }));
                        setDirty(true);
                      }}
                    />
                  </td>
                  <td className="py-2 pr-3">
                    {v3 ? (
                      <PromptButton
                        open={openPrompt === p.id}
                        label={names[p.id] ?? p.name}
                        onClick={() => setOpenPrompt((id) => (id === p.id ? null : p.id))}
                      />
                    ) : (
                      <Pill tone="core">Core</Pill>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      className="sj-input w-[4.5rem] font-mono text-[13px]"
                      type="number"
                      min={0}
                      max={100}
                      disabled={ro}
                      aria-label={`${names[p.id] ?? p.name} weight`}
                      value={weights[p.id] ?? 0}
                      onChange={(e) => {
                        setWeights((w) => ({ ...w, [p.id]: Number(e.target.value) }));
                        setDirty(true);
                      }}
                    />
                  </td>
                  <td className="py-2">
                    <div className="h-[7px] w-[70px] overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full"
                        data-testid={`weight-bar-${p.key}`}
                        style={{
                          width: `${weightBarWidth(weights[p.id] ?? 0)}%`,
                          background: "var(--ac-olive, #4A6644)",
                        }}
                      />
                    </div>
                  </td>
                </tr>,
                promptRow(p, "core", coreCols),
              ])}
            </tbody>
          </table>
        </div>
        <div
          className="mt-3 border-t border-line pt-2 text-[12px] font-medium"
          data-testid="weight-total"
          style={{ color: balanced ? "var(--color-green, #16A34A)" : "#791F1F" }}
        >
          {footer.text}
        </div>
        {!balanced && dirty && (
          <p className="mt-1 text-[11.5px] text-fg-muted">
            Save is disabled until the areas total {REQUIRED_WEIGHT_TOTAL} %.
          </p>
        )}
        {v3 && (
          <div className="mt-3">
            <RestoreAllButton
              label="Restore all core AI prompts"
              question={coreRestoreAllConfirm(core.length)}
              disabled={ro || !promptEditable.core}
              onRestore={() => onRestoreAll("core")}
            />
          </div>
        )}
      </Card>

      {/* ── v3 item 12 · Configurability ──────────────────────────────────── */}
      {v3 && (
        <SeatConfigurability
          capability={capability}
          readOnly={!canEdit}
          onToggle={onToggleCapability}
        />
      )}

      {/* ── Additional configurable parameters ───────────────────────────── */}
      <div>
        <h3 className="text-[13.5px] font-semibold tracking-tight text-fg">
          Additional configurable parameters
        </h3>
        <p className="mt-0.5 max-w-3xl text-[12.5px] text-fg-muted">
          Each role — {owners.map((r) => roleLabel(edition, r)).join(", ")} — configures its own set
          of {MAX_ADDITIONAL_PER_ROLE} parameters, each scored 0–10 (set maximum{" "}
          <strong className="text-fg">{MAX_ADDITIONAL_PER_ROLE * 10}</strong>). Each role&apos;s
          additional score is surfaced as {TIER_BADGES.map((b, i) => (
            <span key={b}>
              {i > 0 ? ", " : ""}
              <strong className="text-fg">{b}</strong> ({roleLabel(edition, owners[i])})
            </span>
          ))}
          .{" "}
          {v3 ? (
            // v3 replaces the per-parameter permit pill with the Seat
            // configurability grid above, so the sentence that explained the
            // pill goes with it.
            "These parameters are configurable by default."
          ) : (
            <>
              Use <em>Permit configuration</em> to allow a role to edit a parameter.
            </>
          )}
        </p>
      </div>

      {v3 && (
        <RestoreAllButton
          label="Restore all additional-parameter prompts"
          question={ADDITIONAL_RESTORE_ALL_CONFIRM}
          disabled={ro || !promptEditable.addl}
          onRestore={() => onRestoreAll("addl")}
        />
      )}

      {owners.map((owner, oi) => {
        const rows = additional.filter((p) => p.roleScope === owner);
        const Icon = OWNER_ICONS[oi] ?? ShieldCheck;
        return (
          <Card key={owner}>
            <div className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-fg">
              <Icon
                className="h-[15px] w-[15px]"
                style={{ color: "var(--ac-olive, #4A6644)" }}
                aria-hidden="true"
              />
              {roleLabel(edition, owner as Role)}
              <Pill tone="tier">{TIER_BADGES[oi] ?? "AI+"} score</Pill>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[30rem] text-left">
                <thead>
                  <tr className="border-b border-line text-fg-muted">
                    <th className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide">#</th>
                    <th className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide">
                      Custom parameter name
                    </th>
                    <th className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide">
                      Score
                    </th>
                    {/* v3 item 11/12: `Permit configuration` becomes `AI prompt`. */}
                    <th className="py-2 text-[10px] font-medium uppercase tracking-wide">
                      {v3 ? "AI prompt" : "Permit configuration"}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((p, i) => [
                    <tr key={p.id}>
                      <IndexCell n={i + 1} />
                      <td className="py-2 pr-3">
                        <input
                          className="sj-input w-full min-w-[11rem] text-[13px]"
                          type="text"
                          disabled={ro}
                          aria-label={`${p.name} name`}
                          value={names[p.id] ?? p.name}
                          onChange={(e) => {
                            setNames((n) => ({ ...n, [p.id]: e.target.value }));
                            setDirty(true);
                          }}
                        />
                        {p.description && (
                          <div className="mt-0.5 text-[11px] text-fg-muted">{p.description}</div>
                        )}
                      </td>
                      <td className="py-2 pr-3 font-mono text-[12px] text-fg-muted">/ 10</td>
                      <td className="py-2">
                        {v3 ? (
                          <PromptButton
                            open={openPrompt === p.id}
                            label={names[p.id] ?? p.name}
                            onClick={() => setOpenPrompt((id) => (id === p.id ? null : p.id))}
                          />
                        ) : (
                          <PermitButton
                            permitted={p.configPermitted === true}
                            busy={permitBusy === p.id}
                            disabled={ro}
                            onToggle={() => togglePermit(p)}
                          />
                        )}
                      </td>
                    </tr>,
                    promptRow(p, "addl", addlCols),
                  ])}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={addlCols} className="py-3 text-[12.5px] text-fg-muted">
                        No parameters configured for this role yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {/* v3's `addlRender` drops this footer — the sub-line above already
                states "each scored 0–10 (set maximum 30)", so it was a repeat. */}
            {!v3 && (
              <div className="mt-3 pt-2 text-[12px] text-fg-muted">
                Set total: max <strong className="text-fg">{MAX_ADDITIONAL_PER_ROLE * 10}</strong> (
                {MAX_ADDITIONAL_PER_ROLE} × 10)
              </div>
            )}
          </Card>
        );
      })}

      {saveError && <p className="text-[12.5px] text-signal-flagged">{saveError}</p>}
    </Shell>
  );
}

function Shell({ children, areaCount = 13 }: { children: ReactNode; areaCount?: number }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold tracking-tight text-fg">Area weights</h2>
        <p className="mt-0.5 max-w-3xl text-[13px] text-fg-muted">
          Set the percentage weight of each of the {areaCount} evaluation areas in the final
          composite score. Total must equal 100%.
        </p>
      </div>
      {children}
    </div>
  );
}
