import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Armchair,
  CircleCheck,
  Clock,
  Eye,
  File as FileIcon,
  FileText,
  Files,
  Forward,
  Info,
  Link as LinkIcon,
  Lock,
  Paperclip,
  Rocket,
  Signature,
  TriangleAlert,
  User,
  UserCheck,
  X,
} from "lucide-react";
import { Button } from "../components";
import { ApiError } from "../api";
import { useAuth } from "../auth/useAuth";
import {
  CERTIFICATE_CHIP,
  ESIGN_PROVIDERS,
  ESIGN_PROVIDER_LABELS,
  SIGNATURE_TYPES,
  SIGNATURE_TYPE_LABELS,
  SIGNATURE_TYPE_SHORT,
  countersignRefusal,
  describeCountersignRefusal,
  describeSigningMethod,
  isAssigned,
  roleOptionLabel,
  userOptionLabel,
  type SignatoryRoleGrant,
  type SignatoryUserGrant,
  type SigningMethod,
  type SigningMethodView,
} from "../../shared/agreements";
import {
  DOCUMENT_STATUS_BADGES,
  WAIVED_BADGE,
  type SignupDocumentView,
} from "../../shared/signupConfig";

/**
 * Spec §8.3 — the **three-tab sign-up workspace** (`AISJ_IC_SuserV15`
 * `_rest.html:1397` `#su-work`, rendered by `suwRender` / `suSignupBody` /
 * `suwDocs` / `suwFounder`), and the founder-facing pieces the founder portal
 * reuses so the Founder tab is literally the founder's screen.
 *
 * **One document set.** The Documents tab and the Founder tab render the SAME
 * `documents.items` from one `GET /api/signups/:id`, through one `DocumentRows`
 * component — never a copy per tab (§8.3: "The Documents tab and the Founder
 * tab share one document set").
 *
 * **No second rule.** Badge colours and labels are `DOCUMENT_STATUS_BADGES`;
 * whether an item can be attached is the server's `next`; whether the method is
 * editable is the server's `method.editable` and why not is `method.lockReason`;
 * the countersign sentence is `describeCountersignRefusal`. This file decides
 * layout, not state.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Wire shapes — `src/server/routes/signups.ts`
// ═══════════════════════════════════════════════════════════════════════════

/** `suSignupLabel` (`_scripts.js:1740`), for the statuses a `signups` row can hold. */
export const SIGNUP_STATUS_LABELS: Record<string, string> = {
  initiated: "Sign-up initiated",
  progress: "Sign-up in progress",
  completed: "Sign-up completed",
  onboarded: "Onboarded",
  archived: "Archived",
};

export interface WorkspaceDocument extends SignupDocumentView {
  hasFile: boolean;
}

export interface SignupWorkspaceView {
  signupId: string;
  deckId: string;
  startup: string;
  programName: string | null;
  cohortName: string | null;
  status: string;
  deckStatus: string;
  founderEmail: string | null;
  founderSignedAt: string | null;
  completedAt: string | null;
  agreement: { templateName: string | null; countersignedAt: string | null; countersignedBy: string | null };
  documents: {
    documentsStatus: "pending" | "partial" | "complete";
    verifiable: number;
    items: WorkspaceDocument[];
  };
  seat: { seatless: boolean; seated: boolean; allocatedAt: string | null };
  assignment: { userId: string | null; name: string | null } | null;
  readOnly: boolean;
  readOnlyReason: string | null;
  canAssign: boolean;
  programManagers: { id: string; name: string }[];
}

/** One pipeline row's worth — `GET /api/signups`. */
export interface SignupSummary {
  signupId: string;
  deckId: string;
  startup: string;
  status: string;
  deckStatus: string;
  founderSigned: boolean;
  documentsStatus: "pending" | "partial" | "complete";
  verifiable: number;
  seatless: boolean;
  seated: boolean;
  assignedName: string | null;
  readOnly: boolean;
}

/** `GET /api/esign/signups/:id/method` (`W5-B`). */
export interface MethodPayload {
  method: SigningMethodView;
  options: { byRole: SignatoryRoleGrant[]; named: SignatoryUserGrant[] };
  providerLabel: string;
  sigTypeLabel: string;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new ApiError(res.status, body);
  }
  return res.json() as Promise<T>;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body ?? {}),
});

export function listSignups(): Promise<{ signups: SignupSummary[] }> {
  return call("/api/signups");
}

export function listMySignups(): Promise<{ signups: SignupWorkspaceView[] }> {
  return call("/api/signups/mine");
}

function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "illegal_transition") {
      return "That document isn't waiting on a file — it has either been submitted already or wasn't requested.";
    }
    return err.message;
  }
  return "Something went wrong. Try again.";
}

// ═══════════════════════════════════════════════════════════════════════════
// Shared pieces — the Documents tab, the Founder tab and the founder portal
// ═══════════════════════════════════════════════════════════════════════════

/** `suwPill` — the one badge, from the one table. */
export function DocumentBadge({ item }: { item: Pick<SignupDocumentView, "status" | "waived"> }) {
  const pill = item.waived ? WAIVED_BADGE : DOCUMENT_STATUS_BADGES[item.status];
  return (
    <span
      data-testid={`doc-badge-${item.waived ? "waived" : item.status}`}
      className="shrink-0 rounded-full px-[9px] py-[3px] text-[10px] font-bold"
      style={{ color: pill.fg, background: pill.bg }}
    >
      {pill.label}
    </span>
  );
}

function AttachedPill() {
  return (
    <span className="shrink-0 rounded-full bg-green-lt px-[9px] py-[3px] text-[10px] font-bold text-green">
      Attached
    </span>
  );
}

/**
 * The document rows. `staff` is `suwDocs` (badge + View); `founder` and
 * `mirror` are `suwFounder` / `fpBuildSignup` (Attached, or Attach). Same rows,
 * same order, same keys, whichever tab renders them.
 */
export function DocumentRows({
  signupId,
  items,
  mode,
  busyId,
  onAttach,
}: {
  signupId: string;
  items: WorkspaceDocument[];
  mode: "staff" | "founder" | "mirror";
  busyId?: string | null;
  onAttach?: (item: WorkspaceDocument, file: File) => void;
}) {
  return (
    <ul data-testid={`signup-docs-${mode}`}>
      {items.map((item) => {
        const attached = item.hasFile || item.status === "submitted" || item.status === "verified";
        const attachable = !item.waived && item.next.includes("submitted");
        let right: ReactNode;
        if (mode === "staff") {
          right = (
            <>
              <DocumentBadge item={item} />
              {item.hasFile && (
                <a
                  className="inline-flex h-[26px] items-center rounded-[7px] border border-line bg-surface px-[10px] text-ui text-fg-2 hover:bg-surface-2"
                  href={`/api/signups/${signupId}/documents/${item.id}/file`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View
                </a>
              )}
            </>
          );
        } else if (attached) {
          right = <AttachedPill />;
        } else if (attachable) {
          right =
            mode === "founder" ? (
              <label
                className={`inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-[7px] bg-olive px-3 text-[12px] font-medium text-white hover:bg-olive-dk ${busyId ? "pointer-events-none opacity-50" : ""}`}
              >
                <Paperclip className="h-3.5 w-3.5" />
                {busyId === item.id ? "Attaching…" : "Attach"}
                <input
                  type="file"
                  className="sr-only"
                  aria-label={`Attach ${item.name}`}
                  accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) onAttach?.(item, file);
                  }}
                />
              </label>
            ) : (
              <span className="inline-flex h-[30px] items-center gap-1.5 rounded-[7px] border border-line px-3 text-[12px] text-fg-muted">
                <Paperclip className="h-3.5 w-3.5" /> Attach
              </span>
            );
        } else {
          right = <DocumentBadge item={item} />;
        }
        return (
          <li
            key={item.id}
            data-testid={`signup-doc-${item.id}`}
            className="flex items-center gap-2.5 border-b border-line py-[11px] last:border-0"
          >
            {mode === "staff" && (
              <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[7px] bg-offwhite text-fg-muted">
                <FileIcon className="h-4 w-4" />
              </span>
            )}
            <div className="min-w-0 flex-1 text-[13px] font-semibold text-fg">
              {item.name}{" "}
              <span className={`text-[9.5px] font-normal ${item.mandatory ? "text-red" : "text-fg-muted"}`}>
                {item.mandatory ? "required" : "optional"}
              </span>
            </div>
            {right}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * `suwFounderMethod` — "How you'll sign". Read-only by construction: it takes
 * the method and renders it; there is nothing here to change.
 */
export function FounderMethodMirror({ method }: { method: SigningMethod }) {
  const alternatives: string[] = [];
  if (method.inApp) alternatives.push("in-app signature");
  if (method.wetInk) alternatives.push("print & upload");
  return (
    <section data-testid="founder-method">
      <SectionTitle>How you'll sign</SectionTitle>
      <div className="mb-[18px] rounded-[10px] border border-stone-dk px-[13px] py-[11px] text-[12.5px] text-fg-2">
        <b className="inline-flex items-center gap-1 text-fg">
          <LinkIcon className="h-3 w-3" />
          Sign with {ESIGN_PROVIDER_LABELS[method.provider]}
        </b>{" "}
        · {SIGNATURE_TYPE_SHORT[method.sigType]}
        {method.sigType === "certificate" && (
          <span className="ml-1.5 rounded-[10px] bg-gold-lt px-[7px] py-0.5 text-[10px] text-gold-dk">
            {CERTIFICATE_CHIP}
          </span>
        )}
        {alternatives.length > 0 && (
          <div className="mt-1 text-[10.5px] text-fg-muted">
            Alternatives your team enabled: {alternatives.join(", ")}
          </div>
        )}
      </div>
    </section>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="mb-2 text-[11px] font-bold uppercase tracking-[.08em] text-fg-muted">{children}</div>;
}

/**
 * The founder's screen — `fpBuildSignup` in the portal, `suwFounder` on the
 * staff Founder tab. `mode="founder"` attaches and signs; `mode="mirror"` is the
 * same screen with nothing to press, because staff do not act as the founder.
 */
export function FounderSignupPanel({
  view,
  method,
  mode,
  onChanged,
}: {
  view: SignupWorkspaceView;
  method: SigningMethodView | null;
  mode: "founder" | "mirror";
  onChanged?: (next?: SignupWorkspaceView) => void;
}) {
  const [name, setName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = view.documents.items;
  const signed = view.founderSignedAt !== null || ["completed", "onboarded", "archived"].includes(view.status);

  async function attach(item: WorkspaceDocument, file: File) {
    setBusyId(item.id);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const next = await call<SignupWorkspaceView>(
        `/api/signups/${view.signupId}/documents/${item.id}/file`,
        { method: "POST", body: form },
      );
      onChanged?.(next);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusyId(null);
    }
  }

  async function sign() {
    // `fpSuSubmit`'s own check and sentence: every requested required item
    // attached, and a typed name.
    const outstanding = items.some(
      (i) => i.mandatory && !i.waived && !(i.hasFile || i.status === "submitted" || i.status === "verified"),
    );
    if (outstanding || !name.trim()) {
      setError("Attach all required documents and type your name to sign.");
      return;
    }
    setSigning(true);
    setError(null);
    try {
      await call(`/api/esign/signups/${view.signupId}/founder-signature`, json("POST"));
      onChanged?.();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSigning(false);
    }
  }

  return (
    <div className="max-w-[620px]">
      <SectionTitle>Attach required documents</SectionTitle>
      <div className="mb-[18px] rounded-xl border border-stone-dk bg-surface px-4 pb-3 pt-1">
        <DocumentRows signupId={view.signupId} items={items} mode={mode} busyId={busyId} onAttach={attach} />
      </div>

      <SectionTitle>Your agreement</SectionTitle>
      <div className="mb-[18px] rounded-[10px] border border-stone-dk bg-[#FCFBF8] p-3.5 text-[12.5px] leading-[1.7] text-[#33322c]">
        <div className="mb-0.5 text-center font-bold text-[#1A1E2E]">{view.agreement.templateName ?? "Agreement"}</div>
        <div className="mb-3 text-center text-[10px] uppercase tracking-[.1em] text-gold-dk">ai.STARTUPJURY</div>
        This Agreement is made between <b>ai.STARTUPJURY</b> and <b>{view.startup}</b>
        {view.programName && (
          <>
            , joining {[view.programName, view.cohortName].filter(Boolean).join(" · ")}
          </>
        )}
        , on the terms your team has prepared.
      </div>

      {method && <FounderMethodMirror method={method} />}

      <SectionTitle>Sign</SectionTitle>
      {signed ? (
        <div className="mt-1.5 flex items-center gap-2 text-[12.5px] font-semibold text-green">
          <CircleCheck className="h-4 w-4" /> Signed by the founder — submitted to the team.
        </div>
      ) : mode === "mirror" ? (
        <div className="flex items-center gap-2 text-[12px] text-fg-muted">
          <Clock className="h-4 w-4" /> Waiting for the founder to sign.
        </div>
      ) : (
        <>
          <input
            className="sj-input mb-2.5 mt-1.5 w-full"
            placeholder="Type your full name to sign"
            aria-label="Type your full name to sign"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button variant="primary" size="md" disabled={signing || busyId !== null} onClick={sign}>
            <Signature className="h-4 w-4" />
            {signing ? "Signing…" : method ? `Sign with ${ESIGN_PROVIDER_LABELS[method.provider]}` : "Submit & sign"}
          </Button>
        </>
      )}
      {error && (
        <div role="alert" className="mt-2 text-[12px] text-red">
          {error}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// The Agreement tab — `suSignupBody`
// ═══════════════════════════════════════════════════════════════════════════

type StageState = "done" | "active" | "pending";

/** `suStage` — one step of the four-step workflow. */
function Stage({
  icon,
  title,
  sub,
  state,
  children,
}: {
  icon: ReactNode;
  title: string;
  sub: string;
  state: StageState;
  children?: ReactNode;
}) {
  const ring =
    state === "done"
      ? "bg-green-lt text-green"
      : state === "active"
        ? "bg-olive text-white"
        : "bg-surface-2 text-fg-muted";
  return (
    <div data-testid={`stage-${title}`} data-state={state} className="flex gap-3 pb-4">
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${ring}`}>
        {state === "done" ? <CircleCheck className="h-4 w-4" /> : icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className={`text-[13px] font-semibold ${state === "pending" ? "text-fg-muted" : "text-fg"}`}>{title}</div>
        <div className="text-[11.5px] text-fg-muted">{sub}</div>
        {children}
      </div>
    </div>
  );
}

function CardShell({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <div className="mb-3.5 rounded-[10px] border border-stone-dk bg-surface p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[12px] font-bold text-fg">
        <span className="text-olive">
          {title === "Signing method" ? <Signature className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
        </span>
        {title} <span className="text-[10px] font-semibold text-fg-muted">· {note}</span>
      </div>
      {children}
    </div>
  );
}

function LockedLine({ icon, head, sub, testId }: { icon: ReactNode; head: string; sub: string; testId: string }) {
  return (
    <div
      data-testid={testId}
      className="mb-3.5 flex items-center gap-2.5 rounded-[10px] border border-stone-dk bg-offwhite px-3 py-[11px] text-[12px]"
    >
      <span className="text-fg-muted">{icon}</span>
      <div className="flex-1">
        <b className="text-fg">{head}</b>
        <div className="text-[10.5px] text-fg-muted">{sub}</div>
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <span className="inline-flex items-center gap-[7px] text-[11.5px] text-fg-2">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-block h-[19px] w-[34px] rounded-full transition-colors disabled:opacity-60 ${checked ? "bg-olive" : "bg-[#D8D6CE]"}`}
      >
        <span
          className="absolute top-[2px] h-[15px] w-[15px] rounded-full bg-white transition-all"
          style={{ left: checked ? 17 : 2 }}
        />
      </button>
      {label}
    </span>
  );
}

/**
 * `suMethodCard`. Editable while the SERVER says `method.editable`; otherwise
 * the locked line, whose sentence is `describeSigningMethod` and whose reason is
 * `method.lockReason`. The editable window (§8 Q61) is not restated here.
 */
export function MethodCard({
  method,
  readOnly,
  onSave,
}: {
  method: SigningMethodView;
  readOnly: boolean;
  onSave: (next: SigningMethod) => void;
}) {
  if (!method.editable) {
    return (
      <LockedLine
        testId="method-locked"
        icon={<Lock className="h-4 w-4" />}
        head={describeSigningMethod(method)}
        sub={method.lockReason ?? "Signing method locked"}
      />
    );
  }
  const current: SigningMethod = {
    provider: method.provider,
    sigType: method.sigType,
    inApp: method.inApp,
    wetInk: method.wetInk,
  };
  const select = "sj-input h-8 w-full py-0 text-[12px]";
  return (
    <div data-testid="method-editable">
      <CardShell title="Signing method" note="editable until the founder signs">
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-[3px] block text-[10.5px] text-fg-muted">eSign provider</span>
            <select
              className={select}
              aria-label="eSign provider"
              value={method.provider}
              disabled={readOnly}
              onChange={(e) => onSave({ ...current, provider: e.target.value as SigningMethod["provider"] })}
            >
              {ESIGN_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {ESIGN_PROVIDER_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-[3px] block text-[10.5px] text-fg-muted">Signature type</span>
            <select
              className={select}
              aria-label="Signature type"
              value={method.sigType}
              disabled={readOnly}
              onChange={(e) => onSave({ ...current, sigType: e.target.value as SigningMethod["sigType"] })}
            >
              {SIGNATURE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {SIGNATURE_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-[11px] flex gap-[18px]">
          <Toggle
            label="In-app signature"
            checked={method.inApp}
            disabled={readOnly}
            onChange={(v) => onSave({ ...current, inApp: v })}
          />
          <Toggle
            label="Print, scan & upload"
            checked={method.wetInk}
            disabled={readOnly}
            onChange={(v) => onSave({ ...current, wetInk: v })}
          />
        </div>
      </CardShell>
    </div>
  );
}

const CLOSED = ["completed", "onboarded", "archived"];

/**
 * `suAssignCard` — the countersignatory picker, a projection of the pool
 * (`options`, enabled grants only). Collapses to the read-only line once the
 * sign-up is completed: the countersignatory is history by then, not a setting.
 */
export function AssignCard({
  payload,
  status,
  readOnly,
  onAssign,
}: {
  payload: MethodPayload;
  status: string;
  readOnly: boolean;
  onAssign: (value: { role?: string; userId?: string }) => void;
}) {
  const { method, options } = payload;
  if (CLOSED.includes(status)) {
    return (
      <LockedLine
        testId="assign-locked"
        icon={<UserCheck className="h-4 w-4" />}
        head={isAssigned(method.assignment) ? method.assignmentLabel : "Not assigned"}
        sub="Countersignatory"
      />
    );
  }
  const value = method.assignment.userId
    ? `user:${method.assignment.userId}`
    : method.assignment.role
      ? `role:${method.assignment.role}`
      : "";
  return (
    <CardShell title="Authorised signatory" note="assign here — no admin console needed">
      <select
        className="sj-input h-8 w-full py-0 text-[12px]"
        aria-label="Authorised signatory"
        value={value}
        disabled={readOnly}
        onChange={(e) => {
          const [kind, id] = e.target.value.split(":");
          onAssign(kind === "user" ? { userId: id } : kind === "role" ? { role: id } : {});
        }}
      >
        <option value="">— Assign role or person —</option>
        <optgroup label="By role">
          {options.byRole.map((r) => (
            <option key={r.role} value={`role:${r.role}`}>
              {roleOptionLabel(r)}
            </option>
          ))}
        </optgroup>
        <optgroup label="Named individuals">
          {options.named.map((u) => (
            <option key={u.userId} value={`user:${u.userId}`}>
              {userOptionLabel(u)}
            </option>
          ))}
        </optgroup>
      </select>
      <div className="mt-1.5 text-[10.5px] text-fg-muted">Same pool as Admin → Authorised signatories.</div>
    </CardShell>
  );
}

/**
 * The Super User / Admin half of §8.3's assignment gate. The prototype shows the
 * PM's side (the amber banner, the locked pill) and not where the assignment is
 * made; this card is that place, shown only to the roles that may use it.
 */
function PmAssignCard({ view, onAssign }: { view: SignupWorkspaceView; onAssign: (userId: string | null) => void }) {
  return (
    <div className="mb-3.5 rounded-[10px] border border-stone-dk bg-surface p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[12px] font-bold text-fg">
        <User className="h-3.5 w-3.5 text-olive" />
        Program manager{" "}
        <span className="text-[10px] font-semibold text-fg-muted">· read-only for them until assigned</span>
      </div>
      <select
        className="sj-input h-8 w-full py-0 text-[12px]"
        aria-label="Assigned program manager"
        value={view.assignment?.userId ?? ""}
        onChange={(e) => onAssign(e.target.value || null)}
      >
        <option value="">— Not assigned —</option>
        {view.programManagers.map((pm) => (
          <option key={pm.id} value={pm.id}>
            {pm.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The seat card under the stages (`_scripts.js:2053-2058`). */
function SeatCard({ view, readOnly, onAllocate }: { view: SignupWorkspaceView; readOnly: boolean; onAllocate: () => void }) {
  if (view.seat.seated) {
    return (
      <div
        data-testid="seat-allocated"
        className="flex items-center gap-[9px] rounded-[10px] border border-[#BCE3CB] bg-[#E7F3EC] px-3 py-[11px] text-[12px] font-semibold text-[#047857]"
      >
        <Armchair className="h-4 w-4" />
        Seat allocated · founder access provisioned
      </div>
    );
  }
  return (
    <div
      data-testid="seatless"
      className="flex items-center gap-[9px] rounded-[10px] border border-[#EBC7C2] bg-[#FCEBEB] px-3 py-[11px] text-[12px]"
    >
      <span className="flex flex-1 items-center gap-1.5 font-semibold text-red">
        <TriangleAlert className="h-4 w-4" /> Seatless — no cohort seat allocated yet
      </span>
      <Button size="sm" disabled={readOnly} onClick={onAllocate}>
        Allocate seat
      </Button>
    </div>
  );
}

function AgreementTab({
  view,
  payload,
  busy,
  act,
  goFounder,
}: {
  view: SignupWorkspaceView;
  payload: MethodPayload;
  busy: boolean;
  act: (fn: () => Promise<unknown>) => void;
  goFounder: () => void;
}) {
  const { user } = useAuth();
  const { method, options } = payload;
  const status = view.status;
  const ro = view.readOnly;

  const founderDone = view.founderSignedAt !== null || CLOSED.includes(status);
  const verifyDone = CLOSED.includes(status);
  const sFound: StageState = founderDone ? "done" : "active";
  const sVer: StageState = verifyDone ? "done" : founderDone ? "active" : "pending";
  const sDone: StageState = verifyDone ? "done" : "pending";

  // The gate. The pool is the server's enabled projection, so a revoked grant
  // is simply absent and reads as `not_authorised` — the same answer the
  // countersign route would give.
  const refusal = user
    ? countersignRefusal({ roles: options.byRole, users: options.named }, method.assignment, {
        id: user.id,
        role: user.role,
      })
    : "no_signatory";

  const saveMethod = (next: SigningMethod) =>
    act(() => call(`/api/esign/signups/${view.signupId}/method`, json("PUT", next)));
  const assign = (value: { role?: string; userId?: string }) =>
    act(() => call(`/api/esign/signups/${view.signupId}/signatory`, json("PUT", value)));
  const assignPm = (userId: string | null) =>
    act(() => call(`/api/signups/${view.signupId}/assignee`, json("PUT", { userId })));
  const verifyAll = () => act(() => call(`/api/signups/${view.signupId}/documents/verify-all`, json("POST")));
  const countersign = () =>
    act(async () => {
      await call(`/api/esign/signups/${view.signupId}/countersign`, json("POST"));
      await call(`/api/signups/${view.signupId}/complete`, json("POST"));
    });
  const complete = () => act(() => call(`/api/signups/${view.signupId}/complete`, json("POST")));
  const allocate = () => act(() => call(`/api/signups/${view.signupId}/seat`, json("POST")));

  // Countersigned by esign, but the deck never left sign-up (the second call
  // failed) — offer the second half on its own rather than strand the record.
  const unfinished = status === "completed" && view.deckStatus === "signup";

  return (
    <div className="max-w-[600px]">
      <div className="mb-3 text-[11px] text-fg-muted">
        Sign-up workflow — status: <b className="text-fg">{SIGNUP_STATUS_LABELS[status] ?? status}</b>
      </div>
      <MethodCard method={method} readOnly={ro} onSave={saveMethod} />
      <AssignCard payload={payload} status={status} readOnly={ro} onAssign={assign} />
      {view.canAssign && <PmAssignCard view={view} onAssign={assignPm} />}

      <Stage
        icon={<Rocket className="h-4 w-4" />}
        title="Initiate"
        sub={`Link emailed · ${view.agreement.templateName ?? "no agreement template mapped yet"}`}
        state="done"
      />
      <Stage
        icon={<Forward className="h-4 w-4" />}
        title="Founder response"
        sub={
          founderDone
            ? "Founder attached documents & signed"
            : "Link sent — awaiting founder to attach docs & sign"
        }
        state={sFound}
      >
        {sFound === "active" && (
          <>
            <div className="mt-2.5 overflow-hidden rounded-[10px] border border-stone-dk">
              <div className="border-b border-line px-[11px] py-[9px] text-[11px] text-fg-muted">
                To: {view.founderEmail ?? "the founder"} · Subject: Complete your sign-up
              </div>
              <div className="px-[11px] py-2.5 text-[11.5px] text-fg-2">
                You&rsquo;ve been shortlisted
                {view.programName ? ` for ${[view.programName, view.cohortName].filter(Boolean).join(" · ")}` : ""}.
                Attach your documents and sign your agreement from your founder portal.
              </div>
            </div>
            <div className="mt-2">
              <Button variant="primary" size="sm" onClick={goFounder}>
                View founder screen
              </Button>
            </div>
          </>
        )}
      </Stage>
      <Stage
        icon={<Signature className="h-4 w-4" />}
        title="Verify & countersign"
        sub={
          verifyDone
            ? "Documents verified · countersigned"
            : sVer === "active"
              ? `Founder signed ✓ via ${payload.providerLabel} — verify & countersign`
              : "Verify documents, then countersign"
        }
        state={sVer}
      >
        {sVer === "active" && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {view.documents.documentsStatus !== "complete" && (
              <Button size="sm" disabled={busy || ro || view.documents.verifiable === 0} onClick={verifyAll}>
                Verify documents
              </Button>
            )}
            {refusal === null ? (
              <Button variant="primary" size="sm" disabled={busy || ro} onClick={countersign}>
                Countersign &amp; complete
              </Button>
            ) : (
              <span data-testid="countersign-refusal" className="flex items-center gap-1.5 text-[11.5px] text-fg-muted">
                <UserCheck className="h-3.5 w-3.5" /> {describeCountersignRefusal(refusal)}
              </span>
            )}
          </div>
        )}
      </Stage>
      <Stage
        icon={<CircleCheck className="h-4 w-4" />}
        title="Completed"
        sub="Signed PDF emailed with congratulations"
        state={sDone}
      >
        {sDone === "done" && (
          <>
            {view.agreement.countersignedBy && (
              <div className="my-2 flex items-center gap-2 text-[12px] font-semibold text-[#047857]">
                <UserCheck className="h-4 w-4" /> Countersigned by {view.agreement.countersignedBy}
              </div>
            )}
            {unfinished && (
              <div className="mt-2">
                <Button variant="primary" size="sm" disabled={busy || ro} onClick={complete}>
                  Move to Onboard ready
                </Button>
              </div>
            )}
          </>
        )}
      </Stage>
      {CLOSED.includes(status) && <SeatCard view={view} readOnly={ro || busy} onAllocate={allocate} />}
    </div>
  );
}

function DocumentsTab({
  view,
  busy,
  act,
  goAgreement,
}: {
  view: SignupWorkspaceView;
  busy: boolean;
  act: (fn: () => Promise<unknown>) => void;
  goAgreement: () => void;
}) {
  const { documentsStatus, verifiable, items } = view.documents;
  let action: ReactNode;
  if (documentsStatus === "complete") {
    action = (
      <div className="mt-3.5 flex items-center gap-2 text-[12px] font-semibold text-[#047857]">
        <CircleCheck className="h-4 w-4" /> All required documents verified.
      </div>
    );
  } else if (verifiable > 0) {
    action = (
      <div className="mt-3.5">
        <Button
          variant="primary"
          size="sm"
          disabled={busy || view.readOnly}
          onClick={() => act(() => call(`/api/signups/${view.signupId}/documents/verify-all`, json("POST")))}
        >
          Verify all documents
        </Button>
      </div>
    );
  } else if (items.every((i) => i.status === "not_requested")) {
    action = (
      <div className="mt-3.5 flex items-center gap-2 text-[12px] text-fg-muted">
        <Info className="h-4 w-4" /> Documents are requested once you initiate sign-up.
        <Button size="sm" onClick={goAgreement}>
          Go to Agreement
        </Button>
      </div>
    );
  } else {
    action = (
      <div className="mt-3.5 flex items-center gap-2 text-[12px] text-fg-muted">
        <Clock className="h-4 w-4" /> Waiting for the founder to attach documents via their portal.
      </div>
    );
  }
  return (
    <div className="max-w-[660px]">
      <div className="mb-1 text-[15px] font-bold text-fg">Documents to submit</div>
      <div className="mb-4 text-[12px] text-fg-muted">
        The founder attaches these from their founder portal — verify them here.
      </div>
      <div className="rounded-xl border border-stone-dk bg-surface px-4 pb-4 pt-1.5">
        <DocumentRows signupId={view.signupId} items={items} mode="staff" />
        {action}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// The overlay
// ═══════════════════════════════════════════════════════════════════════════

export type WorkspaceTab = "docs" | "agr" | "founder";

const TABS: { id: WorkspaceTab; label: string; icon: ReactNode }[] = [
  { id: "docs", label: "Documents", icon: <Files className="h-[13px] w-[13px]" /> },
  { id: "agr", label: "Agreement", icon: <FileText className="h-[13px] w-[13px]" /> },
  { id: "founder", label: "Founder", icon: <User className="h-[13px] w-[13px]" /> },
];

/**
 * `#su-work` — full-screen over the pipeline (`openSuWork`), three tabs over
 * one sign-up. `onChanged` lets the pipeline refresh its roll-up badge.
 */
export function SignupWorkspace({
  signupId,
  initialTab = "agr",
  onClose,
  onChanged,
}: {
  signupId: string;
  initialTab?: WorkspaceTab;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [tab, setTab] = useState<WorkspaceTab>(initialTab);
  const [view, setView] = useState<SignupWorkspaceView | null>(null);
  const [payload, setPayload] = useState<MethodPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const load = useCallback(async () => {
    try {
      const [v, m] = await Promise.all([
        call<SignupWorkspaceView>(`/api/signups/${signupId}`),
        call<MethodPayload>(`/api/esign/signups/${signupId}/method`),
      ]);
      setView(v);
      setPayload(m);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorText(err));
    }
  }, [signupId]);

  useEffect(() => {
    load();
  }, [load]);

  const act = useCallback(
    (fn: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      fn()
        .catch((err) => setError(errorText(err)))
        .then(() => load())
        .finally(() => {
          setBusy(false);
          onChangedRef.current?.();
        });
    },
    [load],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  let body: ReactNode;
  if (loadError) {
    body = (
      <div role="alert" className="text-[13px] text-red">
        {loadError}
      </div>
    );
  } else if (!view || !payload) {
    body = <div className="text-[13px] text-fg-muted">Loading sign-up…</div>;
  } else {
    const inner =
      tab === "docs" ? (
        <DocumentsTab view={view} busy={busy} act={act} goAgreement={() => setTab("agr")} />
      ) : tab === "founder" ? (
        <div className="max-w-[620px]">
          <div className="mb-4 flex items-center gap-2 rounded-[10px] border border-[#C9D8B8] bg-[#EBF0E4] px-3 py-2.5 text-[11.5px] text-[#3A5236]">
            <Eye className="h-4 w-4" /> Founder view — exactly what the founder sees and submits through their portal.
          </div>
          <FounderSignupPanel view={view} method={payload.method} mode="mirror" />
        </div>
      ) : (
        <AgreementTab view={view} payload={payload} busy={busy} act={act} goFounder={() => setTab("founder")} />
      );
    body = view.readOnly ? (
      <>
        <div
          data-testid="workspace-read-only"
          className="mb-4 flex items-center gap-2 rounded-[10px] border border-[#E8C77A] bg-[#FBF0DA] px-3 py-2.5 text-[11.5px] text-[#8A5B06]"
        >
          <Lock className="h-4 w-4" /> {view.readOnlyReason}
        </div>
        <div className="pointer-events-none opacity-[.72]">{inner}</div>
      </>
    ) : (
      inner
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Sign-up workflow"
      className="fixed inset-0 z-[9000] bg-[rgba(20,22,30,.5)]"
    >
      <div className="absolute inset-5 mx-auto flex max-w-[940px] flex-col overflow-hidden rounded-2xl bg-offwhite shadow-[0_30px_80px_-20px_rgba(0,0,0,.45)]">
        <div className="flex items-center gap-3 bg-[#4A5E3A] px-5 py-3.5 text-white">
          <span className="grid h-[30px] w-[30px] place-items-center rounded-lg bg-white/15">
            <Signature className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-[.1em] text-[#E8A020]">Sign-up workflow</div>
            <div data-testid="workspace-startup" className="text-[16px] font-bold">
              {view?.startup ?? "—"}
            </div>
          </div>
          {view && (
            <span data-testid="workspace-status" className="rounded-full bg-white/15 px-[11px] py-1 text-[11px] font-semibold">
              {SIGNUP_STATUS_LABELS[view.status] ?? view.status}
            </span>
          )}
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg bg-white/15 text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div role="tablist" className="flex gap-0.5 border-b border-line bg-surface px-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px flex items-center gap-[5px] border-b-2 px-3.5 py-2.5 text-[12.5px] font-semibold ${tab === t.id ? "border-olive text-fg" : "border-transparent text-fg-muted hover:text-fg"}`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto bg-offwhite p-[22px]">
          {error && (
            <div role="alert" className="mb-3 rounded-lg border border-red/30 bg-red-lt px-3 py-2 text-[12px] text-red">
              {error}
            </div>
          )}
          {body}
        </div>
      </div>
    </div>
  );
}
