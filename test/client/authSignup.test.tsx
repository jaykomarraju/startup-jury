import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SignupPage } from "../../src/client/routes/SignupPage";

/**
 * `/signup` — the product's first self-service account creation, and the first
 * screen of the pilot customer's live call.
 *
 * `fetch` is stubbed rather than the api module, deliberately: the thing most
 * likely to cost that call is not the form, it is the **normalisation**.
 * `users.email` is UNIQUE per tenant with no `COLLATE NOCASE` after `0087` and
 * `/login` compares with a plain `=` — measured case-sensitive — so an address
 * registered with a capital letter creates an account that can never sign in. A
 * phone keyboard capitalises the first letter of a field by default. Asserting on
 * the body that actually leaves `registerAccount` is the only way to pin that.
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

/** Stub `fetch`, returning the calls it saw. `reply` shapes the one response. */
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

function mount() {
  return render(
    <MemoryRouter>
      <SignupPage />
    </MemoryRouter>,
  );
}

/** Fill the form. Every value is overridable so one branch can be broken. */
function fill(over: Partial<Record<string, string>> = {}) {
  const values: Record<string, string> = {
    "First name": "Asha",
    "Last name": "Nair",
    "Work email": "asha.nair@globalcarbonwarriors.com",
    "Job title (optional)": "Programme Manager",
    Password: "carbon-2026",
    "Confirm password": "carbon-2026",
    ...over,
  };
  for (const [label, value] of Object.entries(values)) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
}

describe("/signup — validation, before anything is sent", () => {
  it("refuses a personal address with the client's own stated rule, and sends nothing", async () => {
    const seen = stubFetch();
    mount();
    fill({ "Work email": "asha.nair@gmail.com" });
    submit();

    expect(
      await screen.findByText("Personal email addresses are not accepted."),
    ).toBeInTheDocument();
    // The whole point of reusing `validateAccountFields` is that this refusal
    // costs no round trip and cannot drift from the server's copy.
    expect(seen).toHaveLength(0);
  });

  it("refuses a mismatched confirmation", async () => {
    const seen = stubFetch();
    mount();
    fill({ "Confirm password": "carbon-2027" });
    submit();

    expect(await screen.findByText("Both passwords must match.")).toBeInTheDocument();
    expect(seen).toHaveLength(0);
  });

  it("refuses a password under the minimum", async () => {
    const seen = stubFetch();
    mount();
    fill({ Password: "short", "Confirm password": "short" });
    submit();

    expect(await screen.findByText("Use at least 8 characters.")).toBeInTheDocument();
    expect(seen).toHaveLength(0);
  });

  it("asks for the names it needs", async () => {
    const seen = stubFetch();
    mount();
    fill({ "First name": "", "Last name": "" });
    submit();

    expect(await screen.findByText("Enter your first name.")).toBeInTheDocument();
    expect(screen.getByText("Enter your last name.")).toBeInTheDocument();
    expect(seen).toHaveLength(0);
  });

  it("names no role and no organisation anywhere on the form", () => {
    stubFetch();
    mount();
    // A registrant never chooses their own role (§7.4) and never creates an
    // organisation (§6) — so neither control exists to be tampered with.
    expect(screen.queryByLabelText(/role/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/organisation|organization/i)).not.toBeInTheDocument();
  });
});

describe("/signup — what reaches the server", () => {
  it("lower-cases and trims the address, and sends no role", async () => {
    const seen = stubFetch({ status: 200, body: { ok: true } });
    mount();
    fill({ "Work email": "  Asha.Nair@GlobalCarbonWarriors.COM  " });
    submit();

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0].url).toBe("/api/auth/register");
    expect(seen[0].method).toBe("POST");
    // The load-bearing assertion of this file.
    expect(seen[0].body.email).toBe("asha.nair@globalcarbonwarriors.com");
    expect(seen[0].body).toMatchObject({
      firstName: "Asha",
      lastName: "Nair",
      name: "Asha Nair",
      designation: "Programme Manager",
      password: "carbon-2026",
    });
    expect(seen[0].body).not.toHaveProperty("role");
    expect(seen[0].body).not.toHaveProperty("active");
    expect(seen[0].body).not.toHaveProperty("approvalState");
    expect(seen[0].body).not.toHaveProperty("tenant");
  });

  it("omits an empty job title rather than sending a blank one", async () => {
    const seen = stubFetch();
    mount();
    fill({ "Job title (optional)": "   " });
    submit();

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0].body).not.toHaveProperty("designation");
  });
});

describe("/signup — the awaiting-approval state", () => {
  it("is a screen that stays, not a toast, and says who has to act", async () => {
    stubFetch({
      status: 200,
      body: { ok: true, pendingApproval: true, organization: { name: "Global Carbon Warriors" } },
    });
    mount();
    fill();
    submit();

    expect(await screen.findByText("Account created")).toBeInTheDocument();
    expect(
      screen.getByText("Your account is awaiting approval from your administrator."),
    ).toBeInTheDocument();
    // It names the workspace the domain resolved to — the one thing the
    // registrant cannot otherwise check, and the one thing that could be wrong.
    expect(screen.getByText("Global Carbon Warriors")).toBeInTheDocument();
    expect(screen.getByText("asha.nair@globalcarbonwarriors.com")).toBeInTheDocument();
    // The form is gone, so there is nothing to submit twice.
    expect(screen.queryByRole("button", { name: "Create account" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/login");
  });

  it("still reads sensibly when the server names no organisation", async () => {
    stubFetch({ status: 200, body: { ok: true } });
    mount();
    fill();
    submit();

    expect(
      await screen.findByText("Your account is awaiting approval from your administrator."),
    ).toBeInTheDocument();
    expect(screen.getByText(/in your organisation's workspace/)).toBeInTheDocument();
  });
});

describe("/signup — every refusal the register route can return", () => {
  it("no_workspace_for_domain names the domain and the way out", async () => {
    stubFetch({ status: 403, body: { error: "no_workspace_for_domain" } });
    mount();
    fill({ "Work email": "someone@notacustomer.example" });
    submit();

    expect(
      await screen.findByText(
        "No workspace is registered for notacustomer.example. Ask your administrator to send you an invite.",
      ),
    ).toBeInTheDocument();
  });

  it("personal_email_not_accepted lands on the email field", async () => {
    // Reachable even though the client checks first: the server's free-mail list
    // is the same list, and this is the belt to that braces.
    stubFetch({ status: 400, body: { error: "personal_email_not_accepted" } });
    mount();
    fill();
    submit();

    expect(
      await screen.findByText("Personal email addresses aren't accepted. Use your work address."),
    ).toBeInTheDocument();
  });

  it("a duplicate address points at sign-in and at the reset, not at nothing", async () => {
    stubFetch({ status: 409, body: { error: "email_taken" } });
    mount();
    fill();
    submit();

    expect(await screen.findByText(/An account already exists for this address/)).toBeInTheDocument();
    expect(screen.getByText(/Forgot your password/)).toBeInTheDocument();
  });

  it("an unnamed 409 is still read as the duplicate, because it can be nothing else", async () => {
    stubFetch({ status: 409, body: {} });
    mount();
    fill();
    submit();

    expect(await screen.findByText(/An account already exists for this address/)).toBeInTheDocument();
  });

  it("429 says to wait, and keeps what was typed", async () => {
    stubFetch({ status: 429, body: { error: "rate_limited" } });
    mount();
    fill();
    submit();

    expect(await screen.findByText(/Too many attempts from this device/)).toBeInTheDocument();
    // A limiter that costs the user their form is a limiter they will defeat by
    // retyping it, which is the opposite of the point.
    expect(screen.getByLabelText("Work email")).toHaveValue("asha.nair@globalcarbonwarriors.com");
    expect(screen.getByLabelText("First name")).toHaveValue("Asha");
  });

  it("a 500 is a 500 and never a credential problem", async () => {
    stubFetch({ status: 500, body: {} });
    mount();
    fill();
    submit();

    expect(await screen.findByText(/Something went wrong on our side/)).toBeInTheDocument();
  });

  it("an unreachable server is reported as unreachable", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    mount();
    fill();
    submit();

    expect(await screen.findByText(/couldn't reach the server/)).toBeInTheDocument();
  });
});
