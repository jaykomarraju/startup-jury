import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AssignPage } from "../../src/client/routes/AssignPage";
import type { DeckView } from "../../src/client/types";
import type { AssignBoardDeck, EvaluatorGroup, RubricParameter } from "../../src/client/api";
import { deckListRoute } from "../../src/shared/queries";

/**
 * W7-E — Assign, against `AISJ_IC_SuserV15/panel-assign.html` and its renderers.
 *
 * Every wait gates on a POPULATED element — a deck row, a role row — never on the
 * "Assign" heading, which renders before a single fetch has answered.
 */

vi.mock("../../src/client/auth/useAuth", () => ({
  useAuth: () => ({ user: { id: "inc_pa", edition: "incubator", role: "program_associate", name: "Sunita Rao", initials: "SR" } }),
}));

vi.mock("../../src/client/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/client/api")>();
  return {
    ...actual,
    listDecks: vi.fn(),
    getAssignBoard: vi.fn(),
    listEvaluators: vi.fn(),
    listParameters: vi.fn(),
    confirmAssignments: vi.fn(),
    getDeckReport: vi.fn(() => new Promise(() => {})),
  };
});

import {
  ApiError,
  confirmAssignments,
  getAssignBoard,
  listDecks,
  listEvaluators,
  listParameters,
} from "../../src/client/api";

const navigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigate };
});

function deck(over: Partial<DeckView>): DeckView {
  return { id: "d", name: "Deck", status: "AI Evaluated", statusId: "ai_evaluated", ...over };
}

const FINSTACK = deck({ id: "d_fin", name: "FinStack", sector: "B2B Fintech", stage: "Seed", aiScore: 7.2 });
const GREENGRID = deck({ id: "d_green", name: "GreenGrid", sector: "Climatetech", stage: "Pre-seed", aiScore: 9.1 });
const TAXPILOT = deck({
  id: "d_tax",
  name: "TaxPilot",
  sector: "B2B SaaS",
  stage: "Seed",
  aiScore: 6.9,
  status: "Assigned",
  statusId: "assigned",
});
const AGRICHAIN = deck({
  id: "d_agri",
  name: "AgriChain",
  sector: "AgriTech",
  stage: "Pre-seed",
  status: "Incomplete",
  statusId: "incomplete",
  missingFields: ["founderEmail"],
  missingSections: ["Traction"],
});

const PARAMS: RubricParameter[] = [
  { key: "problem", name: "Problem & Market Clarity", weight: 8 },
  { key: "traction", name: "Traction & Validation", weight: 10 },
  { key: "add_fit", name: "Program fit", weight: 0, informational: true, roleScope: "program_associate" },
];

function boardEntry(over: Partial<AssignBoardDeck> = {}): AssignBoardDeck {
  return {
    core: [
      { key: "problem", value: 8 },
      { key: "traction", value: 4 },
    ],
    additional: { program_associate: 21.4, program_manager: 18, jury: null },
    withheld: false,
    assignees: [],
    ...over,
  };
}

const GROUPS: EvaluatorGroup[] = [
  // The server's order — jury first — which the screen must re-sort (F0334).
  {
    role: "jury",
    roleLabel: "Jury Member",
    members: [{ id: "u_rk", name: "Rajesh Kumar", initials: "RK", role: "jury", title: "Fintech · IIT Bombay", openDecks: 4, capacity: 6 }],
  },
  {
    role: "program_manager",
    roleLabel: "Program Manager",
    members: [
      { id: "u_vn", name: "Vikram Nair", initials: "VN", role: "program_manager", openDecks: 5, capacity: 10 },
      { id: "u_pm", name: "Priya Menon", initials: "PM", role: "program_manager", openDecks: 1, capacity: 10 },
    ],
  },
  {
    role: "program_associate",
    roleLabel: "Program Associate",
    members: [{ id: "u_sr", name: "Sunita Rao", initials: "SR", role: "program_associate", openDecks: 11, capacity: 12 }],
  },
];

function setup({
  decks = [FINSTACK, GREENGRID, TAXPILOT, AGRICHAIN],
  groups = GROUPS,
}: { decks?: DeckView[]; groups?: EvaluatorGroup[] } = {}) {
  // V4-ROUTE — the screen now reads TWO server-enforced lists,
  // `?list=assign` (the roster) and `?list=query` (the hand-over drawer).
  // Routed here with `deckListRoute`, the same function the server runs, so a
  // fixture cannot put a deck marked incomplete in column 1 by accident.
  vi.mocked(listDecks).mockImplementation(async (filter) => ({
    decks: filter?.list
      ? decks.filter((d) => deckListRoute(d, "incubator", { queried: d.queried === true }) === filter.list)
      : decks,
  }));
  vi.mocked(getAssignBoard).mockResolvedValue({
    decks: Object.fromEntries(decks.filter((d) => d.statusId !== "incomplete").map((d) => [d.id, boardEntry()])),
  });
  vi.mocked(listEvaluators).mockResolvedValue({ groups });
  vi.mocked(listParameters).mockResolvedValue({ parameters: PARAMS });
  return render(
    <MemoryRouter>
      <AssignPage />
    </MemoryRouter>,
  );
}

const deckRow = (name: string) =>
  screen.getAllByTestId("assign-deck-row").find((r) => within(r).queryByText(name)) as HTMLElement;

async function ready() {
  await screen.findByRole("checkbox", { name: "Select FinStack" });
  await screen.findByRole("button", { name: /Program manager/ });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Assign — toolbar and columns", () => {
  it("renders the prototype's toolbar: title, subtitle, Incomplete N, Filter, Export", async () => {
    setup();
    await ready();
    expect(screen.getByRole("heading", { name: "Assign" })).toBeInTheDocument();
    expect(screen.getByText("Select evaluated decks · choose role · pick one or more jury members · confirm")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Incomplete\s*1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Filter/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
  });

  it("keeps the Incomplete button at zero (F0267)", async () => {
    setup({ decks: [FINSTACK] });
    await ready();
    expect(screen.getByTestId("assign-incomplete-count")).toHaveTextContent("0");
  });

  it("draws each evaluated deck with the AI badge, AI+ /30, sparkline and the status vocabulary", async () => {
    setup();
    await ready();
    const fin = deckRow("FinStack");
    expect(within(fin).getByText("B2B Fintech · Seed")).toBeInTheDocument();
    expect(within(fin).getByText("AI 7.2")).toBeInTheDocument();
    expect(fin).toHaveTextContent("AI+ 21/30");
    expect(within(fin).getByText("Evaluated")).toBeInTheDocument();
    expect(within(fin).queryByText("Assigned")).toBeNull();
    expect(within(fin).getByRole("button", { name: "View AI parameter scores for FinStack" })).toBeInTheDocument();
    // An assigned deck stays selectable and says so.
    const tax = deckRow("TaxPilot");
    expect(within(tax).getByText("Assigned")).toBeInTheDocument();
    expect(within(tax).getByRole("checkbox", { name: "Select TaxPilot" })).toBeEnabled();
  });

  it("switches the AI badge to a role's additional score from the row's dropdown", async () => {
    setup();
    await ready();
    const fin = deckRow("FinStack");
    fireEvent.change(within(fin).getByRole("combobox", { name: "AI score view for FinStack" }), { target: { value: "1" } });
    expect(fin).toHaveTextContent("AI++ 18/30");
    const options = within(within(fin).getByRole("combobox")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["AI base", "AI+ · Program Associate", "AI++ · Program Manager", "AI+++ · Jury Member"]);
  });

  it("lists incomplete decks greyed out with their missing information, unselectable (F0259)", async () => {
    setup();
    await ready();
    const row = screen.getByTestId("assign-incomplete-row");
    expect(within(row).getByText("AgriChain")).toBeInTheDocument();
    expect(within(row).getByText("Incomplete")).toBeInTheDocument();
    expect(within(row).getByText("Founder email not captured · no traction data")).toBeInTheDocument();
    expect(within(row).getByRole("checkbox", { name: "Select AgriChain" })).toBeDisabled();
  });

  it("orders roles Program manager → Program associate → Jury member, with 'N users' (F0332/F0334)", async () => {
    setup();
    await ready();
    const names = within(screen.getByRole("list", { name: "Roles" }))
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(names).toEqual(["Program manager2 users", "Program associate1 user", "Jury member1 user"]);
  });

  it("shows the members of a role with the pluralised heading, description and load bar (F0258/F0333)", async () => {
    setup();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /Jury member/ }));
    expect(screen.getByTestId("assign-col3-title")).toHaveTextContent("Jury members");
    expect(screen.getByText("Domain expert evaluators · 1 available")).toBeInTheDocument();
    expect(screen.getByTestId("assign-load-label")).toHaveTextContent("4/6");
    fireEvent.click(screen.getByRole("button", { name: /Program associate/ }));
    // 11 of 12 is ≥ 80 % — red.
    expect(screen.getByTestId("assign-load-label")).toHaveClass("text-red");
  });

  it("filters column 1 by sector", async () => {
    setup();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /^Filter/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Sector" }), { target: { value: "Climatetech" } });
    expect(screen.getAllByTestId("assign-deck-row")).toHaveLength(1);
    expect(screen.getByRole("checkbox", { name: "Select GreenGrid" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Select FinStack" })).toBeNull();
  });
});

describe("Assign — empty states", () => {
  it("column 1 says why it is empty when nothing has passed the AI gate", async () => {
    setup({ decks: [] });
    await screen.findByRole("button", { name: /Program manager/ });
    await waitFor(() => expect(screen.getByTestId("assign-decks-empty")).toHaveTextContent(
      "No evaluated decks yet — decks that pass the AI gate appear here.",
    ));
    expect(screen.queryAllByTestId("assign-deck-row")).toHaveLength(0);
  });

  it("column 3 asks for a role, and column 4 walks through its two stages", async () => {
    setup();
    await ready();
    expect(screen.getByTestId("assign-col3-empty")).toHaveTextContent("Choose a role from column 2 to see available users.");
    expect(screen.getByTestId("assign-summary-empty")).toHaveTextContent("Select at least one deck from column 1.");
    expect(screen.getByTestId("assign-bottom-summary")).toHaveTextContent("Select decks and jury members to enable assignment.");
    expect(screen.getByRole("button", { name: /Confirm assignment/ })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select FinStack" }));
    expect(screen.getByTestId("assign-summary-empty")).toHaveTextContent(
      "Pick one or more jury members from column 3 — you can mix roles.",
    );
    expect(screen.getByTestId("assign-bottom-summary")).toHaveTextContent("1 deck selected — now pick one or more jury members.");
    expect(screen.queryByTestId("assign-summary")).toBeNull();
  });
});

describe("Assign — the summary and the cross product", () => {
  it("mixes roles, shows chips, scope, deadline and notify, and removes a member from its chip (F0260/F0261)", async () => {
    setup();
    await ready();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select FinStack" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select GreenGrid" }));
    fireEvent.click(screen.getByRole("button", { name: /Jury member/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Rajesh Kumar" }));
    fireEvent.click(screen.getByRole("button", { name: /Program manager/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Vikram Nair" }));

    const summary = screen.getByTestId("assign-summary");
    expect(within(summary).getByText("Assignment summary")).toBeInTheDocument();
    expect(within(summary).getByText("Review before confirming")).toBeInTheDocument();
    expect(within(summary).getByText("Rajesh Kumar")).toBeInTheDocument();
    expect(within(summary).getByText("Vikram Nair")).toBeInTheDocument();
    expect(screen.getByTestId("assign-scope")).toHaveAccessibleName("2 decks × 2 jury members = 4 evaluations");
    expect(summary).toHaveTextContent("7 days from assignment date");
    expect(screen.getByText("Notify 2 jury members by email")).toBeInTheDocument();
    expect(screen.getByTestId("assign-bottom-summary")).toHaveTextContent("2 decks → 2 jury members · click Confirm to assign.");

    fireEvent.click(within(summary).getByRole("button", { name: "Remove Rajesh Kumar" }));
    expect(screen.getByTestId("assign-scope")).toHaveAccessibleName("2 decks × 1 jury member = 2 evaluations");
  });

  it("confirms every deck × every member, with the note and the notify choice, then shows the results table (F0213)", async () => {
    setup();
    await ready();
    vi.mocked(confirmAssignments).mockResolvedValue({
      ok: true,
      assignedAt: "2026-09-12T10:00:00.000Z",
      dueAt: "2026-09-19T10:00:00.000Z",
      evaluations: 2,
      notified: 0,
      rows: [
        { deckId: "d_fin", deckName: "FinStack", evaluatorId: "u_rk", evaluatorName: "Rajesh Kumar", initials: "RK", role: "jury", roleLabel: "Jury Member" },
        { deckId: "d_fin", deckName: "FinStack", evaluatorId: "u_sr", evaluatorName: "Sunita Rao", initials: "SR", role: "program_associate", roleLabel: "Program Associate" },
      ],
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select FinStack" }));
    fireEvent.click(screen.getByRole("button", { name: /Jury member/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Rajesh Kumar" }));
    fireEvent.click(screen.getByRole("button", { name: /Program associate/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Sunita Rao" }));
    fireEvent.change(screen.getByLabelText("Instructions to evaluators (optional)"), {
      target: { value: "Focus on traction." },
    });
    fireEvent.click(screen.getByRole("switch", { name: "Notify by email" }));
    fireEvent.click(screen.getByRole("button", { name: /Confirm assignment/ }));

    const table = await screen.findByRole("table", { name: "Assignment results" });
    expect(confirmAssignments).toHaveBeenCalledWith({
      deckIds: ["d_fin"],
      assigneeIds: ["u_rk", "u_sr"],
      note: "Focus on traction.",
      notify: false,
    });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Assigned deck",
      "Role assigned to",
      "Name assigned to",
      "Evaluation report",
    ]);
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByText("Program associate")).toBeInTheDocument();
    expect(within(table).getAllByRole("button", { name: /View evaluation report/ })).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Assignment confirmed" })).toBeInTheDocument();
    expect(
      screen.getByText("1 deck assigned to 2 evaluators · evaluation report sent along · deadline 7 days"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("assign-bottom-summary")).toHaveTextContent("2 evaluations dispatched with the report.");
    expect(screen.getByRole("link", { name: /Done/ })).toHaveAttribute("href", "/app/alldecks");

    fireEvent.click(screen.getByRole("button", { name: /Assign more/ }));
    expect(await screen.findByRole("heading", { name: "Assign" })).toBeInTheDocument();
  });

  it("says nothing was assigned, and why, when the server refuses (F0211)", async () => {
    setup();
    await ready();
    vi.mocked(confirmAssignments).mockRejectedValue(
      new ApiError(409, { error: "not_assignable", message: "TaxPilot cannot be assigned from its current stage." }),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Select TaxPilot" }));
    fireEvent.click(screen.getByRole("button", { name: /Jury member/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Rajesh Kumar" }));
    fireEvent.click(screen.getByRole("button", { name: /Confirm assignment/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nothing was assigned. TaxPilot cannot be assigned from its current stage.",
    );
    expect(screen.queryByRole("table", { name: "Assignment results" })).toBeNull();
  });

  it("opens the per-parameter AI breakdown from the sparkline (F0212)", async () => {
    setup();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "View AI parameter scores for FinStack" }));
    const dialog = screen.getByRole("dialog", { name: "FinStack — per-parameter AI scores" });
    expect(within(dialog).getAllByTestId("param-row")).toHaveLength(2);
    expect(within(dialog).getByText("Weight 10")).toBeInTheDocument();
    // (8×8 + 4×10) / 18 = 5.8
    expect(within(dialog).getByText("5.8 / 10")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Open full evaluation report/ })).toBeInTheDocument();
    // The sparkline click must not also tick the row.
    expect(screen.getByRole("checkbox", { name: "Select FinStack" })).toHaveAttribute("aria-checked", "false");
  });
});

describe("Assign — the Incomplete decks view (F0272)", () => {
  it("lists them under the prototype's four columns and hands them to Query", async () => {
    setup();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /Incomplete\s*1/ }));
    const table = screen.getByRole("table", { name: "Incomplete decks" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Deck",
      "Missing information",
      "Status",
      "AI score",
    ]);
    expect(within(table).getByText("AgriChain")).toBeInTheDocument();
    expect(within(table).getByText("No AI score")).toBeInTheDocument();
    expect(screen.getByTestId("assign-bottom-summary")).toHaveTextContent(
      "1 incomplete deck — missing information the founder has to supply.",
    );
    fireEvent.click(screen.getByRole("button", { name: /Send to Query/ }));
    expect(navigate).toHaveBeenCalledWith("/app/query", { state: { deckIds: ["d_agri"] } });
  });

  it("says there are none, and offers no Send to Query, when every deck is complete", async () => {
    setup({ decks: [FINSTACK] });
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /Incomplete\s*0/ }));
    expect(
      screen.getByText("No incomplete decks — every evaluated deck is marked complete."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Send to Query/ })).toBeNull();
  });

  // V4-ROUTE — items 6 and 7. The drawer used to be the `incomplete` STAGE; it
  // is now whatever the partition sent to Query out of this screen's own
  // population, which includes an evaluated deck that lost a required intake
  // detail (plan §4.1, measured case (b)). That deck HAS an AI score, so the
  // hardcoded "No AI score" cell was wrong for it.
  it("holds an evaluated deck marked incomplete — out of column 1, into the drawer, with its score", async () => {
    const BLANKED = deck({
      id: "d_blank",
      name: "Blanked",
      aiScore: 8.4,
      status: "AI Evaluated",
      statusId: "ai_evaluated",
      missingFields: ["founderEmail"],
    });
    setup({ decks: [FINSTACK, BLANKED] });
    await ready();
    // Column 1 lists it the way it lists any un-assignable deck — greyed, with
    // a disabled tick — and only FinStack can actually be selected.
    const selectable = screen.getAllByTestId("assign-deck-row");
    expect(selectable.map((r) => r.textContent?.includes("Blanked"))).toEqual([false]);
    expect(screen.getByRole("checkbox", { name: "Select Blanked" })).toBeDisabled();
    expect(screen.getByTestId("assign-incomplete-row")).toHaveTextContent("Blanked");

    fireEvent.click(screen.getByRole("button", { name: /Incomplete\s*1/ }));
    const table = screen.getByRole("table", { name: "Incomplete decks" });
    expect(within(table).getByText("Blanked")).toBeInTheDocument();
    expect(within(table).getByText("8.4")).toBeInTheDocument();
    expect(within(table).queryByText("No AI score")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Send to Query/ }));
    expect(navigate).toHaveBeenCalledWith("/app/query", { state: { deckIds: ["d_blank"] } });
  });

  it("keeps manual_review and the answered-query tail OFF this screen — they are Query's alone", async () => {
    const REVIEW = deck({ id: "d_rev", name: "InReview", status: "Manual Review", statusId: "manual_review" });
    const ANSWERED = deck({ id: "d_ans", name: "Answered", status: "Uploaded", statusId: "uploaded", queried: true });
    setup({ decks: [FINSTACK, REVIEW, ANSWERED] });
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /Incomplete\s*0/ }));
    expect(screen.queryByText("InReview")).toBeNull();
    expect(screen.queryByText("Answered")).toBeNull();
  });
});
