import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { UserCheck, Users, Signature, Plus } from "lucide-react";
import { Card, Button } from "../../components";
import { useAuth } from "../../auth/useAuth";
import { useAdminSave } from "./saveContext";
import {
  assignableOptions,
  roleOptionLabel,
  signatoriesBlurb,
  userOptionLabel,
  type SignatoryPool,
} from "../../../shared/agreements";

/**
 * Admin console → Sign-up → **Authorised signatories** (`admin/s-susign.html`).
 *
 * Two cards of `.tog-row` switches — By role, and Named individuals — and the
 * subtitle that makes them load-bearing: "Only those enabled here appear in the
 * sign-up countersign picker." The **countersign picker** panel below is that
 * sentence, made visible: it renders the exact projection the sign-up workspace
 * reads, so an administrator can see the consequence of a toggle without
 * leaving the console. Nothing else on either screen tells them.
 *
 * The prototype's "Add individual" opens nothing — there is no form behind it.
 * Here the named-individual list is the staff roster itself (a signatory has to
 * be a user of this workspace to sign as one), so "Add individual" reveals the
 * people who are not yet granted rather than asking for a name that would have
 * no account behind it. Recorded in the plan's §8.
 *
 * The VC edition differs only in its role names and in "firm's" for
 * "organisation's", both of which come from the shared vocabulary.
 */

function CardTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-fg">
      <span style={{ color: "var(--ac-olive, #4A6644)" }}>{icon}</span>
      {children}
    </div>
  );
}

/** The prototype's `.tog-row`: a name, an optional sub-line, and a `.tog`. */
function GrantRow({
  label,
  sub,
  checked,
  onChange,
}: {
  label: string;
  sub?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line py-2.5 last:border-0">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-fg">{label}</div>
        {sub && <div className="mt-0.5 text-[11.5px] text-fg-muted">{sub}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className="mt-0.5 inline-flex h-[18px] w-[34px] shrink-0 items-center rounded-full p-[2px] transition-colors"
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

interface Draft {
  roles: Record<string, boolean>;
  users: Record<string, boolean>;
}

function draftOf(pool: SignatoryPool): Draft {
  return {
    roles: Object.fromEntries(pool.roles.map((r) => [r.role, r.enabled])),
    users: Object.fromEntries(pool.users.map((u) => [u.userId, u.enabled])),
  };
}

function sameDraft(a: Draft, b: Draft): boolean {
  const keys = (d: Draft) => [
    ...Object.keys(d.roles).map((k) => `r:${k}`),
    ...Object.keys(d.users).map((k) => `u:${k}`),
  ];
  if (keys(a).length !== keys(b).length) return false;
  return (
    Object.entries(a.roles).every(([k, v]) => b.roles[k] === v) &&
    Object.entries(a.users).every(([k, v]) => b.users[k] === v)
  );
}

/** A pool with the draft's toggles applied, for the live picker preview. */
function withDraft(pool: SignatoryPool, draft: Draft): SignatoryPool {
  return {
    roles: pool.roles.map((r) => ({ ...r, enabled: draft.roles[r.role] ?? r.enabled })),
    users: pool.users.map((u) => ({ ...u, enabled: draft.users[u.userId] ?? u.enabled })),
  };
}

// Fetched directly rather than through `src/client/api.ts` (§2.2 — not this
// session's file); the same accommodation `CrmSync.tsx` makes.
async function fetchPool(): Promise<SignatoryPool> {
  const r = await fetch("/api/esign/signatories");
  if (!r.ok) throw new Error(`esign: ${r.status}`);
  return ((await r.json()) as { pool: SignatoryPool }).pool;
}

export function AuthorisedSignatoriesSection() {
  const { user } = useAuth();
  const edition = user?.edition ?? "incubator";

  const [pool, setPool] = useState<SignatoryPool | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async (reset?: boolean) => {
    try {
      const next = await fetchPool();
      setPool(next);
      // Never blanket-overwrite an edit in flight — the mount effect is
      // double-invoked under StrictMode.
      setDraft((d) => (d === null || reset ? draftOf(next) : d));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(
    () => (pool && draft ? !sameDraft(draft, draftOf(pool)) : false),
    [pool, draft],
  );

  const preview = useMemo(
    () => (pool && draft ? assignableOptions(withDraft(pool, draft)) : null),
    [pool, draft],
  );

  const save = useCallback(async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setNote(null);
    try {
      const r = await fetch("/api/esign/signatories", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const payload = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok) throw new Error(String(payload.message ?? payload.error ?? `esign: ${r.status}`));
      await load(true);
      setNote("Authorised signatories saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the signatories.");
    } finally {
      setSaving(false);
    }
  }, [draft, load]);

  useAdminSave({
    dirty,
    saving,
    hint: "No signatory changes to save",
    onSave: save,
  });

  const setRole = useCallback((role: string, enabled: boolean) => {
    setDraft((d) => (d ? { ...d, roles: { ...d.roles, [role]: enabled } } : d));
    setError(null);
    setNote(null);
  }, []);

  const setUser = useCallback((userId: string, enabled: boolean) => {
    setDraft((d) => (d ? { ...d, users: { ...d.users, [userId]: enabled } } : d));
    setError(null);
    setNote(null);
  }, []);

  const heading = (
    <div>
      <h2 className="text-base font-semibold tracking-tight text-fg">Authorised signatories</h2>
      <p className="mt-0.5 max-w-3xl text-[13px] text-fg-muted">{signatoriesBlurb(edition)}</p>
    </div>
  );

  if (loadError) {
    return (
      <div className="flex flex-col gap-3">
        {heading}
        <Card>
          <p className="text-[13px] text-fg-muted">
            Couldn&rsquo;t load the authorised signatories.{" "}
            <button className="text-olive underline" onClick={() => void load(true)}>
              Retry
            </button>
          </p>
        </Card>
      </div>
    );
  }

  if (!pool || !draft || !preview) {
    return (
      <div className="flex flex-col gap-3">
        {heading}
        <Card>
          <p className="text-[13px] text-fg-muted">Loading authorised signatories&hellip;</p>
        </Card>
      </div>
    );
  }

  const granted = pool.users.filter((u) => draft.users[u.userId] ?? u.enabled);
  const ungranted = pool.users.filter((u) => !(draft.users[u.userId] ?? u.enabled));
  const named = showAll ? pool.users : granted;

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
        <CardTitle icon={<Users className="h-3.5 w-3.5" />}>By role</CardTitle>
        {pool.roles.map((r) => (
          <GrantRow
            key={r.role}
            label={r.label}
            checked={draft.roles[r.role] ?? r.enabled}
            onChange={(v) => setRole(r.role, v)}
          />
        ))}
      </Card>

      <Card>
        <CardTitle icon={<UserCheck className="h-3.5 w-3.5" />}>Named individuals</CardTitle>
        {named.length === 0 ? (
          <p className="py-2 text-[13px] text-fg-muted">
            No named individuals granted. Grants by role above still apply.
          </p>
        ) : (
          named.map((u) => (
            <GrantRow
              key={u.userId}
              label={u.name}
              sub={u.roleLabel}
              checked={draft.users[u.userId] ?? u.enabled}
              onChange={(v) => setUser(u.userId, v)}
            />
          ))
        )}
        {!showAll && ungranted.length > 0 && (
          <div className="mt-3">
            <Button size="sm" onClick={() => setShowAll(true)}>
              <Plus className="h-3.5 w-3.5" />
              Add individual
            </Button>
            <p className="mt-2 text-[11.5px] text-fg-muted">
              {ungranted.length} more {ungranted.length === 1 ? "person" : "people"} in this
              workspace can be granted. A signatory signs as themselves, so they have to be a user
              here — add the person in Team &amp; roles first if they are not listed.
            </p>
          </div>
        )}
        {showAll && (
          <div className="mt-3">
            <Button size="sm" onClick={() => setShowAll(false)}>
              Show granted only
            </Button>
          </div>
        )}
      </Card>

      {/*
        The subtitle's promise, made visible. Without this the only way to see
        what a toggle did is to open a sign-up and look at the picker.
      */}
      <Card>
        <CardTitle icon={<Signature className="h-3.5 w-3.5" />}>
          The sign-up countersign picker
        </CardTitle>
        <p className="mb-2 text-[11.5px] text-fg-muted">
          Exactly what the sign-up workspace will offer. Countersigning stays disabled on a record
          until one of these is assigned to it.
        </p>
        {preview.byRole.length === 0 && preview.named.length === 0 ? (
          <p role="status" className="py-2 text-[13px] text-signal-flagged">
            Nobody is authorised — no agreement could be countersigned. Grant at least one role or
            one named individual above.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="u-label">Roles</div>
              {preview.byRole.length === 0 ? (
                <p className="py-1.5 text-[13px] text-fg-muted">None</p>
              ) : (
                <ul className="flex flex-col">
                  {preview.byRole.map((r) => (
                    <li key={r.role} className="py-1 text-[13px] text-fg">
                      {roleOptionLabel(r)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="u-label">Individuals</div>
              {preview.named.length === 0 ? (
                <p className="py-1.5 text-[13px] text-fg-muted">None</p>
              ) : (
                <ul className="flex flex-col">
                  {preview.named.map((u) => (
                    <li key={u.userId} className="py-1 text-[13px] text-fg">
                      {userOptionLabel(u)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
        {dirty && (
          <p className="mt-2 text-[11.5px] text-fg-muted">
            Unsaved — this preview reflects your changes, the workspace still reads the saved set.
          </p>
        )}
      </Card>
    </div>
  );
}
