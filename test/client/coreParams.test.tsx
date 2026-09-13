import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ConfigPage } from "../../src/client/routes/ConfigPage";
import { getConfig, getConfigSummary, listPrograms, updateThresholds, type FullConfig } from "../../src/client/api";
import { getParameterConfig, saveCoreParams, type ParameterConfigView } from "../../src/client/routes/parametersApi";
import { scoringSettings } from "../../src/client/routes/admin/scoringApi";
import { DEFAULT_SCORING_SETTINGS } from "../../src/shared/scoring";
import type { Edition, Role } from "../../src/shared/roles";

/**
 * W8-B — Core Parameters to `panel-coreparams.html`: the five columns with the
 * renameable name and the Core chip, the toolbar and its copy, the
 * remaining / over-by footer, the read-only variant for a role that may see the
 * weights without changing them, and W7-D's scale rule on the cohort thresholds.
 */

vi.mock("../../src/client/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/api")>()),
  getConfig: vi.fn(),
  getConfigSummary: vi.fn(),
  listPrograms: vi.fn(),
  updateThresholds: vi.fn(),
}));

vi.mock("../../src/client/routes/parametersApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/routes/parametersApi")>()),
  getParameterConfig: vi.fn(),
  saveCoreParams: vi.fn(),
}));

vi.mock("../../src/client/routes/admin/scoringApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/routes/admin/scoringApi")>()),
  scoringSettings: vi.fn(),
}));

const principal: { role: Role; edition: Edition } = { role: "admin", edition: "incubator" };
vi.mock("../../src/client/auth/useAuth", () => ({
  useAuth: () => ({ user: { id: "u1", name: "N", initials: "N", ...principal } }),
}));

const NAMES = [
  "Problem & Market Clarity",
  "Solution & Value Proposition",
  "Market Size & Opportunity",
  "Product & Technology",
  "Business Model & Unit Economics",
  "Traction & Validation",
  "Competitive Landscape",
  "Go-To-Market Strategy",
  "Team & Execution Capability",
  "Business Risks",
  "Business Attractiveness",
  "Climate Impact & Integrity",
  "Storytelling & Deck Quality",
];
const WEIGHTS = [8, 8, 7, 7, 8, 10, 6, 6, 10, 8, 8, 10, 4];

function view(over: Partial<ParameterConfigView> = {}): ParameterConfigView {
  return {
    plan: "premium",
    memberTier: "pro",
    effectivePlan: "pro",
    coreConfigEnabled: true,
    additionalEnabled: false,
    coreEditor: true,
    additionalEditor: true,
    coreParams: NAMES.map((name, i) => ({
      id: `c${i}`,
      key: `c${i}`,
      name,
      weight: WEIGHTS[i],
      informational: false,
      prompt: i === 0 ? "Look for a specific problem." : undefined,
    })),
    additionalParams: [],
    ...over,
  };
}

const CFG: FullConfig = {
  plan: "premium",
  coreConfigEnabled: true,
  additionalEnabled: true,
  thresholdBest: 7,
  thresholdMediocre: 5,
  branding: {},
  creditsBalance: 10,
  coreParams: [],
  additionalParams: [],
  aiSystemPrompt: "",
};

function mount() {
  return render(
    <MemoryRouter>
      <ConfigPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  principal.role = "admin";
  principal.edition = "incubator";
  vi.mocked(getParameterConfig).mockResolvedValue(view());
  vi.mocked(getConfig).mockResolvedValue(CFG);
  vi.mocked(getConfigSummary).mockResolvedValue(CFG);
  vi.mocked(listPrograms).mockResolvedValue({ programs: [] } as never);
  vi.mocked(scoringSettings).mockResolvedValue({ ...DEFAULT_SCORING_SETTINGS });
  vi.mocked(updateThresholds).mockResolvedValue({ ok: true, thresholdBest: 7, thresholdMediocre: 5 });
});

describe("Core Parameters · the panel", () => {
  it("is the prototype's panel: toolbar, copy, plan badge and the five columns", async () => {
    mount();
    const table = await screen.findByRole("table");
    expect(screen.getByRole("heading", { level: 1, name: "Core Parameters — Area weights" })).toBeInTheDocument();
    expect(screen.getByText(/Configure the 13 core evaluation areas and their weights/)).toBeInTheDocument();
    expect(screen.getByTestId("plan-badge")).toHaveTextContent("Pro plan");
    expect(screen.getByRole("heading", { level: 2, name: "Area weights" })).toBeInTheDocument();
    expect(screen.getByText(/Evaluation area names are configurable\. Total must equal 100%\./)).toBeInTheDocument();

    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "#",
      "Evaluation area",
      "Type",
      "Weight %",
      "Visual",
    ]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(13);
    expect(within(rows[0]).getByText("01")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Core")).toBeInTheDocument();
    expect(within(table).getAllByText("Core")).toHaveLength(13);
    expect(screen.getByTestId("core-weight-total")).toHaveTextContent("Total: 100% ✓");
  });

  it("renames an area and saves the name with the weights", async () => {
    vi.mocked(saveCoreParams).mockResolvedValue({
      ok: true,
      rescored: { decks: 4, evaluations: 9 },
      coreParams: view().coreParams.map((p, i) => (i === 0 ? { ...p, name: "Problem clarity" } : p)),
    });
    mount();
    const name = await screen.findByLabelText("Problem & Market Clarity name");
    fireEvent.change(name, { target: { value: "Problem clarity" } });
    fireEvent.click(screen.getByRole("button", { name: /Save changes/ }));

    await waitFor(() => expect(saveCoreParams).toHaveBeenCalled());
    const sent = vi.mocked(saveCoreParams).mock.calls[0][0];
    expect(sent).toHaveLength(13);
    expect(sent[0]).toEqual({ id: "c0", weight: 8, name: "Problem clarity" });
    expect(sent[1]).toEqual({ id: "c1", weight: 8, name: "Solution & Value Proposition" });
    // F0539 — the re-score is no longer silent.
    expect(await screen.findByText(/re-scored 4 decks, 9 evaluations/)).toBeInTheDocument();
  });

  it("the footer says how far off 100 it is, and Save is refused until it balances", async () => {
    mount();
    const first = await screen.findByLabelText("Problem & Market Clarity weight");
    fireEvent.change(first, { target: { value: "0" } });
    expect(screen.getByTestId("core-weight-total")).toHaveTextContent("Total: 92% — 8% remaining");
    expect(screen.getByRole("button", { name: /Save changes/ })).toBeDisabled();
    fireEvent.change(first, { target: { value: "20" } });
    expect(screen.getByTestId("core-weight-total")).toHaveTextContent("Total: 112% — over by 12%");
    // The ×3.3 bar (`cpUpdWt`).
    const bar = first.closest("tr")!.querySelector("[style]") as HTMLElement;
    expect(bar.style.width).toBe("66%");
  });

  it("the read-only variant: a role that may see the weights but not change them", async () => {
    principal.role = "program_manager";
    vi.mocked(getParameterConfig).mockResolvedValue(view({ coreEditor: false, additionalEditor: true }));
    mount();
    await screen.findByRole("table");
    expect(screen.getByRole("note")).toHaveTextContent(
      "Read-only — Core Parameters are governed by the Super User. You can view the organisation’s area weights but can’t change them.",
    );
    expect(screen.queryByRole("button", { name: /Save changes/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Problem & Market Clarity name")).toBeDisabled();
    expect(screen.getByLabelText("Problem & Market Clarity weight")).toBeDisabled();
    // The administrators' folded sections are not this role's.
    expect(getConfig).not.toHaveBeenCalled();
    expect(screen.queryByText("Cohort rating thresholds")).not.toBeInTheDocument();
  });

  it("the VC read-only copy names the firm", async () => {
    principal.role = "analyst";
    principal.edition = "vc";
    vi.mocked(getParameterConfig).mockResolvedValue(view({ coreEditor: false, additionalEditor: false }));
    mount();
    expect(await screen.findByRole("note")).toHaveTextContent("You can view the firm’s area weights");
  });

  it("a plan that cannot configure the core 13 locks the panel and says which plan", async () => {
    vi.mocked(getParameterConfig).mockResolvedValue(
      view({ memberTier: "standard", effectivePlan: "standard", coreConfigEnabled: false }),
    );
    mount();
    expect(await screen.findByRole("note")).toHaveTextContent(
      "Read-only — configuring core parameters requires the Pro or Premium plan. Your current plan is Standard plan.",
    );
    expect(screen.getByRole("button", { name: /Save changes/ })).toBeDisabled();
    expect(screen.getByTestId("plan-badge")).toHaveTextContent("Standard plan");
  });

  it("edits one area's extraction prompt (§8 Q95) through the rubric save", async () => {
    vi.mocked(saveCoreParams).mockResolvedValue({ ok: true, rescored: { decks: 0, evaluations: 0 }, coreParams: view().coreParams });
    mount();
    const row = await screen.findByRole("button", { name: /Problem & Market Clarity.*Customised/ });
    expect(screen.getByRole("button", { name: /Solution & Value Proposition.*Not set/ })).toBeInTheDocument();
    fireEvent.click(row);
    fireEvent.change(screen.getByLabelText("Extraction prompt for Problem & Market Clarity"), {
      target: { value: "Look for quantified pain." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save prompts" }));
    await waitFor(() => expect(saveCoreParams).toHaveBeenCalled());
    const sent = vi.mocked(saveCoreParams).mock.calls[0][0];
    expect(sent[0]).toEqual({ id: "c0", weight: 8, prompt: "Look for quantified pain." });
    expect(sent[1]).toEqual({ id: "c1", weight: 8 });
  });
});

describe("Core Parameters · cohort thresholds on the organisation's scale", () => {
  it("a stored 7.0 shows as 3.8 on a 1–5 organisation, and saves back canonical", async () => {
    vi.mocked(scoringSettings).mockResolvedValue({ ...DEFAULT_SCORING_SETTINGS, scoreScale: "1-5" });
    mount();
    const best = await screen.findByLabelText("Best threshold");
    await waitFor(() => expect(best).toHaveValue(3.8));
    expect(screen.getByLabelText("Mediocre threshold")).toHaveValue(3);
    expect(screen.getByTestId("config-threshold-preview")).toHaveTextContent("Best ≥ 3.8");
    expect(screen.getByTestId("config-threshold-preview")).toHaveTextContent("3 – 3.7");

    fireEvent.change(best, { target: { value: "4" } });
    const card = best.closest(".rounded-xl") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateThresholds).toHaveBeenCalledWith(7.5, 5));
  });

  it("the same stored 7.0 shows as 7 on 0–10 — the identity", async () => {
    mount();
    const best = await screen.findByLabelText("Best threshold");
    expect(best).toHaveValue(7);
    expect(screen.getByLabelText("Mediocre threshold")).toHaveValue(5);
    expect(screen.getByTestId("config-threshold-preview")).toHaveTextContent("Best ≥ 7");
    expect(screen.getByTestId("config-threshold-preview")).toHaveTextContent("5 – 6.9");
  });
});
