import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { AdminConsole } from "../../src/client/routes/admin/AdminConsole";
import {
  ADMIN_SECTION_GROUPS,
  HIDDEN_ADMIN_GROUPS,
  adminGroupsFor,
  adminSections,
  adminSectionsFor,
  allAdminSections,
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

/**
 * The customer console's sections, in rail order.
 *
 * ELEVEN, not the prototype's sixteen, after two instructions on 24-Sep-2026.
 *
 * — "Price configuration" was REMOVED — *"why would a user set their price"* —
 *   because the catalogue is one document serving every customer, not a
 *   per-workspace setting.
 *
 * — The whole **Sign-up group** was HIDDEN — *"we want to introduce this in the
 *   next release"* (feedback row 11). That is four sections, not one: the
 *   prototype's "Sign-up" is a rail GROUP heading, so "Required documents",
 *   "Agreements library", "Authorised signatories" and the edition's fourth
 *   ("Seat capacity" / "Fund Deployment") all leave the rail together.
 *
 * `AISJ_ICAdmin_V6`'s console map still carries all sixteen, so this list
 * deliberately DIVERGES from the prototype and the next parity capture will try
 * to restore them; the reasoning is in `src/client/routes/admin/sections.ts`.
 * The five screens themselves are all still built, mounted and route-backed —
 * `allAdminSections()` is the list of what exists, and the registry-coverage
 * test below walks it.
 */
const INCUBATOR_LABELS = [
  "Scoring framework",
  "Area weights",
  "Rubric anchors",
  "Question bank",
  "Team & roles",
  "CRM sync",
  "Credits & billing",
  "Notifications",
  "Audit log",
  "User access",
  "Branding",
];

/** The four labels row 11 takes out of the rail, in the incubator edition. */
const HIDDEN_LABELS = [
  "Required documents",
  "Agreements library",
  "Authorised signatories",
  "Seat capacity",
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

// The console mounts an eleven-item rail, lucide's icon set and two fetches per
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
  it("declares eleven sections in three groups per edition", () => {
    for (const edition of ["incubator", "vc"] as Edition[]) {
      const sections = adminSections(edition);
      expect(sections).toHaveLength(11);
      expect([...new Set(sections.map((s) => s.group))]).toEqual(ADMIN_SECTION_GROUPS);
      // Ids are unique and each section names its owning session and contents.
      expect(new Set(sections.map((s) => s.id)).size).toBe(11);
      for (const s of sections) {
        expect(s.placeholder.owner).toMatch(/^W\d/);
        expect(s.placeholder.contents.length).toBeGreaterThan(0);
      }
    }
  });

  it("carries the prototype's exact section ids and labels", () => {
    // Transcribed from admin/_scripts.js:20-22 — `secs` (rail order) and `lbls`
    // (the label the title bar shows), less `pc` and less the Sign-up group.
    // Both editions now ship the SAME eleven: the one entry the two builds
    // disagreed about, `secs[11]`, was the Sign-up group's fourth section.
    const SECS = [
      ["fw", "Scoring framework"],
      ["wt", "Area weights"],
      ["rb", "Rubric anchors"],
      ["qb", "Question bank"],
      ["tm", "Team & roles"],
      ["crm", "CRM sync"],
      ["bl", "Credits & billing"],
      ["nt", "Notifications"],
      ["al", "Audit log"],
      ["uc", "User access"],
      ["br", "Branding"],
    ];
    expect(adminSections("incubator").map((s) => [s.id, s.label])).toEqual(SECS);
    expect(adminSections("vc").map((s) => [s.id, s.label])).toEqual(SECS);
  });

  // REWRITTEN for row 11, not renumbered: the edition swap had no subject left
  // in the shipped rail. `suseat` / `sufund` was the ONLY difference between the
  // incubator and VC consoles, and it sat in the group that is now hidden — so
  // the two editions' rails became identical, which is the first half below.
  // The swap itself is not gone, it is unshipped, so the second half asserts it
  // in the registry that survives. If this test were deleted instead, un-hiding
  // the group next release would restore four sections with no coverage that the
  // fourth is edition-resolved at all.
  it("ships one rail for both editions, and keeps the edition swap in the hidden registry", () => {
    expect(adminSections("vc").map((s) => s.id)).toEqual(adminSections("incubator").map((s) => s.id));
    for (const id of ["suseat", "sufund"]) {
      expect(adminSections("incubator").map((s) => s.id)).not.toContain(id);
      expect(adminSections("vc").map((s) => s.id)).not.toContain(id);
    }

    const inc = allAdminSections("incubator").map((s) => s.id);
    const vc = allAdminSections("vc").map((s) => s.id);
    expect(inc).toContain("suseat");
    expect(inc).not.toContain("sufund");
    expect(vc).toContain("sufund");
    expect(vc).not.toContain("suseat");
    // Everything else is identical, and the swap keeps its rail position.
    expect(inc.indexOf("suseat")).toBe(vc.indexOf("sufund"));
    expect(inc.filter((id) => id !== "suseat")).toEqual(vc.filter((id) => id !== "sufund"));
  });

  // The whole point of row 11 being "hidden" and not "removed": he wants it back
  // next release. This is the test that fails if a later session tidies the four
  // section objects away, and it is the one to read before un-hiding.
  it("hides the Sign-up group without deleting it", () => {
    expect(HIDDEN_ADMIN_GROUPS).toEqual(["Sign-up"]);
    expect(ADMIN_SECTION_GROUPS).not.toContain("Sign-up");

    for (const edition of ["incubator", "vc"] as Edition[]) {
      const all = allAdminSections(edition);
      // Fifteen exist, eleven ship, and the four that do not are the group's.
      expect(all).toHaveLength(15);
      const hidden = all.filter((s) => s.group === "Sign-up");
      expect(hidden).toHaveLength(4);
      expect(adminSections(edition)).toHaveLength(11);
      expect(adminSections(edition).map((s) => s.id)).toEqual(
        all.filter((s) => s.group !== "Sign-up").map((s) => s.id),
      );
      // Each hidden section still has a body mounted at its id — removing a
      // rail entry is not unmounting a screen, and it is not unguarding a route.
      for (const section of hidden) {
        expect(SECTION_COMPONENTS).toHaveProperty(section.id);
        expect(section.label).toBeTruthy();
        expect(section.placeholder.contents.length).toBeGreaterThan(0);
      }
    }
    expect(allAdminSections("incubator").filter((s) => s.group === "Sign-up").map((s) => s.id)).toEqual([
      "sudocs",
      "suagr",
      "susign",
      "suseat",
    ]);
  });

  it("opens on Scoring framework and falls back for an unknown or hidden section", () => {
    expect(resolveAdminSection("incubator", "admin", null).id).toBe("fw");
    expect(resolveAdminSection("incubator", "admin", "nope").id).toBe("fw");
    expect(resolveAdminSection("incubator", "admin", "al").id).toBe("al");
    // Nobody lands inside the hidden Sign-up group — and the role that matters
    // here is the ADMIN, for whom `?section=sudocs` resolved until 24-Sep.
    // Somebody's bookmark must reach Scoring framework, not a blank pane.
    for (const role of ["admin", "superuser", "program_manager"] as Role[]) {
      for (const id of ["sudocs", "suagr", "susign", "suseat"]) {
        expect(resolveAdminSection("incubator", role, id).id).toBe("fw");
      }
      expect(resolveAdminSection("vc", role, "sufund").id).toBe("fw");
    }
  });

  // REWRITTEN for row 11, not renumbered. This test used to prove the group was
  // admin-only, an assertion that goes vacuous once the group is hidden from
  // everyone: `canSeeAdminGroup(role, "Sign-up")` is now false for all eleven
  // roles, superuser included. So it inverts — it proves the group reaches NO
  // role, and that the admin-only rule survives underneath for the day it is
  // un-hidden (`ADMIN_ONLY_GROUPS` still names it).
  it("withholds the Sign-up group from every role, superuser included", () => {
    const ALL_ROLES: Role[] = [
      "superuser",
      "admin",
      "program_manager",
      "program_associate",
      "jury",
      "partner",
      "ic_member",
      "associate",
      "analyst",
    ];
    for (const role of ALL_ROLES) {
      expect(canSeeAdminGroup(role, "Sign-up")).toBe(false);
      for (const edition of ["incubator", "vc"] as Edition[]) {
        expect(adminGroupsFor(edition, role)).toEqual(["Evaluation", "Organisation", "System"]);
        expect(adminSectionsFor(edition, role).map((s) => s.group)).not.toContain("Sign-up");
        for (const id of ["sudocs", "suagr", "susign", "suseat", "sufund"]) {
          expect(adminSectionsFor(edition, role).map((s) => s.id)).not.toContain(id);
        }
      }
    }

    // Reachability itself is unchanged — hiding a group is not a permission
    // change, and the console still opens for exactly two roles.
    for (const role of ["admin", "superuser"] as Role[]) {
      expect(canOpenAdminConsole(role)).toBe(true);
      expect(adminGroupsFor("incubator", role)).toEqual(ADMIN_SECTION_GROUPS);
      expect(adminSectionsFor("incubator", role)).toHaveLength(11);
    }
    for (const role of ["program_manager", "program_associate", "jury"] as Role[]) {
      expect(canOpenAdminConsole(role)).toBe(false);
      // And the SAME eleven: what the group's hiding does NOT do is change how
      // many sections a non-admin would see, because a non-admin never saw the
      // group. That is why `e2e/admin-console.spec.ts` still asserts 11 there.
      expect(adminSectionsFor("incubator", role)).toHaveLength(11);
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
  it("renders the overlay header, the three rail groups and all eleven sections", () => {
    renderConsole(user("incubator", "admin"));

    const overlay = screen.getByRole("dialog", { name: "Admin console" });
    expect(overlay).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("heading", { level: 1, name: /Admin console/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();

    for (const group of ADMIN_SECTION_GROUPS) {
      expect(within(rail()).getByText(group)).toBeInTheDocument();
    }
    // One query, not eleven: the rail's buttons in order are the eleven
    // sections and nothing else.
    const railLabels = within(rail())
      .getAllByRole("button")
      .map((b) => (b.textContent ?? "").trim());
    expect(railLabels).toEqual(INCUBATOR_LABELS);
  });

  // REWRITTEN for row 11, not renumbered: this asserted the edition swap, whose
  // subject (`suseat` / `sufund`) is the hidden group's fourth section. Neither
  // half of the swap is in either rail now, so what is left worth asserting is
  // that the VC rail is the incubator rail — the two consoles differed in that
  // one entry and nothing else.
  it("draws the same rail in both editions, with neither half of the edition swap", () => {
    renderConsole(user("vc", "admin"));
    expect(within(rail()).queryByRole("button", { name: /Fund Deployment/ })).toBeNull();
    expect(within(rail()).queryByRole("button", { name: /Seat capacity/ })).toBeNull();
    expect(
      within(rail())
        .getAllByRole("button")
        .map((b) => (b.textContent ?? "").trim()),
    ).toEqual(INCUBATOR_LABELS);
  });

  // REWRITTEN for row 11, not renumbered: "from a role that is not admin or
  // superuser" is now every role, so the strongest version of this test drives
  // the console as the ADMIN — the one principal who DID see the group, and the
  // only one whose rail moved on 24-Sep.
  it("hides the whole Sign-up group from the admin, group heading and all four sections", () => {
    renderConsole(user("incubator", "admin"));
    expect(within(rail()).queryByText("Sign-up")).toBeNull();
    for (const label of HIDDEN_LABELS) {
      expect(within(rail()).queryByRole("button", { name: new RegExp(label) })).toBeNull();
    }
    // The other three groups are untouched.
    expect(within(rail()).getByText("Evaluation")).toBeInTheDocument();
    expect(within(rail()).getByText("Organisation")).toBeInTheDocument();
    expect(within(rail()).getByText("System")).toBeInTheDocument();
  });

  it("sends an admin's bookmarked Sign-up deep link to Scoring framework", () => {
    // The link resolved for an admin until 24-Sep. A blank pane is the failure
    // this guards — the same thing `?section=pc` guards after its removal.
    renderConsole(user("incubator", "admin"), "/app/admin?section=susign");
    expect(screen.getByTestId("admin-section-title")).toHaveTextContent("Scoring framework");
    expect(screen.queryByText("Authorised signatories")).toBeNull();
  });

  it("still withholds the group from a role that is not admin or superuser", () => {
    // The nav guard already stops these roles at /app/admin; this asserts the
    // console itself does not hand them the group if reachability ever widens
    // (F0038) — which has to keep holding once the group is un-hidden.
    renderConsole(user("incubator", "program_manager"));
    expect(within(rail()).queryByText("Sign-up")).toBeNull();
    for (const label of HIDDEN_LABELS) {
      expect(within(rail()).queryByRole("button", { name: new RegExp(label) })).toBeNull();
    }
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
  //
  // Row 11 moved this from `adminSections` to `allAdminSections`: the milestone
  // is that every section HAS a body, and filtering the hidden group out first
  // would let the four Sign-up screens be unmounted without a single test
  // noticing — exactly the drift "hidden, not deleted" is meant to stop.
  it("has a body for every section — the console is complete", () => {
    for (const edition of ["incubator", "vc"] as const) {
      const unbuilt = allAdminSections(edition)
        .filter((s) => !SECTION_COMPONENTS[s.id])
        .map((s) => `${s.id} (${s.placeholder.owner})`);
      expect(unbuilt, `${edition}: sections still on the placeholder`).toEqual([]);
    }
  });

  it("names what would fill a section, and who lands it, if one had no body", () => {
    // Rendered on its own against real section metadata: mounting the whole
    // console only re-proves the routing the test above already covers, and no
    // section is unbuilt any more to route to.
    for (const section of allAdminSections("incubator")) {
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
