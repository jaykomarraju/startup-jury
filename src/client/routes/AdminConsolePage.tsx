import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Card, Button, Badge, EmptyState } from "../components";
import { useAuth } from "../auth/useAuth";
import { listUsers, createUser, updateUser, type InviteResult, type UserView } from "../api";
import { creatableStaffRoles, roleLabel, type Role } from "../../shared/roles";

/**
 * Admin console → Team & roles (Session 4). Super User / Admin manage the org's
 * users: jurors, staff and MENTORS. Mentor is a user-type (a directory/advisor
 * record with no pipeline authority), not a role. Creating a user issues a
 * one-time temporary password, which Session 8 EMAILS to them — the screen only
 * shows the password when that mail could not be delivered (no verified sending
 * domain configured yet), so the admin can still relay it.
 * Weights / branding / credits live on their own admin screens.
 */
export function AdminConsolePage() {
  const { user } = useAuth();
  const edition = user?.edition ?? "incubator";
  const [rows, setRows] = useState<UserView[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const roleOptions = useMemo(() => creatableStaffRoles(edition), [edition]);

  // Create form.
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [userType, setUserType] = useState<"staff" | "mentor">("staff");
  // Default to the least-privileged creatable role (never accidentally admin).
  const [role, setRole] = useState<Role>(roleOptions[roleOptions.length - 1]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    name: string;
    email: string;
    tempPassword?: string;
    invite: InviteResult;
  } | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  // Aug-2026 issue 1 — an admin may set anyone's organizational alias title.
  const [titleDraft, setTitleDraft] = useState<Record<string, string>>({});
  const [aliasTitle, setAliasTitle] = useState("");

  const load = useCallback(() => {
    return listUsers()
      .then((r) => setRows(r.users))
      .catch(() => setLoadError(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    setCreated(null);
    try {
      const res = await createUser({
        name,
        email,
        userType,
        role: userType === "staff" ? role : undefined,
        title: aliasTitle || undefined,
      });
      setCreated({
        name: res.user.name,
        email: res.user.email,
        tempPassword: res.tempPassword,
        invite: res.invite,
      });
      setName("");
      setEmail("");
      setAliasTitle("");
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setFormError(
        msg.includes("409")
          ? "That email already has an account."
          : "Couldn't create the user. Check the details and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(u: UserView) {
    setRowBusy(u.id);
    try {
      await updateUser(u.id, { active: !u.active });
      await load();
    } catch {
      /* surfaced by the row staying unchanged */
    } finally {
      setRowBusy(null);
    }
  }

  async function saveTitle(u: UserView) {
    const next = titleDraft[u.id] ?? u.title ?? "";
    setRowBusy(u.id);
    try {
      await updateUser(u.id, { title: next });
      setTitleDraft((d) => {
        const rest = { ...d };
        delete rest[u.id];
        return rest;
      });
      await load();
    } catch {
      /* the field keeps the unsaved value so nothing is silently lost */
    } finally {
      setRowBusy(null);
    }
  }

  const canManageRow = (u: UserView) => u.id !== user?.id && u.role !== "superuser";

  return (
    <div className="flex flex-col gap-5 p-5">
      <div>
        <h1 className="text-xl font-semibold text-fg">Admin console</h1>
        <p className="mt-0.5 max-w-2xl text-sm text-fg-muted">
          Manage your team — jurors, staff and mentors — and their roles. Rubric weights, branding and
          plan &amp; credits are on the Core Parameters and Buy credits screens.
        </p>
      </div>

      {/* Team roster */}
      <Card flush className="overflow-x-auto">
        <div className="u-label border-b border-line px-4 py-3">
          Team &amp; roles{rows ? ` · ${rows.length}` : ""}
        </div>
        {loadError ? (
          <div className="p-6">
            <EmptyState icon="Users" title="Couldn't load the team" description="Try reloading the page." />
          </div>
        ) : !rows ? (
          <p className="p-6 text-sm text-fg-muted">Loading team…</p>
        ) : (
          <table className="w-full min-w-[44rem] text-left">
            <thead>
              <tr className="text-fg-muted">
                <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Member</th>
                <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Role</th>
                <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">
                  Organizational title
                </th>
                <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Type</th>
                <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Status</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wide">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="border-t border-line">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent">
                        {u.initials}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-medium text-fg">{u.name}</div>
                        <div className="truncate text-xs text-fg-muted">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-fg-muted">{u.roleLabel}</td>
                  <td className="px-4 py-3">
                    {canManageRow(u) ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          className="sj-input h-8 w-40 py-0 text-sm"
                          maxLength={60}
                          aria-label={`Organizational title for ${u.name}`}
                          placeholder={u.roleLabel}
                          value={titleDraft[u.id] ?? u.title ?? ""}
                          onChange={(e) =>
                            setTitleDraft((d) => ({ ...d, [u.id]: e.target.value }))
                          }
                        />
                        {titleDraft[u.id] !== undefined &&
                          titleDraft[u.id] !== (u.title ?? "") && (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={rowBusy !== null}
                              onClick={() => saveTitle(u)}
                            >
                              Save
                            </Button>
                          )}
                      </div>
                    ) : (
                      <span className="text-sm text-fg-muted">{u.title ?? "—"}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {u.userType === "mentor" ? (
                      <Badge tone="info">Mentor</Badge>
                    ) : (
                      <span className="text-xs text-fg-muted">Team member</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {u.active ? (
                      <Badge tone="positive">Active</Badge>
                    ) : (
                      <Badge tone="neutral">Inactive</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      {canManageRow(u) ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={rowBusy !== null}
                          onClick={() => toggleActive(u)}
                        >
                          {rowBusy === u.id ? "…" : u.active ? "Deactivate" : "Activate"}
                        </Button>
                      ) : (
                        <span className="text-xs text-fg-muted">—</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Add a user */}
      <Card>
        <div className="u-label mb-4">Add a team member or mentor</div>

        {created && (
          <div className="mb-4 rounded-lg border border-positive/40 bg-positive/10 px-4 py-3 text-sm">
            <div className="font-medium text-fg">{created.name} added.</div>
            {created.invite.delivered ? (
              <p className="mt-1 text-fg-muted">
                We've emailed {created.email} a sign-in link and a one-time temporary password. They'll
                set their own password on first sign-in — nothing else for you to do.
              </p>
            ) : (
              <>
                <p className="mt-1 text-fg-muted">
                  {created.invite.status === "skipped"
                    ? "Email delivery isn't configured yet, so share this one-time temporary password with"
                    : "The invite email couldn't be delivered, so share this one-time temporary password with"}{" "}
                  {created.email} — they'll set their own on first sign-in:
                </p>
                <code className="mt-2 inline-block rounded bg-surface-2 px-2 py-1 font-mono text-sm text-fg">
                  {created.tempPassword}
                </code>
              </>
            )}
          </div>
        )}

        {formError && (
          <div className="mb-4 rounded-lg border border-signal-flagged/40 bg-signal-flagged/10 px-4 py-2.5 text-sm text-signal-flagged">
            {formError}
          </div>
        )}

        <form className="flex flex-col gap-4" onSubmit={submit}>
          <div className="flex flex-wrap gap-4">
            <label className="flex min-w-[12rem] flex-1 flex-col gap-1">
              <span className="text-xs font-medium text-fg-muted">Full name</span>
              <input
                className="sj-input h-9"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Priya Sharma"
                required
              />
            </label>
            <label className="flex min-w-[14rem] flex-1 flex-col gap-1">
              <span className="text-xs font-medium text-fg-muted">Work email</span>
              <input
                className="sj-input h-9"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="priya@yourorg.com"
                required
              />
            </label>
            <label className="flex min-w-[12rem] flex-1 flex-col gap-1">
              <span className="text-xs font-medium text-fg-muted">
                Organizational title <span className="font-normal">(optional)</span>
              </span>
              <input
                className="sj-input h-9"
                maxLength={60}
                value={aliasTitle}
                onChange={(e) => setAliasTitle(e.target.value)}
                placeholder="e.g. Head of Programs"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-fg-muted">User type</span>
              <select
                className="sj-input h-9"
                value={userType}
                onChange={(e) => setUserType(e.target.value as "staff" | "mentor")}
              >
                <option value="staff">Team member</option>
                <option value="mentor">Mentor</option>
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-fg-muted">Role</span>
              <select
                className="sj-input h-9 disabled:opacity-50"
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                disabled={userType === "mentor"}
              >
                {roleOptions.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(edition, r)}
                  </option>
                ))}
              </select>
            </label>

            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Adding…" : "Add user"}
            </Button>
          </div>

          {userType === "mentor" && (
            <p className="text-xs text-fg-muted">
              A mentor is an advisor recorded in your directory — no evaluation or pipeline access.
            </p>
          )}
        </form>
      </Card>
    </div>
  );
}
