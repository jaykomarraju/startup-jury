// PUBLIC `/signup` — the first screen of the pilot customer's live call, and the
// product's first self-service account creation. A sibling of `/login`,
// deliberately outside the `/app` subtree: a registrant has no session, and the
// catch-all in `App.tsx` would otherwise bounce them to the sign-in screen.
//
// **It joins an existing organisation. It never creates one.** The workspace is
// resolved server-side from the email domain (`organizations.email_domain`) and
// never from anything this form sends, so there is no organisation field here and
// no account-type picker: the three-step "Create your account" flow in
// `docs/PARITY-BUILD-SPEC.md:149-166` is the SIGNED-IN org-creation wizard that
// already exists at `account/AccountScreens.tsx:313-689`, not this screen.
//
// Nothing here chooses a role or an activation state either. A registrant lands
// `active = 0, approval_state = 'pending', role = 'jury'` and an administrator
// sets the real role when they approve — the approval half is the load-bearing
// one, because with no email verification a stranger who guesses the domain would
// otherwise already be inside (`docs/plan_pilot_gcw.md` §6).

import { useState, type FormEvent } from "react";
import { CheckCircle2 } from "lucide-react";
import {
  ApiError,
  MIN_PASSWORD_LENGTH,
  registerAccount,
  type RegisterResult,
} from "../api";
import { validateAccountFields, type FieldErrors } from "../../shared/accountOrder";
import {
  AuthButton,
  AuthCard,
  AuthField,
  AuthFooterLink,
  AuthNotice,
  AuthShell,
} from "./LoginPage";

/**
 * Fixed, and never a question on this screen.
 *
 * `validateAccountFields` requires `accountType` to be one of its two literals
 * (`shared/accountOrder.ts:295-297`) because the signed-in wizard branches on it.
 * Here the registrant is joining an organisation's workspace by definition — the
 * domain already resolved to one — so the value is supplied rather than asked
 * for, and it is not sent to the server, which takes the workspace from the
 * address and nothing else.
 */
const ACCOUNT_TYPE = "organization";

/** The domain half of whatever has been typed so far, for the refusal copy. */
function domainOf(email: string): string {
  const at = email.trim().toLowerCase().lastIndexOf("@");
  return at > -1 ? email.trim().toLowerCase().slice(at + 1) : "";
}

/**
 * A server refusal, placed either on the field it belongs to or on the form.
 *
 * Every code the register route can return is named here. The `field` keys match
 * `validateAccountFields`'s own keys (`workEmail`, not `email`) so one error map
 * drives both halves and a server-side refusal lands under the input that caused
 * it — which, on a phone, is the difference between a fixable form and a dead
 * end.
 */
function registerRefusal(err: unknown, email: string): { field?: string; message: string } {
  if (!(err instanceof ApiError)) {
    return { message: "We couldn't reach the server. Check your connection and try again." };
  }
  if (err.status === 429) {
    return {
      message:
        "Too many attempts from this device. Wait a minute, then try again — your details are still here.",
    };
  }
  if (err.status >= 500) {
    return {
      message: "Something went wrong on our side. Please try again in a moment.",
    };
  }
  switch (err.code) {
    case "personal_email_not_accepted":
      return {
        field: "workEmail",
        message: "Personal email addresses aren't accepted. Use your work address.",
      };
    case "no_workspace_for_domain": {
      const domain = domainOf(email);
      return {
        field: "workEmail",
        message: domain
          ? `No workspace is registered for ${domain}. Ask your administrator to send you an invite.`
          : "No workspace is registered for that email domain. Ask your administrator to send you an invite.",
      };
    }
    case "email_taken":
      return {
        field: "workEmail",
        message:
          "An account already exists for this address. Sign in instead, or use “Forgot your password?”.",
      };
    case "password_too_short":
      return { field: "password", message: `Use at least ${MIN_PASSWORD_LENGTH} characters.` };
    default:
      // A 409 this client has not learned a name for can only be the duplicate
      // case on this route — say the useful thing rather than a generic one.
      if (err.status === 409) {
        return {
          field: "workEmail",
          message:
            "An account already exists for this address. Sign in instead, or use “Forgot your password?”.",
        };
      }
      return {
        message: "We couldn't create your account. Check your details, or ask your administrator.",
      };
  }
}

export function SignupPage() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [designation, setDesignation] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // The success STATE, not a toast. A registrant who cannot sign in yet has to
  // be told why, in words that stay on the screen long enough to read twice and
  // to repeat to whoever is sitting next to them.
  const [done, setDone] = useState<RegisterResult | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    // The shared validator, not a second copy of it: `validateAccountFields`
    // runs on the server too, and it already applies `isWorkEmail`
    // (`accountOrder.ts:303`), which is the client's own stated rule —
    // "Personal email addresses are not accepted" — over the 16 free-mail
    // domains in `PERSONAL_EMAIL_DOMAINS`.
    const next: FieldErrors = validateAccountFields({
      accountType: ACCOUNT_TYPE,
      workEmail: email,
      firstName,
      lastName,
      designation,
    });
    if (password.length < MIN_PASSWORD_LENGTH) {
      next.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (confirm !== password) next.confirmPassword = "Both passwords must match.";
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    try {
      setDone(
        await registerAccount({
          email,
          password,
          firstName,
          lastName,
          ...(designation.trim() ? { designation } : {}),
        }),
      );
    } catch (err) {
      const refusal = registerRefusal(err, email);
      if (refusal.field) setErrors({ [refusal.field]: refusal.message });
      else setFormError(refusal.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    const org = done.organization?.name;
    return (
      <AuthShell>
        <AuthCard>
          <CheckCircle2 className="h-7 w-7 text-signal-strong" aria-hidden />
          <h1 className="mt-2 text-lg font-semibold text-fg">Account created</h1>
          <p className="mt-2 text-sm font-medium text-fg">
            Your account is awaiting approval from your administrator.
          </p>
          <p className="mt-3 text-sm text-fg-muted">
            We&rsquo;ve created{" "}
            <span className="font-medium text-fg">{email.trim().toLowerCase()}</span>
            {org ? (
              <>
                {" "}
                in <span className="font-medium text-fg">{org}</span>
              </>
            ) : (
              " in your organisation's workspace"
            )}
            . You&rsquo;ll be able to sign in as soon as an administrator approves it and sets your
            role &mdash; they can see the request under Admin &rarr; Team &amp; roles.
          </p>
          <p className="mt-3 text-sm text-fg-muted">
            Nothing more to do here. If it&rsquo;s urgent, tell them directly &mdash; approving takes
            them a few seconds.
          </p>
          <div className="mt-4 flex flex-col border-t border-line pt-2">
            <AuthFooterLink to="/login">Back to sign in</AuthFooterLink>
          </div>
        </AuthCard>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <AuthCard>
        <h1 className="text-lg font-semibold text-fg">Create your account</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Work email required. You&rsquo;ll join the workspace your organisation already has &mdash;
          an administrator approves the account and sets your role.
        </p>
        <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-3" noValidate>
          {/* Two columns only from `sm:` up. At 393 px these stack, which is the
              whole point — a two-column name row is the first thing to overflow
              a phone. */}
          <div className="flex flex-col gap-3 sm:flex-row sm:gap-2">
            <div className="sm:flex-1">
              <AuthField
                id="signup-first-name"
                label="First name"
                autoComplete="given-name"
                value={firstName}
                onChange={setFirstName}
                error={errors.firstName}
              />
            </div>
            <div className="sm:flex-1">
              <AuthField
                id="signup-last-name"
                label="Last name"
                autoComplete="family-name"
                value={lastName}
                onChange={setLastName}
                error={errors.lastName}
              />
            </div>
          </div>
          <AuthField
            id="signup-email"
            label="Work email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={setEmail}
            placeholder="you@yourcompany.com"
            error={errors.workEmail}
            hint="Personal addresses (Gmail, Outlook and the like) aren't accepted."
          />
          <AuthField
            id="signup-designation"
            label="Job title (optional)"
            autoComplete="organization-title"
            value={designation}
            onChange={setDesignation}
            placeholder="Programme Manager"
            error={errors.designation}
          />
          <AuthField
            id="signup-password"
            label="Password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
            error={errors.password}
            hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          />
          <AuthField
            id="signup-confirm-password"
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={setConfirm}
            error={errors.confirmPassword}
          />
          {formError && <AuthNotice tone="error">{formError}</AuthNotice>}
          <AuthButton disabled={submitting} className="mt-1">
            {submitting ? "Creating your account…" : "Create account"}
          </AuthButton>
        </form>
        <div className="mt-4 flex flex-col border-t border-line pt-2">
          <AuthFooterLink to="/login">Already have an account? Sign in</AuthFooterLink>
        </div>
      </AuthCard>
    </AuthShell>
  );
}
