import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  FileText,
  Files,
  FormInput,
  GitBranch,
  ListOrdered,
  Paperclip,
  Plus,
  Trash2,
  Upload,
  X,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { Card, Button } from "../../components";
import { useAuth } from "../../auth/useAuth";
import { useAdminSave } from "./saveContext";
import {
  describeFlowError,
  describeMergeFieldError,
  FLOW_ACTION_LABELS,
  FLOW_ACTIONS,
  flowActorLabel,
  flowActors,
  libraryBlurb,
  programmeNoun,
  TEMPLATE_STAGE_LABELS,
  TEMPLATE_STAGES,
  TEMPLATE_STATUS_LABELS,
  TEMPLATE_STATUSES,
  templateSummary,
  validateFlow,
  validateMergeFields,
  type AgreementTemplateView,
  type FlowAction,
  type FlowActor,
  type FlowStep,
  type MergeField,
  type ProgrammeOptionView,
  type TemplateStage,
  type TemplateStatus,
} from "../../../shared/agreements";

/**
 * Admin console → Sign-up → **Agreements library** (`admin/s-suagr.html`).
 *
 * The prototype is two halves: a `#su-list` of templates, each row a name with
 * an Active / Draft / Retired badge, the summary line
 * `<file> · <ver> · N merge fields · programs|unmapped`, and Edit · New version ·
 * Retire/Restore; and a `#su-editor` of four cards — Template file (replace,
 * version label, status), Merge fields (key / label / sample, add / remove),
 * Applies to (stage + one toggle per programme or fund), and Signing workflow
 * (ordered who × action, reorderable). Both halves are here, card for card.
 *
 * Two deliberate departures from the drawn behaviour, both recorded in the
 * plan's §8:
 *   - **Replace file is a real upload.** The prototype's button raises
 *     `alert('Choose a PDF or DOCX to replace the source file.')`; this posts the
 *     file to R2, keyed by template and version, so a retired template still
 *     has the document it was signed against.
 *   - **An unused draft can be deleted.** `suAdd()` creates a row on the click,
 *     before a name is typed, and the prototype offers no way to remove the
 *     mistake. Only a draft that has raised no agreement qualifies; anything
 *     that has been used can still only be retired, which is what keeps the
 *     library auditable.
 *
 * The VC edition differs in one word — templates map to **funds**, not
 * programmes — which `programmeNoun` supplies.
 */

// ── Small prototype primitives ───────────────────────────────────────────────

/** The `.ab` badge: `.ab-c` green for Active, `.ab-p` amber for Draft, grey retired. */
const STATUS_PILLS: Record<TemplateStatus, { fg: string; bg: string }> = {
  active: { fg: "#166534", bg: "#DCFCE7" },
  draft: { fg: "#8A5B06", bg: "#FBF0DA" },
  retired: { fg: "#8A8578", bg: "#EDEBE7" },
};

function StatusPill({ status }: { status: TemplateStatus }) {
  const pill = STATUS_PILLS[status];
  return (
    <span
      className="shrink-0 rounded-full px-2 py-[2px] text-[11px] font-medium"
      style={{ color: pill.fg, background: pill.bg }}
    >
      {TEMPLATE_STATUS_LABELS[status]}
    </span>
  );
}

function CardTitle({
  icon,
  children,
  count,
}: {
  icon: ReactNode;
  children: ReactNode;
  count?: number;
}) {
  return (
    <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-fg">
      <span style={{ color: "var(--ac-olive, #4A6644)" }}>{icon}</span>
      {children}
      {count !== undefined && (
        <span className="rounded-full bg-surface-2 px-2 py-[1px] text-[11px] font-medium text-fg-muted">
          {count}
        </span>
      )}
    </div>
  );
}

const inputClass =
  "h-8 w-full rounded-[7px] border border-line bg-surface px-2 text-item text-fg placeholder:text-fg-muted";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="u-label">{label}</span>
      {children}
    </label>
  );
}

/** The prototype's `.tog` switch, as used by the Applies-to programme rows. */
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
    <div className="flex items-center justify-between gap-4 border-b border-line py-2.5 last:border-0">
      <div className="min-w-0 text-[13px] font-medium text-fg">{label}</div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className="inline-flex h-[18px] w-[34px] shrink-0 items-center rounded-full p-[2px] transition-colors"
        style={{ background: checked ? "var(--ac-olive, #4A6644)" : "var(--color-line)" }}
      >
        <span
          className="h-[14px] w-[14px] rounded-full bg-white transition-transform"
          style={{ transform: checked ? "translateX(16px)" : "translateX(0)" }}
        />
      </button>
    </div>
  );
}

// ── Draft state ──────────────────────────────────────────────────────────────

/** Everything the editor can change for one template, before it is saved. */
interface Draft {
  name: string;
  version: string;
  status: TemplateStatus;
  stage: TemplateStage;
  fields: MergeField[];
  programIds: string[];
  flow: FlowStep[];
}

function draftOf(t: AgreementTemplateView): Draft {
  return {
    name: t.name,
    version: t.version,
    status: t.status,
    stage: t.stage,
    fields: t.fields.map((f) => ({ ...f })),
    programIds: [...t.programIds],
    flow: t.flow.map((s) => ({ ...s })),
  };
}

function sameDraft(a: Draft, b: Draft): boolean {
  return (
    a.name === b.name &&
    a.version === b.version &&
    a.status === b.status &&
    a.stage === b.stage &&
    a.fields.length === b.fields.length &&
    a.fields.every(
      (f, i) =>
        f.key === b.fields[i].key &&
        f.label === b.fields[i].label &&
        (f.sample ?? "") === (b.fields[i].sample ?? ""),
    ) &&
    a.programIds.length === b.programIds.length &&
    a.programIds.every((p) => b.programIds.includes(p)) &&
    a.flow.length === b.flow.length &&
    a.flow.every((s, i) => s.actor === b.flow[i].actor && s.action === b.flow[i].action)
  );
}

interface LibraryPayload {
  templates: Array<AgreementTemplateView & { summary: string }>;
  programmes: ProgrammeOptionView[];
}

// The section fetches directly rather than through `src/client/api.ts`: that
// file is shared by every wave and this session owns none of it (§2.2). The
// same accommodation `CrmSync.tsx` makes, and recorded in §9 the same way.
async function fetchLibrary(): Promise<LibraryPayload> {
  const r = await fetch("/api/esign/templates");
  if (!r.ok) throw new Error(`esign: ${r.status}`);
  return (await r.json()) as LibraryPayload;
}

async function send(method: string, path: string, body?: unknown): Promise<unknown> {
  const r = await fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(String(payload.message ?? payload.error ?? `esign: ${r.status}`));
  return payload;
}

// ── The section ──────────────────────────────────────────────────────────────

export function AgreementsLibrarySection() {
  const { user } = useAuth();
  const edition = user?.edition ?? "incubator";
  const noun = programmeNoun(edition);
  const actors = useMemo(() => flowActors(edition), [edition]);

  const [templates, setTemplates] = useState<LibraryPayload["templates"] | null>(null);
  const [programmes, setProgrammes] = useState<ProgrammeOptionView[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async (reopen?: string) => {
    try {
      const payload = await fetchLibrary();
      setTemplates(payload.templates);
      setProgrammes(payload.programmes);
      setLoadError(false);
      if (reopen) {
        const fresh = payload.templates.find((t) => t.id === reopen);
        if (fresh) setDraft(draftOf(fresh));
      }
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const current = useMemo(
    () => templates?.find((t) => t.id === openId) ?? null,
    [templates, openId],
  );

  const dirty = useMemo(
    () => (current && draft ? !sameDraft(draft, draftOf(current)) : false),
    [current, draft],
  );

  const patch = useCallback((next: Partial<Draft>) => {
    setDraft((d) => (d ? { ...d, ...next } : d));
    setError(null);
    setNote(null);
  }, []);

  const open = useCallback((t: AgreementTemplateView) => {
    setOpenId(t.id);
    setDraft(draftOf(t));
    setError(null);
    setNote(null);
  }, []);

  const close = useCallback(() => {
    setOpenId(null);
    setDraft(null);
    setError(null);
  }, []);

  const save = useCallback(async () => {
    if (!openId || !draft) return;
    const fieldCheck = validateMergeFields(draft.fields);
    if (!fieldCheck.ok) {
      setError(describeMergeFieldError(fieldCheck));
      return;
    }
    const flowCheck = validateFlow(draft.flow);
    if (!flowCheck.ok) {
      setError(describeFlowError(flowCheck));
      return;
    }
    setBusy("save");
    setError(null);
    try {
      await send("PUT", `/api/esign/templates/${openId}`, {
        name: draft.name,
        version: draft.version,
        status: draft.status,
        stage: draft.stage,
        fields: fieldCheck.fields,
        programIds: draft.programIds,
        flow: flowCheck.steps,
      });
      await load(openId);
      setNote(`Template "${draft.name}" saved.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the template.");
    } finally {
      setBusy(null);
    }
  }, [openId, draft, load]);

  useAdminSave({
    dirty,
    saving: busy === "save",
    hint: openId ? "No template changes to save" : "Open a template to edit it",
    onSave: save,
  });

  const act = useCallback(
    async (id: string, path: string, label: string) => {
      setBusy(`${path}:${id}`);
      setError(null);
      setNote(null);
      try {
        await send("POST", `/api/esign/templates/${id}/${path}`);
        await load(openId === id ? id : undefined);
        setNote(label);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't apply that.");
      } finally {
        setBusy(null);
      }
    },
    [load, openId],
  );

  const addTemplate = useCallback(async () => {
    setBusy("add");
    setError(null);
    setNote(null);
    try {
      const res = (await send("POST", "/api/esign/templates", {})) as {
        template: AgreementTemplateView;
      };
      await load();
      open(res.template);
      setNote("Draft template created. Upload its source file and mark its merge fields.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add a template.");
    } finally {
      setBusy(null);
    }
  }, [load, open]);

  const removeTemplate = useCallback(
    async (t: AgreementTemplateView) => {
      setBusy(`delete:${t.id}`);
      setError(null);
      setNote(null);
      try {
        await send("DELETE", `/api/esign/templates/${t.id}`);
        if (openId === t.id) close();
        await load();
        setNote(`Unused draft "${t.name}" deleted.`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't delete that template.");
      } finally {
        setBusy(null);
      }
    },
    [load, openId, close],
  );

  const uploadFile = useCallback(
    async (file: File) => {
      if (!openId) return;
      setBusy("upload");
      setError(null);
      setNote(null);
      try {
        const form = new FormData();
        form.append("file", file);
        const r = await fetch(`/api/esign/templates/${openId}/file`, {
          method: "POST",
          body: form,
        });
        const payload = (await r.json().catch(() => ({}))) as Record<string, unknown>;
        if (!r.ok) {
          throw new Error(String(payload.message ?? payload.error ?? `esign: ${r.status}`));
        }
        // Refresh the LIST (the file card reads `current`, not `draft`) but do
        // NOT re-seed the draft: an upload changes no editable field, and
        // re-seeding here silently discarded whatever the admin had typed but
        // not yet saved — including the template's name. `CrmSync.tsx` makes
        // the same promise about a refresh landing mid-edit.
        await load();
        setNote(`Source file uploaded: ${file.name}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't upload that file.");
      } finally {
        setBusy(null);
        if (fileInput.current) fileInput.current.value = "";
      }
    },
    [openId, load],
  );

  const heading = (
    <div>
      <h2 className="text-base font-semibold tracking-tight text-fg">Agreements library</h2>
      <p className="mt-0.5 max-w-3xl text-[13px] text-fg-muted">{libraryBlurb(edition)}</p>
    </div>
  );

  if (loadError) {
    return (
      <div className="flex flex-col gap-3">
        {heading}
        <Card>
          <p className="text-[13px] text-fg-muted">
            Couldn&rsquo;t load the agreements library.{" "}
            <button className="text-olive underline" onClick={() => void load()}>
              Retry
            </button>
          </p>
        </Card>
      </div>
    );
  }

  if (!templates) {
    return (
      <div className="flex flex-col gap-3">
        {heading}
        <Card>
          <p className="text-[13px] text-fg-muted">Loading agreement templates&hellip;</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {heading}

      {error && (
        <div role="alert" className="text-[13px] text-signal-flagged">
          {error}
        </div>
      )}
      {note && !error && <div className="text-[13px] text-positive">{note}</div>}

      <Card>
        <CardTitle icon={<Files className="h-3.5 w-3.5" />}>Templates</CardTitle>
        {templates.length === 0 ? (
          <p className="py-2 text-[13px] text-fg-muted">
            No agreement templates yet. Add one, upload its source file, and map it to a stage and{" "}
            {noun.plural} — sign-up has nothing to send until one is Active.
          </p>
        ) : (
          <ul className="flex flex-col">
            {templates.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center gap-3 border-b border-line py-2.5 last:border-0"
                style={t.status === "retired" ? { opacity: 0.6 } : undefined}
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: "var(--color-gold-lt, #FBF3E2)" }}
                >
                  <FileText
                    className="h-4 w-4"
                    style={{ color: "var(--color-gold-dk, #8A6512)" }}
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[13px] font-medium text-fg">
                    {t.name}
                    <StatusPill status={t.status} />
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-fg-muted">{t.summary}</div>
                </div>
                <Button size="sm" onClick={() => open(t)}>
                  Edit
                </Button>
                <Button
                  size="sm"
                  disabled={busy !== null}
                  onClick={() =>
                    void act(t.id, "version", `New draft version created for ${t.name}.`)
                  }
                >
                  New version
                </Button>
                {t.status === "retired" ? (
                  <Button
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => void act(t.id, "restore", `${t.name} restored as a Draft.`)}
                  >
                    Restore
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => void act(t.id, "retire", `${t.name} retired.`)}
                  >
                    Retire
                  </Button>
                )}
                {t.status === "draft" && t.agreementCount === 0 && (
                  <button
                    type="button"
                    aria-label={`Delete ${t.name}`}
                    title="Delete this unused draft"
                    className="text-fg-muted hover:text-signal-flagged"
                    disabled={busy !== null}
                    onClick={() => void removeTemplate(t)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3">
          <Button variant="primary" disabled={busy !== null} onClick={() => void addTemplate()}>
            <Upload className="h-3.5 w-3.5" />
            Add template
          </Button>
        </div>
      </Card>

      {current && draft && (
        <>
          <div className="mt-2 flex items-center gap-2">
            <h3 className="text-[13px] font-semibold text-fg">Editing: {current.name}</h3>
            <span className="flex-1" />
            <Button size="sm" onClick={close}>
              <X className="h-3.5 w-3.5" />
              Close
            </Button>
          </div>

          {/* Template file */}
          <Card>
            <CardTitle icon={<FileText className="h-3.5 w-3.5" />}>Template file</CardTitle>
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2">
                <Paperclip className="h-4 w-4 text-fg-muted" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-fg">
                  {current.fileName ?? "(no file yet)"}
                </div>
                <div className="mt-0.5 text-[11.5px] text-fg-muted">
                  {current.fileStored
                    ? `Uploaded source · ${current.version}`
                    : "No source file uploaded yet — merge fields have nothing to map into."}
                </div>
              </div>
              {current.fileStored && (
                <a
                  className="text-[13px] text-olive underline"
                  href={`/api/esign/templates/${current.id}/file`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open
                </a>
              )}
              <input
                ref={fileInput}
                type="file"
                aria-label="Template source file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadFile(file);
                }}
              />
              <Button size="sm" disabled={busy !== null} onClick={() => fileInput.current?.click()}>
                {busy === "upload"
                  ? "Uploading…"
                  : current.fileStored
                    ? "Replace file"
                    : "Upload file"}
              </Button>
            </div>
            <p className="mt-2 text-[11.5px] text-fg-muted">
              PDF or DOCX, up to 10 MB. The file is stored against this version, so a new version
              never overwrites the document an earlier one was signed against.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Field label="Template name">
                <input
                  className={inputClass}
                  aria-label="Template name"
                  value={draft.name}
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </Field>
              <Field label="Version label">
                <input
                  className={inputClass}
                  aria-label="Version label"
                  value={draft.version}
                  onChange={(e) => patch({ version: e.target.value })}
                />
              </Field>
              <Field label="Status">
                <select
                  className={inputClass}
                  aria-label="Status"
                  value={draft.status}
                  onChange={(e) => patch({ status: e.target.value as TemplateStatus })}
                >
                  {TEMPLATE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {TEMPLATE_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </Card>

          {/* Merge fields */}
          <Card>
            <CardTitle icon={<FormInput className="h-3.5 w-3.5" />} count={draft.fields.length}>
              Merge fields
            </CardTitle>
            <p className="mb-2 text-[11.5px] text-fg-muted">
              Each field becomes an editable blank filled during agreement prep. The key maps to the
              placeholder in the uploaded file.
            </p>
            {draft.fields.length === 0 ? (
              <p className="py-2 text-[13px] text-fg-muted">
                No merge fields — the &ldquo;Fill blanks&rdquo; step would have nothing to fill.
              </p>
            ) : (
              <table className="w-full text-item">
                <thead>
                  <tr className="border-b border-line text-left">
                    <th className="u-label py-1.5 font-normal">Field key</th>
                    <th className="u-label py-1.5 font-normal">Label</th>
                    <th className="u-label py-1.5 font-normal">Sample value</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {draft.fields.map((f, i) => (
                    <tr key={i} className="border-b border-line last:border-0">
                      <td className="py-1.5 pr-2">
                        <input
                          className={inputClass}
                          aria-label={`Field key ${i + 1}`}
                          value={f.key}
                          onChange={(e) =>
                            patch({
                              fields: draft.fields.map((x, n) =>
                                n === i ? { ...x, key: e.target.value } : x,
                              ),
                            })
                          }
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <input
                          className={inputClass}
                          aria-label={`Field label ${i + 1}`}
                          value={f.label}
                          onChange={(e) =>
                            patch({
                              fields: draft.fields.map((x, n) =>
                                n === i ? { ...x, label: e.target.value } : x,
                              ),
                            })
                          }
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <input
                          className={inputClass}
                          aria-label={`Sample value ${i + 1}`}
                          value={f.sample ?? ""}
                          onChange={(e) =>
                            patch({
                              fields: draft.fields.map((x, n) =>
                                n === i ? { ...x, sample: e.target.value } : x,
                              ),
                            })
                          }
                        />
                      </td>
                      <td className="py-1.5">
                        <button
                          type="button"
                          aria-label={`Remove field ${i + 1}`}
                          className="text-fg-muted hover:text-signal-flagged"
                          onClick={() =>
                            patch({ fields: draft.fields.filter((_, n) => n !== i) })
                          }
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="mt-2">
              <Button
                size="sm"
                onClick={() =>
                  patch({
                    fields: [...draft.fields, { key: "new_field", label: "New field", sample: null }],
                  })
                }
              >
                <Plus className="h-3.5 w-3.5" />
                Add field
              </Button>
            </div>
          </Card>

          {/* Applies to */}
          <Card>
            <CardTitle icon={<GitBranch className="h-3.5 w-3.5" />}>Applies to</CardTitle>
            <Field label="Stage">
              <select
                className={inputClass}
                aria-label="Stage"
                value={draft.stage}
                onChange={(e) => patch({ stage: e.target.value as TemplateStage })}
              >
                {TEMPLATE_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {TEMPLATE_STAGE_LABELS[s]}
                  </option>
                ))}
              </select>
            </Field>
            <div className="u-label mt-3">{noun.card}</div>
            {programmes.length === 0 ? (
              <p className="py-2 text-[13px] text-fg-muted">
                No active {noun.plural} to map to yet.
              </p>
            ) : (
              programmes.map((p) => (
                <Toggle
                  key={p.id}
                  label={p.name}
                  checked={draft.programIds.includes(p.id)}
                  onChange={(on) =>
                    patch({
                      programIds: on
                        ? [...draft.programIds, p.id]
                        : draft.programIds.filter((x) => x !== p.id),
                    })
                  }
                />
              ))
            )}
            <p className="mt-2 text-[11.5px] text-fg-muted">
              A template with no {noun.plural} mapped is the edition-wide default — it applies
              wherever nothing more specific does.
            </p>
          </Card>

          {/* Signing workflow */}
          <Card>
            <CardTitle icon={<ListOrdered className="h-3.5 w-3.5" />}>Signing workflow</CardTitle>
            <p className="mb-2 text-[11.5px] text-fg-muted">
              Order the steps: who fills the blanks, then the founder signs, then who countersigns.
              Steps run top to bottom.
            </p>
            {draft.flow.map((step, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 border-b border-line py-2 last:border-0">
                <span className="w-5 shrink-0 text-[11px] font-medium text-fg-muted">{i + 1}</span>
                <select
                  className={`${inputClass} min-w-[150px] flex-1`}
                  aria-label={`Step ${i + 1} who`}
                  value={step.actor}
                  onChange={(e) =>
                    patch({
                      flow: draft.flow.map((s, n) =>
                        n === i ? { ...s, actor: e.target.value as FlowActor } : s,
                      ),
                    })
                  }
                >
                  {actors.map((a) => (
                    <option key={a} value={a}>
                      {flowActorLabel(edition, a)}
                    </option>
                  ))}
                </select>
                <select
                  className={`${inputClass} min-w-[130px] flex-1`}
                  aria-label={`Step ${i + 1} action`}
                  value={step.action}
                  onChange={(e) =>
                    patch({
                      flow: draft.flow.map((s, n) =>
                        n === i ? { ...s, action: e.target.value as FlowAction } : s,
                      ),
                    })
                  }
                >
                  {FLOW_ACTIONS.map((a) => (
                    <option key={a} value={a}>
                      {FLOW_ACTION_LABELS[a]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label={`Move step ${i + 1} up`}
                  disabled={i === 0}
                  className="text-fg-muted hover:text-fg disabled:opacity-30"
                  onClick={() => patch({ flow: moved(draft.flow, i, -1) })}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Move step ${i + 1} down`}
                  disabled={i === draft.flow.length - 1}
                  className="text-fg-muted hover:text-fg disabled:opacity-30"
                  onClick={() => patch({ flow: moved(draft.flow, i, 1) })}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Remove step ${i + 1}`}
                  className="text-fg-muted hover:text-signal-flagged"
                  onClick={() => patch({ flow: draft.flow.filter((_, n) => n !== i) })}
                >
                  Remove
                </button>
              </div>
            ))}
            <div className="mt-2">
              <Button
                size="sm"
                onClick={() =>
                  patch({
                    flow: [
                      ...draft.flow,
                      {
                        actor: (actors[0] ?? "founder") as FlowActor,
                        action: "fill_blanks" as FlowAction,
                      },
                    ],
                  })
                }
              >
                <Plus className="h-3.5 w-3.5" />
                Add step
              </Button>
            </div>
          </Card>

          <div className="flex items-center gap-2">
            <Button variant="primary" disabled={!dirty || busy !== null} onClick={() => void save()}>
              {busy === "save" ? "Saving…" : "Save template"}
            </Button>
            <Button onClick={close}>Cancel</Button>
            <span className="text-[11.5px] text-fg-muted">
              {templateSummary({
                fileName: current.fileName,
                version: draft.version,
                fields: draft.fields,
                programNames: programmes
                  .filter((p) => draft.programIds.includes(p.id))
                  .map((p) => p.name),
              })}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/** ↑ / ↓ on one step (`suMove`). Out-of-range moves are no-ops. */
function moved(flow: FlowStep[], i: number, delta: number): FlowStep[] {
  const j = i + delta;
  if (j < 0 || j >= flow.length) return flow;
  const next = flow.map((s) => ({ ...s }));
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
