import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { AdminConsole } from "../../src/client/routes/admin/AdminConsole";
import {
  ADMIN_SECTION_GROUPS,
  adminGroupsFor,
  adminSections,
  adminSectionsFor,
  canOpenAdminConsole,
  canSeeAdminGroup,
  pendingInviteCount,
  resolveAdminSection,
} from "../../src/client/routes/admin/sections";
import { SectionPlaceholder } from "../../src/client/routes/admin/SectionPlaceholder";
import { SECTION_COMPONENTS } from "../../src/client/routes/admin/registry";
import { AuthContext, type AuthUser } from "../../src/client/auth/AuthProvider";
import { listUsers, listPrograms } from "../../src/client/api";
import type { Edition, Role } from "../../src/shared/roles";

vi.mock("../../src/client/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/api")>()),
  listUsers: vi.fn(),
  listPrograms: vi.fn(),
}));

/** The sixteen sections the prototype's `secs`/`lbls` declare, in rail order. */
const INCUBATOR_LABELS = [
  "Scoring framework",
  "Area weights",
  "Rubric anchors",
  "Question bank",
  "Team & roles",
  "CRM sync",
  "Credits & billing",
  "Price configuration",
  "Required documents",
  "Agreements library",
  "Authorised signatories",
  "Seat capacity",
  "Notifications",
  "Audit log",
  "User access",
  "Branding",
];

function user(edition: Edition, role: Role): AuthUser {
  return { id: "u1", name: "Rajan Sharma", initials: "RS", role, edition };
}

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname + loc.search}</div>;
}

function renderConsole(
  principal: AuthUser,
  entry = "/app/admin",
): ReturnType<typeof render> {
  return render(
    <AuthContext.Provider
      value={{
        user: principal,
        loading: false,
        login: vi.fn(),
        logout: vi.fn(),
        updateUser: vi.fn(),
      }}
    >
      <MemoryRouter initialEntries={[entry]}>
        <LocationProbe />
        <Routes>
          <Route path="/app/admin" element={<AdminConsole />} />
          <Route path="*" element={<div>outside the console</div>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

// The console mounts a sixteen-item rail, lucide's icon set and two fetches per
// render, and several of these tests mount it more than once. On a machine
// running the wave's other sessions in parallel that comfortably exceeds the
// 5 s default, so the whole file gets the same accommodation `e2e/parity.spec.ts`
// takes for its walk. Scoped here, not in vitest.client.config.ts.
vi.setConfig({ testTimeout: 30_000 });

function rail() {
  return screen.getByRole("navigation", { name: "Admin console sections" });
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(listUsers).mockResolvedValue({ users: [] });
  vi.mocked(listPrograms).mockResolvedValue({ sectors: [], programs: [] });
});

// ── The registry ─────────────────────────────────────────────────────────────

describe("admin console section registry", () => {
  it("declares sixteen sections in four groups per edition", () => {
    for (const edition of ["incubator", "vc"] as Edition[]) {
      const sections = adminSections(edition);
      expect(sections).toHaveLength(16);
      expect([...new Set(sections.map((s) => s.group))]).toEqual(ADMIN_SECTION_GROUPS);
      // Ids are unique and each section names its owning session and contents.
      expect(new Set(sections.map((s) => s.id)).size).toBe(16);
      for (const s of sections) {
        expect(s.placeholder.owner).toMatch(/^W\d/);
        expect(s.placeholder.contents.length).toBeGreaterThan(0);
      }
    }
  });

  it("carries the prototype's exact section ids and labels", () => {
    // Transcribed from admin/_scripts.js:20-22 — `secs` (rail order) and `lbls`
    // (the label the title bar shows). The VC build differs in one entry.
    const SECS = [
      ["fw", "Scoring framework"],
      ["wt", "Area weights"],
      ["rb", "Rubric anchors"],
      ["qb", "Question bank"],
      ["tm", "Team & roles"],
      ["crm", "CRM sync"],
      ["bl", "Credits & billing"],
      ["pc", "Price configuration"],
      ["sudocs", "Required documents"],
      ["suagr", "Agreements library"],
      ["susign", "Authorised signatories"],
      ["suseat", "Seat capacity"],
      ["nt", "Notifications"],
      ["al", "Audit log"],
      ["uc", "User access"],
      ["br", "Branding"],
    ];
    expect(adminSections("incubator").map((s) => [s.id, s.label])).toEqual(SECS);
    expect(adminSections("vc").map((s) => [s.id, s.label])).toEqual(
      SECS.map((row) => (row[0] === "suseat" ? ["sufund", "Fund Deployment"] : row)),
    );
  });

  it("swaps Seat capacity for Fund Deployment in the VC edition", () => {
    const inc = adminSections("incubator").map((s) => s.id);
    const vc = adminSections("vc").map((s) => s.id);
    expect(inc).toContain("suseat");
    expect(inc).not.toContain("sufund");
    expect(vc).toContain("sufund");
    expect(vc).not.toContain("suseat");
    // Everything else is identical, and the swap keeps its rail position.
    expect(inc.indexOf("suseat")).toBe(vc.indexOf("sufund"));
    expect(inc.filter((id) => id !== "suseat")).toEqual(vc.filter((id) => id !== "sufund"));
  });

  it("opens on Scoring framework and falls back for an unknown or hidden section", () => {
    expect(resolveAdminSection("incubator", "admin", null).id).toBe("fw");
    expect(resolveAdminSection("incubator", "admin", "nope").id).toBe("fw");
    expect(resolveAdminSection("incubator", "admin", "al").id).toBe("al");
    // A role that cannot see the Sign-up group never lands inside it.
    expect(resolveAdminSection("incubator", "program_manager", "sudocs").id).toBe("fw");
  });

  it("restricts the Sign-up group to admin and superuser", () => {
    for (const role of ["admin", "superuser"] as Role[]) {
      expect(canOpenAdminConsole(role)).toBe(true);
      expect(canSeeAdminGroup(role, "Sign-up")).toBe(true);
      expect(adminGroupsFor("incubator", role)).toEqual(ADMIN_SECTION_GROUPS);
      expect(adminSectionsFor("incubator", role)).toHaveLength(16);
    }
    for (const role of ["program_manager", "program_associate", "jury"] as Role[]) {
      expect(canOpenAdminConsole(role)).toBe(false);
      expect(canSeeAdminGroup(role, "Sign-up")).toBe(false);
      expect(adminGroupsFor("incubator", role)).toEqual(["Evaluation", "Organisation", "System"]);
      expect(adminSectionsFor("incubator", role).map((s) => s.group)).not.toContain("Sign-up");
    }
    for (const role of ["partner", "ic_member", "associate", "analyst"] as Role[]) {
      expect(canSeeAdminGroup(role, "Sign-up")).toBe(false);
      expect(adminSectionsFor("vc", role).map((s) => s.id)).not.toContain("sufund");
    }
  });

  it("never advertises a stored password on User access (§1.2)", () => {
    const uc = adminSections("incubator").find((s) => s.id === "uc")!;
    const copy = [uc.heading, uc.subtitle, ...uc.placeholder.contents].join(" ").toLowerCase();
    expect(copy).not.toMatch(/reveal|view (the )?password|show (the )?password|stored password/);
    expect(copy).toContain("never displayed");
    expect(copy).toContain("temporary credential");
  });

  it("counts only members whose invite is still pending", () => {
    expect(pendingInviteCount([])).toBe(0);
    expect(pendingInviteCount([{ id: "a" }, { id: "b" }])).toBe(0);
    expect(
      pendingInviteCount([{ id: "a", invitePending: true }, { id: "b" }, { id: "c", invitePending: true }]),
    ).toBe(2);
  });
});

// ── The shell ────────────────────────────────────────────────────────────────

describe("AdminConsole shell", () => {
  it("renders the overlay header, the four rail groups and all sixteen sections", () => {
    renderConsole(user("incubator", "admin"));

    const overlay = screen.getByRole("dialog", { name: "Admin console" });
    expect(overlay).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("heading", { level: 1, name: /Admin console/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();

    for (const group of ADMIN_SECTION_GROUPS) {
      expect(within(rail()).getByText(group)).toBeInTheDocument();
    }
    // One query, not sixteen: the rail's buttons in order are the sixteen
    // sections and nothing else.
    const railLabels = within(rail())
      .getAllByRole("button")
      .map((b) => (b.textContent ?? "").trim());
    expect(railLabels).toEqual(INCUBATOR_LABELS);
  });

  it("shows Fund Deployment instead of Seat capacity for the VC edition", () => {
    renderConsole(user("vc", "admin"));
    expect(within(rail()).getByRole("button", { name: /Fund Deployment/ })).toBeInTheDocument();
    expect(within(rail()).queryByRole("button", { name: /Seat capacity/ })).toBeNull();
  });

  it("hides the whole Sign-up group from a role that is not admin or superuser", () => {
    // The nav guard already stops these roles at /app/admin; this asserts the
    // console itself does not hand them the group if reachability ever widens.
    renderConsole(user("incubator", "program_manager"));
    expect(within(rail()).queryByText("Sign-up")).toBeNull();
    for (const label of ["Required documents", "Agreements library", "Authorised signatories", "Seat capacity"]) {
      expect(within(rail()).queryByRole("button", { name: new RegExp(label) })).toBeNull();
    }
    // The other three groups are untouched.
    expect(within(rail()).getByText("Evaluation")).toBeInTheDocument();
    expect(within(rail()).getByText("Organisation")).toBeInTheDocument();
    expect(within(rail()).getByText("System")).toBeInTheDocument();
  });

  it("opens on Scoring framework and switches section through ?section=", () => {
    renderConsole(user("incubator", "admin"));
    expect(screen.getByTestId("admin-section-title")).toHaveTextContent("Scoring framework");

    fireEvent.click(within(rail()).getByRole("button", { name: /Audit log/ }));
    expect(screen.getByTestId("admin-section-title")).toHaveTextContent("Audit log");
    expect(screen.getByTestId("loc")).toHaveTextContent("/app/admin?section=al");
    expect(within(rail()).getByRole("button", { name: /Audit log/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("deep-links straight into a section", () => {
    renderConsole(user("incubator", "admin"), "/app/admin?section=br");
    expect(screen.getByTestId("admin-section-title")).toHaveTextContent("Branding");
    expect(screen.getByRole("heading", { level: 2, name: "Branding & theme" })).toBeInTheDocument();
  });

  // Wave 5 is the wave the console ran out of placeholders. `W3-C` made this
  // test drift-proof by asking the registry which section was still unbuilt —
  // which held for Waves 3 and 4 and then, inevitably, found nothing. Rather
  // than delete the property, Wave 5 integration split it in two: the milestone
  // is now asserted directly, and the placeholder component is still covered by
  // driving it with a section rather than by waiting for one to be missing.
  it("has a body for every section — the console is complete", () => {
    for (const edition of ["incubator", "vc"] as const) {
      const unbuilt = adminSections(edition)
        .filter((s) => !SECTION_COMPONENTS[s.id])
        .map((s) => `${s.id} (${s.placeholder.owner})`);
      expect(unbuilt, `${edition}: sections still on the placeholder`).toEqual([]);
    }
  });

  it("names what would fill a section, and who lands it, if one had no body", () => {
    // Rendered on its own against real section metadata: mounting the whole
    // console only re-proves the routing the test above already covers, and no
    // section is unbuilt any more to route to.
    for (const section of adminSections("incubator")) {
      const view = render(<SectionPlaceholder section={section} />);
      expect(screen.getByRole("heading", { level: 2, name: section.heading })).toBeInTheDocument();
      expect(screen.getAllByText(section.placeholder.owner).length).toBeGreaterThan(0);
      for (const line of section.placeholder.contents) {
        expect(screen.getByText(line)).toBeInTheDocument();
      }
      view.unmount();
    }
  });

  it("routes `tm` to the Team & roles roster", async () => {
    vi.mocked(listUsers).mockResolvedValue({
      users: [
        {
          id: "u9",
          name: "Tara Nair",
          email: "tara@startupjury.vc",
          role: "jury",
          roleLabel: "Jury Member",
          userType: "staff",
          initials: "TN",
          active: true,
        },
      ],
    });
    // W2-A and W2-B independently loosened this from `toEqual(["tm"])`, which was
    // only ever true while Wave 1 was the whole registry — every Wave 2–5 session
    // registers a section and breaks it. What the test is about is that Team &
    // roles is still reachable at `tm`; registry COVERAGE is asserted separately,
    // above. All THREE Wave 2 sessions made this same edit independently; kept as
    // one assertion at Wave 2 integration.
    //
    // W4-A, flagged per plan §4 — the two CONTROL assertions this carried
    // ("Add user", an "Organizational title" column) pinned the flat user-CRUD
    // page W1-C moved here verbatim, which F0067 / F0123 / F0148 all report as
    // the wrong shape: the prototype's roster has an *Invite member* button in
    // the card header and names the field per edition. They are replaced rather
    // than weakened — the roster's own columns, actions, invite lifecycle and
    // counting rule are asserted in full in `test/client/teamRoles.test.tsx`.
    // What belongs HERE is only that the console routes `tm` to that section.
    expect(SECTION_COMPONENTS).toHaveProperty("tm");
    renderConsole(user("incubator", "admin"), "/app/admin?section=tm");
    expect(screen.getByTestId("admin-section-title")).toHaveTextContent("Team & roles");
    expect(await screen.findByText("Tara Nair")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Invite member/ })).toBeInTheDocument();
  });

  it("badges Team & roles with the pending-invite count", async () => {
    vi.mocked(listUsers).mockResolvedValue({
      users: [
        {
          id: "u9",
          name: "Tara Nair",
          email: "tara@startupjury.vc",
          role: "jury",
          roleLabel: "Jury Member",
          userType: "staff",
          initials: "TN",
          active: true,
          invitePending: true,
        },
      ] as never,
    });
    renderConsole(user("incubator", "admin"));
    expect(await within(rail()).findByLabelText("1 pending invite")).toHaveTextContent("1");
  });

  it("does not badge Team & roles when nothing is pending", async () => {
    renderConsole(user("incubator", "admin"));
    await waitFor(() => expect(listUsers).toHaveBeenCalled());
    expect(within(rail()).queryByLabelText(/pending invite/)).toBeNull();
  });

  it("carries the active program/cohort in the title-bar context chip", async () => {
    localStorage.setItem(
      "sj_active_context_incubator",
      JSON.stringify({ programId: "p1", cohortId: "c1" }),
    );
    vi.mocked(listPrograms).mockResolvedValue({
      sectors: [],
      programs: [
        {
          id: "p1",
          name: "Climate Accelerator",
          sector: "FinTech",
          active: true,
          cohorts: [{ id: "c1", programId: "p1", name: "Cohort 2026-A", active: true }],
        },
      ],
    });
    renderConsole(user("incubator", "admin"));
    expect(await screen.findByText("Cohort 2026-A · FinTech")).toBeInTheDocument();
  });

  it("falls back to All programs when no context is set", async () => {
    renderConsole(user("incubator", "admin"));
    await waitFor(() =>
      expect(screen.getByTestId("admin-context-chip")).toHaveTextContent("All programs"),
    );
  });

  it("offers a console-level Save changes button, disabled while no section owns state", () => {
    renderConsole(user("incubator", "admin"));
    const save = screen.getByRole("button", { name: /Save changes/ });
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute("title", "This section has nothing to save.");
  });

  it("closes on Escape and on Close, landing back in the app", () => {
    renderConsole(user("incubator", "admin"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByText("outside the console")).toBeInTheDocument();
    expect(screen.getByTestId("loc")).toHaveTextContent("/app/alldecks");

    renderConsole(user("incubator", "admin"));
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);
    expect(screen.getAllByText("outside the console").length).toBeGreaterThan(0);
  });

  it("locks body scroll while open and restores it on close", () => {
    document.body.style.overflow = "auto";
    const view = renderConsole(user("incubator", "admin"));
    expect(document.body.style.overflow).toBe("hidden");
    view.unmount();
    expect(document.body.style.overflow).toBe("auto");
  });

  it("toggles the off-canvas drawer, and Escape closes the drawer before the console", () => {
    renderConsole(user("incubator", "admin"));
    const menu = screen.getByRole("button", { name: "Open admin console sections" });
    expect(rail()).toHaveAttribute("data-open", "false");

    fireEvent.click(menu);
    expect(rail()).toHaveAttribute("data-open", "true");
    expect(menu).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(rail()).toHaveAttribute("data-open", "false");
    expect(screen.queryByText("outside the console")).toBeNull();

    // Picking a section from the drawer closes it.
    fireEvent.click(menu);
    fireEvent.click(within(rail()).getByRole("button", { name: /Notifications/ }));
    expect(rail()).toHaveAttribute("data-open", "false");
  });
});
