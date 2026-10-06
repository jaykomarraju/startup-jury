import { useState, type ButtonHTMLAttributes, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { LoginFailure, type LoginTenant } from "../auth/AuthProvider";
import { Logo, Card } from "../components";

// ── The shared kit for the five auth screens ─────────────────────────────────
//
// `/login`, `/signup`, `/forgot-password`, `/reset-password` and
// `/change-password` are siblings outside the `/app` shell, so none of them gets
// `AppShell`'s layout and all five need the same dark page, the same card and
// the same inputs. The pieces live in this file rather than in
// `src/client/components/` because this lane owns exactly the auth screens and
// `components/` belongs to no lane this wave — moving them to
// `components/AuthKit.tsx` later is a move, not a behaviour change.
//
// **MOBILE IS THE REQUIREMENT, not a later pass.** The pilot customer's
// administrator creates their account on a phone, on a live call, with people
// watching. Everything below was chosen for a 393 px viewport:
//
//   * inputs are `text-base` (16 px). Below 16 px iOS Safari zooms the viewport
//     on focus **and does not zoom back** — the trigger measured 2026-10-05, and
//     the reason `docs/plan_pilot_gcw.md` §11 fix 4 already raised the two login
//     fields from `text-sm`.
//   * `h-11` is 44 px, the minimum comfortable touch target. The shared
//     `Button`'s `md` size is `h-8` (32 px), which is right for a toolbar chip
//     and not right for the one action on a form somebody is tapping on stage.
//   * the page is top-aligned below `sm:` and centred only above it. A centred
//     tall form inside `min-h-screen` puts the submit button under the virtual
//     keyboard with nothing above it to scroll against; top-aligned it simply
//     scrolls.
//   * every form is one column. The only two-column row in these screens
//     (first/last name) is `sm:` and up, so nothing can overflow 393 px.
//
// `min-h-dvh` is deliberately NOT used: §11 holds `h-screen` → `h-dvh` back
// until someone has held a real iPhone, and these are `min-h-*` screens that
// grow with their content either way, so that finding does not bite here.

/** The dark branded page every auth screen renders inside. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center gap-6 bg-topbar px-4 py-10 sm:justify-center">
      <Logo size={40} className="text-white" />
      {children}
    </div>
  );
}

/** The white card: one per screen, phone-width first. */
export function AuthCard({ children, className }: { children: ReactNode; className?: string }) {
  return <Card className={`w-full max-w-sm p-6 ${className ?? ""}`}>{children}</Card>;
}

interface AuthFieldProps {
  /** Drives `htmlFor`, and ties the error or hint to the input for a11y. */
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "password";
  autoComplete?: string;
  placeholder?: string;
  /** A field-level refusal. Replaces the hint while it is showing. */
  error?: string;
  hint?: string;
  required?: boolean;
}

/**
 * One labelled input. Never auto-focused: on a phone an auto-focused field
 * throws the keyboard up over the form before the user has read any of it.
 */
export function AuthField({
  id,
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  placeholder,
  error,
  hint,
  required,
}: AuthFieldProps) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="u-label">
        {label}
      </label>
      <input
        id={id}
        type={type}
        // An email keyboard puts `@` and `.` on the primary layer and, with
        // `autoCapitalize="none"`, stops the phone capitalising the first
        // letter — which is what otherwise turns a typed address into an account
        // that registers and then cannot sign in.
        inputMode={type === "email" ? "email" : undefined}
        autoCapitalize={type === "email" ? "none" : undefined}
        autoCorrect={type === "email" ? "off" : undefined}
        spellCheck={type === "email" ? false : undefined}
        autoComplete={autoComplete}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        placeholder={placeholder}
        className={`h-11 w-full rounded-lg border bg-surface px-3 text-base text-fg outline-none focus:ring-1 ${
          error
            ? "border-signal-flagged focus:border-signal-flagged focus:ring-signal-flagged/40"
            : "border-line focus:border-amber focus:ring-amber/40"
        }`}
      />
      {error ? (
        <p id={`${id}-error`} className="text-xs text-signal-flagged">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-fg-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The primary action: full width, 44 px, olive (the prototype's primary is olive,
 * `.tbb.pr{background:var(--olive)}` — gold is the logo).
 *
 * A native `<button>` rather than the shared `Button` with an override class:
 * `Button` composes `h-8` from `SIZES` ahead of the caller's `className`, and
 * which of two height utilities wins is decided by their order in the generated
 * stylesheet, not by their order in the attribute. A 44 px tap target that
 * depends on Tailwind's emission order is not something to take to a live call.
 */
export function AuthButton({
  children,
  className,
  type = "submit",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={`inline-flex h-11 w-full items-center justify-center rounded-lg bg-olive px-4 text-base font-medium text-white transition-colors hover:bg-olive-dk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive disabled:pointer-events-none disabled:opacity-50 ${className ?? ""}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * A form-level message. `role="alert"` so it is announced rather than left for
 * the user to hunt for, and the colour is the only difference between the two
 * tones — the words carry the meaning.
 */
export function AuthNotice({ tone, children }: { tone: "error" | "info"; children: ReactNode }) {
  return (
    <p role="alert" className={`text-sm ${tone === "error" ? "text-signal-flagged" : "text-fg-2"}`}>
      {children}
    </p>
  );
}

/** A cross-link at the foot of an auth card. 44 px tall, so it is tappable. */
export function AuthFooterLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex min-h-11 items-center text-sm text-olive underline-offset-2 hover:underline"
    >
      {children}
    </Link>
  );
}

/**
 * Seed demo logins (all use password demo1234) surfaced as a dev convenience.
 *
 * **Keep this in step with `migrations/0002_seed.sql:45-56`.** It listed six of
 * the twelve seeded accounts and omitted the incubator Admin and Program
 * Manager, which produced the client's 21-Sep report that "there should be 5
 * roles … Prog. manager and Admin. are missing": this card is the only set of
 * credentials the product hands out, so a tester who has not been sent
 * `docs/DEMO.md` cannot sign in as a role it leaves off, and reasonably
 * concludes the role does not exist. Both roles were fully built the whole
 * time — 26 and 22 sidebar items, their own prototypes and their own pinned
 * screen sets in `e2e/parity.spec.ts`. Nothing was missing but this list.
 *
 * Ordered by edition, then by the role order in `PERMISSION_ROLES`, so the card
 * reads as the role model rather than as a sample. Pinned in
 * `test/client/loginDemoLogins.test.tsx`.
 */
const DEMO_LOGINS: { label: string; email: string }[] = [
  { label: "Incubator · Superuser", email: "priya.sharma@demo.startupjury.ai" },
  { label: "Incubator · Admin", email: "nisha.kapoor@demo.startupjury.ai" },
  { label: "Incubator · Program Manager", email: "raj.kumar@demo.startupjury.ai" },
  { label: "Incubator · Program Associate", email: "sunita.rao@demo.startupjury.ai" },
  { label: "Incubator · Jury Member", email: "rajesh.kumar@demo.startupjury.ai" },
  { label: "Incubator · Founder", email: "meera.sharma@demo.startupjury.ai" },
  { label: "VC · Managing Partner", email: "aarav.khanna@demo.startupjury.ai" },
  { label: "VC · Admin", email: "nisha.kapoor.vc@demo.startupjury.ai" },
  { label: "VC · Partner", email: "ishaan.sethi@demo.startupjury.ai" },
  { label: "VC · IC Member", email: "rajesh.kumar.vc@demo.startupjury.ai" },
  { label: "VC · Investment Associate", email: "sunita.rao.vc@demo.startupjury.ai" },
  { label: "VC · Analyst", email: "rhea.nair@demo.startupjury.ai" },
];

/**
 * What a refused sign-in SAYS.
 *
 * One line per distinct server condition, because they are not the same problem
 * and three of them are not the user's problem at all. The product shipped a
 * single string for every one of them and the cost was measured: a
 * `409 tenant_required` cannot be recovered from the sign-in screen, it read as
 * a wrong password, so the user reset a password that was never wrong and it did
 * not help (`docs/plan_pilot_gcw.md` §8). A 500 read the same way (§11).
 *
 * **401 stays exactly as it was**, deliberately: an unknown address and a wrong
 * password must remain indistinguishable, or this screen becomes a way to find
 * out who holds an account. Note the status is checked before the code, so any
 * 401 — whatever the server names it — gets the credential line.
 *
 * An unknown 4xx code falls back to a NEUTRAL line rather than to the credential
 * one. If the server grows a condition this client has not learned yet, the
 * honest answer is "we couldn't sign you in", not "your password is wrong".
 */
export function loginMessage(err: LoginFailure): string {
  if (err.status === 0) {
    return "We couldn't reach the server. Check your connection and try again.";
  }
  if (err.status === 429) {
    return "Too many sign-in attempts from this device. Wait a minute, then try again.";
  }
  if (err.status >= 500) {
    return "Something went wrong on our side — this is not your password. Please try again in a moment.";
  }
  if (err.status === 401) return "Invalid email or password.";
  switch (err.code) {
    case "pending_approval":
      return "Your account is waiting for approval from your administrator. You'll be able to sign in as soon as they approve it.";
    case "account_disabled":
      return "This account has been deactivated. Ask your administrator to switch it back on.";
    case "invalid_credentials":
      return "Invalid email or password.";
    default:
      return "We couldn't sign you in. Please check your email address, or ask your administrator.";
  }
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Non-empty only after a `409 tenant_required`. The credential was CORRECT at
  // that point — the route reaches the 409 only once the password has opened
  // more than one workspace — so the password stays in state and the second
  // attempt re-sends it with the slug the user picked.
  const [tenants, setTenants] = useState<LoginTenant[]>([]);
  const [submitting, setSubmitting] = useState(false);

  async function attempt(tenant?: string) {
    setError(null);
    setSubmitting(true);
    try {
      // Lower-cased, not just trimmed. Every production account was written
      // through `users.ts:308`, which lower-cases, and the seed is lower-case;
      // `/login` compares with a plain `=`, measured case-sensitive. So a phone
      // keyboard capitalising the first letter is today a failed sign-in with a
      // correct password — and normalising here can only help, because there is
      // no stored address with a capital in it for it to break.
      await login(email.trim().toLowerCase(), password, tenant);
      navigate("/app", { replace: true });
    } catch (err) {
      if (err instanceof LoginFailure) {
        if (err.code === "tenant_required" && err.tenants.length > 0) {
          setTenants(err.tenants);
          return;
        }
        setTenants([]);
        setError(loginMessage(err));
        return;
      }
      // Not a LoginFailure at all — a fault in our own code rather than a
      // refusal from the server. Say that, instead of blaming the password.
      setError("Something went wrong on this page. Please reload and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void attempt();
  }

  function fillDemo(demoEmail: string) {
    setEmail(demoEmail);
    setPassword("demo1234");
  }

  return (
    <AuthShell>
      <AuthCard>
        <h1 className="text-lg font-semibold text-fg">Sign in</h1>
        <p className="mt-1 text-sm text-fg-muted">Venture intelligence first.</p>
        <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-3">
          <AuthField
            id="login-email"
            label="Email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={setEmail}
            placeholder="you@firm.com"
          />
          <AuthField
            id="login-password"
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={setPassword}
            placeholder="••••••••"
          />
          {error && <AuthNotice tone="error">{error}</AuthNotice>}
          <AuthButton disabled={submitting} className="mt-1">
            {submitting ? "Signing in…" : "Sign in"}
          </AuthButton>
        </form>

        {/* The `409 tenant_required` branch, which until now was a dead end. It
            is reachable only with a CORRECT password and it lists only the
            workspaces that password opened, so naming them here tells the user
            nothing they did not already have access to. */}
        {tenants.length > 0 && (
          <div className="mt-4 border-t border-line pt-4">
            <h2 className="text-sm font-semibold text-fg">Choose your workspace</h2>
            <p className="mt-1 text-sm text-fg-muted">
              This email and password open more than one workspace. Pick the one you want to sign
              in to.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {tenants.map((t) => (
                <button
                  key={t.slug}
                  type="button"
                  disabled={submitting}
                  onClick={() => void attempt(t.slug)}
                  className="flex h-11 w-full items-center justify-between rounded-lg border border-line bg-surface px-3 text-base text-fg hover:bg-surface-2 disabled:opacity-50"
                >
                  <span>{t.name}</span>
                  <span className="text-xs text-fg-muted">{t.slug}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-col border-t border-line pt-2">
          <AuthFooterLink to="/forgot-password">Forgot your password?</AuthFooterLink>
          <AuthFooterLink to="/signup">New here? Create an account</AuthFooterLink>
        </div>
      </AuthCard>

      {/* DEV ONLY — until 2026-10-05 this card shipped to production unguarded,
          and the deployed bundle was verified to contain every
          `@demo.startupjury.ai` address and the literal `demo1234`. The pilot
          customer presents this product on a conference projector, so the first
          screen of the demo was handing the room a working superuser credential
          for the workspace holding their own startups' decks.

          `import.meta.env.DEV` rather than deleting the card: Vite strips the
          branch from the production bundle, while `npm run dev`,
          `npm run e2e:serve` and vitest all run with DEV true — measured — so
          `test/client/loginDemoLogins.test.tsx`, which parses `0002_seed.sql`
          and asserts this list matches the seed, keeps its value unchanged.

          This does NOT revoke the credential: those twelve rows are live in
          production D1 and the addresses are guessable, so they still need
          deactivating. Rotating the password instead breaks `scripts/smoke.mjs`
          and `scripts/role-matrix.ts`, which both hardcode it. `docs/plan_pilot_gcw.md` §7. */}
      {import.meta.env.DEV && (
        <Card className="w-full max-w-sm p-4">
          <div className="u-label mb-2">Demo logins · password demo1234</div>
          <ul className="flex flex-col gap-1">
            {DEMO_LOGINS.map((d) => (
              <li key={d.email}>
                <button
                  type="button"
                  onClick={() => fillDemo(d.email)}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs text-fg-muted hover:bg-surface-2 hover:text-fg"
                >
                  <span>{d.label}</span>
                  <span className="font-mono">{d.email}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </AuthShell>
  );
}
