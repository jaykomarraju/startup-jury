import { useCallback, useEffect, useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Card, Button, Badge, EmptyState } from "../../components";
import { useAuth } from "../../auth/useAuth";
import { listUsers, ApiError, type InviteResult, type UserView } from "../../api";
import { resetUserPassword } from "./teamApi";

/**
 * Admin console → System → **User access** (prototype `admin/s-uc.html`).
 *
 * ── This screen is built deliberately differently from the prototype ─────────
 *
 * `s-uc.html` lists every user's password behind an eye icon (`ucReveal`), and
 * the file is byte-identical in all eleven role builds — so as drawn, a jury
 * member can read the Super User's password. Reproducing it would require
 * storing reversible credentials. Passwords here are PBKDF2-hashed and stay
 * that way (plan §1.2, F0021), so:
 *
 *   • the layout, the columns and the Reset action are the prototype's;
 *   • the masked value and its reveal control are replaced by a password
 *     STATE, which is a fact the system actually knows;
 *   • the section is in the console, which only `adminconsole` holders reach.
 *
 * ── The three states, and where each comes from ──────────────────────────────
 *
 *   "Awaiting first sign-in"  `invite_accepted_at IS NULL` (0041) — the
 *                             credential has never been used.
 *   "Temporary — not changed" `must_change_password = 1` (0044) — the password
 *                             in play is one the system issued (invite, resend
 *                             or a reset here) and its owner has not replaced it.
 *   "Set by the user"         Neither. The owner chose it.
 *
 * F0075 found the console promising a forced change at next sign-in that existed
 * nowhere. `PUT /api/users/me/password` now makes the change itself real, so the
 * copy says what is true: the user CAN change it. Making the change *compulsory*
 * at sign-in is an edit to `src/server/routes/auth.ts`, which this session does
 * not own — a cross-session request (plan §9) — and nothing here claims it.
 */

interface ResetResult {
  name: string;
  email: string;
  tempPassword?: string;
  invite: InviteResult;
}

type PasswordState = "pending" | "temporary" | "set";

function passwordState(u: UserView): PasswordState {
  if (u.invitePending === true) return "pending";
  if (u.mustChangePassword === true) return "temporary";
  return "set";
}

const STATE_COPY: Record<PasswordState, { label: string; tone: "neutral" | "amber" | "positive" }> = {
  pending: { label: "Awaiting first sign-in", tone: "neutral" },
  temporary: { label: "Temporary — not yet changed", tone: "amber" },
  set: { label: "Set by the user", tone: "positive" },
};

export function UserAccessSection() {
  const { user } = useAuth();
  const [rows, setRows] = useState<UserView[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reset, setReset] = useState<ResetResult | null>(null);

  const load = useCallback(() => {
    return listUsers()
      .then((r) => setRows(r.users))
      .catch(() => setLoadError(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function doReset(u: UserView) {
    setBusy(u.id);
    setError(null);
    setReset(null);
    try {
      const res = await resetUserPassword(u.id);
      setReset({
        name: u.name,
        email: u.email,
        tempPassword: res.tempPassword,
        invite: res.invite,
      });
      await load();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined;
      setError(
        code === "immutable_superuser"
          ? "Only the account owner can reset the account owner's password."
          : code === "cannot_reset_self"
            ? "Change your own password from your account rather than resetting it here."
            : "Couldn't reset that password. Try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  /** Your own row, and (for a non-superuser) the owner's, are not resettable —
   *  the API refuses both, so the screen does not offer them. */
  function resettable(u: UserView): boolean {
    if (u.id === user?.id) return false;
    if (u.role === "superuser" && user?.role !== "superuser") return false;
    return true;
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight text-fg">User access</h2>
        <p className="mt-0.5 max-w-3xl text-[13px] text-fg-muted">
          Every user's sign-in identity across this account. Passwords are never displayed — reset a
          user to issue a one-time temporary credential, which they can replace from their account.
        </p>
      </div>

      {reset && (
        <div className="rounded-xl border border-green/40 bg-green-lt px-4 py-3 text-sm">
          <div className="font-medium text-fg">Password reset for {reset.name}.</div>
          {reset.invite.delivered ? (
            <p className="mt-1 text-fg-muted">
              We've emailed {reset.email} the new one-time temporary password.
            </p>
          ) : (
            <>
              <p className="mt-1 text-fg-muted">
                {reset.invite.status === "skipped"
                  ? "Email delivery isn't configured yet, so share this one-time temporary password with"
                  : "The email couldn't be delivered, so share this one-time temporary password with"}{" "}
                {reset.email}:
              </p>
              <code className="mt-2 inline-block rounded bg-surface-2 px-2 py-1 font-mono text-sm text-fg">
                {reset.tempPassword}
              </code>
            </>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red/40 bg-red-lt px-4 py-2.5 text-sm text-red" role="alert">
          {error}
        </div>
      )}

      <Card flush>
        {loadError ? (
          <div className="p-6">
            <EmptyState
              icon="Key"
              title="Couldn't load user access"
              description="Try reloading the page."
            />
          </div>
        ) : !rows ? (
          <p className="p-6 text-sm text-fg-muted">Loading users…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left">
              <thead>
                <tr className="text-fg-muted">
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">User</th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">
                    Username
                  </th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide">
                    Password
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wide">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => {
                  const state = STATE_COPY[passwordState(u)];
                  return (
                    <tr key={u.id} className="border-t border-line">
                      <td className="px-4 py-3">
                        <div className="font-medium text-fg">{u.name}</div>
                        <div className="text-meta text-fg-muted">{u.title ?? u.roleLabel}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-fg-2">{u.email}</td>
                      <td className="px-4 py-3">
                        <Badge tone={state.tone}>{state.label}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end">
                          {resettable(u) ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busy !== null}
                              onClick={() => doReset(u)}
                              aria-label={`Reset password for ${u.name}`}
                            >
                              <KeyRound className="h-3 w-3" />
                              {busy === u.id ? "Resetting…" : "Reset password"}
                            </Button>
                          ) : (
                            <span className="text-xs text-fg-muted">
                              {u.id === user?.id ? "Your account" : "Account owner"}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <div className="flex items-start gap-2.5">
          <ShieldCheck className="mt-px h-4 w-4 shrink-0 text-olive" />
          <p className="text-[13px] text-fg-muted">
            <span className="font-medium text-fg">Reset only, by design.</span> Passwords are stored
            as PBKDF2 hashes and cannot be read back by anyone, including this screen — so there is
            no reveal control. A reset issues a fresh one-time credential and emails it; it is shown
            here only while no sending domain is configured, so you can relay it yourself.
          </p>
        </div>
      </Card>
    </div>
  );
}
