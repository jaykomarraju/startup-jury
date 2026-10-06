// TWO screens, one file, because they are the same screen with a different proof.
//
//   `/reset-password?token=…`  PUBLIC. The proof is the single-use token from the
//                             email. Calls `POST /api/auth/reset-password`.
//   `/change-password`        SIGNED IN. The proof is your current password, plus
//                             the session. Calls `PUT /api/users/me/password`.
//
// Both choose a new password, both enforce the same minimum and the same confirm,
// and both are siblings of `/login` outside the `/app` shell. They share this file
// rather than one importing the other across a boundary; this lane owns exactly
// the auth screens, so a third page file was not available to it, and keeping the
// pair together is the arrangement that would have been chosen anyway.
//
// `/change-password` exists because the route it calls has been real, scoped and
// tested since F0075 (`server/routes/users.ts:520-556`) and had **zero callers**:
// `grep -rn changeOwnPassword` returned exactly one line, the definition at
// `routes/admin/teamApi.ts:117`. Meanwhile the invite email promised "choose your
// own password straight away" (`email/outbox.ts:635`) and the console promised
// "they can change it from their account once they're in"
// (`admin/TeamRoles.tsx:1120`). Both sentences were false for the whole life of
// the product (`docs/plan_pilot_gcw.md` §5.2). This is the screen that makes them
// true.
//
// It is a route and not a console section on purpose: the two people who most
// need it are a user holding a temporary password an administrator read out, and
// a user who has just spent a reset link — and neither of those should have to
// find their way through a nav menu on a phone to get there. L4 links it from the
// account menu; it also works as a URL somebody can be told over the phone.

import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, LinkIcon } from "lucide-react";
import { ApiError, MIN_PASSWORD_LENGTH, changeMyPassword, resetPassword } from "../api";
import { useAuth } from "../auth/useAuth";
import type { FieldErrors } from "../../shared/accountOrder";
import {
  AuthButton,
  AuthCard,
  AuthField,
  AuthFooterLink,
  AuthNotice,
  AuthShell,
} from "./LoginPage";

/**
 * The two rules both screens share. Checked client-side so the user is told
 * before a round trip, and again server-side because that is where it counts
 * (`users.ts:524`).
 */
function passwordErrors(password: string, confirm: string): FieldErrors {
  const errors: FieldErrors = {};
  if (password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (confirm !== password) errors.confirmPassword = "Both passwords must match.";
  return errors;
}

/**
 * The codes that mean "this link is finished" — as opposed to "this password is
 * no good", which is also a 400. The code is checked BEFORE the status for
 * exactly that reason.
 *
 * Several spellings are accepted because a single-use token has three distinct
 * ends (never existed, expired, already spent) and they are indistinguishable to
 * the user: every one of them means "ask for a new link". Mapping them to one
 * outcome is not laziness, it is the only honest thing the screen can say.
 */
const DEAD_LINK_CODES = new Set([
  "invalid_token",
  "token_invalid",
  "token_expired",
  "expired_token",
  "token_used",
  "token_not_found",
  "not_found",
]);

/** The success state both screens end in. */
function Done({
  title,
  body,
  link,
}: {
  title: string;
  body: string;
  link: { to: string; label: string };
}) {
  return (
    <AuthShell>
      <AuthCard>
        <CheckCircle2 className="h-7 w-7 text-signal-strong" aria-hidden />
        <h1 className="mt-2 text-lg font-semibold text-fg">{title}</h1>
        <p className="mt-2 text-sm text-fg-muted">{body}</p>
        <div className="mt-4 flex flex-col border-t border-line pt-2">
          <AuthFooterLink to={link.to}>{link.label}</AuthFooterLink>
        </div>
      </AuthCard>
    </AuthShell>
  );
}

/** The dead-link state: the one thing to do about it is ask for another. */
function DeadLink({ reason }: { reason: string }) {
  return (
    <AuthShell>
      <AuthCard>
        <LinkIcon className="h-7 w-7 text-signal-flagged" aria-hidden />
        <h1 className="mt-2 text-lg font-semibold text-fg">This link no longer works</h1>
        <p className="mt-2 text-sm text-fg-muted">{reason}</p>
        <p className="mt-3 text-sm text-fg-muted">
          Reset links can only be used once and they expire quickly. Ask for a fresh one and use the
          newest email.
        </p>
        <div className="mt-4 flex flex-col border-t border-line pt-2">
          <AuthFooterLink to="/forgot-password">Send me a new link</AuthFooterLink>
          <AuthFooterLink to="/login">Back to sign in</AuthFooterLink>
        </div>
      </AuthCard>
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [dead, setDead] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // No token in the query string at all. Almost always a mail client that broke
  // the URL across a line, so the copy names that rather than implying the user
  // did something wrong.
  if (!token) {
    return (
      <DeadLink reason="This address has no reset code in it — email programs sometimes split a long link across two lines." />
    );
  }
  if (dead) return <DeadLink reason={dead} />;
  if (done) {
    return (
      <Done
        title="Password updated"
        body="Your new password is active. Sign in with it now."
        link={{ to: "/login", label: "Go to sign in" }}
      />
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const next = passwordErrors(password, confirm);
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length > 0) return;
    setSubmitting(true);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      if (!(err instanceof ApiError)) {
        setFormError("We couldn't reach the server. Check your connection and try again.");
      } else if (err.code && DEAD_LINK_CODES.has(err.code)) {
        setDead("This reset link has already been used, or it has expired.");
      } else if (err.code === "password_too_short") {
        setErrors({ password: `Use at least ${MIN_PASSWORD_LENGTH} characters.` });
      } else if (err.status === 429) {
        setFormError("Too many attempts from this device. Wait a minute, then try again.");
      } else if (err.status >= 500) {
        setFormError("Something went wrong on our side. Please try again in a moment.");
      } else if (err.status === 404 || err.status === 410) {
        // An unnamed 404/410 on this route can only be the token.
        setDead("This reset link has already been used, or it has expired.");
      } else {
        setFormError("We couldn't set that password. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <AuthCard>
        <h1 className="text-lg font-semibold text-fg">Choose a new password</h1>
        <p className="mt-1 text-sm text-fg-muted">
          This link works once. Pick a password you haven&rsquo;t used here before.
        </p>
        <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-3" noValidate>
          <AuthField
            id="reset-password"
            label="New password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
            error={errors.password}
            hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          />
          <AuthField
            id="reset-confirm-password"
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={setConfirm}
            error={errors.confirmPassword}
          />
          {formError && <AuthNotice tone="error">{formError}</AuthNotice>}
          <AuthButton disabled={submitting} className="mt-1">
            {submitting ? "Saving…" : "Set new password"}
          </AuthButton>
        </form>
        <div className="mt-4 flex flex-col border-t border-line pt-2">
          <AuthFooterLink to="/login">Back to sign in</AuthFooterLink>
        </div>
      </AuthCard>
    </AuthShell>
  );
}

/**
 * `/change-password` — signed in, and the only caller of
 * `PUT /api/users/me/password` anywhere in the product.
 *
 * `must_change_password` is written by the three routes that issue a credential
 * and enforced by none of them — sign-in does NOT yet refuse a principal carrying
 * it (`users.ts:511-516` says so in its own words), and `/api/auth/me` does not
 * return the flag yet either. So this screen only EXPLAINS the flag when the
 * principal happens to carry it, and never gates on it. When the enforcement
 * lands, this is the screen it sends people to.
 */
export function ChangePasswordPage() {
  const { user } = useAuth();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <Done
        title="Password changed"
        body="Your new password is active. You're still signed in on this device."
        link={{ to: "/app", label: "Back to the app" }}
      />
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const next = passwordErrors(password, confirm);
    if (!current) next.currentPassword = "Enter your current password.";
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length > 0) return;
    setSubmitting(true);
    try {
      await changeMyPassword(current, password);
      setDone(true);
    } catch (err) {
      if (!(err instanceof ApiError)) {
        setFormError("We couldn't reach the server. Check your connection and try again.");
      } else if (err.code === "invalid_credentials") {
        // 403 here means the CURRENT password was wrong — not the new one, and
        // not the session. Putting it on that field is the whole point.
        setErrors({ currentPassword: "That isn't your current password." });
      } else if (err.code === "password_unchanged") {
        setErrors({ password: "This is already your password. Choose a different one." });
      } else if (err.code === "password_too_short") {
        setErrors({ password: `Use at least ${MIN_PASSWORD_LENGTH} characters.` });
      } else if (err.status === 401) {
        setFormError("Your session has expired. Sign in again, then change your password.");
      } else if (err.status >= 500) {
        setFormError("Something went wrong on our side. Please try again in a moment.");
      } else {
        setFormError("We couldn't change your password. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <AuthCard>
        <h1 className="text-lg font-semibold text-fg">Change your password</h1>
        {user?.mustChangePassword ? (
          <p className="mt-1 text-sm text-fg">
            You&rsquo;re still using the temporary password you were given. Choose your own now.
          </p>
        ) : (
          <p className="mt-1 text-sm text-fg-muted">
            {user ? `Signed in as ${user.name}. ` : ""}Enter your current password, then the new one.
          </p>
        )}
        <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-3" noValidate>
          <AuthField
            id="change-current-password"
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={setCurrent}
            error={errors.currentPassword}
          />
          <AuthField
            id="change-new-password"
            label="New password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
            error={errors.password}
            hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          />
          <AuthField
            id="change-confirm-password"
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={setConfirm}
            error={errors.confirmPassword}
          />
          {formError && <AuthNotice tone="error">{formError}</AuthNotice>}
          <AuthButton disabled={submitting} className="mt-1">
            {submitting ? "Saving…" : "Change password"}
          </AuthButton>
        </form>
        <div className="mt-4 flex flex-col border-t border-line pt-2">
          <Link
            to="/app"
            className="inline-flex min-h-11 items-center text-sm text-olive underline-offset-2 hover:underline"
          >
            Cancel and go back
          </Link>
        </div>
      </AuthCard>
    </AuthShell>
  );
}
