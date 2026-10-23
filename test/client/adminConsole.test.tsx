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
import { setActiveContext } from "../../src/client/activeContext";
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
 * FIFTEEN in the incubator and ELEVEN in the VC build, not the prototype's
 * sixteen.
 *
 * — "Price configuration" was REMOVED on 24-Sep — *"why would a user set their
 *   price"* — because the catalogue is one document serving every customer, not
 *   a per-workspace setting. Both editions.
 *
 * — The whole **Sign-up group** was HIDDEN the same day — *"we want to introduce
 *   this in the next release"* (feedback row 11) — and came BACK in the
 *   incubator on 23-Oct (tracker row 10: *"The signup section of the admin
 *   console should be implemented"*). That is four sections, not one: the
 *   prototype's "Sign-up" is a rail GROUP heading over "Required documents",
 *   "Agreements library", "Authorised signatories" and the edition's fourth
 *   ("Seat capacity" / "Fund Deployment"). The VC build keeps the group hidden:
 *   that edition is out of scope (client, 2026-10-01) and keeps its rail.
 *
 * `AISJ_ICAdmin_V6`'s console map carries all sixteen, so the incubator list
 * still DIVERGES from the prototype by `pc`; the reasoning is in
 * `src/client/routes/admin/sections.ts`. `allAdminSections()` is the list of
 * what exists, and the registry-coverage test below walks it.
 */
const SIGNUP_LABELS = [
  "Required documents",
  "Agreements library",
  "Authorised signatories",
  "Seat capacity",
];

const VC_LABELS = [
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

/** The incubator rail: the Sign-up group sits between Organisation and System. */
const INCUBATOR_LABELS = [...VC_LABELS.slice(0, 7), ...SIGNUP_LABELS, ...VC_LABELS.slice(7)];

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
  it("declares fifteen sections in four groups for the incubator, eleven in three for the VC build", () => {
    expect(ADMIN_SECTION_GROUPS).toEqual(["Evaluation", "Organisation", "Sign-up", "System"]);
    for (const [edition, count, groups] of [
      ["incubator", 15, ADMIN_SECTION_GROUPS],
      ["vc", 11, ["Evaluation", "Organisation", "System"]],
    ] as const) {
      const sections = adminSections(edition);
      expect(sections).toHaveLength(count);
      expect([...new Set(sections.map((s) => s.group))]).toEqual(groups);
      // Ids are unique and each section names its owning session and contents.
      expect(new Set(sections.map((s) => s.id)).size).toBe(count);
      for (const s of sections) {
        expect(s.placeholder.owner).toMatch(/^W\d/);
        expect(s.placeholder.contents.length).toBeGreaterThan(0);
      }
    }
  });

  it("carries the prototype's exact section ids and labels", () => {
    // Transcribed from admin/_scripts.js:20-22 — `secs` (rail order) and `lbls`
    // (the label the title bar shows), less `pc`. The incubator ships the
    // Sign-up group again since 23-Oct; the VC build ships the same list less
    // that group.
    const SECS = [
      ["fw", "Scoring framework"],
      ["wt", "Area weights"],
      ["rb", "Rubric anchors"],
      ["qb", "Question bank"],
      ["tm", "Team & roles"],
      ["crm", "CRM sync"],
      ["bl", "Credits & billing"],
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
    expect(adminSections("vc").map((s) => [s.id, s.label])).toEqual(SECS.filter(([id]) => !id.startsWith("su")));
  });

  // REWRITTEN for row 11, and again for row 10 (23-Oct). `suseat` / `sufund` is
  // the one entry the two builds' Sign-up groups disagree about. The incubator's
  // half ships again; the VC's stays hidden with its group — so the first half
  // below is now asymmetric, and the second still asserts the swap in the
  // registry, where the VC's half waits for the day that group comes back.
  it("ships Seat capacity in the incubator rail, and keeps Fund Deployment in the VC registry, hidden", () => {
    expect(adminSections("incubator").map((s) => s.id)).toContain("suseat");
    expect(adminSections("incubator").map((s) => s.id)).not.toContain("sufund");
    for (const id of ["suseat", "sufund"]) {
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

  // Row 11 hid the group rather than removing it because he wanted it back next
  // release; row 10 (23-Oct) is that release, for the incubator. This is the
  // test that fails if the group leaks back into the VC rail, or if a later
  // session tidies the VC's hidden section objects away.
  it("ships the Sign-up group in the incubator, and keeps it hidden — not deleted — in the VC build", () => {
    expect(HIDDEN_ADMIN_GROUPS).toEqual({ incubator: [], vc: ["Sign-up"] });
    expect(ADMIN_SECTION_GROUPS).toContain("Sign-up");

    for (const edition of ["incubator", "vc"] as Edition[]) {
      const all = allAdminSections(edition);
      expect(all).toHaveLength(15);
      const signup = all.filter((s) => s.group === "Sign-up");
      expect(signup).toHaveLength(4);
      // Each Sign-up section has a body mounted at its id, shipped or hidden —
      // a rail entry is not a screen, and it is not a route guard.
      for (const section of signup) {
        expect(SECTION_COMPONENTS).toHaveProperty(section.id);
        expect(section.label).toBeTruthy();
        expect(section.placeholder.contents.length).toBeGreaterThan(0);
      }
    }
    // The incubator ships all fifteen; the VC build ships the eleven that are
    // not the group's.
    expect(adminSections("incubator").map((s) => s.id)).toEqual(allAdminSections("incubator").map((s) => s.id));
    expect(adminSections("vc")).toHaveLength(11);
    expect(adminSections("vc").map((s) => s.id)).toEqual(
      allAdminSections("vc").filter((s) => s.group !== "Sign-up").map((s) => s.id),
    );
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
    // An incubator admin's or superuser's Sign-up deep link resolves again, as it
    // did until 24-Sep; a role that may not see the group lands on Scoring
    // framework, never a blank pane — and in the VC build, where the group is
    // still hidden, that is every role, the admin included.
    for (const id of ["sudocs", "suagr", "susign", "suseat"]) {
      for (const role of ["admin", "superuser"] as Role[]) {
        expect(resolveAdminSection("incubator", role, id).id).toBe(id);
      }
      expect(resolveAdminSection("incubator", "program_manager", id).id).toBe("fw");
    }
    for (const role of ["admin", "superuser", "program_manager"] as Role[]) {
      for (const id of ["sudocs", "suagr", "susign", "sufund"]) {
        expect(resolveAdminSection("vc", role, id).id).toBe("fw");
      }
    }
  });

  // REWRITTEN for row 11, and back to its original subject for row 10 (23-Oct).
  // While the group was hidden from everyone this proved it reached NO role,
  // and that `ADMIN_ONLY_GROUPS` survived underneath "for the day it is
  // un-hidden". That day came: in the incubator the group returns to the admin
  // and the superuser ONLY — the restriction this test kept alive is what makes
  // that so — and in the VC build it still reaches nobody.
  it("gives the incubator's Sign-up group to the admin and superuser only, and the VC's to nobody", () => {
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
      const consoleRole = role === "admin" || role === "superuser";
      expect(canSeeAdminGroup("incubator", role, "Sign-up")).toBe(consoleRole);
      expect(canSeeAdminGroup("vc", role, "Sign-up")).toBe(false);
      expect(adminGroupsFor("vc", role)).toEqual(["Evaluation", "Organisation", "System"]);
      expect(adminGroupsFor("incubator", role)).toEqual(
        consoleRole ? ADMIN_SECTION_GROUPS : ["Evaluation", "Organisation", "System"],
      );
      for (const id of ["sudocs", "suagr", "susign", "suseat", "sufund"]) {
        expect(adminSectionsFor("vc", role).map((s) => s.id)).not.toContain(id);
      }
      for (const id of ["sudocs", "suagr", "susign", "suseat"]) {
        expect(adminSectionsFor("incubator", role).map((s) => s.id).includes(id)).toBe(consoleRole);
      }
    }

    // Reachability itself is unchanged — showing a group is not a permission
    // change, and the console still opens for exactly two roles.
    for (const role of ["admin", "superuser"] as Role[]) {
      expect(canOpenAdminConsole(role)).toBe(true);
      expect(adminGroupsFor("incubator", role)).toEqual(ADMIN_SECTION_GROUPS);
      expect(adminSectionsFor("incubator", role)).toHaveLength(15);
      expect(adminSectionsFor("vc", role)).toHaveLength(11);
    }
    for (const role of ["program_manager", "program_associate", "jury"] as Role[]) {
      expect(canOpenAdminConsole(role)).toBe(false);
      // Still ELEVEN: a non-admin never saw the group, so its return adds
      // nothing here, as its hiding took nothing away. That is why
      // `e2e/admin-console.spec.ts` still asserts 11 for these roles.
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
  it("renders the overlay header, the four rail groups and all fifteen incubator sections", () => {
    renderConsole(user("incubator", "admin"));

    const overlay = screen.getByRole("dialog", { name: "Admin console" });
    expect(overlay).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("heading", { level: 1, name: /Admin console/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();

    for (const group of ADMIN_SECTION_GROUPS) {
      expect(within(rail()).getByText(group)).toBeInTheDocument();
    }
    // One query, not fifteen: the rail's buttons in order are the fifteen
    // sections and nothing else.
    const railLabels = within(rail())
      .getAllByRole("button")
      .map((b) => (b.textContent ?? "").trim());
    expect(railLabels).toEqual(INCUBATOR_LABELS);
  });

  // REWRITTEN for row 11 and again for row 10. The VC rail is unchanged by the
  // incubator's group coming back: no Sign-up heading, neither half of the
  // edition swap, the same eleven it has drawn since 24-Sep.
  it("keeps the VC rail at its eleven — no Sign-up heading, neither half of the edition swap", () => {
    renderConsole(user("vc", "admin"));
    expect(within(rail()).queryByText("Sign-up")).toBeNull();
    expect(within(rail()).queryByRole("button", { name: /Fund Deployment/ })).toBeNull();
    expect(within(rail()).queryByRole("button", { name: /Seat capacity/ })).toBeNull();
    expect(
      within(rail())
        .getAllByRole("button")
        .map((b) => (b.textContent ?? "").trim()),
    ).toEqual(VC_LABELS);
  });

  // REWRITTEN for row 10 (23-Oct): this hid the group from the admin; it now
  // draws it for them, heading and all four sections, in the prototype's place
  // between Organisation and System — and each one opens.
  it("draws the whole Sign-up group for the incubator admin, and each section opens", () => {
    renderConsole(user("incubator", "admin"));
    const headings = within(rail())
      .getAllByText(/^(Evaluation|Organisation|Sign-up|System)$/)
      .map((h) => h.textContent);
    expect(headings).toEqual(["Evaluation", "Organisation", "Sign-up", "System"]);
    for (const label of SIGNUP_LABELS) {
      fireEvent.click(within(rail()).getByRole("button", { name: new RegExp(label) }));
      expect(screen.getByTestId("admin-section-title")).toHaveTextContent(label);
    }
  });

  it("opens an incubator admin's Sign-up deep link, and sends the VC admin's to Scoring framework", () => {
    // Resolved for an incubator admin until 24-Sep and again since 23-Oct. In
    // the VC build the group is still hidden, so a bookmark there must reach
    // Scoring framework rather than a blank pane — what `?section=pc` guards.
    const inc = renderConsole(user("incubator", "admin"), "/app/admin?section=susign");
    expect(screen.getByTestId("admin-section-title")).toHaveTextContent("Authorised signatories");
    inc.unmount();
    renderConsole(user("vc", "admin"), "/app/admin?section=sufund");
    expect(screen.getByTestId("admin-section-title")).toHaveTextContent("Scoring framework");
  });

  it("still withholds the group from a role that is not admin or superuser", () => {
    // The nav guard already stops these roles at /app/admin; this asserts the
    // console itself does not hand them the group if reachability ever widens
    // (F0038) — which has to keep holding once the group is un-hidden.
    renderConsole(user("incubator", "program_manager"));
    expect(within(rail()).queryByText("Sign-up")).toBeNull();
    for (const label of SIGNUP_LABELS) {
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
    // Re-pointed at S1 (23-Oct): the context is keyed by the signed-in principal
    // now, not by edition alone, so it is seeded through the store for the
    // principal the console mounts under.
    setActiveContext(user("incubator", "admin"), "incubator", { programId: "p1", cohortId: "c1" });
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
