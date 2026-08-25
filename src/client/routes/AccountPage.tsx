import { useEffect, useState } from "react";
import { Card, Button, Badge } from "../components";
import { useAuth } from "../auth/useAuth";
import { getConfigSummary, updateMyTitle } from "../api";
import { roleLabel, editionLabel } from "../../shared/roles";
import { PLAN_LABELS, type Plan } from "../../shared/plans";

/**
 * My account (Session 4). Every signed-in team member sees their own profile —
 * name, role, workspace and the org's current plan — and can sign out. Plan +
 * org name come from the safe config summary any authed user may read.
 */
export function AccountPage() {
  const { user, logout, updateUser } = useAuth();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  // Aug-2026 issue 1 — your organizational alias title.
  const [title, setTitle] = useState(user?.title ?? "");
  const [savingTitle, setSavingTitle] = useState(false);
  const [titleMsg, setTitleMsg] = useState<string | null>(null);

  useEffect(() => {
    setTitle(user?.title ?? "");
  }, [user?.title]);

  async function saveTitle() {
    setSavingTitle(true);
    setTitleMsg(null);
    try {
      const res = await updateMyTitle(title);
      updateUser({ title: res.title });
      setTitleMsg(res.title ? "Saved — the top ribbon now shows your title." : "Title cleared.");
    } catch {
      setTitleMsg("Couldn't save your title. Try again.");
    } finally {
      setSavingTitle(false);
    }
  }

  useEffect(() => {
    getConfigSummary()
      .then((s) => {
        setPlan(s.plan);
        const name = s.branding && typeof s.branding.orgName === "string" ? s.branding.orgName : null;
        setOrgName(name);
      })
      .catch(() => {});
  }, []);

  if (!user) return null;

  const rows: Array<{ label: string; value: string }> = [
    { label: "Name", value: user.name },
    { label: "Platform role", value: roleLabel(user.edition, user.role) },
    { label: "Workspace", value: orgName ?? editionLabel(user.edition) },
    { label: "Edition", value: editionLabel(user.edition) },
  ];

  return (
    <div className="flex flex-col gap-5 p-5">
      <div>
        <h1 className="text-xl font-semibold text-fg">My account</h1>
        <p className="mt-0.5 text-sm text-fg-muted">Your profile and workspace details.</p>
      </div>

      <Card className="max-w-xl">
        <div className="flex items-center gap-3 border-b border-line pb-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-base font-semibold text-accent">
            {user.initials}
          </span>
          <div>
            <div className="text-base font-semibold text-fg">{user.name}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <Badge tone="info">{user.title ?? roleLabel(user.edition, user.role)}</Badge>
              {user.title && (
                <span className="text-xs text-fg-muted">{roleLabel(user.edition, user.role)}</span>
              )}
              {plan && <Badge tone="amber">{PLAN_LABELS[plan]} plan</Badge>}
            </div>
          </div>
        </div>

        <dl className="mt-4 flex flex-col gap-3">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between gap-4">
              <dt className="text-sm text-fg-muted">{r.label}</dt>
              <dd className="text-sm font-medium text-fg">{r.value}</dd>
            </div>
          ))}
        </dl>

        {/* Aug-2026 issue 1 — an organizational alias shown in place of the
            platform role. Your permissions are unchanged by what you type here. */}
        <div className="mt-5 border-t border-line pt-4">
          <label className="flex flex-col gap-1" htmlFor="alias-title">
            <span className="u-label">Organizational title</span>
            <span className="text-xs text-fg-muted">
              Shown in the top ribbon and on reports instead of &ldquo;
              {roleLabel(user.edition, user.role)}&rdquo;. Your permissions do not change — the
              platform role stays {roleLabel(user.edition, user.role)} in the background.
            </span>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <input
                id="alias-title"
                className="sj-input h-9 min-w-0 flex-1"
                maxLength={60}
                value={title}
                placeholder={`e.g. Head of Programs (leave blank to show "${roleLabel(user.edition, user.role)}")`}
                onChange={(e) => setTitle(e.target.value)}
              />
              <Button size="sm" disabled={savingTitle} onClick={saveTitle}>
                {savingTitle ? "Saving…" : "Save title"}
              </Button>
            </div>
          </label>
          {titleMsg && <p className="mt-2 text-xs text-fg-muted">{titleMsg}</p>}
        </div>

        <div className="mt-5 border-t border-line pt-4">
          <Button variant="secondary" size="sm" onClick={() => logout()}>
            Sign out
          </Button>
        </div>
      </Card>
    </div>
  );
}
