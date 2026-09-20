import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthContext, type AuthUser } from "../../src/client/auth/AuthProvider";
import { ToastProvider } from "../../src/client/components/Toast";
import { EvaluatePage } from "../../src/client/routes/EvaluatePage";
import { DEFAULT_SCORING_SETTINGS } from "../../src/shared/scoring";
import type { DeckView } from "../../src/client/types";
import type { RubricParameter } from "../../src/client/api";
import {
  listDecks,
  listParameters,
  listRecommendations,
  getDeck,
  getMyScores,
  rescoreDeck,
} from "../../src/client/api";
import { scoringSettings } from "../../src/client/routes/admin/scoringApi";
import type { Edition, Role } from "../../src/shared/roles";

/**
 * V3 item 10 — Evaluate, rebuilt from `AISJ_SuperuserV3` `panel-evaluate`.
 *
 * The whole panel diff against v15 is +533 bytes: the `AI Evaluate` toolbar
 * button, the select-all checkbox and `N selected` counter in column 1's head,
 * one CSS rule for that counter, and a new sub-line. Every literal asserted
 * here is copied from the decoded prototype markup, not imported from the
 * component, so a rename fails the test.
 *
 * Only the superuser prototype was reshared. The negative control below is
 * therefore load-bearing: admin, program manager, program associate and jury
 * must still render the v15 surface exactly, and the VC edition has its own
 * `VcEvaluatePage` and never reaches this one.
 */

vi.mock("../../src/client/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/api")>()),
  listDecks: vi.fn(),
  listParameters: vi.fn(),
  listRecommendations: vi.fn(),
  setRecommendation: vi.fn(),
  getDeck: vi.fn(),
  getMyScores: vi.fn(),
  rescoreDeck: vi.fn(),
  submitJuryScores: vi.fn(),
  transitionDeck: vi.fn(),
}));

vi.mock("../../src/client/routes/admin/scoringApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/routes/admin/scoringApi")>()),
  scoringSettings: vi.fn(),
}));

const DECKS: DeckView[] = [
  { id: "d_taxpilot", name: "TaxPilot", sector: "B2B SaaS", stage: "Seed", city: "Chennai", statusId: "assigned", assignedTo: "u_jury", aiScore: 6.9 },
  { id: "d_insureflow", name: "InsureFlow", sector: "Insurtech", stage: "Seed", city: "Bengaluru", statusId: "jury_evaluation", assignedTo: "u_jury", aiScore: 8.6 },
  // Out of the queue in every version: a shortlisted deck is past Evaluate.
  { id: "d_done", name: "Shortlisted Co", statusId: "shortlisted", assignedTo: "u_jury" },
];

const PARAMETERS: RubricParameter[] = [
  { key: "traction", name: "Traction & Validation", weight: 10 },
  { key: "team", name: "Team & Execution Capability", weight: 10 },
];

function principal(role: Role, edition: Edition): AuthUser {
  return { id: `u_${role}`, name: "Rajesh Kumar", initials: "RK", role, edition };
}

function mount(role: Role, edition: Edition = "incubator") {
  vi.mocked(listDecks).mockResolvedValue({ decks: DECKS } as never);
  vi.mocked(listParameters).mockResolvedValue({ parameters: PARAMETERS, anchors: [] });
  vi.mocked(listRecommendations).mockResolvedValue({ recommendations: {}, evaluated: [] });
  vi.mocked(getDeck).mockResolvedValue({ scores: [], weightedTotal: undefined } as never);
  vi.mocked(getMyScores).mockResolvedValue({ scores: [] });
  vi.mocked(rescoreDeck).mockResolvedValue({
    ok: true,
    result: { weightedTotal: 7.4, signal: "strong", status: "ai_evaluated", gatePassed: true },
  });
  return render(
    withAuth(
      <MemoryRouter initialEntries={["/app/evaluate"]}>
        <Routes>
          <Route path="/app/evaluate" element={<EvaluatePage />} />
          <Route path="/app/assign" element={<h1>Assign screen</h1>} />
        </Routes>
      </MemoryRouter>,
      principal(role, edition),
    ),
  );
}

function withAuth(node: ReactNode, user: AuthUser) {
  return (
    <AuthContext.Provider value={{ user, loading: false, login: vi.fn(), logout: vi.fn(), updateUser: vi.fn() }}>
      <ToastProvider>{node}</ToastProvider>
    </AuthContext.Provider>
  );
}

/** The populated list, never the heading — the loading branch renders that too. */
async function deckList() {
  const list = await screen.findByRole("list", { name: "Decks to evaluate" });
  await within(list).findByText("TaxPilot");
  return list;
}

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 })) as typeof fetch;
  vi.mocked(scoringSettings).mockResolvedValue({ ...DEFAULT_SCORING_SETTINGS });
});

describe("V3 item 10 — the superuser's Evaluate toolbar and column 1", () => {
  it("carries the AI Evaluate button, the new sub-line and the select-all counter", async () => {
    mount("superuser");
    await deckList();

    expect(screen.getByRole("button", { name: "AI Evaluate" })).toBeInTheDocument();
    // "Select decks and click <b>AI Evaluate</b> · evaluated decks move to the
    // Assign screen. Click a deck to open its report."
    expect(
      screen.getByText(
        (_, el) =>
          el?.tagName === "DIV" &&
          el.textContent ===
            "Select decks and click AI Evaluate · evaluated decks move to the Assign screen. Click a deck to open its report.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Select all decks")).toBeInTheDocument();
    expect(screen.getByTestId("ev-col1-count")).toHaveTextContent("0 selected");
    // v15's label is gone for this role.
    expect(screen.queryByTestId("ev-decks-label")).toBeNull();
    expect(
      screen.queryByText("Click a deck to open its evaluation report · set its status alongside"),
    ).toBeNull();
  });

  it("Select all ticks every row and counts them; untick clears", async () => {
    mount("superuser");
    await deckList();

    fireEvent.click(screen.getByLabelText("Select all decks"));
    await waitFor(() => expect(screen.getByTestId("ev-col1-count")).toHaveTextContent("2 selected"));
    expect((screen.getByLabelText("Select TaxPilot") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Select InsureFlow") as HTMLInputElement).checked).toBe(true);
    // Never the deck that is past this screen.
    expect(screen.queryByLabelText("Select Shortlisted Co")).toBeNull();

    fireEvent.click(screen.getByLabelText("Select all decks"));
    await waitFor(() => expect(screen.getByTestId("ev-col1-count")).toHaveTextContent("0 selected"));
  });

  it("AI Evaluate with nothing selected evaluates ALL of them, toasts, and lands on Assign", async () => {
    mount("superuser");
    await deckList();

    fireEvent.click(screen.getByRole("button", { name: "AI Evaluate" }));

    await waitFor(() => expect(vi.mocked(rescoreDeck)).toHaveBeenCalledTimes(2));
    expect(vi.mocked(rescoreDeck).mock.calls.map((c) => c[0]).sort()).toEqual(["d_insureflow", "d_taxpilot"]);
    expect(await screen.findByText("2 decks evaluated — sent to Assign")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Assign screen" })).toBeInTheDocument();
  });

  it("AI Evaluate with a selection evaluates only what was ticked", async () => {
    mount("superuser");
    await deckList();

    fireEvent.click(screen.getByLabelText("Select InsureFlow"));
    await waitFor(() => expect(screen.getByTestId("ev-col1-count")).toHaveTextContent("1 selected"));
    fireEvent.click(screen.getByRole("button", { name: "AI Evaluate" }));

    await waitFor(() => expect(vi.mocked(rescoreDeck)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(rescoreDeck)).toHaveBeenCalledWith("d_insureflow");
    expect(await screen.findByText("1 deck evaluated — sent to Assign")).toBeInTheDocument();
  });

  it("counts and evaluates the SAME set when a filter is narrowing the list", async () => {
    mount("superuser");
    await deckList();

    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.change(screen.getByLabelText("Search decks"), { target: { value: "InsureFlow" } });
    await waitFor(() => expect(screen.queryByLabelText("Select TaxPilot")).toBeNull());

    fireEvent.click(screen.getByLabelText("Select all decks"));
    await waitFor(() => expect(screen.getByTestId("ev-col1-count")).toHaveTextContent("1 selected"));

    fireEvent.click(screen.getByRole("button", { name: "AI Evaluate" }));
    await waitFor(() => expect(vi.mocked(rescoreDeck)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(rescoreDeck)).toHaveBeenCalledWith("d_insureflow");
  });

  it("says what it skipped rather than counting a blocked re-run as evaluated", async () => {
    mount("superuser");
    await deckList();
    vi.mocked(rescoreDeck).mockResolvedValueOnce({ ok: false, reason: "already_scored" });

    fireEvent.click(screen.getByRole("button", { name: "AI Evaluate" }));

    expect(
      await screen.findByText("1 deck evaluated — sent to Assign · 1 already scored"),
    ).toBeInTheDocument();
  });
});

describe("the negative control — every role the client did NOT rescope", () => {
  it.each<[string, Role]>([
    ["an admin", "admin"],
    ["a program manager", "program_manager"],
    ["a program associate", "program_associate"],
    ["a jury member", "jury"],
  ])("%s still renders the v15 surface, byte for byte", async (_label, role) => {
    mount(role);
    await deckList();

    expect(screen.getByText("Click a deck to open its evaluation report · set its status alongside")).toBeInTheDocument();
    expect(screen.getByTestId("ev-decks-label")).toHaveTextContent("2 decks · click to open report");

    expect(screen.queryByRole("button", { name: "AI Evaluate" })).toBeNull();
    expect(screen.queryByLabelText("Select all decks")).toBeNull();
    expect(screen.queryByTestId("ev-col1-count")).toBeNull();
    expect(screen.queryByLabelText("Select TaxPilot")).toBeNull();
  });
});
