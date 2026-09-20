import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Building2, CheckCircle2, Crown, Plus, ShieldAlert, TrendingUp } from "lucide-react";
import { Card, Button, Badge, EmptyState } from "../../components";
import { useAuth } from "../../auth/useAuth";
import {
  listUsers,
  createUser,
  updateUser,
  getConfigSummary,
  ApiError,
  type InviteResult,
  type UserView,
} from "../../api";
import {
  getPermissionGrid,
  putPermissionCells,
  deleteUser,
  resendInvite,
  transferOwnership,
  type PermissionGrid,
} from "./teamApi";
import { creatableStaffRoles, roleLabel, type Edition, type Role } from "../../../shared/roles";
import { PERMISSION_TASKS, PERMISSION_TASK_GROUPS } from "../../../shared/types";
import { PLANS, PLAN_LABELS, type Plan } from "../../../shared/plans";
import { setMemberTier } from "../../seatsApi";

/** `users.plan_tier`'s column default (`0052`): what a new member holds. */
const DEFAULT_TIER: Plan = "standard";

/**
 * Admin console → Organisation → **Team & roles** (prototype `admin/s-tm.html`).
 *
 * The prototype's four cards, in its order, plus one:
 *
 *   1. **Workspace type** — Incubator / Accelerator vs Investor.
 *   1b. **Account owner** — who owns the account, and the handover (F0062). The
 *      prototype puts the nomination flow on the Setup overlay (`#su-superbox`)
 *      and card 4's copy points at it ("can't be overridden *here*"); this is
 *      the half that belongs on this screen, and without it ownership was
 *      permanently whatever the seed created.
 *   2. **Active members (N)** — the roster, with the full invite lifecycle
 *      (pending · resend · cancel) and edit / activate / remove.
 *   3. **Roles & access — {workspace}** — the coloured role legend.
 *   4. **Task permissions — {workspace}** — the grid: 21 × 5 in the incubator
 *      edition, 24 × 6 in the investor one, three grouped row headers, coloured
 *      role pills as columns, click-to-toggle cells.
 *
 * ── What a cell means, and why the prototype's copy is not reproduced ────────
 *
 * The prototype says "Tap a cell to toggle access", which overstates it. W3-A
 * built the engine as a **gate, not a grant** (plan §8 Q8, binding): every call
 * site is `requireRole(...roles) AND can(task)`, so unticking a cell REMOVES a
 * capability and ticking it back RESTORES it — but ticking a cell for a role
 * that was never on that screen's role list in `nav.ts` grants nothing at all.
 * The card says so in one line of sub-copy, because a person deciding who may
 * do what needs that sentence before they click, not inside a tooltip.
 *
 * ── Two refusals rendered rather than left to 403 ────────────────────────────
 *
 * `PUT /api/permissions` refuses `immutable_superuser` (the account's single
 * owner) and `cannot_lock_yourself_out` (closing your own `adminconsole`). Both
 * are enforced server-side and asserted in `test/worker/permissions.test.ts`;
 * the screen must not offer what the API will refuse, so the whole superuser
 * column is read-only and the caller's own console cell is inert, each with the
 * reason on the control itself.
 *
 * ── Rows with no verb behind them (§8 Q27) ──────────────────────────────────
 *
 * Four rows — Register, Reassign / Resubmit, Remind, Out of office delegation —
 * are vocabulary the prototype names and the product has no action for yet.
 * They render and they persist, because the seed is real and the sessions that
 * build those verbs will consult them; they carry a "Not enforced yet" marker
 * so nobody reads a tick as protection that exists today. `PermissionTask.note`
 * carries the reason for each.
 */

// ── Role colour, from the prototype's `tmRC` pairs ───────────────────────────
//
// `admin/_scripts.js:83-94` colours each role chip [background, foreground].
// The prototype's role NAMES are its own ("Client admin", "Managing
// Partner/Super user"); this application's are `ROLE_LABELS`, and §1.1 keeps the
// shipped vocabulary where the two only differ in wording — one name per role,
// used identically by the roster, the legend and the grid. See §8 for F0145.
//
// `partner` is the one deliberate change: the prototype gives Partner and
// Inv. assoc. the same olive pair, which makes two adjacent legend chips
// indistinguishable, so Partner takes the darker olive.
const ROLE_TONE: Record<string, { bg: string; fg: string }> = {
  superuser: { bg: "var(--gold-lt)", fg: "var(--gold-dk)" },
  admin: { bg: "var(--purple-lt)", fg: "var(--purple)" },
  program_manager: { bg: "var(--olive-lt)", fg: "var(--olive)" },
  program_associate: { bg: "var(--olive-lt)", fg: "var(--green)" },
  jury: { bg: "var(--blue-lt)", fg: "var(--blue)" },
  partner: { bg: "var(--olive-lt)", fg: "var(--olive-dk)" },
  ic_member: { bg: "var(--blue-lt)", fg: "var(--blue)" },
  associate: { bg: "var(--olive-lt)", fg: "var(--olive)" },
  analyst: { bg: "var(--olive-lt)", fg: "var(--green)" },
};

const FALLBACK_TONE = { bg: "var(--surface-2)", fg: "var(--fg-muted)" };

function tone(role: string) {
  return ROLE_TONE[role] ?? FALLBACK_TONE;
}

/** A coloured role pill — the prototype's `.rtag` / `.role-chip` / `.perm-role`. */
function RolePill({ role, label }: { role: string; label: string }) {
  const { bg, fg } = tone(role);
  return (
    <span
      className="inline-block whitespace-nowrap rounded-md px-2 py-0.5 text-meta font-semibold"
      style={{ background: bg, color: fg }}
    >
      {label}
    </span>
  );
}

/**
 * Task rows the grid can express but nothing enforces (§8 Q27).
 *
 * Derived from `PermissionTask.source === "none"` rather than a hand-written
 * list, so a row that gains a verb stops being marked the moment `types.ts`
 * records it. Three of those rows gain their verb in THIS session —
 * activate / deactivate (`PATCH /api/users/:id`, gated per direction) and
 * delete (`DELETE /api/users/:id`) — and `src/shared/types.ts` still calls them
 * `source: "none"` because this session does not own that file. Correcting the
 * three `source` values is a cross-session request (plan §9); until then they
 * are excluded here, because marking an enforced row "not enforced" is the same
 * lie in the other direction.
 */
const WIRED_BY_W4A = new Set(["activateuser", "deactivateuser", "deleteuser"]);
const NOT_ENFORCED = new Set(
  PERMISSION_TASKS.filter((t) => t.source === "none" && !WIRED_BY_W4A.has(t.id)).map((t) => t.id),
);

const WORKSPACE_LABEL: Record<Edition, string> = {
  incubator: "Incubator / Accelerator",
  vc: "Investor",
};

/**
 * The VC prototype labels this field *Designation* on both of its add-member
 * rows (`aet-desig`, `su-m-desig`); the incubator build has no such field at
 * all and the repo's own name for it is the Aug-2026 alias title. One column,
 * named as each edition names it.
 */
function designationLabel(edition: Edition): string {
  return edition === "vc" ? "Designation" : "Organizational title";
}

function designationPlaceholder(edition: Edition): string {
  return edition === "vc" ? "e.g. Partner" : "e.g. Head of Programs";
}

export function TeamRolesSection() {
  const { user } = useAuth();
  const edition = (user?.edition ?? "incubator") as Edition;
  const workspace = WORKSPACE_LABEL[edition];

  const [rows, setRows] = useState<UserView[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);

  const load = useCallback(() => {
    return listUsers()
      .then((r) => setRows(r.users))
      .catch(() => setLoadError(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    // The plan pill on every row. Plans are an ORG-WIDE tier in this application
    // while the prototype draws a per-member one (F0066) — the seat/plan model
    // itself is W4-C's and W5-A's, so the roster renders the org's tier on every
    // row, which is that finding's own stated fallback.
    getConfigSummary()
      .then((c) => setPlan(c.plan))
      .catch(() => {
        /* the pill is an ornament — no plan, no pill */
      });
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight text-fg">Team &amp; roles</h2>
        <p className="mt-0.5 max-w-3xl text-[13px] text-fg-muted">
          Choose your workspace type, then manage users and roles for that organisation. Pending
          invites shown in red.
        </p>
      </div>

      <WorkspaceTypeCard edition={edition} />

      <AccountOwnerCard rows={rows} selfId={user?.id} selfRole={user?.role} />

      <MembersCard
        edition={edition}
        rows={rows}
        loadError={loadError}
        plan={plan}
        reload={load}
        selfId={user?.id}
      />

      <PermissionCards workspace={workspace} selfRole={user?.role} />
    </div>
  );
}

// ── 1. Workspace type ────────────────────────────────────────────────────────

/**
 * The prototype's two-option switch (`.org-toggle`, `tmSetOrg`), which re-renders
 * the members, the role chips and the matrix columns beneath it.
 *
 * In this application that choice is the workspace's **edition**: it is carried
 * on every user row, it selects the role set (`ROLES_BY_EDITION`), the nav, the
 * pipeline and the permission columns — which is exactly what the prototype's
 * copy promises the switch does. So the active option is read from the edition
 * rather than from a separate setting that would drive nothing, and switching it
 * is not a toggle: it re-keys every member's role and every permission column,
 * and there is no migration for that today. The card says so instead of offering
 * a control that would either lie or break the workspace. Recorded in §8.
 */
function WorkspaceTypeCard({ edition }: { edition: Edition }) {
  const options = [
    {
      id: "incubator" as Edition,
      icon: Building2,
      title: "Incubator / Accelerator",
      blurb: "Programs, cohorts, mentorship & jury",
    },
    {
      id: "vc" as Edition,
      icon: TrendingUp,
      title: "Investor",
      blurb: "Funds, deal flow & investment committee",
    },
  ];
  return (
    <Card>
      <div className="u-label">Workspace type</div>
      <p className="mt-1 max-w-3xl text-[13px] text-fg-muted">
        The role set available to your organisation depends on this choice — it selects the roles,
        the sidebar, the pipeline and the permission columns below. It is fixed when the workspace
        is created, because changing it re-keys every member's role.
      </p>
      <div className="mt-3 flex flex-wrap gap-2.5">
        {options.map((o) => {
          const Icon = o.icon;
          const on = o.id === edition;
          return (
            <div
              key={o.id}
              data-testid={`workspace-${o.id}`}
              aria-current={on ? "true" : undefined}
              className={`flex min-w-[15rem] flex-1 items-center gap-3 rounded-[10px] border p-3 ${
                on ? "border-olive bg-olive-lt" : "border-line bg-surface opacity-60"
              }`}
            >
              <Icon className={`h-5 w-5 shrink-0 ${on ? "text-olive" : "text-fg-muted"}`} />
              <div className="min-w-0">
                <div
                  className={`text-[12.5px] font-bold ${on ? "text-olive" : "text-fg"}`}
                >
                  {o.title}
                </div>
                <div className="mt-px text-meta text-fg-muted">{o.blurb}</div>
              </div>
              {on && (
                <span className="ml-auto flex items-center gap-1 text-meta font-semibold text-olive">
                  <CheckCircle2 className="h-4 w-4" />
                  Active
                </span>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── 1b. Account owner ────────────────────────────────────────────────────────

/**
 * F0062 — "Super user — {email} · Change", the half of the prototype's ownership
 * flow that belongs on this screen.
 *
 * `s-tm`'s card-4 copy says the account owner "is fixed and can't be overridden
 * **here**", which is true of the permission grid and points at a flow that
 * lives on the Setup overlay (`#su-superbox` → `suSetSuper`). Until now this
 * product had neither: `creatableStaffRoles` excludes `superuser` and `PATCH`
 * refuses the row, so ownership was permanently whatever the seed created and an
 * organisation whose owner left had no path to appoint another.
 *
 * Visible to everyone who reaches the console — knowing who owns the account is
 * not privileged — but only the owner can hand it on, which is what the API
 * enforces. The confirmation says the two things that surprise people: the
 * outgoing owner becomes an Admin, and they are signed out on the spot.
 */
function AccountOwnerCard({
  rows,
  selfId,
  selfRole,
}: {
  rows: UserView[] | null;
  selfId: string | undefined;
  selfRole: string | undefined;
}) {
  const owner = rows?.find((u) => u.role === "superuser");
  const isOwner = selfRole === "superuser";
  const [choice, setChoice] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Who can hold an account: an active staff member who has actually signed in.
  const eligible = (rows ?? []).filter(
    (u) =>
      u.role !== "superuser" &&
      u.userType !== "mentor" &&
      u.active &&
      u.invitePending !== true,
  );

  async function transfer() {
    setBusy(true);
    setError(null);
    try {
      await transferOwnership(choice);
      // The session that made this call no longer exists, so there is nothing
      // useful left on screen — a full reload lands on the sign-in page.
      window.location.assign("/login");
    } catch (err) {
      setError(refusalMessage(err));
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <Card>
      <div className="u-label">Account owner</div>
      <p className="mt-1 max-w-3xl text-[13px] text-fg-muted">
        Exactly one person owns this account. The owner's permissions are fixed — they cannot be
        overridden in the grid below — and only the owner can hand the account on.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2.5" data-testid="account-owner">
        <Crown className="h-4 w-4 shrink-0 text-gold-dk" />
        {owner ? (
          <span className="text-sm text-fg">
            <span className="font-medium">{owner.name}</span>{" "}
            <span className="text-fg-muted">· {owner.email}</span>
            {owner.id === selfId && <span className="text-fg-muted"> · you</span>}
          </span>
        ) : (
          <span className="text-sm text-fg-muted">
            This workspace has no owner. Ask an administrator to appoint one.
          </span>
        )}
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-red/40 bg-red-lt px-3 py-2 text-item text-red" role="alert">
          {error}
        </div>
      )}

      {isOwner && eligible.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          {!confirming ? (
            <div className="flex flex-wrap items-end gap-2.5">
              <label className="flex flex-col gap-1">
                <span className="text-meta font-medium text-fg-muted">Transfer ownership to</span>
                <select
                  className="sj-input h-8 py-0 text-sm"
                  value={choice}
                  onChange={(e) => setChoice(e.target.value)}
                  aria-label="Transfer ownership to"
                >
                  <option value="">Choose a member…</option>
                  {eligible.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} · {u.roleLabel}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                size="sm"
                variant="secondary"
                disabled={!choice}
                onClick={() => setConfirming(true)}
              >
                Transfer ownership
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-[13px] text-fg">
                {eligible.find((u) => u.id === choice)?.name} becomes the account owner and you
                become an Admin. You'll be signed out straight away.
              </span>
              <Button size="sm" variant="primary" disabled={busy} onClick={transfer}>
                {busy ? "Transferring…" : "Yes, transfer it"}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ── 2. Active members ────────────────────────────────────────────────────────

interface MembersCardProps {
  edition: Edition;
  rows: UserView[] | null;
  loadError: boolean;
  plan: Plan | null;
  reload: () => Promise<unknown>;
  selfId: string | undefined;
}

/** The credential a route issued, shown once when the mail could not go out. */
interface IssuedCredential {
  name: string;
  email: string;
  tempPassword?: string;
  invite: InviteResult;
  verb: "invited" | "resent";
  /**
   * V3-PT — why the chosen seat could not be assigned, when it could not. The
   * member exists either way, on the default tier; the invite is not lost over
   * a seat, and the reason is not swallowed either.
   */
  seatNote?: string | null;
}

function MembersCard({ edition, rows, loadError, plan, reload, selfId }: MembersCardProps) {
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedCredential | null>(null);

  // The prototype counts ACTIVE members only — pending invites are excluded from
  // the heading and render last (F0148).
  const ordered = useMemo(() => {
    if (!rows) return null;
    return [...rows].sort((a, b) => {
      const ap = a.invitePending === true ? 1 : 0;
      const bp = b.invitePending === true ? 1 : 0;
      if (ap !== bp) return ap - bp;
      if (a.active !== b.active) return a.active ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [rows]);

  const activeCount = rows
    ? rows.filter((u) => u.active && u.invitePending !== true).length
    : null;

  async function act(id: string, run: () => Promise<unknown>) {
    setRowBusy(id);
    setRowError(null);
    try {
      await run();
      await reload();
    } catch (err) {
      setRowError(refusalMessage(err));
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <Card flush>
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="u-label">
          Active members{activeCount === null ? "" : ` (${activeCount})`}
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setInviting((v) => !v);
            setEditing(null);
          }}
          aria-expanded={inviting}
        >
          <Plus className="h-3 w-3" />
          Invite member
        </Button>
      </div>

      {issued && <CredentialNotice issued={issued} onDismiss={() => setIssued(null)} />}

      {rowError && (
        <div className="border-b border-line bg-red-lt px-4 py-2.5 text-item text-red" role="alert">
          {rowError}
        </div>
      )}

      {inviting && (
        <InviteRow
          edition={edition}
          onCancel={() => setInviting(false)}
          onInvited={async (result) => {
            setIssued(result);
            setInviting(false);
            await reload();
          }}
        />
      )}

      {loadError ? (
        <div className="p-6">
          <EmptyState
            icon="Users"
            title="Couldn't load the team"
            description="Try reloading the page."
          />
        </div>
      ) : !ordered ? (
        <p className="p-6 text-sm text-fg-muted">Loading team…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-left" data-testid="member-roster">
            <thead>
              <tr className="text-fg-muted">
                <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Member</th>
                <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Role</th>
                <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">
                  {designationLabel(edition)}
                </th>
                <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Plan</th>
                <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">Status</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wide">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((u) =>
                editing === u.id ? (
                  <EditRow
                    key={u.id}
                    edition={edition}
                    member={u}
                    onCancel={() => setEditing(null)}
                    onSaved={async () => {
                      setEditing(null);
                      await reload();
                    }}
                  />
                ) : (
                  <MemberRow
                    key={u.id}
                    member={u}
                    plan={plan}
                    busy={rowBusy !== null}
                    manageable={u.id !== selfId && u.role !== "superuser"}
                    onEdit={() => {
                      setEditing(u.id);
                      setInviting(false);
                    }}
                    onToggleActive={() => act(u.id, () => updateUser(u.id, { active: !u.active }))}
                    onRemove={() => act(u.id, () => deleteUser(u.id))}
                    onResend={() =>
                      act(u.id, async () => {
                        const res = await resendInvite(u.id);
                        setIssued({
                          name: u.name,
                          email: u.email,
                          tempPassword: res.tempPassword,
                          invite: res.invite,
                          verb: "resent",
                        });
                      })
                    }
                  />
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function MemberRow({
  member,
  plan,
  busy,
  manageable,
  onEdit,
  onToggleActive,
  onRemove,
  onResend,
}: {
  member: UserView;
  plan: Plan | null;
  busy: boolean;
  manageable: boolean;
  onEdit: () => void;
  onToggleActive: () => void;
  onRemove: () => void;
  onResend: () => void;
}) {
  const pending = member.invitePending === true;
  return (
    <tr
      className={`border-t border-line ${pending ? "bg-red-lt" : ""}`}
      data-pending={pending ? "true" : undefined}
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
            style={{ background: tone(member.role).bg, color: tone(member.role).fg }}
          >
            {member.initials}
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium text-fg">{member.name}</div>
            <div className="truncate text-xs text-fg-muted">{member.email}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        {/* F0182 — the repo's mentor is a user-TYPE; the prototype's roster has
            no extra Type column, so it reads as a role tag like every other. */}
        <RolePill role={member.role} label={member.roleLabel} />
      </td>
      <td className="px-4 py-3 text-sm text-fg-muted">{member.title ?? "—"}</td>
      <td className="px-4 py-3">
        {plan ? (
          <Badge tone={plan === "standard" ? "neutral" : "amber"}>{PLAN_LABELS[plan]}</Badge>
        ) : (
          <span className="text-xs text-fg-muted">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        {pending ? (
          <Badge tone="danger">Invite pending</Badge>
        ) : member.active ? (
          <Badge tone="positive">Active</Badge>
        ) : (
          <Badge tone="neutral">Inactive</Badge>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap justify-end gap-1.5">
          {!manageable ? (
            <span className="text-xs text-fg-muted">
              {member.role === "superuser" ? "Account owner" : "You"}
            </span>
          ) : pending ? (
            <>
              <Button size="sm" variant="secondary" disabled={busy} onClick={onResend}>
                Resend
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={onRemove}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="secondary" disabled={busy} onClick={onEdit}>
                Edit
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={onToggleActive}>
                {member.active ? "Deactivate" : "Activate"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={onRemove}
                aria-label={`Remove ${member.name}`}
              >
                Remove
              </Button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

/** The prototype's `Edit` action, bound to the PATCH that has existed since
 *  Phase 1 and had no caller (F0068): name, role and designation in place. */
function EditRow({
  edition,
  member,
  onCancel,
  onSaved,
}: {
  edition: Edition;
  member: UserView;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(member.name);
  const [role, setRole] = useState(member.role);
  const [title, setTitle] = useState(member.title ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roleOptions = useMemo(() => creatableStaffRoles(edition), [edition]);
  const isMentor = member.userType === "mentor";

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await updateUser(member.id, {
        name,
        title,
        ...(isMentor ? {} : { role }),
      });
      await onSaved();
    } catch (err) {
      setError(refusalMessage(err));
      setBusy(false);
    }
  }

  return (
    <tr className="border-t border-line bg-surface-2">
      <td className="px-4 py-3">
        <label className="flex flex-col gap-1">
          <span className="text-meta font-medium text-fg-muted">Full name</span>
          <input
            className="sj-input h-8 w-52 py-0 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label={`Full name for ${member.email}`}
          />
        </label>
      </td>
      <td className="px-4 py-3">
        <label className="flex flex-col gap-1">
          <span className="text-meta font-medium text-fg-muted">Role</span>
          <select
            className="sj-input h-8 py-0 text-sm disabled:opacity-50"
            value={role}
            disabled={isMentor}
            onChange={(e) => setRole(e.target.value)}
            aria-label={`Role for ${member.email}`}
          >
            {roleOptions.map((r) => (
              <option key={r} value={r}>
                {roleLabel(edition, r)}
              </option>
            ))}
          </select>
        </label>
      </td>
      <td className="px-4 py-3" colSpan={2}>
        <label className="flex flex-col gap-1">
          <span className="text-meta font-medium text-fg-muted">{designationLabel(edition)}</span>
          <input
            className="sj-input h-8 w-48 py-0 text-sm"
            maxLength={60}
            value={title}
            placeholder={designationPlaceholder(edition)}
            onChange={(e) => setTitle(e.target.value)}
            aria-label={`${designationLabel(edition)} for ${member.email}`}
          />
        </label>
      </td>
      <td className="px-4 py-3 text-item text-red">{error}</td>
      <td className="px-4 py-3">
        <div className="flex justify-end gap-1.5">
          <Button size="sm" variant="primary" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save"}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </td>
    </tr>
  );
}

/** The prototype's `Invite member` form. The VC build carries Designation. */
function InviteRow({
  edition,
  onCancel,
  onInvited,
}: {
  edition: Edition;
  onCancel: () => void;
  onInvited: (issued: IssuedCredential) => Promise<void>;
}) {
  const roleOptions = useMemo(() => creatableStaffRoles(edition), [edition]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [userType, setUserType] = useState<"staff" | "mentor">("staff");
  // The least-privileged creatable role, so nobody is made an admin by default.
  const [role, setRole] = useState<Role>(roleOptions[roleOptions.length - 1]);
  /**
   * V3-PT item 16 — the Seat select v3 added to this form (`#tm-add-plan`).
   * The wizard's add-member block is gone, and with it the only place a seat
   * tier could be chosen at invite time; without this, every member Team &
   * roles creates would silently land on `users.plan_tier`'s default.
   */
  const [tier, setTier] = useState<Plan>(DEFAULT_TIER);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Creation stays on `POST /api/users`, unchanged. Routing it through the
      // SEAT route instead would have added a capacity refusal this screen has
      // never had and has no Buy-seats control to answer with (§4 Q84) — a
      // tightening nobody asked for, and it broke `e2e/roles.spec.ts` at once
      // because every tier in the seed is full.
      const res = await createUser({
        name,
        email,
        userType,
        role: userType === "staff" ? role : undefined,
        title: title || undefined,
      });
      // The seat is a SECOND, non-fatal step. A refusal here leaves a created
      // member on the default tier — which is exactly what this form did
      // yesterday — and says so rather than losing the invite.
      let seatNote: string | null = null;
      if (userType === "staff" && tier !== DEFAULT_TIER) {
        try {
          await setMemberTier(res.user.id, tier);
        } catch (err) {
          seatNote =
            (err instanceof ApiError && typeof err.body.message === "string" ? err.body.message : null) ??
            `A ${PLAN_LABELS[tier]} seat could not be assigned.`;
        }
      }
      await onInvited({
        name: res.user.name,
        email: res.user.email,
        tempPassword: res.tempPassword,
        invite: res.invite,
        verb: "invited",
        seatNote,
      });
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? "That email already has an account."
          : refusalMessage(err),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="border-b border-line bg-surface-2 px-4 py-4" onSubmit={submit}>
      <div className="u-label mb-3">Invite a team member or mentor</div>
      {error && (
        <div className="mb-3 rounded-lg border border-red/40 bg-red-lt px-3 py-2 text-item text-red" role="alert">
          {error}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[11rem] flex-1 flex-col gap-1">
          <span className="text-meta font-medium text-fg-muted">Full name</span>
          <input
            className="sj-input h-9"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Priya Sharma"
            required
          />
        </label>
        <label className="flex min-w-[13rem] flex-1 flex-col gap-1">
          <span className="text-meta font-medium text-fg-muted">Work email</span>
          <input
            className="sj-input h-9"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colleague@company.com"
            required
          />
        </label>
        <label className="flex min-w-[11rem] flex-1 flex-col gap-1">
          <span className="text-meta font-medium text-fg-muted">
            {designationLabel(edition)} <span className="font-normal">(optional)</span>
          </span>
          <input
            className="sj-input h-9"
            maxLength={60}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={designationPlaceholder(edition)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-meta font-medium text-fg-muted">User type</span>
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
          <span className="text-meta font-medium text-fg-muted">Role</span>
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
        <label className="flex flex-col gap-1">
          <span className="text-meta font-medium text-fg-muted">Seat</span>
          <select
            aria-label="Seat for the new member"
            className="sj-input h-9 disabled:opacity-50"
            value={tier}
            onChange={(e) => setTier(e.target.value as Plan)}
            disabled={userType === "mentor"}
          >
            {PLANS.map((t) => (
              <option key={t} value={t}>
                {PLAN_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Inviting…" : "Send invite"}
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {userType === "mentor" && (
        <p className="mt-2 text-xs text-fg-muted">
          A mentor is an advisor recorded in your directory — no evaluation or pipeline access.
        </p>
      )}
    </form>
  );
}

/**
 * What happened to the credential — and the credential itself ONLY when the mail
 * could not be delivered.
 *
 * F0075 found the old copy promising that the new user "will set their own
 * password on first sign-in", which was not true of any account: there was no
 * change-password route anywhere. There is one now (`PUT /api/users/me/password`),
 * so the sentence is written to what the product actually does — the user CAN
 * change it, and nothing yet forces them to at sign-in (§9).
 */
function CredentialNotice({
  issued,
  onDismiss,
}: {
  issued: IssuedCredential;
  onDismiss: () => void;
}) {
  const verb = issued.verb === "resent" ? "Invite resent to" : "Invited";
  return (
    <div className="border-b border-line bg-green-lt px-4 py-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium text-fg">
            {verb} {issued.name}.
          </div>
          {issued.invite.delivered ? (
            <p className="mt-1 text-fg-muted">
              We've emailed {issued.email} a sign-in link and a one-time temporary password. They
              can change it from their account once they're in.
            </p>
          ) : (
            <>
              <p className="mt-1 text-fg-muted">
                {issued.invite.status === "skipped"
                  ? "Email delivery isn't configured yet, so share this one-time temporary password with"
                  : "The invite email couldn't be delivered, so share this one-time temporary password with"}{" "}
                {issued.email}. They can change it from their account once they're in.
              </p>
              <code className="mt-2 inline-block rounded bg-surface-2 px-2 py-1 font-mono text-sm text-fg">
                {issued.tempPassword}
              </code>
            </>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
      {issued.seatNote && (
        <p className="mt-2 text-xs text-gold-dk" data-testid="invite-seat-note" role="alert">
          {issued.seatNote} They hold a {PLAN_LABELS[DEFAULT_TIER]} seat until one is free — change
          it from their row once you have bought one.
        </p>
      )}
    </div>
  );
}

// ── 3 + 4. Roles & access, and the task-permission grid ──────────────────────

function PermissionCards({
  workspace,
  selfRole,
}: {
  workspace: string;
  selfRole: string | undefined;
}) {
  const [data, setData] = useState<PermissionGrid | null>(null);
  const [failed, setFailed] = useState(false);
  const [busyCell, setBusyCell] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The admin column as it stood before the prototype-default reset, so the
   *  reset can be undone for the rest of the session. */
  const [undoAdmin, setUndoAdmin] = useState<Record<string, boolean> | null>(null);

  useEffect(() => {
    getPermissionGrid()
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  const grouped = useMemo(() => {
    if (!data) return [];
    return PERMISSION_TASK_GROUPS.map((group) => ({
      group,
      tasks: data.tasks.filter((t) => t.group === group),
    })).filter((g) => g.tasks.length > 0);
  }, [data]);

  /** Returns whether the write actually landed — the reset's Undo depends on it. */
  async function writeCells(
    cells: { role: string; taskId: string; granted: boolean }[],
  ): Promise<boolean> {
    if (!data) return false;
    const key = cells.length === 1 ? `${cells[0].taskId}:${cells[0].role}` : "bulk";
    setBusyCell(key);
    setError(null);
    const previous = data;
    // Optimistic: the prototype's cell flips on click, and a 200 that only
    // repaints what was already painted is the quieter experience.
    setData({
      ...data,
      grid: cells.reduce(
        (g, c) => ({ ...g, [c.taskId]: { ...g[c.taskId], [c.role]: c.granted } }),
        data.grid,
      ),
    });
    try {
      await putPermissionCells(cells);
      return true;
    } catch (err) {
      setData(previous);
      setError(refusalMessage(err));
      return false;
    } finally {
      setBusyCell(null);
    }
  }

  if (failed) {
    return (
      <Card>
        <EmptyState
          icon="ShieldCheck"
          title="Couldn't load task permissions"
          description="Try reloading the page."
        />
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <p className="text-sm text-fg-muted">Loading task permissions…</p>
      </Card>
    );
  }

  const roles = data.roles;

  return (
    <>
      {/* ── 3. Roles & access ── */}
      <Card>
        <div className="u-label">Roles &amp; access — {workspace}</div>
        <p className="mt-1 max-w-3xl text-[13px] text-fg-muted">
          These are the roles available for the selected workspace type. Each carries its own access
          level across the platform; the count is how many of the {data.tasks.length} tasks below the
          role currently holds.
        </p>
        <div className="mt-3 flex flex-wrap gap-2" data-testid="role-legend">
          {roles.map((r) => {
            const held = data.tasks.filter((t) => data.grid[t.id]?.[r.role]).length;
            return (
              <span key={r.role} className="inline-flex items-center gap-1.5">
                <RolePill role={r.role} label={r.label} />
                <span className="text-meta text-fg-muted">
                  {held} / {data.tasks.length}
                </span>
              </span>
            );
          })}
        </div>
      </Card>

      {/* ── 4. Task permissions ── */}
      <Card flush>
        <div className="border-b border-line px-4 py-3">
          <div className="u-label">Task permissions — {workspace}</div>
          {/* The one line that replaces the prototype's "Tap a cell to toggle
              access". See the module header: a cell is a gate, not a grant. */}
          <p className="mt-1 max-w-3xl text-[13px] text-fg-muted">
            Unticking a cell <strong className="font-semibold text-fg">removes</strong> that task
            from the role; ticking it back restores it. A tick cannot hand a role access it never
            had — a role that has no route to a screen still won't reach it. The account owner
            column is fixed and cannot be overridden here.
          </p>
          <AdminDefaultReset
            data={data}
            undoAdmin={undoAdmin}
            busy={busyCell !== null}
            // Only on a write that landed: a refused PUT must not leave the
            // card claiming a change it did not make, or offering to undo one.
            onApply={async (cells, snapshot) => {
              if (await writeCells(cells)) setUndoAdmin(snapshot);
            }}
            onUndo={async (cells) => {
              if (await writeCells(cells)) setUndoAdmin(null);
            }}
          />
        </div>

        {error && (
          <div className="border-b border-line bg-red-lt px-4 py-2.5 text-item text-red" role="alert">
            {error}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-[11.5px]" data-testid="permission-grid">
            <thead>
              <tr>
                <th className="border-b-2 border-line px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-fg-muted">
                  Task
                </th>
                {roles.map((r) => (
                  <th key={r.role} className="border-b-2 border-line px-2 py-2 text-center">
                    <RolePill role={r.role} label={r.label} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grouped.map((g) => (
                <GroupRows
                  key={g.group}
                  group={g.group}
                  tasks={g.tasks}
                  roles={roles}
                  grid={data.grid}
                  selfRole={selfRole}
                  busyCell={busyCell}
                  onToggle={(taskId, role, granted) => writeCells([{ taskId, role, granted }])}
                />
              ))}
            </tbody>
          </table>
        </div>

        {NOT_ENFORCED.size > 0 && (
          <p className="border-t border-line px-4 py-3 text-xs text-fg-muted">
            <ShieldAlert className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
            Rows marked <em>Not enforced yet</em> are tasks the prototype names that this product has
            no action for yet. The cell is saved and the sessions that build those actions will read
            it — but nothing checks it today.
          </p>
        )}
      </Card>
    </>
  );
}

function GroupRows({
  group,
  tasks,
  roles,
  grid,
  selfRole,
  busyCell,
  onToggle,
}: {
  group: string;
  tasks: PermissionGrid["tasks"];
  roles: PermissionGrid["roles"];
  grid: PermissionGrid["grid"];
  selfRole: string | undefined;
  busyCell: string | null;
  onToggle: (taskId: string, role: string, granted: boolean) => void;
}): ReactNode {
  return (
    <>
      <tr>
        <td
          colSpan={roles.length + 1}
          className="border-b border-line bg-olive-lt px-2 py-1.5 text-left text-[9.5px] font-bold uppercase tracking-[0.06em] text-olive"
        >
          {group}
        </td>
      </tr>
      {tasks.map((t) => (
        <tr key={t.id} className="border-b border-line">
          <th
            scope="row"
            className="whitespace-nowrap px-2 py-2 text-left text-[11.5px] font-semibold text-fg"
          >
            {t.label}
            {NOT_ENFORCED.has(t.id) && (
              <span className="ml-1.5 align-[1px] text-[9.5px] font-medium text-fg-muted" title={t.note}>
                Not enforced yet
              </span>
            )}
          </th>
          {roles.map((r) => (
            <PermissionCell
              key={r.role}
              taskId={t.id}
              taskLabel={t.label}
              role={r.role}
              roleLabel={r.label}
              granted={grid[t.id]?.[r.role] === true}
              selfRole={selfRole}
              busy={busyCell === `${t.id}:${r.role}` || busyCell === "bulk"}
              onToggle={onToggle}
            />
          ))}
        </tr>
      ))}
    </>
  );
}

/**
 * One cell. Both of the API's refusals are rendered as a disabled control with
 * the reason on it, rather than offered and then 403'd:
 *
 *   • the whole `superuser` column — `immutable_superuser`;
 *   • your own role's `adminconsole` cell — `cannot_lock_yourself_out`. It is
 *     inert in both directions: it can only be ON (you are reading this screen),
 *     and turning it off is the one write the API will always refuse.
 */
function PermissionCell({
  taskId,
  taskLabel,
  role,
  roleLabel: label,
  granted,
  selfRole,
  busy,
  onToggle,
}: {
  taskId: string;
  taskLabel: string;
  role: string;
  roleLabel: string;
  granted: boolean;
  selfRole: string | undefined;
  busy: boolean;
  onToggle: (taskId: string, role: string, granted: boolean) => void;
}) {
  const immutable = role === "superuser";
  const ownConsole = role === selfRole && taskId === "adminconsole";
  const locked = immutable || ownConsole;
  const reason = immutable
    ? "The account owner's permissions are fixed and can't be overridden here."
    : ownConsole
      ? "You can't close your own access to the admin console."
      : undefined;

  return (
    <td className="border-b border-line px-2 py-2 text-center">
      <button
        type="button"
        role="switch"
        aria-checked={granted}
        aria-label={`${taskLabel} · ${label}`}
        title={reason}
        disabled={locked || busy}
        onClick={() => onToggle(taskId, role, !granted)}
        className={[
          "inline-flex h-5 w-5 items-center justify-center rounded-md border-[1.5px] transition-colors",
          granted ? "border-olive bg-olive text-white" : "border-line bg-surface text-transparent",
          locked ? "cursor-not-allowed opacity-55" : "hover:border-olive",
        ].join(" ")}
      >
        <svg viewBox="0 0 20 20" className="h-3 w-3" aria-hidden="true" fill="none">
          <path
            d="M5 10.5l3.2 3.2L15 7"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </td>
  );
}

/**
 * §8 Q7 — the prototype's Admin column, offered as an ACTION rather than a seed.
 *
 * The prototype's "Client admin" holds only Register, Purchase/Upgrade plan, the
 * three user-management rows, Access to admin console, Permit to add team
 * members and Out of office delegation; its own copy says "Admins are read-only
 * on evaluation, due-diligence and parameters by default". This application's
 * `admin` has held Upload / Evaluate / Assign / Query since Phase 1 and the
 * roles harness asserts it, so today's app wins and the seed is unchanged. An
 * organisation that wants the narrower default gets it as a deliberate write of
 * those cells, reversible for the rest of the session.
 */
const PROTOTYPE_ADMIN_TASKS = new Set([
  "register",
  "upgrade",
  "activateuser",
  "deactivateuser",
  "deleteuser",
  "adminconsole",
  "addmembers",
  "outofofficedelegation",
]);

function AdminDefaultReset({
  data,
  undoAdmin,
  busy,
  onApply,
  onUndo,
}: {
  data: PermissionGrid;
  undoAdmin: Record<string, boolean> | null;
  busy: boolean;
  onApply: (
    cells: { role: string; taskId: string; granted: boolean }[],
    snapshot: Record<string, boolean>,
  ) => Promise<void>;
  onUndo: (cells: { role: string; taskId: string; granted: boolean }[]) => Promise<void>;
}) {
  const alreadyNarrow = data.tasks.every(
    (t) => (data.grid[t.id]?.admin === true) === PROTOTYPE_ADMIN_TASKS.has(t.id),
  );

  if (undoAdmin) {
    return (
      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
        <span>Admin is now read-only on evaluation, due diligence and parameters.</span>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() =>
            onUndo(
              data.tasks.map((t) => ({
                role: "admin",
                taskId: t.id,
                granted: undoAdmin[t.id] === true,
              })),
            )
          }
        >
          Undo
        </Button>
      </div>
    );
  }

  if (alreadyNarrow) return null;

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
      <span>
        Admin can upload, evaluate, assign and query in this workspace. The prototype's default is
        narrower.
      </span>
      <Button
        size="sm"
        variant="secondary"
        disabled={busy}
        onClick={() =>
          onApply(
            data.tasks.map((t) => ({
              role: "admin",
              taskId: t.id,
              granted: PROTOTYPE_ADMIN_TASKS.has(t.id),
            })),
            Object.fromEntries(data.tasks.map((t) => [t.id, data.grid[t.id]?.admin === true])),
          )
        }
      >
        Make Admin read-only on evaluation
      </Button>
    </div>
  );
}

// ── Refusals ─────────────────────────────────────────────────────────────────

/** Turn the API's error codes into the sentence the administrator needs. Every
 *  one of these is asserted in `test/worker/users.test.ts` or
 *  `test/worker/permissions.test.ts`. */
function refusalMessage(err: unknown): string {
  const code = err instanceof ApiError ? err.code : undefined;
  switch (code) {
    case "immutable_superuser":
      return "The account owner's row is fixed and can't be changed here.";
    case "cannot_lock_yourself_out":
      return "You can't close your own access to the admin console.";
    case "cannot_delete_self":
      return "You can't remove your own account.";
    case "cannot_edit_self":
      return "You can't change your own role or status here.";
    case "already_owner":
      return "You already own this account.";
    case "inactive_user":
      return "That member is deactivated — switch them back on first.";
    case "invite_pending":
      return "That member hasn't signed in yet, so they can't take the account on.";
    case "last_admin":
      return "This is the last person who can open the admin console — give someone else access first.";
    case "invite_already_accepted":
      return "That member has already signed in, so there's no invite to resend.";
    case "email_taken":
      return "That email already has an account.";
    case "forbidden":
      return "Your role doesn't have permission to do that.";
    default:
      return "That didn't go through. Try again.";
  }
}
