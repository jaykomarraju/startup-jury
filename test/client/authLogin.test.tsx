import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../../src/client/auth/AuthProvider";
import { LoginPage } from "../../src/client/routes/LoginPage";

/**
 * `/login`, against the failure it used to tell the same lie about five times.
 *
 * `AuthProvider.tsx:69-83` threw `Error(err.error ?? "login_failed")` and
 * `LoginPage.tsx:51-54` caught every one as "Invalid email or password." So a
 * 500, a rate-limit, a disabled account and the `409 tenant_required` lockout all
 * read as a wrong password — and the user went off and reset a password that was
 * never wrong. Both halves were measured, the 409 with a screenshot
 * (`docs/plan_pilot_gcw.md` §8 and §11).
 *
 * The REAL `AuthProvider` is mounted, not a stub context: the mapping under test
 * spans both files — the provider builds the `LoginFailure` and the page chooses
 * the words — and a stubbed `login` would test neither half against the other.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Sent {
  url: string;
  body: Record<string, unknown>;
}

/**
 * Stub `fetch`. `/api/auth/me` always 401s (nobody is signed in); each entry in
 * `logins` answers one POST to `/api/auth/login`, in order, so the two-step
 * workspace choice can be driven.
 */
function stubFetch(logins: { status: number; body?: unknown }[]): Sent[] {
  const seen: Sent[] = [];
  let next = 0;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/auth/me") {
      return new Response(JSON.stringify({}), { status: 401 });
    }
    seen.push({
      url,
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
    });
    const reply = logins[Math.min(next++, logins.length - 1)];
    return new Response(JSON.stringify(reply.body ?? {}), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return seen;
}

function mount() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function signIn(email = "asha.nair@globalcarbonwarriors.com", password = "carbon-2026") {
  // Wait for the mount-time `/api/auth/me` to settle, or React warns about the
  // state update it lands after the assertions.
  await waitFor(() => expect(screen.getByLabelText("Email")).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("/login — each refusal says its own thing", () => {
  it("401 still says exactly 'Invalid email or password.'", async () => {
    // NOT a cosmetic assertion. An unknown address and a wrong password must stay
    // indistinguishable or this screen becomes a way to enumerate accounts.
    stubFetch([{ status: 401, body: { error: "invalid_credentials" } }]);
    mount();
    await signIn();

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password.");
  });

  it("403 pending_approval tells the registrant what they are waiting for", async () => {
    stubFetch([{ status: 403, body: { error: "pending_approval" } }]);
    mount();
    await signIn();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your account is waiting for approval from your administrator.",
    );
  });

  it("403 account_disabled names the one person who can undo it", async () => {
    stubFetch([{ status: 403, body: { error: "account_disabled" } }]);
    mount();
    await signIn();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This account has been deactivated.",
    );
  });

  it("a 500 is reported as ours, and says so in as many words", async () => {
    stubFetch([{ status: 500, body: {} }]);
    mount();
    await signIn();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("this is not your password");
    expect(alert).not.toHaveTextContent("Invalid email or password.");
  });

  it("429 says to wait rather than to try another password", async () => {
    stubFetch([{ status: 429, body: { error: "rate_limited" } }]);
    mount();
    await signIn();

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many sign-in attempts");
  });

  it("an unreachable server is the user's own network, not their password", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/auth/me") return new Response("{}", { status: 401 });
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    mount();
    await signIn();

    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't reach the server");
  });

  it("an unknown 403 code falls back to neutral, never to the credential line", async () => {
    // The fallback matters because this client cannot know every code the server
    // will grow. Guessing "wrong password" is the failure mode being fixed.
    stubFetch([{ status: 403, body: { error: "some_future_condition" } }]);
    mount();
    await signIn();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("We couldn't sign you in.");
    expect(alert).not.toHaveTextContent("Invalid email or password.");
  });
});

describe("/login — the 409 tenant_required lockout, now a choice", () => {
  it("offers the workspaces the credential opened and re-sends with the slug", async () => {
    const seen = stubFetch([
      {
        status: 409,
        body: {
          error: "tenant_required",
          tenants: [
            { slug: "gcw", name: "Global Carbon Warriors" },
            { slug: "acme", name: "Acme Accelerator" },
          ],
        },
      },
      { status: 200, body: { user: { id: "u1", name: "Asha", initials: "AN", role: "admin", edition: "incubator" } } },
    ]);
    mount();
    await signIn();

    expect(await screen.findByText("Choose your workspace")).toBeInTheDocument();
    // Not an error state: the password was CORRECT, which is the only way the
    // route reaches this branch at all.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Global Carbon Warriors/ }));

    await waitFor(() => expect(seen).toHaveLength(2));
    // The slug the user picked, with the same credential — the route has always
    // accepted `tenant` and nothing ever sent it.
    expect(seen[1].body).toMatchObject({
      email: "asha.nair@globalcarbonwarriors.com",
      password: "carbon-2026",
      tenant: "gcw",
    });
  });

  it("sends no tenant key at all on an ordinary first attempt", async () => {
    const seen = stubFetch([{ status: 401, body: { error: "invalid_credentials" } }]);
    mount();
    await signIn();

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0].body).not.toHaveProperty("tenant");
  });

  it("falls back to a message when the 409 carries no usable tenant list", async () => {
    // Defensive: a 409 with nothing to choose from must not render an empty
    // picker with no way forward.
    stubFetch([{ status: 409, body: { error: "tenant_required", tenants: [{ slug: 7 }] } }]);
    mount();
    await signIn();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("Choose your workspace")).not.toBeInTheDocument();
  });
});

describe("/login — what it sends, and where it points", () => {
  it("lower-cases the address, because the server compares it case-sensitively", async () => {
    const seen = stubFetch([{ status: 401, body: { error: "invalid_credentials" } }]);
    mount();
    await signIn("  Asha.Nair@GlobalCarbonWarriors.COM  ");

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0].body.email).toBe("asha.nair@globalcarbonwarriors.com");
  });

  it("links to the two screens somebody stuck here actually needs", async () => {
    stubFetch([{ status: 401 }]);
    mount();
    await waitFor(() => expect(screen.getByLabelText("Email")).toBeInTheDocument());

    expect(screen.getByRole("link", { name: "Forgot your password?" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
    expect(screen.getByRole("link", { name: "New here? Create an account" })).toHaveAttribute(
      "href",
      "/signup",
    );
  });

  it("keeps both inputs at 16px, the iOS auto-zoom threshold", async () => {
    stubFetch([{ status: 401 }]);
    mount();
    await waitFor(() => expect(screen.getByLabelText("Email")).toBeInTheDocument());

    // Below 16px iOS Safari zooms the viewport on focus and does not zoom back —
    // the first tap of the demo, on the screen that matters most
    // (`docs/plan_pilot_gcw.md` §11 fix 4). Class names are inert strings in
    // jsdom, so the class is what there is to assert on; it is still the one
    // thing a careless edit would quietly undo.
    for (const label of ["Email", "Password"]) {
      expect(screen.getByLabelText(label).className).toContain("text-base");
      expect(screen.getByLabelText(label).className).not.toContain("text-sm");
    }
  });
});
