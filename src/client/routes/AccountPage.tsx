import { useEffect, useState } from "react";
import { Card, Button, Badge } from "../components";
import { useAuth } from "../auth/useAuth";
import { getConfigSummary } from "../api";
import { roleLabel, editionLabel } from "../../shared/roles";
import { PLAN_LABELS, type Plan } from "../../shared/plans";

/**
 * My account (Session 4). Every signed-in team member sees their own profile —
 * name, role, workspace and the org's current plan — and can sign out. Plan +
 * org name come from the safe config summary any authed user may read.
 */
export function AccountPage() {
  const { user, logout } = useAuth();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);

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
    { label: "Role", value: roleLabel(user.edition, user.role) },
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
            <div className="mt-0.5 flex items-center gap-2">
              <Badge tone="info">{roleLabel(user.edition, user.role)}</Badge>
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

        <div className="mt-5 border-t border-line pt-4">
          <Button variant="secondary" size="sm" onClick={() => logout()}>
            Sign out
          </Button>
        </div>
      </Card>
    </div>
  );
}
