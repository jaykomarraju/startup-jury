import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { AuthContext, type AuthUser } from "../../src/client/auth/AuthProvider";
import { ScoringFrameworkSection } from "../../src/client/routes/admin/ScoringFramework";
import { AreaWeightsSection } from "../../src/client/routes/admin/AreaWeights";
import { AdminSaveContext, type AdminSaveState } from "../../src/client/routes/admin/saveContext";
import { DEFAULT_SCORING_SETTINGS } from "../../src/shared/scoring";
import { getConfig, updateWeights, updateAdditionalParam } from "../../src/client/api";
import {
  getScoringFramework,
  saveScoringFramework,
  setConfigPermitted,
} from "../../src/client/routes/admin/scoringApi";
import { updateThresholds } from "../../src/client/api";
import type { Edition, Role } from "../../src/shared/roles";

/**
 * W2-A — the two console sections. What is asserted here is the prototype's
 * own contract: the exact control set of `admin/s-fw.html`, the §1.2 omission,
 * the live 100 % total and its three footer strings from `admin/_scripts.js`,
 * the ×3.3 bar, and the *Permit configuration* pill.
 */

vi.mock("../../src/client/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/api")>()),
  getConfig: vi.fn(),
  updateWeights: vi.fn(),
  updateAdditionalParam: vi.fn(),
  updateThresholds: vi.fn(),
}));

vi.mock("../../src/client/routes/admin/scoringApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/routes/admin/scoringApi")>()),
  getScoringFramework: vi.fn(),
  saveScoringFramework: vi.fn(),
  setConfigPermitted: vi.fn(),
}));

function principal(role: Role = "admin", edition: Edition = "incubator"): AuthUser {
  return { id: "u1", name: "Nisha Kapoor", initials: "NK", role, edition };
}

/** Captures whatever the section registers with the console's title-bar Save. */
function mountSection(node: React.ReactNode, role: Role = "admin") {
  const saved: { state: AdminSaveState | null } = { state: null };
  const view = render(
    <AuthContext.Provider
      value={{
        user: principal(role),
        loading: false,
        login: vi.fn(),
        logout: vi.fn(),
        updateUser: vi.fn(),
      }}
    >
      <AdminSaveContext.Provider
        value={{
          register: (s) => {
            saved.state = s;
          },
        }}
      >
        {node}
      </AdminSaveContext.Provider>
    </AuthContext.Provider>,
  );
  return { view, saved };
}

const CORE = [
  { id: "p1", key: "problem", name: "Problem & Market Clarity", weight: 8, informational: false },
  { id: "p2", key: "solution", name: "Solution & Value Proposition", weight: 82, informational: false },
  { id: "p3", key: "story", name: "Storytelling & Deck Quality", weight: 10, informational: false },
];

const ADDITIONAL = [
  {
    id: "a1",
    key: "add_barriers_of_entry",
    name: "Barriers of entry",
    weight: 0,
    informational: true,
    roleScope: "jury",
    configPermitted: true,
  },
  {
    id: "a2",
    key: "add_scalability",
    name: "Scalability",
    weight: 0,
    informational: true,
    roleScope: "jury",
    configPermitted: false,
  },
];

beforeEach(() => {
  vi.mocked(getScoringFramework).mockResolvedValue({
    scoring: { ...DEFAULT_SCORING_SETTINGS },
    thresholdBest: 7,
    thresholdMediocre: 5,
    editable: true,
  });
  vi.mocked(saveScoringFramework).mockResolvedValue({
    ok: true,
    scoring: { ...DEFAULT_SCORING_SETTINGS },
    rescored: { decks: 2, evaluations: 3 },
  });
  vi.mocked(setConfigPermitted).mockResolvedValue({ ok: true, id: "a2", permitted: true });
  vi.mocked(updateThresholds).mockResolvedValue({ ok: true, thresholdBest: 7, thresholdMediocre: 5 });
  vi.mocked(updateWeights).mockResolvedValue({
    ok: true,
    rescored: { decks: 1, evaluations: 1 },
    coreParams: CORE,
  });
  vi.mocked(updateAdditionalParam).mockResolvedValue({ ok: true, param: { id: "a1", name: "x" } });
  vi.mocked(getConfig).mockResolvedValue({
    plan: "premium",
    coreConfigEnabled: true,
    additionalEnabled: true,
    creditsBalance: 50,
    aiSystemPrompt: "",
    thresholdBest: 7,
    thresholdMediocre: 5,
    branding: {},
    coreParams: CORE,
    additionalParams: ADDITIONAL,
  } as never);
});

// ── Scoring framework ────────────────────────────────────────────────────────

describe("Scoring framework section", () => {
  it("renders every control the prototype's three cards carry", async () => {
    mountSection(<ScoringFrameworkSection />);
    await screen.findByText("AI engine behaviour");

    for (const label of [
      "AI pre-scoring enabled",
      "Auto-trigger clarification questions",
      "Show AI score to jury before they score",
      "Require override rationale",
      "Jury can see each other's scores",
      "Show 3-score view (AI · Mine · Average)",
      "Show score drift analysis in reports",
      "Include AI evidence quotes in reports",
      "Intro call AI question prompts enabled",
    ]) {
      expect(screen.getByRole("switch", { name: label })).toBeInTheDocument();
    }
    for (const field of [
      "Score scale",
      "Composite formula",
      "AI weight in composite",
      "Shortlist threshold",
    ]) {
      expect(screen.getByLabelText(field)).toBeInTheDocument();
    }
  });

  it("omits 'Mentor can adjust composite' — §1.2, the column does not exist", async () => {
    mountSection(<ScoringFrameworkSection />);
    await screen.findByText("AI engine behaviour");
    expect(screen.queryByText(/Mentor can adjust composite/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/mentor/i)).not.toBeInTheDocument();
  });

  it("ships the prototype's ON/OFF state — peer visibility is the one that is off", async () => {
    mountSection(<ScoringFrameworkSection />);
    await screen.findByText("AI engine behaviour");
    expect(screen.getByRole("switch", { name: "AI pre-scoring enabled" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(
      screen.getByRole("switch", { name: "Jury can see each other's scores" }),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("offers the four AI/jury splits the prototype names, defaulted to 40/60", async () => {
    mountSection(<ScoringFrameworkSection />);
    const select = (await screen.findByLabelText("AI weight in composite")) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "40% AI · 60% Jury",
      "30% AI · 70% Jury",
      "50% AI · 50% Jury",
      "0% (jury only)",
    ]);
    expect(select.value).toBe("40");
  });

  it("previews the three cohort bands and clamps Poor to Best as you type", async () => {
    mountSection(<ScoringFrameworkSection />);
    const preview = await screen.findByTestId("threshold-preview");
    expect(preview).toHaveTextContent("Best ≥ 7.0");
    expect(preview).toHaveTextContent("Mediocre 5.0 – 6.9");
    expect(preview).toHaveTextContent("Poor < 5.0");

    // The prototype's `updThr()` clamps: Poor can never exceed Best.
    fireEvent.change(screen.getByLabelText(/Poor — below/), { target: { value: "9" } });
    expect(await screen.findByTestId("threshold-preview")).toHaveTextContent("Poor < 7.0");
  });

  it("saves the whole section through the console's single Save changes", async () => {
    const { saved } = mountSection(<ScoringFrameworkSection />);
    await screen.findByText("AI engine behaviour");
    // Nothing changed yet — the title bar button stays disabled.
    expect(saved.state?.dirty).toBe(false);

    fireEvent.click(screen.getByRole("switch", { name: "AI pre-scoring enabled" }));
    await waitFor(() => expect(saved.state?.dirty).toBe(true));

    await saved.state!.onSave();
    await waitFor(() =>
      expect(saveScoringFramework).toHaveBeenCalledWith(
        expect.objectContaining({ aiPreScoringEnabled: false }),
      ),
    );
    // The cohort bands are saved with it — they are one card in the prototype.
    expect(updateThresholds).toHaveBeenCalledWith(7, 5);
    expect(await screen.findByText(/2 decks re-scored/)).toBeInTheDocument();
  });

  it("is read-only for a role that may see it but not change it", async () => {
    vi.mocked(getScoringFramework).mockResolvedValue({
      scoring: { ...DEFAULT_SCORING_SETTINGS },
      thresholdBest: 7,
      thresholdMediocre: 5,
      editable: false,
    });
    const { saved } = mountSection(<ScoringFrameworkSection />, "jury");
    expect(await screen.findByText(/only an administrator can change/i)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "AI pre-scoring enabled" })).toBeDisabled();
    expect(saved.state).toBeNull();
  });

  it("says so when it cannot load rather than rendering an empty pane", async () => {
    vi.mocked(getScoringFramework).mockRejectedValue(new Error("boom"));
    mountSection(<ScoringFrameworkSection />);
    expect(await screen.findByText(/Couldn't load the scoring framework/)).toBeInTheDocument();
  });
});

// ── Area weights ─────────────────────────────────────────────────────────────

describe("Area weights section", () => {
  it("renders the prototype's five columns, the Core pill and a mono index", async () => {
    mountSection(<AreaWeightsSection />);
    await screen.findByLabelText("Problem & Market Clarity weight");
    for (const header of ["#", "Evaluation area", "Type", "Weight %", "Visual"]) {
      expect(screen.getAllByRole("columnheader", { name: header }).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText("Core")).toHaveLength(CORE.length);
    // Zero-padded mono index cells, one set per table.
    expect(screen.getAllByText("01").length).toBeGreaterThan(0);
    expect(screen.getByText("03")).toBeInTheDocument();
  });

  it("draws the bar at the prototype's ×3.3 scale", async () => {
    mountSection(<AreaWeightsSection />);
    const bar = await screen.findByTestId("weight-bar-problem");
    // 8 × 3.3 = 26.4 % of the 70 px track (`admin/_scripts.js:254`).
    expect(bar.style.width.startsWith("26.4")).toBe(true);
    fireEvent.change(screen.getByLabelText("Problem & Market Clarity weight"), {
      target: { value: "40" },
    });
    // …capped at 100 %.
    expect(screen.getByTestId("weight-bar-problem").style.width).toBe("100%");
  });

  it("reports the live total with the prototype's own three strings", async () => {
    mountSection(<AreaWeightsSection />);
    // 8 + 82 + 10 = 100.
    expect(await screen.findByTestId("weight-total")).toHaveTextContent("Total: 100% ✓");

    fireEvent.change(screen.getByLabelText("Problem & Market Clarity weight"), {
      target: { value: "4" },
    });
    expect(screen.getByTestId("weight-total")).toHaveTextContent("Total: 96% — 4% remaining");

    fireEvent.change(screen.getByLabelText("Problem & Market Clarity weight"), {
      target: { value: "12" },
    });
    expect(screen.getByTestId("weight-total")).toHaveTextContent("Total: 104% — over by 4%");
  });

  it("refuses to save while the total is not 100 % (F0153)", async () => {
    const { saved } = mountSection(<AreaWeightsSection />);
    await screen.findByLabelText("Problem & Market Clarity weight");

    fireEvent.change(screen.getByLabelText("Problem & Market Clarity weight"), {
      target: { value: "4" },
    });
    await waitFor(() => expect(saved.state?.dirty).toBe(false));
    expect(saved.state?.hint).toBe("Total: 96% — 4% remaining");

    fireEvent.change(screen.getByLabelText("Problem & Market Clarity weight"), {
      target: { value: "8" },
    });
    await waitFor(() => expect(saved.state?.dirty).toBe(true));
  });

  it("sends an area RENAME with the weights (F0079 — the API always took one)", async () => {
    const { saved } = mountSection(<AreaWeightsSection />);
    await screen.findByLabelText("Problem & Market Clarity name");
    fireEvent.change(screen.getByLabelText("Problem & Market Clarity name"), {
      target: { value: "Problem clarity" },
    });
    await waitFor(() => expect(saved.state?.dirty).toBe(true));
    await saved.state!.onSave();
    await waitFor(() =>
      expect(updateWeights).toHaveBeenCalledWith([
        { id: "p1", weight: 8, name: "Problem clarity" },
        { id: "p2", weight: 82, name: "Solution & Value Proposition" },
        { id: "p3", weight: 10, name: "Storytelling & Deck Quality" },
      ]),
    );
  });

  it("renders the role cards in the same section, with their tier badges", async () => {
    mountSection(<AreaWeightsSection />);
    expect(await screen.findByText("Additional configurable parameters")).toBeInTheDocument();
    for (const badge of ["AI+ score", "AI++ score", "AI+++ score"]) {
      expect(screen.getByText(badge)).toBeInTheDocument();
    }
    expect(screen.getAllByText("/ 10")).toHaveLength(ADDITIONAL.length);
    expect(screen.getAllByText(/Set total: max/)).toHaveLength(3); // one per owning role
  });

  it("toggles Permit configuration per parameter", async () => {
    mountSection(<AreaWeightsSection />);
    await screen.findByText("Additional configurable parameters");
    // Seeded: parameter 1 of the role is permitted, the rest are not.
    expect(screen.getByRole("button", { name: "Permitted" })).toBeInTheDocument();
    const grant = screen.getByRole("button", { name: "Permit configuration" });
    fireEvent.click(grant);
    await waitFor(() => expect(setConfigPermitted).toHaveBeenCalledWith("a2", true));
    expect(await screen.findAllByRole("button", { name: "Permitted" })).toHaveLength(2);
  });

  it("is read-only on a plan that does not include core configuration", async () => {
    vi.mocked(getConfig).mockResolvedValue({
      plan: "standard",
      coreConfigEnabled: false,
      additionalEnabled: false,
      creditsBalance: 0,
      aiSystemPrompt: "",
      thresholdBest: 7,
      thresholdMediocre: 5,
      branding: {},
      coreParams: CORE,
      additionalParams: ADDITIONAL,
    } as never);
    const { saved } = mountSection(<AreaWeightsSection />);
    expect(await screen.findByText(/requires the Pro or Premium plan/)).toBeInTheDocument();
    expect(screen.getByLabelText("Problem & Market Clarity weight")).toBeDisabled();
    expect(saved.state).toBeNull();
  });

  it("names the areas with the count the payload actually carries", async () => {
    mountSection(<AreaWeightsSection />);
    const heading = await screen.findByRole("heading", { level: 2, name: "Area weights" });
    expect(within(heading.parentElement as HTMLElement).getByText(/3 evaluation areas/)).toBeInTheDocument();
  });
});
