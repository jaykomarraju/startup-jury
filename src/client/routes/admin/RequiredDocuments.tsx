import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { FileCheck, FileText, Folders, Info, Plus, Trash2 } from "lucide-react";
import { Card, Button } from "../../components";
import { useAdminSave } from "./saveContext";
import { listPrograms, type ProgramView } from "../../api";
import {
  DOCUMENT_APPLY_TO,
  DOCUMENT_APPLY_TO_LABELS,
  DOCUMENT_STATUS_BADGES,
  WAIVED_BADGE,
  type DocumentApplyTo,
  type DocumentStatus,
  type RequiredDocumentView,
  type SignupDocumentSetView,
  type SignupDocumentView,
} from "../../../shared/signupConfig";

/**
 * Admin console → Sign-up → **Required documents** (`admin/s-sudocs.html`).
 *
 * The prototype's two cards, plus the one the spec asks for and the prototype
 * only implies:
 *
 *   1. **Program / cohort** — the scope select and "Applies to" (in the VC
 *      console the same card is headed *Fund*, because a VC programme IS a
 *      fund; `s-sudocs.html` differs between the editions in exactly that
 *      label and in carrying "Audited financials · Last 2 years").
 *   2. **Checklist** — a toggle per item, "Mandatory when ON", with the
 *      per-item sub-label, Add document, and the olive footer note about
 *      per-sign-up additions and waivers.
 *   3. **Sign-up document status** — the lifecycle the checklist feeds:
 *      `not_requested → awaiting → submitted → verified` per item, with the
 *      prototype's four badges (`suwDocs`) and its **Verify all documents**
 *      bulk action. Without this card the section would configure a checklist
 *      whose effect is invisible, which is F0050 restated rather than closed.
 *
 * The section owns unsaved state, so the console's title-bar Save changes is
 * this component's (`useAdminSave`). Lifecycle moves are NOT part of that
 * draft: each is one authorised act on one document, applied immediately, the
 * way the prototype's own Verify buttons behave.
 */

// ── Small pieces of the prototype's card chrome ──────────────────────────────

function CardTitle({ icon, children, chip }: { icon: ReactNode; children: ReactNode; chip?: string }) {
  return (
    <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-fg">
      <span style={{ color: "var(--ac-olive, #4A6644)" }}>{icon}</span>
      {children}
      {chip && (
        <span
          className="rounded-full px-2 py-[2px] text-[10px] font-semibold"
          style={{ color: "var(--ac-gold-dk, #BA7517)", background: "var(--color-gold-lt, #FBF3E2)" }}
        >
          {chip}
        </span>
      )}
    </div>
  );
}

const inputClass =
  "h-8 w-full rounded-[7px] border border-line bg-surface px-2 text-item text-fg placeholder:text-fg-muted";

/** The prototype's `.tog` — a 34×18 pill that is olive when ON. */
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={`${label} mandatory`}
      onClick={() => onChange(!checked)}
      className="inline-flex h-[18px] w-[34px] shrink-0 items-center rounded-full p-[2px] transition-colors"
      style={{ background: checked ? "var(--ac-olive, #4A6644)" : "var(--color-line)" }}
    >
      <span
        className="h-[14px] w-[14px] rounded-full bg-white transition-transform"
        style={{ transform: checked ? "translateX(16px)" : "translateX(0)" }}
      />
    </button>
  );
}

/** One of the four lifecycle pills (`suwPill`), or the waived note beside one. */
export function StatusBadge({ status, waived }: { status: DocumentStatus; waived?: boolean }) {
  const pill = waived ? WAIVED_BADGE : DOCUMENT_STATUS_BADGES[status];
  return (
    <span
      data-testid={`doc-badge-${waived ? "waived" : status}`}
      className="shrink-0 rounded-full px-[9px] py-[3px] text-[10px] font-bold"
      style={{ color: pill.fg, background: pill.bg }}
    >
      {pill.label}
    </span>
  );
}

// ── The draft ────────────────────────────────────────────────────────────────

/** One checklist row being edited. `id` absent = added here, not yet saved. */
interface DraftItem {
  id: string | null;
  name: string;
  note: string;
  mandatory: boolean;
  /** Stable React key — an id is not available for a brand-new row. */
  key: string;
}

let nextKey = 0;
const newKey = () => `new-${++nextKey}`;

function draftOf(items: RequiredDocumentView[]): DraftItem[] {
  return items.map((i) => ({
    id: i.id,
    name: i.name,
    note: i.note ?? "",
    mandatory: i.mandatory,
    key: i.id,
  }));
}

function sameDraft(a: DraftItem[], b: DraftItem[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (x, i) =>
        x.id === b[i].id &&
        x.name === b[i].name &&
        x.note === b[i].note &&
        x.mandatory === b[i].mandatory,
    )
  );
}

interface Payload {
  edition: string;
  scope: { programId: string | null; cohortId: string | null };
  inherited: boolean;
  items: RequiredDocumentView[];
  signups: SignupDocumentSetView[];
}

// The section fetches directly rather than through `src/client/api.ts`: that
// file is shared by every wave and this session owns none of it (§2.2). Recorded
// in the plan's §9 for a later consolidation, exactly as `CrmSync` did.
async function fetchPayload(programId: string | null, cohortId: string | null): Promise<Payload> {
  const q = new URLSearchParams();
  if (programId) q.set("programId", programId);
  if (cohortId) q.set("cohortId", cohortId);
  const r = await fetch(`/api/signup-config/documents${q.size ? `?${q}` : ""}`);
  if (!r.ok) throw new Error(`documents: ${r.status}`);
  return (await r.json()) as Payload;
}

async function send(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const payload = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(describeError(payload, r.status));
  return payload;
}

/** The route's error vocabulary, in the section's own words. */
function describeError(payload: Record<string, unknown>, status: number): string {
  const code = String(payload.error ?? "");
  if (code === "illegal_transition") {
    const from = DOCUMENT_STATUS_BADGES[payload.from as DocumentStatus]?.label ?? payload.from;
    const to = DOCUMENT_STATUS_BADGES[payload.to as DocumentStatus]?.label ?? payload.to;
    return `A document can't go from ${from} to ${to} — the lifecycle runs Not requested → Awaiting → Submitted → Verified.`;
  }
  if (code === "checklist_empty") return "Keep at least one document on the checklist.";
  if (code === "duplicate_document") return "Two items share a name — give each one its own.";
  if (code === "name_required") return "Every document needs a name.";
  if (code === "invalid_note") return "A sub-label is at most 120 characters.";
  if (code === "document_waived") return "This item is waived — lift the waiver before moving it.";
  return code ? code.replace(/_/g, " ") : `Request failed (${status}).`;
}

// ═══════════════════════════════════════════════════════════════════════════

export function RequiredDocumentsSection() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [programs, setPrograms] = useState<ProgramView[]>([]);
  const [scopeKey, setScopeKey] = useState<string>(""); // "" = edition default
  const [applyTo, setApplyTo] = useState<DocumentApplyTo>("all");
  const [draft, setDraft] = useState<DraftItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  /** `""` | `prog_x` | `prog_x/coh_y` — one select over both levels. */
  const scope = useMemo(() => {
    const [programId = null, cohortId = null] = scopeKey.split("/");
    return { programId: programId || null, cohortId: cohortId || null };
  }, [scopeKey]);

  /**
   * True once the admin has edited the draft, cleared when the draft is seeded
   * or saved. It is what stops a SLOW FETCH from eating an edit: React's
   * StrictMode double-invokes the mount effect, and on a loaded machine the
   * second response can land after the first click — seeding the draft again
   * would silently discard what was just typed, and the console's Save button
   * would go back to "No checklist changes to save". A real e2e run caught
   * exactly that.
   */
  const touched = useRef(false);

  const load = useCallback(
    async (programId: string | null, cohortId: string | null, reset: boolean) => {
      try {
        const next = await fetchPayload(programId, cohortId);
        setPayload(next);
        // Never overwrite a draft the admin is working in — not on a refresh
        // after a lifecycle action (reset=false), and not on a late mount
        // response either.
        if (reset && !touched.current) setDraft(draftOf(next.items));
        setLoadError(false);
      } catch {
        setLoadError(true);
      }
    },
    [],
  );

  useEffect(() => {
    // Changing scope deliberately abandons the draft: it belonged to the
    // programme being navigated away from.
    touched.current = false;
    void load(scope.programId, scope.cohortId, true);
  }, [load, scope.programId, scope.cohortId]);

  useEffect(() => {
    let cancelled = false;
    listPrograms()
      .then((r) => {
        if (!cancelled) setPrograms(r.programs);
      })
      .catch(() => {
        /* no programmes — the scope select falls back to the edition default */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = useMemo(
    () => (payload ? !sameDraft(draft, draftOf(payload.items)) : false),
    [draft, payload],
  );

  const setItem = (key: string, patch: Partial<DraftItem>) => {
    touched.current = true;
    setDraft((d) => d.map((i) => (i.key === key ? { ...i, ...patch } : i)));
    setError(null);
    setNote(null);
  };

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    setNote(null);
    try {
      const body = {
        programId: scope.programId,
        cohortId: scope.cohortId,
        applyTo,
        items: draft.map((i) => ({
          id: i.id ?? undefined,
          name: i.name,
          note: i.note.trim() || null,
          mandatory: i.mandatory,
        })),
      };
      const r = (await send("PUT", "/api/signup-config/documents", body)) as unknown as {
        items: RequiredDocumentView[];
        signups: SignupDocumentSetView[];
        inherited: boolean;
        resynced: number;
      };
      setPayload((p) =>
        p ? { ...p, items: r.items, signups: r.signups, inherited: r.inherited } : p,
      );
      touched.current = false;
      setDraft(draftOf(r.items));
      setNote(
        applyTo === "all" && r.resynced > 0
          ? `Checklist saved · re-synced ${r.resynced} open sign-up${r.resynced === 1 ? "" : "s"}.`
          : "Checklist saved. New sign-ups inherit it.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the checklist.");
    } finally {
      setSaving(false);
    }
  }, [applyTo, draft, scope.cohortId, scope.programId]);

  useAdminSave({
    dirty,
    saving,
    hint: "No checklist changes to save",
    onSave: save,
  });

  const move = useCallback(
    async (set: SignupDocumentSetView, item: SignupDocumentView, to: DocumentStatus) => {
      setBusy(item.id);
      setError(null);
      setNote(null);
      try {
        await send(
          "PATCH",
          `/api/signup-config/signups/${set.signupId}/documents/${item.id}`,
          { status: to },
        );
        await load(scope.programId, scope.cohortId, false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't move that document.");
      } finally {
        setBusy(null);
      }
    },
    [load, scope.cohortId, scope.programId],
  );

  const verifyAll = useCallback(
    async (set: SignupDocumentSetView) => {
      setBusy(set.signupId);
      setError(null);
      setNote(null);
      try {
        const r = await send(
          "POST",
          `/api/signup-config/signups/${set.signupId}/documents/verify-all`,
        );
        await load(scope.programId, scope.cohortId, false);
        const moved = Number(r.moved ?? 0);
        const blocked = Number(r.blocked ?? 0);
        setNote(
          `Verified ${moved} document${moved === 1 ? "" : "s"} for ${set.startup}` +
            (blocked > 0
              ? ` · ${blocked} still waiting on the founder, so ${blocked === 1 ? "it was" : "they were"} left alone.`
              : "."),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't verify those documents.");
      } finally {
        setBusy(null);
      }
    },
    [load, scope.cohortId, scope.programId],
  );

  const heading = (
    <div>
      <h2 className="text-base font-semibold tracking-tight text-fg">Required documents</h2>
      <p className="mt-0.5 max-w-3xl text-[13px] text-fg-muted">
        Set the documents a shortlisted startup must submit during sign-up. Configured per program /
        cohort &mdash; each toggle marks an item mandatory. Every new sign-up inherits this checklist.
      </p>
    </div>
  );

  if (loadError) {
    return (
      <div className="flex flex-col gap-3">
        {heading}
        <Card>
          <p className="text-[13px] text-fg-muted">
            Couldn&rsquo;t load the required-documents checklist.{" "}
            <button
              className="text-olive underline"
              onClick={() => void load(scope.programId, scope.cohortId, true)}
            >
              Retry
            </button>
          </p>
        </Card>
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="flex flex-col gap-3">
        {heading}
        <Card>
          <p className="text-[13px] text-fg-muted">Loading the checklist&hellip;</p>
        </Card>
      </div>
    );
  }

  const isVc = payload.edition === "vc";

  return (
    <div className="flex flex-col gap-3">
      {heading}

      {/* ── 1. Scope ── */}
      <Card>
        <CardTitle icon={<Folders className="h-3.5 w-3.5" />}>
          {isVc ? "Fund" : "Program / cohort"}
        </CardTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="u-label">{isVc ? "Fund" : "Program"}</span>
            <select
              className={inputClass}
              aria-label={isVc ? "Fund" : "Program"}
              value={scopeKey}
              onChange={(e) => setScopeKey(e.target.value)}
            >
              <option value="">
                {isVc ? "All funds — the default checklist" : "All programs — the default checklist"}
              </option>
              {programs.map((p) => [
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>,
                ...(p.cohorts ?? []).map((co) => (
                  <option key={co.id} value={`${p.id}/${co.id}`}>
                    {p.name} &middot; {co.name}
                  </option>
                )),
              ])}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="u-label">Applies to</span>
            <select
              className={inputClass}
              aria-label="Applies to"
              value={applyTo}
              onChange={(e) => setApplyTo(e.target.value as DocumentApplyTo)}
            >
              {DOCUMENT_APPLY_TO.map((v) => (
                <option key={v} value={v}>
                  {DOCUMENT_APPLY_TO_LABELS[v]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {payload.inherited && (
          <p className="mt-2 text-[11.5px] text-fg-muted" data-testid="checklist-inherited">
            <Info className="mr-1 inline h-3 w-3" />
            This {isVc ? "fund" : "program"} has no list of its own yet, so it shows the{" "}
            {isVc ? "edition" : "organisation"} default. Saving here creates its own.
          </p>
        )}
      </Card>

      {/* ── 2. The checklist ── */}
      <Card>
        <CardTitle icon={<FileCheck className="h-3.5 w-3.5" />} chip="Mandatory when ON">
          Checklist
        </CardTitle>
        {draft.length === 0 ? (
          <p className="py-3 text-[13px] text-fg-muted" data-testid="checklist-empty">
            No documents on this checklist — a sign-up would ask the founder for nothing. Add the
            first one below.
          </p>
        ) : (
          <ul>
            {draft.map((item) => (
              <li
                key={item.key}
                className="flex flex-wrap items-center gap-3 border-b border-line py-2.5 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <input
                    className={`${inputClass} font-semibold`}
                    aria-label={`Document name ${item.name || "new"}`}
                    value={item.name}
                    placeholder="Certificate of incorporation"
                    onChange={(e) => setItem(item.key, { name: e.target.value })}
                  />
                  <input
                    className={`${inputClass} mt-1`}
                    aria-label={`${item.name || "New document"} sub-label`}
                    value={item.note}
                    placeholder="PDF · one file"
                    onChange={(e) => setItem(item.key, { note: e.target.value })}
                  />
                </div>
                <Toggle
                  checked={item.mandatory}
                  label={item.name || "New document"}
                  onChange={(v) => setItem(item.key, { mandatory: v })}
                />
                <button
                  type="button"
                  aria-label={`Remove ${item.name || "new document"}`}
                  className="text-fg-muted hover:text-signal-flagged"
                  onClick={() => {
                    touched.current = true;
                    setDraft((d) => d.filter((i) => i.key !== item.key));
                    setError(null);
                    setNote(null);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3">
          <Button
            size="sm"
            onClick={() => {
              touched.current = true;
              setDraft((d) => [
                ...d,
                { id: null, name: "", note: "", mandatory: true, key: newKey() },
              ]);
              setError(null);
              setNote(null);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            Add document
          </Button>
        </div>
      </Card>

      <p
        className="rounded-lg px-3 py-2.5 text-[12px] text-fg-muted"
        style={{ background: "var(--color-olive-lt, rgba(74,102,68,0.09))" }}
      >
        On an individual sign-up the team can still add extra items or waive one (with a reason)
        &mdash; this list is the per-{isVc ? "fund" : "program"} default. A removed item is retired,
        not deleted: sign-ups that already inherited it keep their copy.
      </p>

      {error && (
        <p className="text-[13px] text-signal-flagged" role="alert">
          {error}
        </p>
      )}
      {note && <p className="text-[13px] text-positive">{note}</p>}

      {/* ── 3. The lifecycle ── */}
      <Card>
        <CardTitle icon={<FileText className="h-3.5 w-3.5" />}>Sign-up document status</CardTitle>
        <p className="mb-2 text-[11.5px] text-fg-muted">
          Each sign-up&rsquo;s inherited set. The founder attaches documents via their secure link
          &mdash; verify them here. A document moves one step at a time: Not requested &rarr;
          Awaiting &rarr; Submitted &rarr; Verified.
        </p>
        {payload.signups.length === 0 ? (
          <p className="py-2 text-[13px] text-fg-muted" data-testid="signups-empty">
            No sign-ups in this scope yet. The first startup to enter sign-up inherits the checklist
            above.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {payload.signups.map((set) => (
              <li
                key={set.signupId}
                className="rounded-[10px] border border-line p-3"
                data-testid={`signup-set-${set.signupId}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold text-fg">{set.startup}</span>
                  <span className="text-[11.5px] text-fg-muted">
                    {[set.programName, set.cohortName].filter(Boolean).join(" · ") ||
                      "No program yet"}
                  </span>
                  <span className="ml-auto text-[11px] text-fg-muted">
                    Roll-up: <strong className="text-fg">{set.documentsStatus}</strong>
                  </span>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={set.verifiable === 0 || busy !== null}
                    title={
                      set.verifiable === 0
                        ? "Nothing submitted yet — a bulk verify would have to skip the lifecycle."
                        : undefined
                    }
                    onClick={() => void verifyAll(set)}
                  >
                    {busy === set.signupId ? "Verifying…" : "Verify all documents"}
                  </Button>
                </div>
                <ul className="mt-1">
                  {set.items.map((item) => (
                    <li
                      key={item.id}
                      className="flex flex-wrap items-center gap-2 border-b border-line py-2 last:border-0"
                    >
                      <span className="min-w-0 flex-1 text-[13px] text-fg">
                        {item.name}
                        {item.mandatory ? (
                          <span className="ml-1 text-[9.5px] text-signal-flagged">required</span>
                        ) : (
                          <span className="ml-1 text-[9.5px] text-fg-muted">optional</span>
                        )}
                        {item.waived && item.waivedReason && (
                          <span className="ml-1 text-[9.5px] text-fg-muted">
                            &mdash; {item.waivedReason}
                          </span>
                        )}
                      </span>
                      <StatusBadge status={item.status} waived={item.waived} />
                      {item.next.map((to) => (
                        <Button
                          key={to}
                          size="sm"
                          disabled={busy !== null}
                          onClick={() => void move(set, item, to)}
                        >
                          {actionLabel(item.status, to)}
                        </Button>
                      ))}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/**
 * What the button that performs a move is called, in the admin's language.
 * Keyed on BOTH ends, because `→ awaiting` is two different acts depending on
 * where it starts: asking for a document that was never requested, and sending
 * a wrong one back.
 */
function actionLabel(from: DocumentStatus, to: DocumentStatus): string {
  if (to === "awaiting") return from === "submitted" ? "Send back" : "Request";
  if (to === "not_requested") return "Stand down";
  if (to === "submitted") return "Mark submitted";
  return "Verify";
}
