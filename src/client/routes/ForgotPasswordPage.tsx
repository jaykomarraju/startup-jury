// PUBLIC `/forgot-password` — the half of the reset pair that asks, paired with
// `/reset-password` which spends the token. A sibling of `/login`, outside
// `/app`: whoever needs this has no session by definition.
//
// **The confirmation is the same whether or not the address exists, and this
// screen SAYS so.** Hiding the difference is the security requirement — a reset
// form that answers "no such account" is an account-enumeration oracle, and
// `/login` already goes to some length to keep an unknown address and a wrong
// password indistinguishable (`server/routes/auth.ts:131-137`). But a silent
// identical answer leaves a non-technical user staring at a screen with no way to
// tell "sent" from "that isn't your address", so the page explains WHY it cannot
// be more specific, and names the fallback that always works.
//
// That fallback is not hypothetical: `wrangler.jsonc` `vars.EMAIL_FROM` is `""`,
// so `email/outbox.ts` records every message with `status='recorded'` and
// dispatches nothing (`emailDeliveryConfigured`, `outbox.ts:257-259`). Until the
// sending domain is onboarded, NO reset email will arrive for anybody — the
// admin-mediated `POST /api/users/:id/reset-password`, which hands the
// administrator the temporary password to pass on, is the working path. Saying so
// here is the difference between a user who waits and one who asks.

import { useState, type FormEvent } from "react";
import { MailCheck } from "lucide-react";
import { ApiError, requestPasswordReset } from "../api";
import { isEmail } from "../../shared/accountOrder";
import {
  AuthButton,
  AuthCard,
  AuthField,
  AuthFooterLink,
  AuthNotice,
  AuthShell,
} from "./LoginPage";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // The address the confirmation names. Held separately from `email` so that
  // "Try a different address" can clear the input without the confirmation
  // changing under the user mid-read.
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const typed = email.trim().toLowerCase();
    // Shape only. `isEmail` is the same check the account screens use
    // (`shared/accountOrder.ts:272`) and it says nothing about existence —
    // `isWorkEmail` is deliberately NOT applied here, because somebody whose
    // account was created before the work-email rule, or created for them by an
    // administrator, must still be able to reset their password.
    if (!isEmail(typed)) {
      setFieldError("Enter a valid email address.");
      return;
    }
    setFieldError(undefined);
    setFormError(null);
    setSubmitting(true);
    try {
      await requestPasswordReset(typed);
      setSentTo(typed);
    } catch (err) {
      // Only two failures are worth distinguishing, and NEITHER of them reveals
      // anything about the address: the route answers 2xx for an unknown one.
      if (err instanceof ApiError && err.status === 429) {
        setFormError("Too many requests from this device. Wait a minute, then try again.");
      } else if (err instanceof ApiError && err.status >= 500) {
        setFormError("Something went wrong on our side. Please try again in a moment.");
      } else {
        setFormError("We couldn't reach the server. Check your connection and try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (sentTo) {
    return (
      <AuthShell>
        <AuthCard>
          <MailCheck className="h-7 w-7 text-signal-strong" aria-hidden />
          <h1 className="mt-2 text-lg font-semibold text-fg">Check your email</h1>
          <p className="mt-2 text-sm text-fg">
            If an account exists for <span className="font-medium">{sentTo}</span>, we&rsquo;ve sent
            it a link to choose a new password. The link works once and expires shortly.
          </p>
          <p className="mt-3 text-sm text-fg-muted">
            You&rsquo;ll see this same message whether or not that address is registered. That&rsquo;s
            deliberate &mdash; otherwise this page could be used to find out who has an account here.
          </p>
          <p className="mt-3 text-sm text-fg-muted">
            <span className="font-medium text-fg">Nothing arrived?</span> Email sending isn&rsquo;t
            switched on for every workspace yet. Ask your administrator to reset your password for
            you from Admin &rarr; Team &amp; roles &mdash; they&rsquo;re shown a temporary one to pass
            on, and you can change it straight away once you&rsquo;re in.
          </p>
          <div className="mt-4 flex flex-col border-t border-line pt-2">
            <button
              type="button"
              onClick={() => {
                setSentTo(null);
                setEmail("");
              }}
              className="inline-flex min-h-11 items-center text-left text-sm text-olive underline-offset-2 hover:underline"
            >
              Try a different address
            </button>
            <AuthFooterLink to="/login">Back to sign in</AuthFooterLink>
          </div>
        </AuthCard>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <AuthCard>
        <h1 className="text-lg font-semibold text-fg">Forgot your password?</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Enter the email address you sign in with and we&rsquo;ll send you a link to choose a new
          password.
        </p>
        <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-3" noValidate>
          <AuthField
            id="forgot-email"
            label="Email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={setEmail}
            placeholder="you@firm.com"
            error={fieldError}
          />
          {formError && <AuthNotice tone="error">{formError}</AuthNotice>}
          <AuthButton disabled={submitting} className="mt-1">
            {submitting ? "Sending…" : "Send reset link"}
          </AuthButton>
        </form>
        <div className="mt-4 flex flex-col border-t border-line pt-2">
          <AuthFooterLink to="/login">Back to sign in</AuthFooterLink>
        </div>
      </AuthCard>
    </AuthShell>
  );
}
