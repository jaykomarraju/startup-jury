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
 * The deletion is gated to the incubator SUPER USER, per §13's constraint that
 * every other role renders exactly as it does today and the VC edition was not
 * rescoped — so most of this file is negative controls. They are not padding:
 * the one-predicate difference between "narrowed for the super user" and
 * "narrowed for everybody" is invisible in a screenshot and would take out
 * three e2e specs (`programs` and `automation` as the incubator admin, `seats`
 * as the VC admin) only at the end of a four-minute run.
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

describe("the incubator super user's wizard — item 7", () => {
  it("is Configure → Select, and draws neither deleted step", async () => {
    renderWizard(principal("superuser"));
    await waitFor(() => expect(steps()).toEqual(["Configure", "Select"]));

    // It OPENS on Configure — the deletion is not "step 1 hidden but still first".
    expect(await screen.findByText("Sectors", { exact: true })).toBeInTheDocument();

    // Both deleted steps, asserted absent rather than assumed gone.
    expect(screen.queryByText("What best describes your organisation?")).toBeNull();
    expect(screen.queryByLabelText("Organisation name")).toBeNull();
    expect(screen.queryByText("Organisation name")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Nominate your super user" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Add team members" })).toBeNull();

    // The wizard's own title is untouched — `e2e/parity.spec.ts` captures it.
    expect(screen.getByRole("heading", { name: "Set up your workspace" })).toBeInTheDocument();
  });

  it("Configure has no Back button — there is no step behind it any more", async () => {
    renderWizard(principal("superuser"));
    expect(await screen.findByText("Sectors", { exact: true })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Back/ })).toBeNull();
  });

  it("Select is the last step: it finishes the wizard instead of continuing", async () => {
    renderWizard(principal("superuser"));
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
 * The negative controls. Revert the predicate in `SetupWizard.tsx` to `true`
 * and every one of these fails; revert it to `false` and the block above does.
 */
describe("everybody else's wizard is untouched", () => {
  it("the incubator ADMIN still walks all four steps, starting at Org type", async () => {
    renderWizard(principal("admin"));
    await waitFor(() => expect(steps()).toEqual(["Org type", "Configure", "Select", "Team"]));
    expect(screen.getByText("What best describes your organisation?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue/ })).toBeInTheDocument();
  });

  it("a VC SUPER USER still walks all four — the VC edition was not rescoped", async () => {
    renderWizard(principal("superuser", "vc"));
    await waitFor(() => expect(steps()).toEqual(["Org type", "Configure", "Select", "Team"]));
    expect(screen.getByText("What best describes your organisation?")).toBeInTheDocument();
  });

  it("a VC admin too", async () => {
    renderWizard(principal("admin", "vc"));
    await waitFor(() => expect(steps()).toEqual(["Org type", "Configure", "Select", "Team"]));
  });

  /**
   * The double-apply guard §13 asked for. A non-`full` seat has ALWAYS been
   * shown three steps by `stepsFor`'s `slice(1)`; if item 7's narrowing were
   * expressed as a second slice rather than its own branch, this role would
   * lose Configure as well and land on Select with nothing configured.
   */
  it("a program associate still sees three steps, starting at Configure", async () => {
    renderWizard(principal("program_associate"));
    await waitFor(() => expect(steps()).toEqual(["Configure", "Select", "Team"]));
    expect(await screen.findByText(/Read-only — Standard seat/)).toBeInTheDocument();
    expect(screen.queryByText("What best describes your organisation?")).toBeNull();
  });

  it("a program manager still sees three steps", async () => {
    renderWizard(principal("program_manager"));
    await waitFor(() => expect(steps()).toEqual(["Configure", "Select", "Team"]));
  });
});
