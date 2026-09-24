import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SetupWizard } from "../../src/client/routes/SetupWizard";
import { listPrograms, getConfigSummary } from "../../src/client/api";
import type { AuthUser } from "../../src/client/auth/AuthProvider";
import type { Role } from "../../src/shared/roles";

/**
 * S2-SETUP — 21-Sep item 7: *"Delete step 1 (Org type) and step 4 (the
 * team/superuser step) from the Set up wizard; only the programme setup
 * remains."*
 *
 * R3-SETUP — item 6 of the four-role extension widens that deletion to the two
 * roles the client's row names beside the super user: the incubator **admin**
 * and **program manager**. So the file now has three positive principals and
 * keeps the negative controls that matter, because the interesting distinction
 * moved rather than disappeared — it is no longer "the super user vs everybody"
 * but **"the incubator's three managing roles vs the program associate and the
 * whole VC edition"**. That difference is still invisible in a screenshot and
 * still takes out an e2e spec (`seats`, as the VC admin) only at the end of a
 * four-minute run.
 *
 * The program associate is the one to watch. Their seat is `readonly`, so
 * `stepsFor` has ALWAYS sliced Org type off their list; item 6 adds a
 * `cohorts`-seat principal (the program manager) to the same narrowing, and if
 * either narrowing were ever re-expressed as a second `slice` the associate
 * would lose Configure as well and land on Select with nothing configured. The
 * last test in this file is that guard.
 *
 * Every assertion reads the STEPPER's own list rather than the heading, which
 * is identical on all four steps.
 */

vi.mock("../../src/client/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/client/api")>();
  return { ...actual, listPrograms: vi.fn(), getConfigSummary: vi.fn(), updateBranding: vi.fn() };
});

const navigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigate };
});

let user: AuthUser | null = null;
vi.mock("../../src/client/auth/useAuth", () => ({
  useAuth: () => ({ user, loading: false }),
}));

function principal(role: Role, edition: "incubator" | "vc" = "incubator"): AuthUser {
  return { id: `u_${role}`, name: "Someone", initials: "SO", role, edition };
}

const PROGRAMS = {
  sectors: [{ id: "s1", name: "Fintech" }],
  programs: [{ id: "p1", name: "Fintech Accelerator", sector: "Fintech", active: true, cohorts: [] }],
} as never;

function renderWizard(as: AuthUser) {
  user = as;
  render(
    <MemoryRouter>
      <SetupWizard />
    </MemoryRouter>,
  );
}

/** The stepper's labels, in order — `<ol>` is the only one on the screen. */
function steps(): string[] {
  const list = document.querySelector("ol");
  return [...(list?.querySelectorAll("li") ?? [])].map((li) =>
    (li.textContent ?? "").replace(/^[0-9✓]\s*/, "").trim(),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(listPrograms).mockResolvedValue(PROGRAMS);
  vi.mocked(getConfigSummary).mockResolvedValue({
    plan: "pro",
    branding: { orgName: "T-Hub", orgType: "incubator" },
    coreParams: [],
    additionalParams: [],
  } as never);
});

/**
 * The three incubator roles the client's row names: *Superuser / Prog. manager
 * / Admin*. Every one of them walks the same two steps, so they are asserted as
 * one table rather than three copies — a role that drifts out of
 * `PROGRAMME_ONLY_ROLES` fails its whole column here, not one assertion.
 */
const PROGRAMME_ONLY: Role[] = ["superuser", "admin", "program_manager"];

describe.each(PROGRAMME_ONLY)("the incubator %s's wizard — items 7 and 6", (role) => {
  it("is Configure → Select, and draws neither deleted step", async () => {
    renderWizard(principal(role));
    await waitFor(() => expect(steps()).toEqual(["Configure", "Select"]));

    // It OPENS on Configure — the deletion is not "step 1 hidden but still first".
    expect(await screen.findByText("Sectors", { exact: true })).toBeInTheDocument();

    // Both deleted steps, asserted absent rather than assumed gone.
    expect(screen.queryByText("What best describes your organisation?")).toBeNull();
    expect(screen.queryByLabelText("Organisation name")).toBeNull();
    expect(screen.queryByText("Organisation name")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Nominate your super user" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Add team members" })).toBeNull();

    // And no Standard-seat banner: that belongs to the `readonly` seat, which is
    // exactly the role item 6 does NOT narrow.
    expect(screen.queryByText(/Read-only — Standard seat/)).toBeNull();

    // The wizard's own title is untouched — `e2e/parity.spec.ts` captures it.
    expect(screen.getByRole("heading", { name: "Set up your workspace" })).toBeInTheDocument();
  });

  /**
   * The other half of the double-apply hazard, and the reason the ADMIN column
   * of this table is not redundant: `onBack` is `seat === "full" && !programmeOnly`.
   * The admin is the first `full` seat other than the super user to be narrowed,
   * so the seat check ALONE would draw a Back button into a step that no longer
   * exists.
   */
  it("Configure has no Back button — there is no step behind it any more", async () => {
    renderWizard(principal(role));
    expect(await screen.findByText("Sectors", { exact: true })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Back/ })).toBeNull();
  });

  it("Select is the last step: it finishes the wizard instead of continuing", async () => {
    renderWizard(principal(role));
    expect(await screen.findByText("Sectors", { exact: true })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    expect(await screen.findByText("Select your active context")).toBeInTheDocument();

    // Back still works — Configure is behind it.
    expect(screen.getByRole("button", { name: /Back/ })).toBeInTheDocument();

    // And the forward button is the finish, with the deleted footer's wording.
    expect(screen.queryByRole("button", { name: /^Continue/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Confirm & go to dashboard/ }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/app/alldecks"));
  });
});

/**
 * The negative controls. Widen the predicate in `SetupWizard.tsx` past the
 * incubator's three managing roles and every one of these fails; narrow it back
 * to the super user alone and two thirds of the block above does.
 */
describe("the roles item 6 does NOT narrow", () => {
  it("a VC SUPER USER still walks all four — the VC edition was not rescoped", async () => {
    renderWizard(principal("superuser", "vc"));
    await waitFor(() => expect(steps()).toEqual(["Org type", "Configure", "Select", "Team"]));
    expect(screen.getByText("What best describes your organisation?")).toBeInTheDocument();
  });

  it("a VC admin too — and it is the edition, not the role, that keeps them", async () => {
    renderWizard(principal("admin", "vc"));
    await waitFor(() => expect(steps()).toEqual(["Org type", "Configure", "Select", "Team"]));
    expect(screen.getByText("What best describes your organisation?")).toBeInTheDocument();
  });

  /**
   * The double-apply guard §13 asked for, and item 6 makes it matter more, not
   * less. A non-`full` seat has ALWAYS been shown three steps by `stepsFor`'s
   * `slice(1)`; item 6 now narrows a `cohorts` seat (the program manager)
   * through the SAME function, so if either narrowing were ever re-expressed as
   * a second slice this role would lose Configure as well and land on Select
   * with nothing configured.
   */
  it("a program associate still sees three steps, starting at Configure", async () => {
    renderWizard(principal("program_associate"));
    await waitFor(() => expect(steps()).toEqual(["Configure", "Select", "Team"]));
    expect(await screen.findByText(/Read-only — Standard seat/)).toBeInTheDocument();
    expect(screen.queryByText("What best describes your organisation?")).toBeNull();
  });

  /**
   * And they keep Configure itself — the screen that carries the banner above.
   * Deleting it is what plan §2 ʰ rules out: it is the only place the product
   * tells a Standard seat that their seat is view-only.
   */
  it("the associate's Configure step is intact, banner and all", async () => {
    renderWizard(principal("program_associate"));
    expect(await screen.findByText("Sectors", { exact: true })).toBeInTheDocument();
    expect(screen.getByText(/Read-only — Standard seat/)).toBeInTheDocument();
  });
});
