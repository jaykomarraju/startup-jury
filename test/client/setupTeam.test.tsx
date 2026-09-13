import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TeamStep, type WizardSeat } from "../../src/client/routes/setup/TeamStep";
import type { AuthUser } from "../../src/client/auth/AuthProvider";
import type { SeatMemberView, SeatsView, SeatTier } from "../../src/shared/seats";
import type { ProgramView } from "../../src/client/api";

/**
 * W6-C — Set up step 4 (`#sus-team`) and the buy-seats sub-flow.
 *
 * Every assertion that waits for the screen gates on a POPULATED element — the
 * seat bar, a member card, the order summary — never on the step heading,
 * which the loading and the non-manager branches render too.
 *
 * Prices in these fixtures are fixture data standing in for the published
 * catalogue: the component names no amount, so changing a fixture's price
 * changes the screen (asserted below).
 */

vi.setConfig({ testTimeout: 30_000 });

const ADMIN: AuthUser = { id: "u_admin", name: "Nisha Kapoor", initials: "NK", role: "admin", edition: "incubator" };

function member(over: Partial<SeatMemberView>): SeatMemberView {
  return {
    id: "u_x",
    name: "Someone",
    email: "someone@firm.com",
    role: "jury",
    roleLabel: "Jury Member",
    title: null,
    tier: "standard",
    active: true,
    invitePending: false,
    isSuperuser: false,
    isViewer: false,
    ...over,
  };
}

const VIEWER = member({ id: "u_admin", name: "Nisha Kapoor", email: "nisha.kapoor@firm.com", role: "admin", roleLabel: "Admin", tier: "pro", isViewer: true });
const SUPER = member({ id: "u_super", name: "Priya Sharma", email: "priya.sharma@firm.com", role: "superuser", roleLabel: "Super User", tier: "premium", isSuperuser: true });

function seatsView(over: Partial<SeatsView> & { caps?: Record<SeatTier, number>; proPrice?: number } = {}): SeatsView {
  const members = over.members ?? [VIEWER, SUPER];
  const caps = over.caps ?? { standard: 2, pro: 2, premium: 1 };
  const currency = over.currency ?? "INR";
  const used = { standard: 0, pro: 0, premium: 0 } as Record<SeatTier, number>;
  for (const m of members) used[m.tier] += 1;
  const tiers = (["standard", "pro", "premium"] as SeatTier[]).map((t) => ({
    tier: t,
    label: t === "standard" ? "Standard" : t === "pro" ? "Pro" : "Premium",
    capacity: caps[t],
    used: used[t],
    available: Math.max(0, caps[t] - used[t]),
    over: Math.max(0, used[t] - caps[t]),
    price:
      t === "premium"
        ? null
        : {
            tier: t,
            code: t,
            name: t === "pro" ? "Pro" : "Standard",
            currency,
            amountMinor: t === "pro" ? (over.proPrice ?? 199_900) : 99_900,
            period: "month" as const,
          },
  }));
  const capacity = caps.standard + caps.pro + caps.premium;
  const u = members.length;
  const { caps: _c, proPrice: _p, ...rest } = over;
  void _c;
  void _p;
  return {
    edition: "incubator",
    tiers,
    capacity,
    used: u,
    left: Math.max(0, capacity - u),
    over: tiers.reduce((n, t) => n + t.over, 0),
    purchasedSeats: capacity,
    members,
    superuser: members.find((m) => m.isSuperuser) ?? null,
    roles: [
      { value: "admin", label: "Admin" },
      { value: "program_manager", label: "Program Manager" },
      { value: "jury", label: "Jury Member" },
    ],
    currency,
    tax: { ratePct: 18, registration: null, inclusive: false, internationalNotice: true },
    catalogue: { version: 3, publishedAt: "2026-09-01" },
    paymentConfigured: false,
    ...rest,
  };
}

interface Sent {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mockApi(
  initial: SeatsView,
  handlers: Partial<Record<string, (body: Record<string, unknown>) => Response>> = {},
) {
  const sent: Sent[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    if (method !== "GET") sent.push({ url, method, body });
    const h = handlers[`${method} ${url}`];
    if (h) return h(body);
    if (url === "/api/seats") return json(initial);
    return json({ ok: true });
  }) as unknown as typeof fetch;
  return sent;
}

const PROGRAMS = [
  { id: "p1", name: "Fintech Accelerator", active: true, cohorts: [] },
  { id: "p2", name: "Climate Cohort", active: true, cohorts: [] },
] as unknown as ProgramView[];

function renderTeam(opts: { seat?: WizardSeat; user?: AuthUser; edition?: "incubator" | "vc" } = {}) {
  const onFinish = vi.fn();
  const onFlowChange = vi.fn();
  render(
    <MemoryRouter>
      <TeamStep
        user={opts.user ?? ADMIN}
        edition={opts.edition ?? "incubator"}
        seat={opts.seat ?? "full"}
        programs={PROGRAMS}
        onFinish={onFinish}
        onFlowChange={onFlowChange}
      />
    </MemoryRouter>,
  );
  return { onFinish, onFlowChange };
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("the team step", () => {
  it("empty: the owner card, the super user and a seat bar with room — and no member cards", async () => {
    mockApi(seatsView());
    renderTeam();
    const bar = await screen.findByTestId("seat-bar");
    expect(bar).toHaveTextContent("2 total users · 3 seats left for nomination");
    expect(within(bar).getByTestId("seat-tier-premium")).toHaveTextContent("Premium 1 / 1");
    expect(within(bar).getByTestId("seat-tier-pro")).toHaveTextContent("Pro 1 / 2");
    expect(within(bar).getByTestId("seat-tier-standard")).toHaveTextContent("Standard 0 / 2");
    expect(screen.getByText("You — account owner")).toBeInTheDocument();
    expect(screen.getByTestId("superbox")).toHaveTextContent("Super user — priya.sharma@firm.com");
    expect(screen.queryAllByTestId("seat-member")).toHaveLength(0);
    expect(screen.getByRole("button", { name: /^Add$/ })).toBeEnabled();
    // The prototype's copy, and its footer.
    expect(screen.getByRole("heading", { name: "Add team members" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip for now" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirm & go to dashboard/ })).toBeInTheDocument();
    // The old redirect is gone.
    expect(screen.queryByText(/Add the rest of your team in the Admin console/)).toBeNull();
  });

  it("populated: one card per member, each with its own plan; expanding one shows its plan toggle", async () => {
    const jury = member({ id: "u_j", email: "rajesh.kumar@firm.com", tier: "standard" });
    const pm = member({ id: "u_pm", email: "meera.sharma@firm.com", role: "program_manager", roleLabel: "Program Manager", tier: "pro" });
    mockApi(seatsView({ members: [VIEWER, SUPER, jury, pm], caps: { standard: 5, pro: 20, premium: 5 } }));
    renderTeam();
    const cards = await screen.findAllByTestId("seat-member");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText("rajesh.kumar@firm.com")).toBeInTheDocument();
    expect(within(cards[0]).getByText("Standard")).toBeInTheDocument();
    expect(within(cards[1]).getByText("Pro")).toBeInTheDocument();

    fireEvent.click(within(cards[1]).getByRole("button", { name: /meera.sharma/ }));
    const toggle = await within(cards[1]).findByRole("group", { name: "Plan for meera.sharma@firm.com" });
    expect(within(toggle).getByRole("button", { name: "Pro" })).toHaveAttribute("aria-pressed", "true");
    expect(within(cards[1]).getByText(/Pro — Can configure the 13 core parameters/)).toBeInTheDocument();
  });

  it("a plan toggle PUTs the member's tier and redraws from the answer", async () => {
    const jury = member({ id: "u_j", email: "rajesh.kumar@firm.com", tier: "standard" });
    const after = seatsView({ members: [VIEWER, SUPER, { ...jury, tier: "pro" }] });
    const sent = mockApi(seatsView({ members: [VIEWER, SUPER, jury] }), {
      "PUT /api/seats/members/u_j/tier": () => json({ ok: true, seats: after }),
    });
    renderTeam();
    const [card] = await screen.findAllByTestId("seat-member");
    fireEvent.click(within(card).getByRole("button", { name: /rajesh.kumar/ }));
    const toggle = await within(card).findByRole("group", { name: "Plan for rajesh.kumar@firm.com" });
    fireEvent.click(within(toggle).getByRole("button", { name: "Pro" }));
    await waitFor(() => expect(sent).toEqual([{ url: "/api/seats/members/u_j/tier", method: "PUT", body: { tier: "pro" } }]));
    await waitFor(() => expect(screen.getByTestId("seat-tier-pro")).toHaveTextContent("Pro 2 / 2"));
  });

  it("at capacity: the add is refused with the server's named message and nobody is added", async () => {
    const sent = mockApi(seatsView({ caps: { standard: 0, pro: 1, premium: 1 } }), {
      "POST /api/seats/members": () =>
        json(
          {
            error: "seat_limit_reached",
            tier: "standard",
            capacity: 0,
            used: 0,
            message: "No Standard seats left — buy a Standard seat below, then add this user.",
          },
          409,
        ),
    });
    renderTeam();
    const bar = await screen.findByTestId("seat-bar");
    expect(bar).toHaveTextContent("2 total users · 0 seats left for nomination");

    fireEvent.change(screen.getByPlaceholderText("colleague@company.com"), { target: { value: "new.person@firm.com" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No Standard seats left — buy a Standard seat below, then add this user.",
    );
    expect(sent[0]).toMatchObject({ url: "/api/seats/members", body: { email: "new.person@firm.com", role: "admin", tier: "standard" } });
    expect(screen.queryAllByTestId("seat-member")).toHaveLength(0);
  });

  it("reports a workspace holding more members than seats", async () => {
    const extra = member({ id: "u_2", email: "two@firm.com" });
    mockApi(seatsView({ members: [VIEWER, SUPER, member({ id: "u_1", email: "one@firm.com" }), extra], caps: { standard: 1, pro: 1, premium: 1 } }));
    renderTeam();
    expect(await screen.findByTestId("seat-bar")).toHaveTextContent("1 member over your purchased seats");
  });

  it("the super-user gate: with none nominated, Add is disabled and says why", async () => {
    mockApi(seatsView({ members: [VIEWER] }));
    renderTeam();
    const box = await screen.findByTestId("superbox");
    expect(box).toHaveTextContent("Nominate a super user");
    expect(screen.getByRole("button", { name: /^Add$/ })).toBeDisabled();
    expect(screen.getByText("Nominate a super user above to start adding team members.")).toBeInTheDocument();
  });

  it("the super user sees themselves as the super user", async () => {
    const me = { ...SUPER, isViewer: true };
    mockApi(seatsView({ members: [me] }));
    renderTeam({ user: { ...ADMIN, id: "u_super", role: "superuser" } });
    expect(await screen.findByTestId("superbox")).toHaveTextContent("You are the super user");
  });

  it("an add that succeeds but cannot be emailed shows the credential to relay, not 'Invitation sent'", async () => {
    const created = member({ id: "u_new", email: "new.person@firm.com" });
    mockApi(seatsView(), {
      "POST /api/seats/members": () =>
        json({
          ok: true,
          user: { id: "u_new", email: "new.person@firm.com", tier: "standard" },
          tempPassword: "aisj-abc123",
          invite: { delivered: false, status: "skipped" },
          seats: seatsView({ members: [VIEWER, SUPER, created] }),
        }),
    });
    renderTeam();
    await screen.findByTestId("seat-bar");
    fireEvent.change(screen.getByPlaceholderText("colleague@company.com"), { target: { value: "new.person@firm.com" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    expect(await screen.findByText(/aisj-abc123/)).toBeInTheDocument();
    expect(screen.getByText("Account created for new.person@firm.com")).toBeInTheDocument();
    expect(screen.queryByText(/Invitation sent/)).toBeNull();
    expect(await screen.findAllByTestId("seat-member")).toHaveLength(1);
  });

  it("VC: the add-member row carries Designation and a card reads 'Designation · Role'", async () => {
    const partner = member({ id: "u_p", email: "kabir@vc.com", role: "partner", roleLabel: "Partner", title: "Senior Partner" });
    const sent = mockApi(seatsView({ edition: "vc", members: [VIEWER, SUPER, partner] }));
    renderTeam({ edition: "vc", user: { ...ADMIN, edition: "vc" } });
    const [card] = await screen.findAllByTestId("seat-member");
    expect(card).toHaveTextContent("Senior Partner · Partner");
    fireEvent.change(screen.getByPlaceholderText("e.g. Partner"), { target: { value: "Principal" } });
    fireEvent.change(screen.getByPlaceholderText("colleague@company.com"), { target: { value: "x@vc.com" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    await waitFor(() => expect(sent[0]?.body).toMatchObject({ title: "Principal" }));
  });

  it("incubator: no Designation field", async () => {
    mockApi(seatsView());
    renderTeam();
    await screen.findByTestId("seat-bar");
    expect(screen.queryByPlaceholderText("e.g. Partner")).toBeNull();
  });

  it("a role that does not manage the team is told who does, and fetches nothing", async () => {
    const fetchSpy = mockApi(seatsView());
    void fetchSpy;
    renderTeam({ seat: "readonly", user: { ...ADMIN, role: "program_associate" } });
    expect(screen.getByText(/done by your Super User or an Admin/)).toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(screen.queryByTestId("seat-bar")).toBeNull();
  });

  it("the individual plan panel and its upgrade link", async () => {
    mockApi(seatsView());
    renderTeam();
    await screen.findByTestId("seat-bar");
    fireEvent.click(screen.getByRole("button", { name: "Individual plan" }));
    expect(screen.getByText("Individual plan · single seat")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Upgrade to Enterprise/ })).toHaveAttribute("href", "/app/account");
    expect(screen.queryByTestId("seat-bar")).toBeNull();
  });

  it("View all members: the prototype's five columns, and a row per member", async () => {
    const jury = member({ id: "u_j", name: "Rajesh Kumar", email: "rajesh.kumar@firm.com" });
    mockApi(seatsView({ members: [VIEWER, SUPER, jury] }));
    renderTeam();
    await screen.findByTestId("seat-bar");
    fireEvent.click(screen.getByRole("tab", { name: /View all members/ }));
    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Member",
      "Plan",
      "Role",
      "Status",
      "Programs accessible",
    ]);
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(screen.getByText("3 team members")).toBeInTheDocument();
    expect(within(table).getByText(/You · account owner/)).toBeInTheDocument();
    expect(within(table).getAllByText("✓ Fintech Accelerator")).toHaveLength(3);
  });
});

describe("the buy-seats sub-flow", () => {
  it("Buy a seat → quantities priced from the catalogue → a payment screen with NO card field → a recorded receipt", async () => {
    const bought = seatsView({ caps: { standard: 2, pro: 3, premium: 1 } });
    const sent = mockApi(seatsView(), {
      "POST /api/seats/purchase": () =>
        json({
          ok: true,
          completed: false,
          paymentTaken: false,
          intent: { id: "pi_123", status: "recorded", checkoutUrl: null },
          order: {
            lines: [{ tier: "pro", name: "Pro", quantity: 1, unitMinor: 199_900, amountMinor: 199_900, period: "month" }],
            seats: 1,
            currency: "INR",
            statedMinor: 199_900,
            money: { subtotalMinor: 199_900, taxMinor: 35_982, totalMinor: 235_882, ratePct: 18, inclusive: false, taxed: true },
            period: "month",
          },
          seatsGranted: { standard: 0, pro: 1, premium: 0 },
          seats: bought,
          message:
            "Seat order recorded and your seats are ready to assign. No payment provider is configured, so nothing has been charged — our team will follow up to invoice it.",
        }),
    });
    const { onFlowChange } = renderTeam();
    await screen.findByTestId("seat-bar");

    // 1 · Buy additional seats — opened from the seat bar with one Pro seat chosen.
    fireEvent.click(screen.getByRole("button", { name: "Buy a Pro seat" }));
    expect(await screen.findByTestId("seat-buy-total")).toHaveTextContent("₹2,358.82");
    expect(onFlowChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole("heading", { name: "Buy additional seats" })).toBeInTheDocument();
    expect(screen.getByLabelText("Pro seats")).toHaveValue("1");
    expect(screen.getByText("1 seat selected · incl. 18% GST")).toBeInTheDocument();
    expect(screen.getByText(/each seat is billed monthly/)).toBeInTheDocument();
    // The catalogue does not sell a Premium seat, so it cannot be chosen.
    expect(screen.getByLabelText("Premium seats")).toBeDisabled();
    expect(screen.getByText("Not offered in the published price list")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Standard seats"), { target: { value: "2" } });
    expect(screen.getByTestId("seat-buy-total")).toHaveTextContent("₹4,716.46");
    fireEvent.change(screen.getByLabelText("Standard seats"), { target: { value: "0" } });

    // 2 · Complete payment — a summary and a provider notice; not one input.
    fireEvent.click(screen.getByRole("button", { name: /Continue to payment/ }));
    const summary = await screen.findByTestId("seat-order");
    expect(summary).toHaveTextContent("Pro seat × 1");
    expect(summary).toHaveTextContent("GST (18%)₹359.82");
    expect(summary).toHaveTextContent("Total · month₹2,358.82");
    expect(document.querySelectorAll("input")).toHaveLength(0);
    expect(within(screen.getByTestId("seat-pay")).queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryByText(/card number|cvv|expiry|cardholder/i)).toBeNull();
    expect(screen.getByText(/Card details are never entered into, sent to or stored/)).toBeInTheDocument();
    const place = screen.getByRole("button", { name: /Place order ₹2,358.82/ });

    // 3 · The receipt says recorded, never paid.
    fireEvent.click(place);
    await waitFor(() => expect(sent).toEqual([{ url: "/api/seats/purchase", method: "POST", body: { quantities: { pro: 1 } } }]));
    expect(await screen.findByRole("heading", { name: "Seats added" })).toBeInTheDocument();
    expect(screen.getByText(/1 new seat added to your account · ₹2,358.82 recorded — no payment has been taken/)).toBeInTheDocument();
    expect(screen.getByText("Recorded · not charged")).toBeInTheDocument();
    expect(screen.queryByText(/Payment successful|Paid/)).toBeNull();

    // Back to the team, whose bar now counts the seat bought.
    fireEvent.click(screen.getByRole("button", { name: /Back to team/ }));
    expect(await screen.findByTestId("seat-tier-pro")).toHaveTextContent("Pro 1 / 3");
    expect(onFlowChange).toHaveBeenLastCalledWith(false);
  });

  it("names no price of its own — change the catalogue and the screen changes", async () => {
    mockApi(seatsView({ proPrice: 250_000 }));
    renderTeam();
    await screen.findByTestId("seat-bar");
    fireEvent.click(screen.getByRole("button", { name: "Buy a Pro seat" }));
    // ₹2,500 + 18 % = ₹2,950
    expect(await screen.findByTestId("seat-buy-total")).toHaveTextContent("₹2,950");
    expect(document.body.textContent ?? "").not.toMatch(/per[- ]deck|\/deck/i);
  });

  it("a non-INR workspace is quoted without GST", async () => {
    mockApi(seatsView({ currency: "USD" }));
    renderTeam();
    await screen.findByTestId("seat-bar");
    fireEvent.click(screen.getByRole("button", { name: "Buy a Standard seat" }));
    expect(await screen.findByTestId("seat-buy-summary")).toHaveTextContent("no GST (USD billing)");
    expect(screen.getByTestId("seat-buy-total")).toHaveTextContent("$999");
    fireEvent.click(screen.getByRole("button", { name: /Continue to payment/ }));
    expect(await screen.findByTestId("seat-order")).toHaveTextContent("Not applied · USD billing");
  });

  it("Continue is unavailable with nothing selected", async () => {
    mockApi(seatsView());
    renderTeam();
    await screen.findByTestId("seat-bar");
    // Premium has no price, so buying "a Premium seat" opens the screen with nothing chosen.
    fireEvent.click(screen.getByRole("button", { name: "Buy a Premium seat" }));
    expect(await screen.findByTestId("seat-buy-total")).toHaveTextContent("₹0");
    expect(screen.getByRole("button", { name: /Continue to payment/ })).toBeDisabled();
  });
});
