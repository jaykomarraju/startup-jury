import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { Logo, Button, Card } from "../components";

/** Seed demo logins (all use password demo1234) surfaced as a dev convenience. */
const DEMO_LOGINS: { label: string; email: string }[] = [
  { label: "Incubator · Superuser", email: "priya.sharma@demo.startupjury.ai" },
  { label: "Incubator · Program Associate", email: "sunita.rao@demo.startupjury.ai" },
  { label: "Incubator · Jury", email: "rajesh.kumar@demo.startupjury.ai" },
  { label: "VC · Managing Partner", email: "aarav.khanna@demo.startupjury.ai" },
  { label: "VC · Analyst", email: "rhea.nair@demo.startupjury.ai" },
  { label: "VC · IC Member", email: "rajesh.kumar.vc@demo.startupjury.ai" },
];

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate("/app", { replace: true });
    } catch {
      setError("Invalid email or password.");
    } finally {
      setSubmitting(false);
    }
  }

  function fillDemo(demoEmail: string) {
    setEmail(demoEmail);
    setPassword("demo1234");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-topbar px-4 py-10">
      <Logo size={40} className="text-white" />
      <Card className="w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold text-fg">Sign in</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Venture intelligence first.
        </p>
        <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="u-label">Email</span>
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-10 rounded-lg border border-line bg-surface px-3 text-sm text-fg outline-none focus:border-amber focus:ring-1 focus:ring-amber/40"
              placeholder="you@firm.com"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="u-label">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-10 rounded-lg border border-line bg-surface px-3 text-sm text-fg outline-none focus:border-amber focus:ring-1 focus:ring-amber/40"
              placeholder="••••••••"
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-signal-flagged">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={submitting} className="mt-1 w-full">
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Card>

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
    </div>
  );
}
