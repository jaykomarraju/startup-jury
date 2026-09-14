import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, configure } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthContext, type AuthUser } from "../../src/client/auth/AuthProvider";
import { VcEvaluatePage, SUBMIT_SUBTITLE } from "../../src/client/routes/VcEvaluatePage";
import type { DeckView } from "../../src/client/types";
import type { RubricParameter } from "../../src/client/api";
import {
  castIcVote,
  getDeck,
  getDeckReport,
  getMyScores,
  listDecks,
  listIcVotes,
  listParameters,
  submitJuryScores,
} from "../../src/client/api";
import { scoringSettings } from "../../src/client/routes/admin/scoringApi";
import { DEFAULT_SCORING_SETTINGS } from "../../src/shared/scoring";
import type { Role } from "../../src/shared/roles";

/**
 * W9-A — VC Evaluate (`AISJ_VC_Superuser_V8` panel-evaluate, md5-identical in
 * the Admin / Partner / Associate / Analyst builds), the IC member's variant
 * (`AISJ_VC_IC_member_V2`), and the Submit route that shares the component.
 */

configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 30_000 });

vi.mock("../../src/client/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/api")>()),
  listDecks: vi.fn(),
  listParameters: vi.fn(),
  listIcVotes: vi.fn(),
  castIcVote: vi.fn(),
  getDeck: vi.fn(),
  getDeckReport: vi.fn(),
  getMyScores: vi.fn(),
  submitJuryScores: vi.fn(),
  transitionDeck: vi.fn(),
  rescoreDeck: vi.fn(),
}));

vi.mock("../../src/client/routes/admin/scoringApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/routes/admin/scoringApi")>()),
  scoringSettings: vi.fn(),
}));

const PARAMETERS: RubricParameter[] = [
  {
    key: "traction",
    name: "Traction & Validation",
    weight: 60,
    prompt: "Has reality said ‘yes’?",
    questions: ["What is your strongest proof of customer demand?"],
  },
  { key: "team", name: "Team & Execution Capability", weight: 40 },
  { key: "ic_exit", name: "Exit attractiveness", weight: 0, informational: true, roleScope: "ic_member", description: "Plausible exit paths." },
  { key: "partner_trl", name: "TRL stage", weight: 0, informational: true, roleScope: "partner" },
];

function deck(id: string, name: string, statusId: string, extra: Partial<DeckView> = {}): DeckView {
  return { id, name, sector: "Fintech", stage: "Seed", city: "Mumbai", statusId, aiScore: 7.4, missingFields: [], ...extra };
}

const DECKS: DeckView[] = [
  deck("d_wealth", "WealthOS", "associate_review", { missingFields: ["founderPhone"] }),
  deck("d_agri", "AgriChain", "partner_review"),
  deck("d_new", "Freshly", "analyst_scoring"),
  deck("d_credit", "CreditBridge", "ic_review", { aiScore: 7.5 }),
  deck("d_north", "Northbeam Robotics", "incomplete", { aiScore: undefined }),
  deck("d_quant", "QuantIQ", "onboard_ready"),
];

function mount(role: Role, path: "evaluate" | "assign" = "evaluate") {
  const user: AuthUser = { id: `u_${role}`, name: "Test", initials: "T", role, edition: "vc", permissions: ["evaluate", "icpipeline", "myparams"] };
  return render(
    <AuthContext.Provider value={{ user, loading: false, login: vi.fn(), logout: vi.fn(), updateUser: vi.fn() }}>
      <MemoryRouter initialEntries={[`/app/${path}`]}>
        <Routes>
          <Route path="/app/:navId" element={<VcEvaluatePage />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 })) as typeof fetch;
  vi.mocked(scoringSettings).mockResolvedValue({ ...DEFAULT_SCORING_SETTINGS });
  vi.mocked(listDecks).mockResolvedValue({ decks: DECKS } as never);
  vi.mocked(listParameters).mockResolvedValue({ parameters: PARAMETERS, anchors: [] });
  vi.mocked(getDeck).mockResolvedValue({ scores: [], weightedTotal: undefined } as never);
  vi.mocked(getMyScores).mockImplementation(async (id: string) =>
    id === "d_agri" ? { scores: [{ key: "traction", value: 8 }] } : { scores: [] },
  );
  vi.mocked(getDeckReport).mockResolvedValue({ deck: DECKS[3], columns: [], core: [], additional: [], hiddenEvaluators: 0 } as never);
  vi.mocked(listIcVotes).mockResolvedValue({
    votes: [],
    tally: { invest: 0, hold: 0, need_more_info: 0, pass: 0 },
    total: 0,
    recommendation: null,
    myVote: null,
  });
  vi.mocked(castIcVote).mockResolvedValue({ ok: true, vote: "invest" });
  vi.mocked(submitJuryScores).mockResolvedValue({ ok: true } as never);
});

describe("VC Evaluate — the prototype's three columns and the batch bar (F0435 / F0436 / F0451 / F0452)", () => {
  it("renders the toolbar, the deck checklist, the parameters column and the empty detail", async () => {
    mount("associate");
    const list = await screen.findByRole("list", { name: "Decks to evaluate" });
    await within(list).findByText("WealthOS");

    expect(screen.getByRole("heading", { level: 1, name: "Evaluate" })).toBeInTheDocument();
    expect(screen.getByText("Select decks · review parameters · click Evaluate to begin")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
    expect(screen.getByTestId("ev-decks-label")).toHaveTextContent("3 decks");
    expect(screen.getByRole("checkbox", { name: "Select all" })).toBeInTheDocument();
    expect(screen.getByTestId("ev-sel-label")).toHaveTextContent("0 decks selected");
    expect(screen.getByText("✓ check to queue")).toBeInTheDocument();
    expect(screen.getByText("2 Evaluation parameters")).toBeInTheDocument();
    expect(screen.getByText("Click Review to see the full prompt")).toBeInTheDocument();
    expect(screen.getByText(/Click/, { selector: "p" })).toHaveTextContent("Click Review on any parameter");
    // The VC Super User build has no additional-parameter group above the core list.
    expect(screen.queryByText(/My additional parameters/)).not.toBeInTheDocument();

    // Only deals being scored: not IC review, not Incomplete, not onboarded.
    for (const other of ["CreditBridge", "Northbeam Robotics", "QuantIQ"]) {
      expect(within(list).queryByText(other)).not.toBeInTheDocument();
    }
    // Badges: flags, and Evaluated once this evaluator has saved scores.
    const wealth = within(list).getByText("WealthOS").closest("li") as HTMLElement;
    expect(within(wealth).getByText("1 flag")).toBeInTheDocument();
    const agri = within(list).getByText("AgriChain").closest("li") as HTMLElement;
    expect(await within(agri).findByText("Evaluated")).toBeInTheDocument();
    expect(within(wealth).queryByText("Evaluated")).not.toBeInTheDocument();
  });

  it("Review opens the parameter detail: prompt, questions, anchors", async () => {
    mount("analyst");
    fireEvent.click(await screen.findByRole("button", { name: "Review Traction & Validation" }));
    const card = await screen.findByRole("article", { name: "Traction & Validation detail" });
    expect(within(card).getByText("Has reality said ‘yes’?")).toBeInTheDocument();
    expect(within(card).getByText("What is your strongest proof of customer demand?")).toBeInTheDocument();
    expect(within(card).getByText("Rubric anchors")).toBeInTheDocument();
  });

  it("ticking decks arms the bar; Evaluate selected decks walks exactly the selection, nothing pre-scored (F0454)", async () => {
    mount("partner");
    const list = await screen.findByRole("list", { name: "Decks to evaluate" });
    await within(list).findByText("WealthOS");
    const go = screen.getByRole("button", { name: /Evaluate selected decks/ });
    expect(go).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select WealthOS" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Freshly" }));
    expect(screen.getByTestId("ev-sel-label")).toHaveTextContent("2 decks selected");
    expect(screen.getByTestId("ev-bottom-summary")).toHaveTextContent("2 decks queued for evaluation across all 2 parameters.");
    expect(go).toBeEnabled();

    fireEvent.click(go);
    const dialog = await screen.findByRole("dialog", { name: "Evaluate WealthOS" });
    expect(within(dialog).getByText(/Deck 1 of 2/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("My score for Traction & Validation")).toHaveValue(null);
    expect(within(dialog).getByRole("button", { name: "Submit my evaluation" })).toBeDisabled();
    // The partner's own parameter is scored; another role's is not offered.
    expect(within(dialog).getByLabelText("My score for TRL stage")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("My score for Exit attractiveness")).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Next deck" }));
    expect(await screen.findByRole("dialog", { name: "Evaluate Freshly" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    expect(screen.getByTestId("ev-sel-label")).toHaveTextContent("3 decks selected");
  });

  it("a saved score is shown on reopening, and submits on the org's scale", async () => {
    mount("associate");
    const list = await screen.findByRole("list", { name: "Decks to evaluate" });
    fireEvent.click(await within(list).findByRole("button", { name: "AgriChain" }));
    const dialog = await screen.findByRole("dialog", { name: "Evaluate AgriChain" });
    await waitFor(() => expect(within(dialog).getByLabelText("My score for Traction & Validation")).toHaveValue(8));
    fireEvent.change(within(dialog).getByLabelText("My score for Team & Execution Capability"), { target: { value: "6" } });
    const submit = within(dialog).getByRole("button", { name: "Submit my evaluation" });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    await waitFor(() =>
      expect(submitJuryScores).toHaveBeenCalledWith(
        "d_agri",
        [
          { key: "traction", value: 8, comment: undefined },
          { key: "team", value: 6, comment: undefined },
        ],
        undefined,
      ),
    );
  });

  it("empty state: nothing being scored", async () => {
    vi.mocked(listDecks).mockResolvedValue({ decks: [DECKS[3], DECKS[5]] } as never);
    mount("analyst");
    expect(await screen.findByText(/Nothing to evaluate yet/)).toBeInTheDocument();
    expect(screen.getByTestId("ev-sel-label")).toHaveTextContent("0 decks selected");
  });
});

describe("VC Evaluate — the IC member (F0441)", () => {
  it("lists the deals at IC with the member's ballot alongside, and their own parameters first", async () => {
    mount("ic_member");
    const list = await screen.findByRole("list", { name: "Deals at IC" });
    await within(list).findByText("CreditBridge");
    expect(screen.getByText("Click a deck to open its evaluation report · set its status alongside")).toBeInTheDocument();
    expect(screen.getByTestId("ev-decks-label")).toHaveTextContent("1 deck · click to open report");
    expect(within(list).queryByText("WealthOS")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Evaluate selected decks/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Select all" })).not.toBeInTheDocument();
    const row = within(list).getByText("CreditBridge").closest("li") as HTMLElement;
    expect(within(row).getByText("AI 7.5")).toBeInTheDocument();

    expect(screen.getByText("My additional parameters (IC)")).toBeInTheDocument();
    const glance = screen.getByRole("article", { name: "My additional parameters" });
    expect(within(glance).getByText("Exit attractiveness")).toBeInTheDocument();
    expect(within(glance).getByText(/alongside the Analyst, Investment Associate and Partner/)).toBeInTheDocument();
    expect(screen.queryByText("TRL stage")).not.toBeInTheDocument();
  });

  it("the select is the committee ballot: none shows as none, a choice casts a vote", async () => {
    mount("ic_member");
    const select = (await screen.findByLabelText("My vote on CreditBridge")) as HTMLSelectElement;
    await waitFor(() => expect(select).toBeEnabled());
    expect(select.value).toBe("");
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "Not voted",
      "Invest",
      "Hold",
      "Need more info",
      "Pass",
    ]);
    fireEvent.change(select, { target: { value: "invest" } });
    await waitFor(() => expect(castIcVote).toHaveBeenCalledWith("d_credit", "invest"));
    expect((screen.getByLabelText("My vote on CreditBridge") as HTMLSelectElement).value).toBe("invest");
  });

  it("clicking a deal opens its evaluation report", async () => {
    mount("ic_member");
    fireEvent.click(await screen.findByRole("button", { name: /CreditBridge/ }));
    await waitFor(() => expect(getDeckReport).toHaveBeenCalled());
  });
});

describe("VC Submit shares the component, under its own title (F0594)", () => {
  it("titles the assign route Submit and keeps the scoring workbench, with nothing pre-scored", async () => {
    mount("analyst", "assign");
    expect(await screen.findByRole("heading", { level: 1, name: "Submit" })).toBeInTheDocument();
    expect(screen.getByText(SUBMIT_SUBTITLE)).toBeInTheDocument();
    expect(screen.queryByText("Select decks · review parameters · click Evaluate to begin")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /WealthOS/ }));
    expect(await screen.findByLabelText("My score for Traction & Validation")).toHaveValue(null);
    expect(screen.getByRole("button", { name: "Submit my evaluation" })).toBeDisabled();
  });
});
