// W9-C — the VC diligence-to-close screens' cells, slide-over tabs and API.
//
// `StagePage` renders Investment DD, Term sheet Pipeline, Legal DD, Onboard
// ready (and the IC member's Invest ready) and Archive from their configs; the
// pieces those configs declare — the MP approval and row-status selects, the
// progress bars and flag pills, the DD checklist tab, the term sheet's status,
// document and template picker — live here, so the renderer stays generic and
// `IcVotePage` reuses the same DD badge and checklist.
//
// The record is `/api/diligence` (migration 0063, `src/shared/diligence.ts`).

import { useEffect, useState, type ReactNode } from "react";
import { CalendarPlus, CheckCircle2, ClipboardCheck, Download, FileText, Paperclip, Signature, X } from "lucide-react";
import { Button } from "../components";
import type { DeckView, DeckAction } from "../types";
import type { Role } from "../../shared/roles";
import {
  DD_ITEM_STATUSES,
  DD_ITEM_STATUS_LABELS,
  DD_RATINGS,
  DD_RATING_LABELS,
  DD_ROW_STATUSES,
  DD_ROW_STATUS_LABELS,
  MP_APPROVALS,
  MP_APPROVAL_LABELS,
  TERM_SHEET_STATUSES,
  TERM_SHEET_STATUS_LABELS,
  TERM_SHEET_VERSION_LABELS,
  investReadyStage,
  investReadyStatus,
  isComplete,
  type DdItemStatus,
  type DdItemView,
  type DdRating,
  type DdRowStatus,
  type DdSummary,
  type DealView,
  type DiligenceTrack,
  type MpApproval,
  type TermSheetStatus,
  type TermSheetVersion,
} from "../../shared/diligence";
import type { StageContext, StageRow } from "./StagePage";

// ═══════════════════════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════════════════════

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? String(res.status));
  }
  return res.json() as Promise<T>;
}

function send<T>(method: string, url: string, body: unknown): Promise<T> {
  return fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(
    (r) => json<T>(r),
  );
}

export interface ChecklistView {
  deckId: string;
  startup: string;
  track: DiligenceTrack;
  items: DdItemView[];
  summary: DdSummary;
  renameable: boolean;
}

export interface TermSheetTemplate {
  id: string;
  name: string;
  fileName: string | null;
  version: string;
  status: string;
  pickable: boolean;
}

export type ItemPatch = Partial<{ status: DdItemStatus; owner: string | null; rating: DdRating | null; finding: string | null; label: string }>;
export type DealPatch = Partial<{
  ddStatus: DdRowStatus;
  investmentLead: string | null;
  legalLead: string | null;
  ask: string | null;
  valuation: string | null;
}>;

export const listDeals = () => fetch("/api/diligence").then((r) => json<{ deals: DealView[] }>(r));
export const getChecklist = (deckId: string, track: DiligenceTrack) =>
  fetch(`/api/diligence/${deckId}/checklist/${track}`).then((r) => json<ChecklistView>(r));
export const patchItem = (deckId: string, track: DiligenceTrack, itemId: string, patch: ItemPatch) =>
  send<{ item: DdItemView; deal: DealView }>("PATCH", `/api/diligence/${deckId}/checklist/${track}/${itemId}`, patch);
export const putMpApproval = (deckId: string, value: MpApproval) =>
  send<{ deal: DealView }>("PUT", `/api/diligence/${deckId}/mp-approval`, { value });
export const putDeal = (deckId: string, patch: DealPatch) =>
  send<{ deal: DealView }>("PUT", `/api/diligence/${deckId}/deal`, patch);
export const putTermSheet = (deckId: string, status: TermSheetStatus | null) =>
  send<{ deal: DealView }>("PUT", `/api/diligence/${deckId}/term-sheet`, { status });
export const listTermSheetTemplates = () =>
  fetch("/api/diligence/templates").then((r) => json<{ templates: TermSheetTemplate[] }>(r));
export const attachTermSheet = (deckId: string, templateId: string) =>
  send<{ deal: DealView }>("POST", `/api/diligence/${deckId}/term-sheet/attach`, { templateId });

/** `StageConfig.extra` for every screen that reads the deal record. A refusal is an empty record, not a broken table. */
export function loadDeals(): Promise<Record<string, DealView>> {
  return listDeals()
    .then((r) => Object.fromEntries(r.deals.map((d) => [d.deckId, d])))
    .catch(() => ({}));
}

export const dealOf = (row: StageRow): DealView | undefined => row.extra as DealView | undefined;

// ── Who may set what — the same tasks the router gates on (`shared/types.ts` defaults) ──
const can = (role: Role | undefined, roles: Role[]) => !!role && (role === "superuser" || roles.includes(role));
export const canEditChecklist = (role?: Role) => can(role, ["admin", "partner", "ic_member"]);
export const canSetMpApproval = (role?: Role) => can(role, ["partner"]);
export const canSetTermSheet = (role?: Role) => can(role, ["admin", "partner"]);
export const canScheduleVcCall = (role?: Role) => can(role, ["admin", "partner", "associate"]);

// ═══════════════════════════════════════════════════════════════════════════
// Small pieces
// ═══════════════════════════════════════════════════════════════════════════

type Tone = "go" | "hold" | "no" | "info" | "plain";

const TONE_CLASS: Record<Tone, string> = {
  go: "border-transparent bg-green-lt text-green",
  hold: "border-transparent bg-gold-lt text-gold-dk",
  no: "border-transparent bg-red-lt text-red",
  info: "border-transparent bg-blue-lt text-blue-dk",
  plain: "border-line bg-surface text-fg",
};

/** `.icq-rec` / `.cl-out` / `.dd-rowsel` — a select tinted by its current value. */
export function ToneSelect<T extends string>({
  label,
  value,
  options,
  tone,
  placeholder,
  disabled,
  onChange,
}: {
  label: string;
  value: T | null;
  options: readonly { value: T; label: string }[];
  tone: Tone;
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: T | null) => void;
}) {
  return (
    <select
      aria-label={label}
      className={`h-8 rounded-lg border px-2 text-xs font-bold disabled:cursor-default disabled:opacity-80 ${TONE_CLASS[tone]}`}
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange((e.target.value || null) as T | null)}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** `.icq-stage` — the funding-stage chip. */
export function StageChip({ children }: { children?: ReactNode }) {
  if (!children) return <span className="text-sm text-fg-muted">—</span>;
  return (
    <span className="inline-block whitespace-nowrap rounded-full bg-blue-lt px-2.5 py-0.5 text-[11px] font-semibold text-blue-dk">
      {children}
    </span>
  );
}

/** `.rep-pill` / `.ad-chip`. */
export function Pill({ tone, children, style }: { tone: Tone; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold ${TONE_CLASS[tone]}`}
      style={style}
    >
      {children}
    </span>
  );
}

/** `ddProgressBar` / `ldProgressBar` — olive, or gold once anything is flagged. */
export function ProgressBar({ summary }: { summary: DdSummary | null | undefined }) {
  const s = summary ?? { done: 0, total: 0, flagged: 0, started: false };
  const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
  return (
    <div className="flex items-center gap-2" data-testid="dd-progress">
      <div className="h-2 min-w-[90px] flex-1 overflow-hidden rounded bg-offwhite">
        <div className="h-full" style={{ width: `${pct}%`, background: s.flagged ? "var(--gold-dk)" : "var(--olive)" }} />
      </div>
      <span className="font-mono text-[11px] font-semibold text-navy">
        {s.done}/{s.total}
      </span>
    </div>
  );
}

/** The `Flags` cell — red "N flagged", a green 0 once started, else a dash. */
export function FlagsPill({ summary }: { summary: DdSummary | null | undefined }) {
  if (summary?.flagged) return <Pill tone="no">{summary.flagged} flagged</Pill>;
  if (summary?.started) return <Pill tone="go">0</Pill>;
  return <span className="text-sm text-fg-muted">—</span>;
}

/** `ddBadge` — the IC Pipeline's DD cell, opening the checklist it summarises. */
export function DdBadge({ summary, onOpen }: { summary: DdSummary | null | undefined; onOpen?: () => void }) {
  if (!summary || summary.total === 0) {
    return <span className="rounded-full bg-offwhite px-2.5 py-0.5 font-mono text-[11px] font-semibold text-fg-muted">No DD</span>;
  }
  const tone: Tone = summary.flagged ? "no" : isComplete(summary) ? "go" : "hold";
  const text = `${summary.done}/${summary.total}${summary.flagged ? ` · ${summary.flagged} flagged` : ""}`;
  return (
    <button
      type="button"
      title="Open diligence checklist"
      className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold ${TONE_CLASS[tone]}`}
      onClick={onOpen}
    >
      {text}
    </button>
  );
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const ms = Date.parse(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// ═══════════════════════════════════════════════════════════════════════════
// Investment DD / Legal DD cells
// ═══════════════════════════════════════════════════════════════════════════

const mpTone = (v: MpApproval): Tone => (v === "approved" ? "go" : "no");
const rowTone = (v: DdRowStatus): Tone => (v === "completed" ? "go" : v === "in_progress" ? "hold" : "plain");

async function saving(ctx: StageContext, write: () => Promise<unknown>, failure: string) {
  try {
    await write();
    await ctx.reload();
  } catch {
    ctx.fail(failure);
  }
}

/** `ddRowExtraCells` — MP approval (`DD_MP`). */
export function MpApprovalCell({ row, ctx }: { row: StageRow; ctx: StageContext }) {
  const deal = dealOf(row);
  if (!deal) return <span className="text-sm text-fg-muted">—</span>;
  return (
    <ToneSelect
      label={`MP approval for ${row.deck.name}`}
      value={deal.mpApproval}
      tone={mpTone(deal.mpApproval)}
      options={MP_APPROVALS.map((v) => ({ value: v, label: MP_APPROVAL_LABELS[v] }))}
      disabled={ctx.busy || !canSetMpApproval(ctx.role)}
      onChange={(v) =>
        v && saving(ctx, () => putMpApproval(row.deck.id, v), `Couldn't record MP approval for ${row.deck.name}.`)
      }
    />
  );
}

/** `ddRowExtraCells` — the row's Status (`DD_ROWSTATUS`). */
export function DdStatusCell({ row, ctx }: { row: StageRow; ctx: StageContext }) {
  const deal = dealOf(row);
  if (!deal) return <span className="text-sm text-fg-muted">—</span>;
  return (
    <ToneSelect
      label={`Diligence status for ${row.deck.name}`}
      value={deal.ddStatus}
      tone={rowTone(deal.ddStatus)}
      options={DD_ROW_STATUSES.map((v) => ({ value: v, label: DD_ROW_STATUS_LABELS[v] }))}
      disabled={ctx.busy || !canEditChecklist(ctx.role)}
      onChange={(v) =>
        v && saving(ctx, () => putDeal(row.deck.id, { ddStatus: v }), `Couldn't update ${row.deck.name}'s status.`)
      }
    />
  );
}

/** `ddProgCell` — the bar once the row is under way, else "— not started —". */
export function DiligenceProgressCell({ row }: { row: StageRow }) {
  const deal = dealOf(row);
  if (!deal || deal.ddStatus === "yet_to_start") {
    return <span className="text-[11px] text-fg-muted">— not started —</span>;
  }
  return <ProgressBar summary={deal.investment} />;
}

/** "Open checklist" / "Open sign up" — both open the row's slide-over on a tab. */
export function OpenTabButton({
  row,
  ctx,
  tab,
  children,
  icon,
}: {
  row: StageRow;
  ctx: StageContext;
  tab: string;
  children: ReactNode;
  icon: ReactNode;
}) {
  return (
    <Button size="sm" variant="secondary" className="whitespace-nowrap" onClick={() => ctx.openTab(row.deck, tab)}>
      {icon}
      {children}
    </Button>
  );
}

export const checklistIcon = <ClipboardCheck className="mr-1 h-3.5 w-3.5" aria-hidden="true" />;
export const signupIcon = <Signature className="mr-1 h-3.5 w-3.5" aria-hidden="true" />;

// ═══════════════════════════════════════════════════════════════════════════
// The checklist tab (`ddOpen` / `ldOpen`)
// ═══════════════════════════════════════════════════════════════════════════

const statusTone = (s: DdItemStatus): Tone =>
  s === "done" ? "go" : s === "flagged" ? "no" : s === "in_progress" ? "hold" : "plain";
const ratingTone = (r: DdRating | null): Tone =>
  r === "strong" ? "go" : r === "mixed" ? "hold" : r === "concern" ? "no" : "plain";

/**
 * One `.dd-item`: the label (renameable on the investment checklist), a status
 * select, an owner, a rating select and the finding. Selects save on change,
 * text on blur — the prototype's `onchange` and `onblur`.
 */
function ChecklistItem({
  item,
  renameable,
  readOnly,
  onSave,
}: {
  item: DdItemView;
  renameable: boolean;
  readOnly: boolean;
  onSave: (patch: ItemPatch) => void;
}) {
  const [label, setLabel] = useState(item.label);
  const [owner, setOwner] = useState(item.owner ?? "");
  const [finding, setFinding] = useState(item.finding ?? "");
  const blurSave = (key: "label" | "owner" | "finding", value: string, was: string) => {
    if (value.trim() !== was) onSave({ [key]: value.trim() || (key === "label" ? "" : null) } as ItemPatch);
  };
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-line p-3" data-testid="dd-item">
      {renameable && !readOnly ? (
        <input
          className="sj-input h-8 py-0 text-sm font-semibold"
          aria-label={`Checklist item ${item.sortOrder}`}
          title="Click to rename this checklist item"
          placeholder={item.defaultLabel}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => blurSave("label", label, item.label)}
        />
      ) : (
        <div className="text-sm font-semibold text-fg">{item.label}</div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <ToneSelect
          label={`Status for ${item.label}`}
          value={item.status}
          tone={statusTone(item.status)}
          options={DD_ITEM_STATUSES.map((s) => ({ value: s, label: DD_ITEM_STATUS_LABELS[s] }))}
          disabled={readOnly}
          onChange={(v) => v && v !== item.status && onSave({ status: v })}
        />
        <input
          className="sj-input h-8 w-28 py-0 text-xs"
          aria-label={`Owner for ${item.label}`}
          placeholder="Owner"
          value={owner}
          disabled={readOnly}
          onChange={(e) => setOwner(e.target.value)}
          onBlur={() => blurSave("owner", owner, item.owner ?? "")}
        />
        <ToneSelect
          label={`Rating for ${item.label}`}
          value={item.rating}
          tone={ratingTone(item.rating)}
          placeholder="—"
          options={DD_RATINGS.map((r) => ({ value: r, label: DD_RATING_LABELS[r] }))}
          disabled={readOnly}
          onChange={(v) => v !== item.rating && onSave({ rating: v })}
        />
      </div>
      <textarea
        className="sj-input min-h-[3rem] text-xs"
        aria-label={`Finding for ${item.label}`}
        placeholder="Finding / notes"
        value={finding}
        disabled={readOnly}
        onChange={(e) => setFinding(e.target.value)}
        onBlur={() => blurSave("finding", finding, item.finding ?? "")}
      />
    </li>
  );
}

/** A labelled text field on the deal record that saves on blur. */
function DealField({
  label,
  value,
  disabled,
  onSave,
}: {
  label: string;
  value: string | null;
  disabled: boolean;
  onSave: (value: string | null) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  return (
    <label className="flex flex-col gap-1 text-[11px] text-fg-muted">
      {label}
      <input
        className="sj-input h-8 py-0 text-xs text-fg"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft.trim() !== (value ?? "") && onSave(draft.trim() || null)}
      />
    </label>
  );
}

/** The deck's own transitions, at the foot of a tab — the table carries no Action column here. */
export function StageActions({ row, ctx }: { row: StageRow; ctx: StageContext }) {
  const actions = (row.deck.actions ?? []).filter((a) => a.action !== "assign_jury");
  if (actions.length === 0) return null;
  return (
    <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-3" data-testid="pane-stage-actions">
      {actions.map((a: DeckAction) => (
        <Button
          key={a.action}
          size="sm"
          variant={a.to === "archived" ? "secondary" : "primary"}
          disabled={ctx.busy}
          onClick={() => ctx.runAction(row.deck, a)}
        >
          {a.label}
        </Button>
      ))}
    </div>
  );
}

/**
 * The checklist slide-over tab — `ddOpen` ("investment diligence checklist")
 * and `ldOpen` ("legal & confirmatory diligence"), with the deal's lead (and,
 * for investment, the round's ask and pre-money the IC votes on) above it.
 */
export function ChecklistTab({ row, ctx, track }: { row: StageRow; ctx: StageContext; track: DiligenceTrack }) {
  const deckId = row.deck.id;
  const [view, setView] = useState<ChecklistView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setView(null);
    setError(null);
    getChecklist(deckId, track)
      .then((v) => live && setView(v))
      .catch(() => live && setError("Couldn't load the checklist."));
    return () => {
      live = false;
    };
  }, [deckId, track]);

  const readOnly = !canEditChecklist(ctx.role);
  const deal = dealOf(row);

  async function save(item: DdItemView, patch: ItemPatch) {
    try {
      const res = await patchItem(deckId, track, item.id, patch);
      setView((v) =>
        v && {
          ...v,
          items: v.items.map((i) => (i.id === res.item.id ? res.item : i)),
          summary: res.deal[track] ?? v.summary,
        },
      );
      await ctx.reload();
    } catch {
      setError(`Couldn't save ${item.label}. Try again.`);
    }
  }

  if (error && !view) return <p className="text-xs text-red">{error}</p>;
  if (!view) return <p className="text-xs text-fg-muted">Loading…</p>;
  return (
    <div className="flex flex-col gap-3" data-testid={`pane-checklist-${track}`}>
      <div className="text-[11px] text-fg-muted">
        {[row.deck.sector, row.deck.stage, row.deck.city].filter(Boolean).join(" · ")}
        {" · "}
        {track === "investment" ? "investment diligence checklist" : "legal & confirmatory diligence"}
      </div>
      <ProgressBar summary={view.summary} />
      {error && <p className="text-xs text-red">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <DealField
          key={`lead-${deal?.[track === "investment" ? "investmentLead" : "legalLead"] ?? ""}`}
          label="Lead"
          value={deal?.[track === "investment" ? "investmentLead" : "legalLead"] ?? null}
          disabled={readOnly}
          onSave={(v) =>
            saving(ctx, () => putDeal(deckId, track === "investment" ? { investmentLead: v } : { legalLead: v }), "Couldn't save the lead.")
          }
        />
        {track === "investment" && (
          <>
            <DealField
              key={`ask-${deal?.ask ?? ""}`}
              label="Ask"
              value={deal?.ask ?? null}
              disabled={readOnly}
              onSave={(v) => saving(ctx, () => putDeal(deckId, { ask: v }), "Couldn't save the ask.")}
            />
            <DealField
              key={`val-${deal?.valuation ?? ""}`}
              label="Pre-money valuation"
              value={deal?.valuation ?? null}
              disabled={readOnly}
              onSave={(v) => saving(ctx, () => putDeal(deckId, { valuation: v }), "Couldn't save the valuation.")}
            />
          </>
        )}
      </div>
      <ol className="flex flex-col gap-2">
        {view.items.map((item) => (
          <ChecklistItem
            key={`${item.id}:${item.updatedAt ?? ""}`}
            item={item}
            renameable={view.renameable}
            readOnly={readOnly}
            onSave={(patch) => save(item, patch)}
          />
        ))}
      </ol>
      <StageActions row={row} ctx={ctx} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Term sheet
// ═══════════════════════════════════════════════════════════════════════════

const tsTone = (s: TermSheetStatus | null): Tone =>
  s === "signed" ? "go" : s === "declined" ? "no" : s === "drafted" ? "hold" : s === "issued" ? "info" : "plain";
const versionTone = (v: TermSheetVersion): Tone => (v === "executed" ? "go" : v === "issued" ? "info" : "hold");

/** `clRow`'s outcome select with `TS_OUTCOMES` and the "— status —" placeholder. */
export function TermSheetStatusCell({ row, ctx }: { row: StageRow; ctx: StageContext }) {
  const deal = dealOf(row);
  const status = deal?.termSheet.status ?? null;
  return (
    <ToneSelect
      label={`Term sheet status for ${row.deck.name}`}
      value={status}
      tone={tsTone(status)}
      placeholder="— status —"
      options={TERM_SHEET_STATUSES.map((s) => ({ value: s, label: TERM_SHEET_STATUS_LABELS[s] }))}
      disabled={ctx.busy || !deal || !canSetTermSheet(ctx.role)}
      onChange={(v) => saving(ctx, () => putTermSheet(row.deck.id, v), `Couldn't update ${row.deck.name}'s term sheet.`)}
    />
  );
}

/** `ts-doc-ov` / `ts-tpl-ov` — a centred modal. */
function Modal({ title, meta, onClose, children, footer, width = "34rem" }: {
  title: string;
  meta?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-label={title} className="flex max-h-[85vh] w-full flex-col overflow-hidden rounded-xl bg-surface shadow-xl" style={{ maxWidth: width }}>
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-fg">{title}</div>
            {meta && <div className="mt-0.5 text-[11px] text-fg-muted">{meta}</div>}
          </div>
          <button type="button" aria-label="Close" className="text-fg-muted hover:text-fg" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

const TEMPLATE_BADGE: Record<string, { tone: Tone; label: string }> = {
  active: { tone: "go", label: "Active" },
  draft: { tone: "hold", label: "Draft" },
  retired: { tone: "plain", label: "Retired" },
};

/** `tsAttach` — pick a template from the Agreements library; retired ones are shown, never pickable. */
function TemplatePicker({ deck, onPick, onClose }: { deck: DeckView; onPick: (id: string) => void; onClose: () => void }) {
  const [templates, setTemplates] = useState<TermSheetTemplate[] | null>(null);
  useEffect(() => {
    let live = true;
    listTermSheetTemplates()
      .then((r) => live && setTemplates(r.templates))
      .catch(() => live && setTemplates([]));
    return () => {
      live = false;
    };
  }, []);
  return (
    <Modal
      title="Pick a term sheet template"
      meta={`For ${[deck.name, deck.sector, deck.stage].filter(Boolean).join(" · ")}`}
      onClose={onClose}
      width="30rem"
    >
      <div className="mb-3 rounded-lg bg-blue-lt px-3 py-2 text-[11px] text-blue-dk">
        Templates come from the Agreements library in the Admin console. Retired templates can't be picked.
      </div>
      {templates === null ? (
        <p className="text-xs text-fg-muted">Loading…</p>
      ) : templates.length === 0 ? (
        <p className="text-xs text-fg-muted">The Agreements library has no templates yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {templates.map((t) => {
            const badge = TEMPLATE_BADGE[t.status] ?? TEMPLATE_BADGE.draft;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  disabled={!t.pickable}
                  onClick={() => onPick(t.id)}
                  className="flex w-full items-center gap-2.5 rounded-lg border border-stone-dk px-3 py-2.5 text-left enabled:hover:bg-surface-2 disabled:opacity-55"
                >
                  <FileText className="h-4 w-4 text-gold-dk" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-semibold text-navy">
                      {t.name} <Pill tone={badge.tone}>{badge.label}</Pill>
                    </span>
                    <span className="block text-[10.5px] text-fg-muted">
                      {[t.fileName, t.version].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}

/**
 * `tsViewDoc` — the non-binding summary of proposed terms. What this
 * application knows (company, ask, pre-money, template) is filled in; the
 * standard terms are the prototype's template defaults, and the banner says so.
 */
function TermSheetDocModal({ deck, deal, onClose }: { deck: DeckView; deal: DealView; onClose: () => void }) {
  const doc = deal.termSheet.doc!;
  const rows: [string, string][] = [
    ["Company", [deck.name, deck.sector, deck.stage, deck.city].filter(Boolean).join(" · ")],
    ["Instrument", "Compulsorily Convertible Preference Shares (CCPS)"],
    ["Investment amount", deal.ask ?? "—"],
    ["Pre-money valuation", deal.valuation ?? "—"],
    ["Option pool", "10% post-money (topped up pre-investment)"],
    ["Board composition", "1 investor seat + 1 observer"],
    ["Pro-rata rights", "Yes, for major investors"],
    ["Liquidation preference", "1x non-participating"],
    ["Anti-dilution", "Broad-based weighted average"],
    ["Information rights", "Quarterly MIS + annual audited financials"],
    ["Exclusivity", "45 days from signing of this term sheet"],
    ["Governing law", `India${deck.city ? ` · arbitration seat: ${deck.city}` : ""}`],
  ];
  function download() {
    const text = [`Term Sheet — ${deck.name}`, `${doc.fileName} · ${TERM_SHEET_VERSION_LABELS[doc.version]}`, "", ...rows.map(([k, v]) => `${k}: ${v}`)].join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doc.fileName.replace(/\.[a-z]+$/i, "")}-summary.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <Modal
      title={`Term Sheet — ${deck.name}`}
      meta={
        <>
          {doc.fileName} · <Pill tone={versionTone(doc.version)}>{TERM_SHEET_VERSION_LABELS[doc.version]}</Pill>
          {doc.templateName && ` · Template: ${doc.templateName}${doc.templateVersion ? ` · ${doc.templateVersion}` : ""}`}
        </>
      }
      onClose={onClose}
      footer={
        <>
          <Button size="sm" variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button size="sm" onClick={download}>
            <Download className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Download
          </Button>
        </>
      }
    >
      <div className="mb-3 rounded-lg bg-blue-lt px-3 py-2 text-[11px] text-blue-dk">
        Non-binding summary of proposed terms. Standard terms are the template's defaults until the document is negotiated.
      </div>
      <table className="w-full text-xs">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-t border-line first:border-t-0">
              <td className="w-44 py-1.5 pr-3 text-fg-muted">{k}</td>
              <td className="py-1.5 font-medium text-fg">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

/** `tsDocCell` — the attached document (name, version badge, View) or Attach. */
export function TermSheetDocCell({ row, ctx }: { row: StageRow; ctx: StageContext }) {
  const deal = dealOf(row);
  const [open, setOpen] = useState<"view" | "pick" | null>(null);
  if (!deal) return <span className="text-sm text-fg-muted">—</span>;
  const doc = deal.termSheet.doc;
  return (
    <>
      {doc ? (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            title={`View ${doc.fileName}`}
            className="flex max-w-[11rem] items-center gap-1 truncate rounded-md border border-line px-2 py-1 text-[11px] text-fg hover:bg-surface-2"
            onClick={() => setOpen("view")}
          >
            <FileText className="h-3.5 w-3.5 shrink-0 text-gold-dk" aria-hidden="true" />
            <span className="truncate">{doc.fileName}</span>
          </button>
          <Pill tone={versionTone(doc.version)}>{TERM_SHEET_VERSION_LABELS[doc.version]}</Pill>
        </div>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          className="whitespace-nowrap"
          disabled={ctx.busy || !canSetTermSheet(ctx.role)}
          onClick={() => setOpen("pick")}
        >
          <Paperclip className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Attach
        </Button>
      )}
      {open === "view" && doc && <TermSheetDocModal deck={row.deck} deal={deal} onClose={() => setOpen(null)} />}
      {open === "pick" && (
        <TemplatePicker
          deck={row.deck}
          onClose={() => setOpen(null)}
          onPick={(id) => {
            setOpen(null);
            void saving(ctx, () => attachTermSheet(row.deck.id, id), `Couldn't attach a template to ${row.deck.name}.`);
          }}
        />
      )}
    </>
  );
}

/**
 * `tsSchedule` → `ncCallOpenModal(…, label:'Term sheet')`. The VC edition has
 * three call kinds and none is "term sheet"; the call closest to it — the
 * post-IC conversation with the founder — is `alignment`, titled for the term
 * sheet so both screens say what it is (plan §8 Q143).
 */
export function ScheduleCallCell({ row, ctx }: { row: StageRow; ctx: StageContext }) {
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState("");
  const [minutes, setMinutes] = useState(30);
  const [saving_, setSaving] = useState(false);
  if (row.deck.callScheduledAt) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-green">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Scheduled
      </span>
    );
  }
  if (!canScheduleVcCall(ctx.role)) return <span className="text-sm text-fg-muted">—</span>;
  async function submit() {
    setSaving(true);
    try {
      const res = await fetch("/api/calls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deckId: row.deck.id,
          kind: "alignment",
          scheduledAt: new Date(when).toISOString(),
          durationMinutes: minutes,
          title: `${row.deck.name} — term sheet call`,
          participants: [],
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setOpen(false);
      await ctx.reload();
    } catch {
      ctx.fail(`Couldn't schedule a call with ${row.deck.name}. Try again.`);
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <Button size="sm" variant="secondary" className="whitespace-nowrap" disabled={ctx.busy} onClick={() => setOpen(true)}>
        <CalendarPlus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Schedule call
      </Button>
      {open && (
        <Modal
          title="Schedule term sheet call"
          meta={row.deck.name}
          onClose={() => setOpen(false)}
          width="26rem"
          footer={
            <>
              <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
                Close
              </Button>
              <Button size="sm" disabled={!when || saving_} onClick={submit}>
                {saving_ ? "…" : "Schedule"}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs text-fg-muted">
              Date & time
              <input type="datetime-local" className="sj-input text-sm text-fg" value={when} onChange={(e) => setWhen(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-fg-muted">
              Duration
              <select className="sj-input text-sm text-fg" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                {[15, 30, 45, 60, 90].map((m) => (
                  <option key={m} value={m}>
                    {m} min
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Modal>
      )}
    </>
  );
}

/** The Term sheet Pipeline's own slide-over tab: status, document, the round's figures, the stage move. */
export function TermSheetTab({ row, ctx }: { row: StageRow; ctx: StageContext }) {
  const deal = dealOf(row);
  return (
    <div className="flex flex-col gap-3" data-testid="pane-term-sheet">
      <div className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-xs">
        <span className="text-fg-muted">Term sheet status</span>
        <TermSheetStatusCell row={row} ctx={ctx} />
      </div>
      <div className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-xs">
        <span className="text-fg-muted">Term sheet doc</span>
        <TermSheetDocCell row={row} ctx={ctx} />
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-surface-2 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-fg-muted">Ask</div>
          <div className="font-mono font-semibold text-navy">{deal?.ask ?? "—"}</div>
        </div>
        <div className="rounded-lg bg-surface-2 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-fg-muted">Pre-money</div>
          <div className="font-mono font-semibold text-navy">{deal?.valuation ?? "—"}</div>
        </div>
      </div>
      <StageActions row={row} ctx={ctx} />
    </div>
  );
}

/**
 * Legal DD's `Open sign up` (`openSuWork`). The VC onboarding record §8.3 names —
 * the term sheet that was signed and where diligence stands — is what this
 * edition can show today; the three-tab workspace (`/api/signups`) serves the
 * incubator only, and its VC half is §9's.
 */
export function SignupRecordTab({ row, ctx }: { row: StageRow; ctx: StageContext }) {
  const deal = dealOf(row);
  const status = deal?.termSheet.status;
  return (
    <div className="flex flex-col gap-3" data-testid="pane-signup-record">
      <div className="text-[11px] text-fg-muted">
        Sign-up — term sheet status:{" "}
        <b className="text-fg">{status ? TERM_SHEET_STATUS_LABELS[status] : "Not recorded"}</b>
      </div>
      <div className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-xs">
        <span className="text-fg-muted">Term sheet doc</span>
        <TermSheetDocCell row={row} ctx={ctx} />
      </div>
      <div className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-xs">
        <span className="text-fg-muted">Legal DD</span>
        <ProgressBar summary={deal?.legal} />
      </div>
      <Button size="sm" variant="secondary" onClick={() => ctx.openTab(row.deck, "legal-checklist")}>
        {checklistIcon} Open checklist
      </Button>
      <StageActions row={row} ctx={ctx} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Onboard ready · Invest ready · Archive
// ═══════════════════════════════════════════════════════════════════════════

/** `curRender`'s `su-act` — View profile, plus Mark graduated / Archive where the pipeline offers them. */
export function CurationActionCell({ row, ctx }: { row: StageRow; ctx: StageContext }) {
  const moves = (row.deck.actions ?? []).filter((a) => a.to === "archived" || a.action === "graduate");
  return (
    <select
      aria-label={`Action for ${row.deck.name}`}
      className="sj-input h-8 w-32 py-0 text-xs"
      value=""
      disabled={ctx.busy}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "view") ctx.openReport(row.deck, "core");
        const move = moves.find((a) => a.action === v);
        if (move) void ctx.runAction(row.deck, move);
      }}
    >
      <option value="">Action ▾</option>
      <option value="view">View profile</option>
      {moves.map((a) => (
        <option key={a.action} value={a.action}>
          {a.action === "graduate" ? "Mark graduated" : a.label}
        </option>
      ))}
    </select>
  );
}

export function ClearedCell({ row }: { row: StageRow }) {
  return <span className="text-[11px] text-fg-muted">{fmtDate(dealOf(row)?.clearedAt)}</span>;
}

/** `curData.stage` chips — Term sheet (info) · Legal DD (hold) · Closed (go). */
export function InvestReadyStageCell({ row }: { row: StageRow }) {
  const stage = investReadyStage(row.deck.statusId);
  if (!stage) return <span className="text-sm text-fg-muted">—</span>;
  return <Pill tone={stage === "Closed" ? "go" : stage === "Legal DD" ? "hold" : "info"}>{stage}</Pill>;
}

/** `curData.status` chips — Funded (olive) · Stalled (no) · On track (go). */
export function InvestReadyStatusCell({ row }: { row: StageRow }) {
  const status = investReadyStatus(row.deck.statusId, dealOf(row)?.lastActivityAt);
  if (status === "Funded") return <Pill tone="plain" style={{ background: "var(--olive)", color: "#fff", borderColor: "transparent" }}>Funded</Pill>;
  return <Pill tone={status === "Stalled" ? "no" : "go"}>{status}</Pill>;
}

export const investReadyOwner = (row: StageRow) => {
  const d = dealOf(row);
  return d?.legalLead ?? d?.investmentLead ?? d?.partnerName ?? null;
};

/**
 * `arReasonLabel` — Rejected / Withdrawn / Graduated, and the IC build's
 * Archived. Every way a VC deal leaves the pipeline maps to one of them, so the
 * cell never falls back to the stage name (F0589).
 */
export type ArchiveReason = "rejected" | "withdrawn" | "graduated" | "archived";
export function archiveReason(deck: DeckView): ArchiveReason {
  switch (deck.exitAction) {
    case "not_shortlisted":
    case "not_shortlisted_partner":
    case "pass_at_call":
    case "pass":
    case "reject":
    case "reject_ai_gate":
      return "rejected";
    case "withdraw":
      return "withdrawn";
    case "graduate":
      return "graduated";
    default:
      return "archived";
  }
}
export const ARCHIVE_REASON_LABELS: Record<ArchiveReason, string> = {
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  graduated: "Graduated",
  archived: "Archived",
};

/** `.ar-reason` — a toned pill, with the exit note (when one was written) as its title. */
export function ArchiveReasonCell({ row }: { row: StageRow }) {
  const reason = archiveReason(row.deck);
  const style: Record<ArchiveReason, React.CSSProperties> = {
    rejected: { background: "#FEF2F2", color: "#DC2626" },
    withdrawn: { background: "var(--stone)", color: "var(--fg-muted)" },
    graduated: { background: "#F0FDF4", color: "#047857" },
    archived: { background: "var(--offwht)", color: "var(--fg-muted)" },
  };
  return (
    <span
      title={row.deck.exitNote ?? undefined}
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold"
      style={style[reason]}
    >
      {ARCHIVE_REASON_LABELS[reason]}
    </span>
  );
}
