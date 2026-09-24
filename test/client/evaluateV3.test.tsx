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
import { PROGRAM_MANAGER_PENDING_Q_P, V3_UP_ROLES } from "../../src/client/routes/upload/v3Up";

/**
 * V3 item 10 — Evaluate, rebuilt from `AISJ_SuperuserV3` `panel-evaluate`.
 *
 * The whole panel diff against v15 is +533 bytes: the `AI Evaluate` toolbar
 * button, the select-all checkbox and `N selected` counter in column 1's head,
 * one CSS rule for that counter, and a new sub-line. Every literal asserted
 * here is copied from the decoded prototype markup, not imported from the
 * component, so a rename fails the test.
 *
 * R2-UPEVAL widened WHO gets that surface, per plan_roles_incubator §2 row
 * `11 · V3-UP`: the incubator superuser, ADMIN and PROGRAM ASSOCIATE. Nothing
 * server-side moved for either — `RESCORE_ROLES` (`server/routes/decks.ts:1268`)
 * already carried both, which is why the AI Evaluate test below asserts the call
 * really goes out for a program associate and not merely that the button draws.
 *
 * The negative control is still load-bearing, and now for two distinct reasons:
 *
 *   • the PROGRAM MANAGER is an open client question, not a gap. `AISJ_IC_PM_V5`
 *     draws its own multi-select for this screen — a bottom action bar with
 *     "Evaluate selected decks" — and V3 draws a toolbar button. Q-P asks which.
 *     Until it is answered the PM keeps v15.
 *   • the JURY must never get it, and this file is where that is provable.
 *     `App.tsx` routes the jury-exclusive `jassigned` screen through this same
 *     component, so admitting `"jury"` would silently rebuild the screen a juror
 *     scores on. The last test mounts that exact route to say so.
 *
 * The VC edition has its own `VcEvaluatePage` and never reaches this one.
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

/**
 * `entry` exists for the jury's own screen. `App.tsx` routes BOTH `evaluate` and
 * the jury-exclusive `jassigned` through `EvaluatePage`, so the route is part of
 * what the last test has to state — a v15 assertion made only at `/app/evaluate`
 * would not notice a juror's Assigned screen being rebuilt.
 */
function mount(role: Role, edition: Edition = "incubator", entry = "/app/evaluate") {
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
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          {/* A static segment outranks the dynamic one, so Assign still wins. */}
          <Route path="/app/assign" element={<h1>Assign screen</h1>} />
          <Route path="/app/:navId" element={<EvaluatePage />} />
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

describe("V3 item 10 — the Evaluate toolbar and column 1, for every admitted role", () => {
  it.each<[string, Role]>([
    ["the incubator superuser", "superuser"],
    ["an admin", "admin"],
    ["a program associate", "program_associate"],
  ])("%s carries the AI Evaluate button, the new sub-line and the select-all counter", async (_label, role) => {
    mount(role);
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

  /**
   * The widening's one real risk was the server, not the markup: the button
   * calls `POST /decks/:id/rescore`. `RESCORE_ROLES` already admits the program
   * associate, so this asserts the batch actually goes out for them and lands on
   * Assign — a screen they also already have (`nav.ts:107`), so the navigate is
   * not a 403 either.
   */
  it("a program associate's AI Evaluate really re-scores, and lands on Assign", async () => {
    mount("program_associate");
    await deckList();

    fireEvent.click(screen.getByLabelText("Select TaxPilot"));
    await waitFor(() => expect(screen.getByTestId("ev-col1-count")).toHaveTextContent("1 selected"));
    fireEvent.click(screen.getByRole("button", { name: "AI Evaluate" }));

    await waitFor(() => expect(vi.mocked(rescoreDeck)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(rescoreDeck)).toHaveBeenCalledWith("d_taxpilot");
    expect(await screen.findByText("1 deck evaluated — sent to Assign")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Assign screen" })).toBeInTheDocument();
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

describe("the negative control — the two roles that must NOT have it", () => {
  /** Everything v15 draws here and v3 replaces, asserted in one place. */
  function expectV15Surface() {
    expect(screen.getByText("Click a deck to open its evaluation report · set its status alongside")).toBeInTheDocument();
    expect(screen.getByTestId("ev-decks-label")).toHaveTextContent("2 decks · click to open report");

    expect(screen.queryByRole("button", { name: "AI Evaluate" })).toBeNull();
    expect(screen.queryByLabelText("Select all decks")).toBeNull();
    expect(screen.queryByTestId("ev-col1-count")).toBeNull();
    expect(screen.queryByLabelText("Select TaxPilot")).toBeNull();
  }

  it("the gate admits exactly three roles, and says why the PM is not one of them", () => {
    expect([...V3_UP_ROLES]).toEqual(["superuser", "admin", "program_associate"]);
    // Q-P, unanswered: the PM's own prototype draws a bottom action bar where V3
    // draws a toolbar button. Flipping this ships V3's design to them.
    expect(PROGRAM_MANAGER_PENDING_Q_P).toBe(true);
  });

  it("a program manager keeps the v15 surface while Q-P is open", async () => {
    mount("program_manager");
    await deckList();
    expectV15Surface();
  });

  it("a jury member keeps it at /app/evaluate", async () => {
    mount("jury");
    await deckList();
    expectV15Surface();
  });

  /**
   * The trap, made explicit. `App.tsx` points the jury-exclusive `jassigned`
   * screen at this same component, so a juror added to `V3_UP_ROLES` would not
   * gain a new screen — they would lose the one they score on, rebuilt around a
   * multi-select and an "AI Evaluate" button they hold no permission for. The
   * two assertions below are the pair: the workbench entry point is still there,
   * and none of v3's chrome is.
   */
  it("and on their OWN screen, /app/jassigned, which is the one that matters", async () => {
    mount("jury", "incubator", "/app/jassigned");
    const list = await deckList();
    expectV15Surface();

    // Still a juror's screen: the row opens the report, and nothing selects it.
    expect(within(list).getByRole("button", { name: /TaxPilot/ })).toBeInTheDocument();
    expect(within(list).queryByRole("checkbox")).toBeNull();
  });
});
