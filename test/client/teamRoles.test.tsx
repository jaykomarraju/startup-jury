import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { TeamRolesSection } from "../../src/client/routes/admin/TeamRoles";
import { UserAccessSection } from "../../src/client/routes/admin/UserAccess";
import { AuthContext, type AuthUser } from "../../src/client/auth/AuthProvider";
import { ROLE_LABELS, type Edition, type Role } from "../../src/shared/roles";
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_ROLES,
  PERMISSION_TASK_GROUPS,
  permissionTasksFor,
} from "../../src/shared/types";
import type { UserView } from "../../src/client/api";

/**
 * W4-A — Admin console → **Team & roles** and **User access**.
 *
 * The grid is the piece worth pinning hardest, because it is the first
 * authorisation surface an administrator can change without a redeploy:
 *
 *   • the SHAPE per edition — 21 × 5 incubator, 24 × 6 investor — and the three
 *     row groups in `PERMISSION_TASK_GROUPS` order;
 *   • one cell click writes exactly ONE cell, not a column and not the grid;
 *   • the two refusals the API will make (`immutable_superuser`,
 *     `cannot_lock_yourself_out`) are rendered as inert controls rather than
 *     offered and then 403'd.
 *
 * Plus the roster's invite lifecycle and the standing rule on User access: a
 * stored password is never rendered, in any state (plan §1.2 / F0021).
 *
 * `DEFAULT_ROLE_PERMISSIONS` is imported HERE to build a realistic server
 * payload. The component must never import it — the resolved grid the API sends
 * is the one that accounts for an administrator's overrides.
 */

/**
 * Every test here mounts the whole section, and the grid alone is 105 (or 144)
 * interactive cells — a heavy jsdom render by the standards of this suite. On an
 * idle machine each test is well under a second; with the sibling parity
 * worktrees running it has been measured at ten. The 5 s default is therefore a
 * budget these tests can blow for reasons that have nothing to do with what they
 * assert, which is the failure mode §8 Q28 describes and `e2e/parity.spec.ts`
 * and `e2e/coverage.spec.ts` already carry explicit budgets for. Nothing is
 * relaxed about the assertions; only the clock.
 */
vi.setConfig({ testTimeout: 30_000 });

function principal(edition: Edition, role: Role = "admin"): AuthUser {
  return { id: "u_admin", name: "Nisha Kapoor", initials: "NK", role, edition };
}

function member(over: Partial<UserView> = {}): UserView {
  return {
    id: "u1",
    name: "Kabir Malhotra",
    email: "kabir@startupjury.vc",
    role: "program_manager",
    roleLabel: "Program Manager",
    userType: "staff",
    initials: "KM",
    active: true,
    invitePending: false,
    mustChangePassword: false,
    ...over,
  };
}

/** The payload `GET /api/permissions` sends: tasks, role columns, resolved grid. */
function gridPayload(edition: Edition) {
  const tasks = permissionTasksFor(edition);
  const roles = PERMISSION_ROLES[edition];
  return {
    edition,
    roles: roles.map((role) => ({ role, label: ROLE_LABELS[edition][role] ?? role })),
    tasks: tasks.map((t) => ({ id: t.id, label: t.label, group: t.group, note: t.note })),
    grid: Object.fromEntries(
      tasks.map((t) => [
        t.id,
        Object.fromEntries(
          roles.map((role) => [
            role,
            (DEFAULT_ROLE_PERMISSIONS[edition][t.id] as readonly string[]).includes(role),
          ]),
        ),
      ]),
    ),
  };
}

interface Sent {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

function mockApi(
  edition: Edition,
  users: UserView[],
  /** V3-PT — how `PUT /api/users/:id/tier` answers, when a test needs it to refuse. */
  over: { tier?: { status: number; body: unknown } } = {},
) {
  const sent: Sent[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method !== "GET") {
      sent.push({ url, method, body: JSON.parse(String(init?.body ?? "{}")) });
    }
    if (url === "/api/users" && method === "POST") {
      return json({
        user: { id: "u_new", name: "Ananya Iyer", email: "ananya.iyer@firm.com" },
        tempPassword: "aisj-abc123",
        invite: { delivered: false, status: "skipped" },
      });
    }
    if (/\/tier$/.test(url) && over.tier) {
      return new Response(JSON.stringify(over.tier.body), {
        status: over.tier.status,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.startsWith("/api/permissions")) {
      if (method === "PUT") return json({ ok: true, updated: 1, cells: [] });
      return json(gridPayload(edition));
    }
    if (url === "/api/users") return json({ users });
    if (url === "/api/seats") return json(seatsPayload());
    if (url === "/api/config/summary") return json({ plan: "pro" });
    if (url.includes("/reset-password") || url.includes("/resend-invite")) {
      return json({ ok: true, tempPassword: "aisj-abc123", invite: { delivered: false, status: "skipped" } });
    }
    return json({ ok: true });
  }) as unknown as typeof fetch;
  return sent;
}

/**
 * S2-SETUP — what `GET /api/seats` sends. Kept minimal: the card renders the
 * seat bar and opens the shared buy flow, both of which are already pinned in
 * full by `setupTeam.test.tsx`. What is tested HERE is that the card exists for
 * the right principal and for nobody else.
 */
function seatsPayload() {
  const tier = (t: string, used: number, capacity: number, price: boolean) => ({
    tier: t,
    label: t === "standard" ? "Standard" : t === "pro" ? "Pro" : "Premium",
    capacity,
    used,
    available: Math.max(0, capacity - used),
    over: Math.max(0, used - capacity),
    price: price
      ? { tier: t, code: t, name: t, currency: "INR", amountMinor: 199_900, period: "month" }
      : null,
  });
  return {
    edition: "incubator",
    tiers: [tier("standard", 0, 2, true), tier("pro", 1, 2, true), tier("premium", 1, 1, false)],
    capacity: 5,
    used: 2,
    left: 3,
    over: 0,
    purchasedSeats: 5,
    members: [],
    superuser: null,
    roles: [{ value: "admin", label: "Admin" }],
    currency: "INR",
    tax: { ratePct: 18, registration: null, inclusive: false, internationalNotice: true },
    catalogue: { version: 3, publishedAt: "2026-09-01" },
    paymentConfigured: false,
  };
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function renderSection(node: React.ReactElement, edition: Edition, role: Role = "admin") {
  return render(
    <AuthContext.Provider
      value={{
        user: principal(edition, role),
        loading: false,
        login: vi.fn(),
        logout: vi.fn(),
        updateUser: vi.fn(),
      }}
    >
      {node}
    </AuthContext.Provider>,
  );
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// ── The grid ────────────────────────────────────────────────────────────────

describe("task permissions grid", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["incubator" as Edition, 21, 5],
    ["vc" as Edition, 24, 6],
  ])("renders %s as %i tasks × %i roles", async (edition, taskCount, roleCount) => {
    mockApi(edition, [member()]);
    renderSection(<TeamRolesSection />, edition);

    const grid = await screen.findByTestId("permission-grid");
    // The shape the prototype specifies, per edition.
    expect(permissionTasksFor(edition)).toHaveLength(taskCount);
    expect(PERMISSION_ROLES[edition]).toHaveLength(roleCount);
    expect(within(grid).getAllByRole("columnheader")).toHaveLength(roleCount + 1);
    expect(within(grid).getAllByRole("switch")).toHaveLength(taskCount * roleCount);
    // Every task row is present, by its prototype label.
    for (const task of permissionTasksFor(edition)) {
      expect(within(grid).getByRole("rowheader", { name: new RegExp(task.label.replace(/[/]/g, ".")) }))
        .toBeInTheDocument();
    }
  });

  it("groups the rows into the three prototype groups, in order", async () => {
    mockApi("incubator", [member()]);
    renderSection(<TeamRolesSection />, "incubator");
    const grid = await screen.findByTestId("permission-grid");

    const groupCells = within(grid)
      .getAllByRole("cell")
      .filter((c) => c.getAttribute("colspan") !== null)
      .map((c) => c.textContent);
    expect(groupCells).toEqual([...PERMISSION_TASK_GROUPS]);
  });

  it("a cell toggle PUTs exactly one cell", async () => {
    const sent = mockApi("incubator", [member()]);
    renderSection(<TeamRolesSection />, "incubator");

    const cell = await screen.findByRole("switch", { name: "Remind · Program Manager" });
    expect(cell).toHaveAttribute("aria-checked", "true"); // seeded on

    fireEvent.click(cell);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ url: "/api/permissions", method: "PUT" });
    expect(sent[0].body).toEqual({
      cells: [{ role: "program_manager", taskId: "remind", granted: false }],
    });
    // Optimistic, so the cell reads its new value straight away.
    expect(cell).toHaveAttribute("aria-checked", "false");
  });

  it("the superuser column is read-only — the API refuses that row (immutable_superuser)", async () => {
    const sent = mockApi("incubator", [member()]);
    renderSection(<TeamRolesSection />, "incubator");
    await screen.findByTestId("permission-grid");

    const ownerLabel = ROLE_LABELS.incubator.superuser!;
    const ownerCells = screen
      .getAllByRole("switch")
      .filter((el) => el.getAttribute("aria-label")?.endsWith(`· ${ownerLabel}`));
    expect(ownerCells).toHaveLength(permissionTasksFor("incubator").length);
    for (const cell of ownerCells) expect(cell).toBeDisabled();

    fireEvent.click(ownerCells[0]);
    expect(sent).toHaveLength(0);
  });

  it("the caller's own console cell is inert — the API refuses it (cannot_lock_yourself_out)", async () => {
    const sent = mockApi("incubator", [member()]);
    renderSection(<TeamRolesSection />, "incubator", "admin");
    await screen.findByTestId("permission-grid");

    const own = screen.getByRole("switch", { name: "Access to admin console · Admin" });
    expect(own).toBeDisabled();
    fireEvent.click(own);
    expect(sent).toHaveLength(0);

    // Another role's console cell is perfectly toggleable.
    const other = screen.getByRole("switch", { name: "Access to admin console · Jury Member" });
    expect(other).not.toBeDisabled();
  });

  it("marks the rows the grid can express but nothing enforces yet (§8 Q27)", async () => {
    mockApi("incubator", [member()]);
    renderSection(<TeamRolesSection />, "incubator");
    const grid = await screen.findByTestId("permission-grid");

    // Named by the prototype, no verb in the product.
    for (const label of ["Register", "Reassign / Resubmit", "Remind", "Out of office delegation"]) {
      const row = within(grid).getByRole("rowheader", { name: new RegExp(label.replace(/[/]/g, ".")) });
      expect(row).toHaveTextContent("Not enforced yet");
    }
    // The three W4-A gives a verb to are NOT marked.
    for (const label of ["Activate user", "Deactivate user", "Delete user"]) {
      expect(within(grid).getByRole("rowheader", { name: label })).not.toHaveTextContent(
        "Not enforced yet",
      );
    }
  });

  it("says what a cell does, rather than the prototype's 'toggle access'", async () => {
    mockApi("incubator", [member()]);
    renderSection(<TeamRolesSection />, "incubator");
    await screen.findByTestId("permission-grid");
    expect(screen.getByText(/cannot hand a role access it never had/i)).toBeInTheDocument();
    expect(screen.queryByText(/Tap a cell to toggle access/i)).toBeNull();
  });

  it("offers the prototype's narrower Admin default as an action, not a seed (§8 Q7)", async () => {
    const sent = mockApi("incubator", [member()]);
    renderSection(<TeamRolesSection />, "incubator");
    await screen.findByTestId("permission-grid");

    fireEvent.click(screen.getByRole("button", { name: /Make Admin read-only on evaluation/ }));
    await waitFor(() => expect(sent).toHaveLength(1));
    const cells = sent[0].body.cells as { role: string; taskId: string; granted: boolean }[];
    expect(cells.every((c) => c.role === "admin")).toBe(true);
    const off = cells.filter((c) => !c.granted).map((c) => c.taskId);
    expect(off).toEqual(expect.arrayContaining(["upload", "evaluate", "assign", "query"]));
    // …and the console door stays open, or the administrator locks themselves out.
    expect(cells.find((c) => c.taskId === "adminconsole")?.granted).toBe(true);
  });
});

// ── Workspace type + role legend ────────────────────────────────────────────

describe("workspace type and the role legend", () => {
  it("marks the workspace the account actually runs on", async () => {
    mockApi("vc", [member()]);
    renderSection(<TeamRolesSection />, "vc");
    await screen.findByTestId("permission-grid");
    expect(screen.getByTestId("workspace-vc")).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("workspace-incubator")).not.toHaveAttribute("aria-current");
    expect(screen.getByText("Roles & access — Investor")).toBeInTheDocument();
    expect(screen.getByText("Task permissions — Investor")).toBeInTheDocument();
  });

  it("lists exactly the roles the matrix covers — no founder, no mentor", async () => {
    mockApi("incubator", [member()]);
    renderSection(<TeamRolesSection />, "incubator");
    const legend = await screen.findByTestId("role-legend");
    for (const role of PERMISSION_ROLES.incubator) {
      expect(within(legend).getByText(ROLE_LABELS.incubator[role]!)).toBeInTheDocument();
    }
    expect(within(legend).queryByText("Founder")).toBeNull();
    expect(within(legend).queryByText("Mentor")).toBeNull();
  });
});

// ── The roster + invite lifecycle ───────────────────────────────────────────

describe("member roster (F0064 / F0123 / F0148)", () => {
  const ROSTER = [
    member({ id: "u_active", name: "Kabir Malhotra", active: true }),
    member({
      id: "u_pending",
      name: "Tara Nair",
      email: "tara@startupjury.vc",
      role: "admin",
      roleLabel: "Admin",
      initials: "TN",
      invitePending: true,
    }),
    member({ id: "u_off", name: "Devan Iyer", email: "devan@startupjury.vc", active: false }),
  ];

  it("counts ACTIVE members only, and renders a pending invite with Resend / Cancel", async () => {
    mockApi("incubator", ROSTER);
    renderSection(<TeamRolesSection />, "incubator");

    // Three rows, one active, one pending, one inactive → "(1)".
    expect(await screen.findByText("Active members (1)")).toBeInTheDocument();

    const pending = screen.getByText("Tara Nair").closest("tr")!;
    expect(pending).toHaveAttribute("data-pending", "true");
    expect(within(pending).getByText("Invite pending")).toBeInTheDocument();
    expect(within(pending).getByRole("button", { name: "Resend" })).toBeInTheDocument();
    expect(within(pending).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(within(pending).queryByRole("button", { name: "Edit" })).toBeNull();

    const active = screen.getByText("Kabir Malhotra").closest("tr")!;
    expect(within(active).getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(within(active).getByRole("button", { name: "Deactivate" })).toBeInTheDocument();
    expect(within(active).getByRole("button", { name: "Remove Kabir Malhotra" })).toBeInTheDocument();
    expect(within(screen.getByText("Devan Iyer").closest("tr")!).getByRole("button", { name: "Activate" }))
      .toBeInTheDocument();
  });

  it("Remove calls DELETE, and Resend re-issues the invite", async () => {
    const sent = mockApi("incubator", ROSTER);
    renderSection(<TeamRolesSection />, "incubator");
    await screen.findByText("Active members (1)");

    fireEvent.click(screen.getByRole("button", { name: "Remove Kabir Malhotra" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ url: "/api/users/u_active", method: "DELETE" });

    fireEvent.click(screen.getByRole("button", { name: "Resend" }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toMatchObject({ url: "/api/users/u_pending/resend-invite", method: "POST" });
    // No sending domain in this fixture, so the credential is shown to relay.
    expect(await screen.findByText("aisj-abc123")).toBeInTheDocument();
  });

  it("names the designation field as each edition names it", async () => {
    mockApi("vc", [member()]);
    const view = renderSection(<TeamRolesSection />, "vc");
    expect(await screen.findByRole("columnheader", { name: "Designation" })).toBeInTheDocument();
    view.unmount();

    mockApi("incubator", [member()]);
    renderSection(<TeamRolesSection />, "incubator");
    expect(
      await screen.findByRole("columnheader", { name: "Organizational title" }),
    ).toBeInTheDocument();
  });

  it("carries Designation on both the invite row and the edit row (VC)", async () => {
    mockApi("vc", [member()]);
    renderSection(<TeamRolesSection />, "vc");
    await screen.findByText(/Active members/);

    fireEvent.click(screen.getByRole("button", { name: /Invite member/ }));
    expect(screen.getByPlaceholderText("e.g. Partner")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(
      screen.getByRole("textbox", { name: "Designation for kabir@startupjury.vc" }),
    ).toBeInTheDocument();
  });

  /**
   * V3-PT item 16 — the Seat select v3 added to this form (`#tm-add-plan`).
   *
   * The wizard's add-member block was deleted with the rest of its step, and it
   * was the ONLY place a seat tier could be chosen at invite time. So the form
   * posts to `/api/seats/members` — the route that refuses at capacity and
   * records the seat — rather than to `/api/users`, which does neither.
   */
  async function openInvite(name: string, email: string) {
    renderSection(<TeamRolesSection />, "incubator");
    await screen.findByText(/Active members/);
    fireEvent.click(screen.getByRole("button", { name: /Invite member/ }));
    fireEvent.change(screen.getByPlaceholderText("Priya Sharma"), { target: { value: name } });
    fireEvent.change(screen.getByPlaceholderText("colleague@company.com"), { target: { value: email } });
  }

  it("creates the member, then assigns the seat the form chose — two steps, in that order", async () => {
    const sent = mockApi("incubator", [member()]);
    await openInvite("Ananya Iyer", "ananya.iyer@firm.com");

    const seat = screen.getByRole("combobox", { name: "Seat for the new member" });
    expect(Array.from(seat.querySelectorAll("option")).map((o) => o.textContent)).toEqual([
      "Standard",
      "Pro",
      "Premium",
    ]);
    fireEvent.change(seat, { target: { value: "premium" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));

    await waitFor(() => expect(sent.length).toBeGreaterThan(1));
    // Creation is `POST /api/users`, exactly as it was — routing it through the
    // seat route would have added a capacity refusal this screen cannot answer.
    expect(sent[0]).toMatchObject({ url: "/api/users", method: "POST" });
    expect(sent[0].body).toMatchObject({ name: "Ananya Iyer", email: "ananya.iyer@firm.com" });
    expect(sent[0].body).not.toHaveProperty("tier");
    expect(sent[1]).toMatchObject({ url: "/api/seats/members/u_new/tier", method: "PUT" });
    expect(sent[1].body).toEqual({ tier: "premium" });
  });

  it("does not call the seat route at all for the default tier", async () => {
    const sent = mockApi("incubator", [member()]);
    await openInvite("Dev Patel", "dev.patel@firm.com");
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));
    await waitFor(() => expect(sent.length).toBeGreaterThan(0));
    expect(sent.map((c) => c.url)).toEqual(["/api/users"]);
  });

  it("a seat refused at capacity keeps the invite and says the member is on Standard", async () => {
    const sent = mockApi("incubator", [member()], {
      tier: {
        status: 409,
        body: { error: "seat_limit_reached", message: "No Premium seats left — buy a Premium seat." },
      },
    });
    await openInvite("Ananya Iyer", "ananya.iyer@firm.com");
    fireEvent.change(screen.getByRole("combobox", { name: "Seat for the new member" }), {
      target: { value: "premium" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));

    await waitFor(() => expect(sent.length).toBeGreaterThan(1));
    // The member exists — the invite is not lost over a seat…
    expect(await screen.findByText(/Invited Ananya Iyer/)).toBeInTheDocument();
    // …and the reason is not swallowed either.
    expect(screen.getByTestId("invite-seat-note")).toHaveTextContent("No Premium seats left");
    expect(screen.getByTestId("invite-seat-note")).toHaveTextContent("hold a Standard seat until one is free");
  });

  it("a mentor holds no seat, so the Seat select is disabled and no tier is sent", async () => {
    const sent = mockApi("incubator", [member()]);
    await openInvite("Dev Patel", "dev.patel@firm.com");
    fireEvent.change(screen.getByRole("combobox", { name: "User type" }), { target: { value: "mentor" } });
    expect(screen.getByRole("combobox", { name: "Seat for the new member" })).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: "Seat for the new member" }), {
      target: { value: "premium" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));

    await waitFor(() => expect(sent.length).toBeGreaterThan(0));
    expect(sent.map((c) => c.url)).toEqual(["/api/users"]);
    expect(sent[0].body).toMatchObject({ userType: "mentor" });
  });

  it("does not offer row actions on the account owner or on yourself", async () => {
    mockApi("incubator", [
      member({ id: "u_admin", name: "Nisha Kapoor", role: "admin", roleLabel: "Admin" }),
      member({ id: "u_su", name: "Priya Sharma", role: "superuser", roleLabel: "Super User" }),
    ]);
    renderSection(<TeamRolesSection />, "incubator");
    await screen.findByText(/Active members/);
    // Scoped to the roster: the owner's name and the words "Account owner" also
    // appear on the Account owner card above it.
    // `find`, not `get`: "Active members" is the card's heading and renders
    // before the roster body does, so a synchronous get here raced the fetch and
    // failed under load at Wave 9 integration with the table still "Loading team…".
    const roster = within(await screen.findByTestId("member-roster"));
    expect(within(roster.getByText("Nisha Kapoor").closest("tr")!).getByText("You")).toBeInTheDocument();
    expect(
      within(roster.getByText("Priya Sharma").closest("tr")!).getByText("Account owner"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
  });
});

// ── Account owner ───────────────────────────────────────────────────────────

describe("account owner (F0062)", () => {
  const ROSTER = [
    member({ id: "u_su", name: "Priya Sharma", email: "priya@inc.in", role: "superuser", roleLabel: "Super User" }),
    member({ id: "u_pm", name: "Raj Kumar", email: "raj@inc.in" }),
    member({ id: "u_pending", name: "Tara Nair", email: "tara@inc.in", invitePending: true }),
    member({ id: "u_off", name: "Devan Iyer", email: "devan@inc.in", active: false }),
    member({ id: "u_mentor", name: "Anil Mehta", email: "anil@inc.in", role: "mentor", roleLabel: "Mentor", userType: "mentor" }),
  ];

  it("names the owner, and offers the handover only to the owner", async () => {
    mockApi("incubator", ROSTER);
    const view = renderSection(<TeamRolesSection />, "incubator", "admin");
    const card = await screen.findByTestId("account-owner");
    expect(card).toHaveTextContent("Priya Sharma");
    // An administrator can SEE who owns the account but cannot hand it on.
    expect(screen.queryByLabelText("Transfer ownership to")).toBeNull();
    view.unmount();

    mockApi("incubator", ROSTER);
    renderSection(<TeamRolesSection />, "incubator", "superuser");
    await screen.findByTestId("account-owner");
    const picker = screen.getByLabelText("Transfer ownership to");
    // Only an active staff member who has signed in is eligible: not the owner,
    // not a pending invite, not a deactivated row, not a mentor.
    const options = within(picker).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Choose a member…", "Raj Kumar · Program Manager"]);
  });

  it("confirms before transferring, and says what the handover costs you", async () => {
    const sent = mockApi("incubator", ROSTER);
    renderSection(<TeamRolesSection />, "incubator", "superuser");
    await screen.findByTestId("account-owner");

    fireEvent.change(screen.getByLabelText("Transfer ownership to"), { target: { value: "u_pm" } });
    fireEvent.click(screen.getByRole("button", { name: "Transfer ownership" }));
    // Nothing is written until the second click.
    expect(sent).toHaveLength(0);
    expect(screen.getByText(/becomes the account owner and you become an Admin/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Yes, transfer it" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      url: "/api/users/u_pm/transfer-ownership",
      method: "POST",
    });
  });
});

// ── User access ─────────────────────────────────────────────────────────────

describe("user access (F0021 / F0124 — reset only)", () => {
  const ROSTER = [
    member({ id: "u_set", name: "Kabir Malhotra", mustChangePassword: false }),
    member({
      id: "u_temp",
      name: "Raj Kumar",
      email: "raj@incubator.in",
      initials: "RK",
      mustChangePassword: true,
    }),
    member({
      id: "u_pending",
      name: "Tara Nair",
      email: "tara@incubator.in",
      initials: "TN",
      invitePending: true,
      mustChangePassword: true,
    }),
  ];

  it("shows a password STATE and never a password", async () => {
    mockApi("incubator", ROSTER);
    renderSection(<UserAccessSection />, "incubator");
    await screen.findByRole("columnheader", { name: "Password" });

    expect(screen.getByText("Set by the user")).toBeInTheDocument();
    expect(screen.getByText("Temporary — not yet changed")).toBeInTheDocument();
    expect(screen.getByText("Awaiting first sign-in")).toBeInTheDocument();
    // The prototype's reveal control has no counterpart here, deliberately: no
    // control that would show one, and no masked value for one to unmask.
    expect(screen.queryByRole("button", { name: /reveal|show password/i })).toBeNull();
    expect(screen.queryByText("••••••••")).toBeNull();
    expect(screen.getByText(/Passwords are stored\s+as PBKDF2 hashes/)).toBeInTheDocument();
  });

  it("resets a password and relays the one-time credential when mail cannot go out", async () => {
    const sent = mockApi("incubator", ROSTER);
    renderSection(<UserAccessSection />, "incubator");
    await screen.findByRole("columnheader", { name: "Password" });

    fireEvent.click(screen.getByRole("button", { name: "Reset password for Raj Kumar" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ url: "/api/users/u_temp/reset-password", method: "POST" });
    expect(await screen.findByText("aisj-abc123")).toBeInTheDocument();
  });

  it("offers no reset for your own row or for the account owner", async () => {
    mockApi("incubator", [
      member({ id: "u_admin", name: "Nisha Kapoor", role: "admin", roleLabel: "Admin" }),
      member({ id: "u_su", name: "Priya Sharma", role: "superuser", roleLabel: "Super User" }),
    ]);
    renderSection(<UserAccessSection />, "incubator");
    await screen.findByRole("columnheader", { name: "Password" });
    expect(screen.getByText("Your account")).toBeInTheDocument();
    expect(screen.getByText("Account owner")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reset password/ })).toBeNull();
  });
});

// ── Seats — S2-SETUP · 21-Sep item 7 ────────────────────────────────────────

/**
 * Item 7 deletes the Set up wizard's step 4 for the incubator super user, and
 * `setup/TeamStep.tsx` was the ONLY importer of `purchaseSeats`. §4 Q84 names
 * this screen as the destination, so the seat bar and the Buy-additional-seats
 * flow are mounted here — for the principal that lost them, and no one else.
 *
 * The flow's own three screens are pinned in `setupTeam.test.tsx` and are not
 * re-asserted: this is one component rendered in two places, not a copy. What
 * these tests exist for is the GATE, which is the part that can silently widen.
 */
describe("the re-homed seat card", () => {
  beforeEach(() => vi.clearAllMocks());

  it("the incubator super user gets the seat bar and can open the buy flow", async () => {
    mockApi("incubator", [member()]);
    renderSection(<TeamRolesSection />, "incubator", "superuser");

    const bar = await screen.findByTestId("seat-bar");
    expect(bar).toHaveTextContent("2 total users · 3 seats left for nomination");
    expect(within(bar).getByTestId("seat-tier-pro")).toHaveTextContent("Pro 1 / 2");

    fireEvent.click(within(bar).getByRole("button", { name: "Buy a Pro seat" }));
    expect(await screen.findByRole("heading", { name: "Buy additional seats" })).toBeInTheDocument();
    expect(screen.getByLabelText("Pro seats")).toHaveValue("1");

    // Back returns to the screen, not to a blank card.
    fireEvent.click(screen.getByRole("button", { name: /^Back$/ }));
    expect(await screen.findByTestId("seat-bar")).toBeInTheDocument();
  });

  /**
   * The negative controls. Every one of these principals still reaches the flow
   * through their own step 4, which §13 requires to render exactly as it does
   * today — a second entry point is a change nobody asked for. Widen the gate
   * in `SeatsCard` and all four of these fail.
   */
  it.each([
    ["an incubator admin", "incubator" as Edition, "admin" as Role],
    ["a VC super user", "vc" as Edition, "superuser" as Role],
    ["a VC admin", "vc" as Edition, "admin" as Role],
  ])("%s does not get it — and makes no seats request", async (_label, edition, role) => {
    mockApi(edition, [member()]);
    renderSection(<TeamRolesSection />, edition, role);

    // Gate on a POPULATED element that proves the section finished rendering,
    // never on the absence alone — which a still-loading screen also satisfies.
    await screen.findByTestId("permission-grid");
    expect(screen.queryByTestId("seat-bar")).toBeNull();
    expect(screen.queryByRole("button", { name: /Buy a .* seat/ })).toBeNull();

    const seatCalls = vi
      .mocked(globalThis.fetch)
      .mock.calls.filter(([u]) => String(u) === "/api/seats");
    expect(seatCalls).toHaveLength(0);
  });

  it("survives a /api/seats response that is not a SeatsView", async () => {
    mockApi("incubator", [member()]);
    // The shape a proxy or an error page can return with a 200.
    const inner = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === "/api/seats"
        ? json({ ok: true })
        : (inner as typeof fetch)(input, init),
    ) as unknown as typeof fetch;

    renderSection(<TeamRolesSection />, "incubator", "superuser");
    // The rest of the section still renders — the card is an addition to this
    // screen and must never be able to take the roster or the grid down.
    expect(await screen.findByTestId("permission-grid")).toBeInTheDocument();
    expect(screen.queryByTestId("seat-bar")).toBeNull();
  });
});
