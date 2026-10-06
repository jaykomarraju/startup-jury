import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarClock, KeyRound, UserCheck } from "lucide-react";
import { Card, Button, Badge } from "../components";
import { NotificationPreferences } from "./admin/Notifications";
import { useAuth } from "../auth/useAuth";
import { usePermissions } from "../auth/usePermissions";
import { getConfigSummary, updateMyTitle, ApiError } from "../api";
import {
  changeOwnPassword,
  clearOutOfOffice,
  getMyAccount,
  setOutOfOffice,
  type MyAccountView,
} from "./admin/teamApi";
import { roleLabel, editionLabel } from "../../shared/roles";
import { canAccessNav } from "../../shared/nav";
import type { PermissionLookup } from "../../shared/permissions";
import { PLAN_LABELS, type Plan } from "../../shared/plans";
import { todayIso, validateWindow } from "../../shared/outOfOffice";
import { AccountOverlay } from "./account/AccountOverlay";

/**
 * My account.
 *
 * W6-B — for anyone who may BUY (the `upgrade` task behind Buy credits: Admin
 * and Super User in the shipped grid), this is the prototype's full-screen
 * account overlay (`#acct-overlay`): Account → [Org type → Org details] → Plan →
 * Payment → receipt. The prototype gives My account to exactly those two roles
 * (F1073).
 *
 * Everyone else still reaches the profile below — name, role, alias title, their
 * own notification mask (W3-B, §8 Q16(c)) and Sign out — because today's nav
 * shows them My account and nothing else carries those controls yet. Whether the
 * entry should leave their sidebar is `nav.ts`'s decision, not this file's.
 * A buyer reaches the same profile with `?view=profile` (linked from the overlay).
 *
 * ── L4: `?change=password`, AND WHY IT OVERRIDES THE OVERLAY ────────────────
 *
 * The profile now carries **Change password** and **Out of office**, and both are
 * needed by the two roles the overlay intercepts — an administrator with a
 * system-issued temporary credential is the single most important person in the
 * workspace to be able to replace it. Rather than change which screen a buyer
 * lands on (that is prototype parity, and `e2e/account-purchase.spec.ts` pins
 * it), `?change=password` is a second way in: it reaches the profile for EVERY
 * role, and the form is already open and focused when it does.
 *
 * That makes `/app/account?change=password` the stable deep link anything may
 * send a user to — the login screen for somebody carrying `must_change_password`,
 * an invite email, a support reply. It is a query parameter and not a hash so it
 * survives `react-router`'s navigation and can be read without `useLocation`.
 */
export function AccountPage() {
  const { user } = useAuth();
  const can = usePermissions();
  const [params] = useSearchParams();
  if (!user) return null;
  const changePassword = params.get("change") === "password";
  const canBuy = canAccessNav(user.edition, user.role, "billing", can);
  if (canBuy && params.get("view") !== "profile" && !changePassword) {
    return <AccountOverlay entry="account" />;
  }
  return <ProfilePage openChangePassword={changePassword} />;
}

/**
 * The profile (Session 4). Every signed-in team member sees their own profile —
 * name, role, workspace and the org's current plan — and can sign out. Plan +
 * org name come from the safe config summary any authed user may read.
 *
 * L4 adds the three things the account surface was missing: the password change
 * that has had a working route and no caller since W4-A, the out-of-office window
 * with its delegate, and the list of work this person is covering for somebody
 * else. All three read one request (`GET /api/users/me/account`) because they are
 * all facts about the same row.
 */
function ProfilePage({ openChangePassword }: { openChangePassword: boolean }) {
  const { user, logout, updateUser } = useAuth();
  const can = usePermissions();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  // Aug-2026 issue 1 — your organizational alias title.
  const [title, setTitle] = useState(user?.title ?? "");
  const [savingTitle, setSavingTitle] = useState(false);
  const [titleMsg, setTitleMsg] = useState<string | null>(null);
  const [account, setAccount] = useState<MyAccountView | null>(null);

  const loadAccount = useCallback(() => {
    return getMyAccount()
      .then(setAccount)
      .catch(() => {
        /* The profile itself does not depend on this read — name, role, plan and
           Sign out must keep rendering. The two cards below simply stay away. */
      });
  }, []);

  useEffect(() => {
    setTitle(user?.title ?? "");
  }, [user?.title]);

  useEffect(() => {
    loadAccount();
  }, [loadAccount]);

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

      {/* L4 — the credential. Above Notifications on purpose: a person who was
          sent here to change a temporary password should not have to scroll past
          a mask editor to find the form. */}
      <ChangePasswordCard
        account={account}
        startOpen={openChangePassword}
        onChanged={loadAccount}
      />

      {/* L4 — the work this person is covering for an absent colleague. Rendered
          before their own out-of-office card because it is somebody else's
          deadline. */}
      <CoveringForCard account={account} canAccess={can} />

      <OutOfOfficeCard account={account} onSaved={loadAccount} />

      {/* W3-B — §8 Q16(c). `admin/s-nt.html` scopes its toggles to one person
          ("…for your account"), and the console that hosts that section is
          admin-only, so this is the surface on which every other role reaches
          their own mask. Same control, same API, user scope only. */}
      <div className="max-w-xl">
        <h2 className="text-base font-semibold text-fg">Notifications</h2>
        <p className="mb-3 mt-0.5 text-sm text-fg-muted">
          Control which platform events trigger email and in-app alerts for your account.
        </p>
        <NotificationPreferences lockToUserScope />
      </div>
    </div>
  );
}

// ── Change password (the caller F0075's route never had) ─────────────────────

/**
 * `PUT /api/users/me/password`, which has existed, been scoped and been tested
 * since W4-A and had **zero callers** — while the product promised the change
 * twice in copy that was therefore false (the invite email's "choose your own
 * password straight away", `email/outbox.ts:635`, and Team & roles' "they'll set
 * their own on first sign-in").
 *
 * ── SOFT FORCE, AND WHY IT MUST STAY SOFT ──────────────────────────────────
 *
 * When `must_change_password` is set the card opens itself, says so in an amber
 * banner and focuses the first field. It does not block the rest of the
 * application, and `POST /api/auth/login` must not refuse the sign-in either:
 * `vars.EMAIL_FROM` is `""`, so every invited credential in the workspace is one
 * an administrator relayed by hand, and a hard force would lock out every one of
 * those accounts at once with no self-service route back in. The gate flips the
 * day the sending domain is onboarded, not before.
 *
 * `minPasswordLength` comes from the server (`MIN_PASSWORD`, one constant) so this
 * form cannot drift from the route's refusal.
 */
function ChangePasswordCard({
  account,
  startOpen,
  onChanged,
}: {
  account: MyAccountView | null;
  startOpen: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const mustChange = account?.mustChangePassword === true;
  const minLength = account?.minPasswordLength ?? 8;
  const [open, setOpen] = useState(startOpen);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const firstField = useRef<HTMLInputElement | null>(null);

  // A person who arrived carrying a system-issued credential gets the form open
  // without having to find it. Keyed on `mustChange` so it runs once the one read
  // this screen makes has resolved, and never again after they have changed it.
  useEffect(() => {
    if (mustChange) setOpen(true);
  }, [mustChange]);

  useEffect(() => {
    if (open) firstField.current?.focus();
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError("The two new passwords don't match.");
      return;
    }
    if (next.length < minLength) {
      setError(`Your new password needs at least ${minLength} characters.`);
      return;
    }
    setBusy(true);
    try {
      await changeOwnPassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone(true);
      setOpen(false);
      await onChanged();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined;
      setError(
        code === "invalid_credentials"
          ? "That current password isn't right."
          : code === "password_too_short"
            ? `Your new password needs at least ${minLength} characters.`
            : code === "password_unchanged"
              ? "That is the password you already have — choose a different one."
              : "Couldn't change your password. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="max-w-xl">
      <div className="flex flex-wrap items-center gap-2">
        <KeyRound className="h-4 w-4 shrink-0 text-olive" />
        <div className="u-label">Sign-in &amp; password</div>
      </div>

      {mustChange && (
        <div
          className="mt-2.5 rounded-lg border border-warn/40 bg-warn-lt px-3 py-2 text-[13px] text-fg"
          role="status"
        >
          <span className="font-medium">You are using a temporary password.</span> It was issued for
          you — by an invite or a reset — so choose your own now. Nobody else can read it, and nothing
          will stop you working until you do.
        </div>
      )}

      {done && !mustChange && (
        <div
          className="mt-2.5 rounded-lg border border-green/40 bg-green-lt px-3 py-2 text-[13px] text-fg"
          role="status"
        >
          Your password has been changed. Use the new one next time you sign in.
        </div>
      )}

      {!open ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
          <p className="min-w-[12rem] flex-1 text-[13px] text-fg-muted">
            Change the password you sign in with. You will need your current one.
          </p>
          <Button variant="secondary" className="min-h-10 px-4" onClick={() => setOpen(true)}>
            Change password
          </Button>
        </div>
      ) : (
        <form className="mt-2.5 flex flex-col gap-2.5" onSubmit={submit}>
          {error && (
            <div
              className="rounded-lg border border-red/40 bg-red-lt px-3 py-2 text-item text-red"
              role="alert"
            >
              {error}
            </div>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-meta font-medium text-fg-muted">Current password</span>
            <input
              ref={firstField}
              className="sj-input h-10"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-meta font-medium text-fg-muted">
              New password ({minLength} characters or more)
            </span>
            <input
              className="sj-input h-10"
              type="password"
              autoComplete="new-password"
              minLength={minLength}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-meta font-medium text-fg-muted">New password again</span>
            <input
              className="sj-input h-10"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" className="min-h-10 px-4" disabled={busy}>
              {busy ? "Saving…" : "Save new password"}
            </Button>
            {!mustChange && (
              <Button
                type="button"
                variant="ghost"
                className="min-h-10 px-4"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  setError(null);
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </form>
      )}
    </Card>
  );
}

// ── Out of office, with delegation ───────────────────────────────────────────

/**
 * Set a window and name somebody to cover.
 *
 * `<input type="date">` rather than a date picker of our own: it is the control
 * the phone's own keyboard offers, which is the right answer for the
 * non-technical administrator this wave is built for, and it emits exactly the
 * `YYYY-MM-DD` the API takes. `validateWindow` is the SAME function the route
 * refuses with (`src/shared/outOfOffice.ts`), so the button is only disabled for
 * reasons the server would also give.
 *
 * The delegate list comes from the server already filtered to active, approved,
 * non-mentor members of this workspace; the screen does not re-derive eligibility,
 * because the route is the thing that enforces it.
 *
 * "No one" is a real choice, not a placeholder: recording an absence with nobody
 * covering is what a person does before they have arranged cover, and the console
 * shows it either way.
 */
function OutOfOfficeCard({
  account,
  onSaved,
}: {
  account: MyAccountView | null;
  onSaved: () => Promise<unknown>;
}) {
  const current = account?.outOfOffice ?? null;
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [delegateId, setDelegateId] = useState("");
  const [busy, setBusy] = useState<"save" | "clear" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-seed the form whenever the stored window changes — on first load, and
  // after a save or a clear.
  useEffect(() => {
    setFrom(current?.from ?? "");
    setTo(current?.to ?? "");
    setDelegateId(current?.delegateId ?? "");
  }, [current?.from, current?.to, current?.delegateId]);

  const refusal = useMemo(() => (from && to ? validateWindow(from, to) : "invalid_date"), [from, to]);
  const delegateName = account?.delegates.find((d) => d.id === current?.delegateId)?.name ?? null;

  async function save() {
    setBusy("save");
    setError(null);
    try {
      await setOutOfOffice(from, to, delegateId || null);
      await onSaved();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined;
      setError(
        code === "window_backwards"
          ? "The last day can't be before the first."
          : code === "window_too_long"
            ? `That window is longer than ${account?.maxOutOfOfficeDays ?? 180} days — check the year.`
            : code === "invalid_delegate"
              ? "That person can't cover for you — they may have been deactivated. Pick somebody else."
              : code === "invalid_date"
                ? "Pick a first and last day."
                : "Couldn't save that. Try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function clear() {
    setBusy("clear");
    setError(null);
    try {
      await clearOutOfOffice();
      await onSaved();
    } catch {
      setError("Couldn't clear that. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="max-w-xl">
      <div className="flex flex-wrap items-center gap-2">
        <CalendarClock className="h-4 w-4 shrink-0 text-olive" />
        <div className="u-label">Out of office</div>
        {current && (
          <Badge tone={current.active ? "amber" : "neutral"}>
            {current.active ? `Out until ${current.to}` : `From ${current.from}`}
          </Badge>
        )}
      </div>
      <p className="mt-1 text-[13px] text-fg-muted">
        While you are away, the evaluations still waiting on you can be picked up by the person you
        name here. Your own access does not change, and nothing is reassigned permanently.
      </p>

      {current?.active && delegateName && (
        <p className="mt-2 text-[13px] text-fg">
          <span className="font-medium">{delegateName}</span> is covering your outstanding
          evaluations until {current.to}.
        </p>
      )}

      {error && (
        <div
          className="mt-2.5 rounded-lg border border-red/40 bg-red-lt px-3 py-2 text-item text-red"
          role="alert"
        >
          {error}
        </div>
      )}

      <div className="mt-3 flex flex-col gap-2.5">
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-meta font-medium text-fg-muted">First day away</span>
            <input
              className="sj-input h-10"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="First day away"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-meta font-medium text-fg-muted">Last day away</span>
            <input
              className="sj-input h-10"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              aria-label="Last day away"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-meta font-medium text-fg-muted">Who covers your evaluations</span>
          <select
            className="sj-input h-10"
            value={delegateId}
            onChange={(e) => setDelegateId(e.target.value)}
            aria-label="Who covers your evaluations"
          >
            <option value="">No one — just mark me as away</option>
            {(account?.delegates ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} · {d.roleLabel}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            className="min-h-10 px-4"
            disabled={busy !== null || refusal !== null || !account}
            onClick={save}
          >
            {busy === "save" ? "Saving…" : current ? "Update" : "Set out of office"}
          </Button>
          {current && (
            <Button
              variant="secondary"
              className="min-h-10 px-4"
              disabled={busy !== null}
              onClick={clear}
            >
              {busy === "clear" ? "Clearing…" : "I'm back"}
            </Button>
          )}
        </div>
        {/* The one refusal worth saying before the button is pressed, because a
            date picker makes it easy to produce and the message is not obvious. */}
        {refusal === "window_backwards" && (
          <p className="text-xs text-red">The last day can't be before the first.</p>
        )}
        {refusal === "window_too_long" && (
          <p className="text-xs text-red">
            That window is longer than {account?.maxOutOfOfficeDays ?? 180} days — check the year.
          </p>
        )}
      </div>
    </Card>
  );
}

// ── The work you are covering for somebody else ──────────────────────────────

/**
 * Whose evaluations this person is holding, and which decks are still outstanding.
 *
 * The list is the absent colleague's PENDING assignments only — an evaluation
 * submitted by either of them drops off (`coverageFor` in
 * `server/routes/users.ts` is where that is decided, and it tests both ids, since
 * the one that disappears when the delegate does the work is the delegate's).
 *
 * The link points at whichever evaluation screen this role actually reaches,
 * resolved through `canAccessNav` rather than hard-coded: a jury member's decks
 * are on **Assigned** (`jassigned`), everybody else's on **Evaluate**. No link at
 * all is better than one that lands on "Not available for your role".
 */
function CoveringForCard({
  account,
  canAccess,
}: {
  account: MyAccountView | null;
  canAccess: PermissionLookup;
}) {
  const { user } = useAuth();
  const covering = account?.coveringFor ?? [];
  if (!user || covering.length === 0) return null;

  const destination = ["jassigned", "evaluate", "alldecks"].find((id) =>
    canAccessNav(user.edition, user.role, id, canAccess),
  );
  const today = todayIso();

  return (
    <Card className="max-w-xl">
      <div className="flex flex-wrap items-center gap-2">
        <UserCheck className="h-4 w-4 shrink-0 text-olive" />
        <div className="u-label">You are covering for someone</div>
        <Badge tone="amber">
          {covering.reduce((n, p) => n + p.assignments.length, 0)} to evaluate
        </Badge>
      </div>

      <ul className="mt-3 flex flex-col gap-3">
        {covering.map((person) => (
          <li key={person.userId} className="rounded-[10px] border border-line bg-surface-2 p-3">
            <div className="text-[13px] text-fg">
              <span className="font-medium">{person.name}</span> is away until {person.until}.
            </div>
            <ul className="mt-2 flex flex-col gap-1.5">
              {person.assignments.map((a) => (
                <li
                  key={a.deckId}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"
                >
                  <span className="text-[13px] font-medium text-fg">{a.deckName}</span>
                  {a.dueAt && (
                    <span
                      className={`text-meta ${a.dueAt.slice(0, 10) < today ? "text-red" : "text-fg-muted"}`}
                    >
                      due {a.dueAt.slice(0, 10)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      {destination ? (
        <Link
          className="mt-3 inline-flex min-h-10 items-center rounded-[7px] border border-line bg-surface px-4 text-item text-fg-2 hover:bg-surface-2"
          to={`/app/${destination}`}
        >
          Open the decks to evaluate
        </Link>
      ) : (
        <p className="mt-3 text-xs text-fg-muted">
          These decks appear on your usual evaluation screen.
        </p>
      )}
    </Card>
  );
}
