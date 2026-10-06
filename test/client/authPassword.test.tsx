import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthContext, type AuthUser } from "../../src/client/auth/AuthProvider";
import { ForgotPasswordPage } from "../../src/client/routes/ForgotPasswordPage";
import { ResetPasswordPage, ChangePasswordPage } from "../../src/client/routes/ResetPasswordPage";

/**
 * The three screens that let somebody recover or replace their own credential.
 *
 * Two of them are new routes; the third, `/change-password`, is new only as a
 * SCREEN — `PUT /api/users/me/password` has been real, scoped and tested since
 * F0075 and `grep -rn changeOwnPassword` returned exactly one line, its own
 * definition. The invite email and the Admin console had both been promising this
 * for the whole life of the product (`docs/plan_pilot_gcw.md` §5.2).
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Sent {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

function stubFetch(reply: { status: number; body?: unknown } = { status: 200 }): Sent[] {
  const seen: Sent[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
    });
    return new Response(JSON.stringify(reply.body ?? { ok: true }), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return seen;
}

// ── /forgot-password ─────────────────────────────────────────────────────────

function mountForgot() {
  return render(
    <MemoryRouter>
      <ForgotPasswordPage />
    </MemoryRouter>,
  );
}

function ask(email: string) {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
}

describe("/forgot-password", () => {
  it("shows one confirmation for any address, and SAYS that it does", async () => {
    stubFetch();
    mountForgot();
    ask("asha.nair@globalcarbonwarriors.com");

    expect(await screen.findByText("Check your email")).toBeInTheDocument();
    expect(screen.getByText(/If an account exists for/)).toBeInTheDocument();
    // The requirement is that the answer not reveal existence. The ADDITION is
    // that the screen explains why, so a non-technical user is not left deciding
    // whether they typed their own address wrong.
    expect(
      screen.getByText(/same message whether or not that address is registered/),
    ).toBeInTheDocument();
    expect(screen.getByText(/could be used to find out who has an account/)).toBeInTheDocument();
  });

  it("names the admin-mediated fallback, because no email is being delivered yet", async () => {
    // `wrangler.jsonc` vars.EMAIL_FROM is "", so `outbox.ts` records every
    // message and dispatches nothing. Until the sending domain is onboarded, no
    // reset email arrives for anybody — a confirmation that did not say so would
    // be true and useless.
    stubFetch();
    mountForgot();
    ask("asha.nair@globalcarbonwarriors.com");

    expect(await screen.findByText(/Nothing arrived\?/)).toBeInTheDocument();
    expect(screen.getByText(/Admin . Team & roles/)).toBeInTheDocument();
  });

  it("gives the identical confirmation for an address that cannot exist", async () => {
    stubFetch();
    mountForgot();
    ask("nobody@notacustomer.example");

    expect(await screen.findByText("Check your email")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("lower-cases the address before sending it", async () => {
    const seen = stubFetch();
    mountForgot();
    ask("  Asha.Nair@GlobalCarbonWarriors.COM ");

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0].url).toBe("/api/auth/forgot-password");
    expect(seen[0].body.email).toBe("asha.nair@globalcarbonwarriors.com");
  });

  it("checks the shape locally and sends nothing for a non-address", async () => {
    const seen = stubFetch();
    mountForgot();
    ask("not-an-address");

    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(seen).toHaveLength(0);
  });

  it("surfaces a rate-limit as a rate-limit", async () => {
    stubFetch({ status: 429, body: { error: "rate_limited" } });
    mountForgot();
    ask("asha.nair@globalcarbonwarriors.com");

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many requests");
    expect(screen.queryByText("Check your email")).not.toBeInTheDocument();
  });

  it("lets the user try a different address without a reload", async () => {
    stubFetch();
    mountForgot();
    ask("asha.nair@globalcarbonwarriors.com");
    fireEvent.click(await screen.findByRole("button", { name: "Try a different address" }));

    expect(screen.getByLabelText("Email")).toHaveValue("");
  });
});

// ── /reset-password?token=… ──────────────────────────────────────────────────

function mountReset(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/reset-password${search}`]}>
      <ResetPasswordPage />
    </MemoryRouter>,
  );
}

function setNew(password: string, confirm = password, labels = ["New password", "Confirm new password"]) {
  fireEvent.change(screen.getByLabelText(labels[0]), { target: { value: password } });
  fireEvent.change(screen.getByLabelText(labels[1]), { target: { value: confirm } });
}

describe("/reset-password", () => {
  it("takes the token from the query string and spends it", async () => {
    const seen = stubFetch();
    mountReset("?token=tok-abc123");
    setNew("carbon-2026");
    fireEvent.click(screen.getByRole("button", { name: "Set new password" }));

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0].url).toBe("/api/auth/reset-password");
    expect(seen[0].body).toMatchObject({ token: "tok-abc123", password: "carbon-2026" });
    expect(await screen.findByText("Password updated")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute("href", "/login");
  });

  it("says so, and offers a new link, when the URL carries no token at all", () => {
    const seen = stubFetch();
    mountReset("");

    expect(screen.getByText("This link no longer works")).toBeInTheDocument();
    // The usual cause is a mail client splitting a long URL, so the copy names
    // that rather than implying the user did something wrong.
    expect(screen.getByText(/split a long link across two lines/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Send me a new link" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
    expect(seen).toHaveLength(0);
  });

  it("turns a spent or expired token into the one action that helps", async () => {
    stubFetch({ status: 400, body: { error: "token_expired" } });
    mountReset("?token=tok-stale");
    setNew("carbon-2026");
    fireEvent.click(screen.getByRole("button", { name: "Set new password" }));

    expect(await screen.findByText("This link no longer works")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Send me a new link" })).toBeInTheDocument();
  });

  it("keeps a short password on the field, not on the link", async () => {
    // Both are 400s. If the code were not read before the status, a password
    // that is merely too short would throw away a perfectly good token.
    stubFetch({ status: 400, body: { error: "password_too_short" } });
    mountReset("?token=tok-abc123");
    setNew("carbon-2026");
    fireEvent.click(screen.getByRole("button", { name: "Set new password" }));

    expect(await screen.findByText("Use at least 8 characters.")).toBeInTheDocument();
    expect(screen.queryByText("This link no longer works")).not.toBeInTheDocument();
  });

  it("refuses a mismatch locally, with no round trip", async () => {
    const seen = stubFetch();
    mountReset("?token=tok-abc123");
    setNew("carbon-2026", "carbon-2027");
    fireEvent.click(screen.getByRole("button", { name: "Set new password" }));

    expect(await screen.findByText("Both passwords must match.")).toBeInTheDocument();
    expect(seen).toHaveLength(0);
  });
});

// ── /change-password ─────────────────────────────────────────────────────────

const USER: AuthUser = {
  id: "u1",
  name: "Asha Nair",
  initials: "AN",
  role: "admin",
  edition: "incubator",
};

function mountChange(user: AuthUser = USER) {
  return render(
    <MemoryRouter>
      <AuthContext.Provider
        value={{ user, loading: false, login: vi.fn(), logout: vi.fn(), updateUser: vi.fn() }}
      >
        <ChangePasswordPage />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

function changeTo(current: string, next: string, confirm = next) {
  fireEvent.change(screen.getByLabelText("Current password"), { target: { value: current } });
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: next } });
  fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: confirm } });
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));
}

describe("/change-password — the screen the route never had", () => {
  it("calls PUT /api/users/me/password, the route with zero callers until now", async () => {
    const seen = stubFetch();
    mountChange();
    changeTo("demo1234", "carbon-2026");

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0].url).toBe("/api/users/me/password");
    expect(seen[0].method).toBe("PUT");
    expect(seen[0].body).toMatchObject({
      currentPassword: "demo1234",
      newPassword: "carbon-2026",
    });
    expect(await screen.findByText("Password changed")).toBeInTheDocument();
  });

  it("puts a wrong CURRENT password on the current-password field", async () => {
    // The route answers 403 `invalid_credentials` for that case. Rendering it as
    // a form-level error would leave the user re-typing the new password.
    stubFetch({ status: 403, body: { error: "invalid_credentials" } });
    mountChange();
    changeTo("wrong", "carbon-2026");

    expect(await screen.findByText("That isn't your current password.")).toBeInTheDocument();
  });

  it("explains password_unchanged instead of repeating the server's word for it", async () => {
    stubFetch({ status: 400, body: { error: "password_unchanged" } });
    mountChange();
    changeTo("carbon-2026", "carbon-2026");

    expect(
      await screen.findByText("This is already your password. Choose a different one."),
    ).toBeInTheDocument();
  });

  it("explains itself to somebody still holding a temporary password", () => {
    stubFetch();
    mountChange({ ...USER, mustChangePassword: true });

    expect(
      screen.getByText(/still using the temporary password you were given/),
    ).toBeInTheDocument();
  });

  it("says who is signed in when there is nothing to explain", () => {
    stubFetch();
    mountChange();

    expect(screen.getByText(/Signed in as Asha Nair/)).toBeInTheDocument();
  });
});
