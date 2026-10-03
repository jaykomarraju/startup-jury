import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthContext, type AuthUser } from "../../src/client/auth/AuthProvider";
import { EvaluatePage } from "../../src/client/routes/EvaluatePage";
import { EvaluationDrawer } from "../../src/client/components/EvaluationDrawer";
import { DEFAULT_SCORING_SETTINGS } from "../../src/shared/scoring";
import type { DeckView } from "../../src/client/types";
import {
  ApiError,
  getDeck,
  getDeckReport,
  getMyScores,
  listDecks,
  getMyAssignments,
  listParameters,
  listRecommendations,
  submitJuryScores,
  type DeckReportMatrix,
  type RubricParameter,
} from "../../src/client/api";
import { scoringSettings } from "../../src/client/routes/admin/scoringApi";
import type { Edition, Role } from "../../src/shared/roles";

/**
 * Oct-2026 issue 6 — "**My score** · Not editable. Unable to score the deck. My
 * score column is inactive", filed independently by a **jury member** and a
 * **programme manager**.
 *
 * Two roles, one symptom, so the first job was to find out whether anything was
 * disabled at all. Nothing is: the workbench takes a score from either role, and
 * the first describe below pins that so it cannot quietly stop being true. What
 * the client hit is three separate things wearing one sentence —
 *
 *   1. the overlay every OTHER screen opens on a startup name is a read-only
 *      report that never said so (`EvaluationDrawer`);
 *   2. a refused submit said "Try again", which is the one answer that cannot
 *      work for either refusal the server actually sends;
 *   3. only a deck at `assigned` / `jury_evaluation` reaches the workbench, and
 *      production holds exactly one of seventeen — which is the Assign flow's
 *      to answer, not this screen's. Pinned here as the reason, not as a fix.
 */

vi.mock("../../src/client/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/api")>()),
  listDecks: vi.fn(),
  listParameters: vi.fn(),
  listRecommendations: vi.fn(),
  getDeck: vi.fn(),
  getMyScores: vi.fn(),
  getDeckReport: vi.fn(),
  getMyAssignments: vi.fn(),
  submitJuryScores: vi.fn(),
  transitionDeck: vi.fn(),
  rescoreDeck: vi.fn(),
  setRecommendation: vi.fn(),
}));

vi.mock("../../src/client/routes/admin/scoringApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/routes/admin/scoringApi")>()),
  scoringSettings: vi.fn(),
}));

function principal(role: Role, edition: Edition = "incubator"): AuthUser {
  return { id: `u_${role}`, name: "Rajesh Kumar", initials: "RK", role, edition };
}

function withAuth(node: ReactNode, role: Role) {
  return (
    <AuthContext.Provider
      value={{ user: principal(role), loading: false, login: vi.fn(), logout: vi.fn(), updateUser: vi.fn() }}
    >
      {node}
    </AuthContext.Provider>
  );
}

const PARAMETERS: RubricParameter[] = [
  { key: "traction", name: "Traction & Validation", weight: 60 },
  { key: "team", name: "Team & Execution Capability", weight: 40 },
];

/** The one deck state the workbench opens for. Rostered to both test users. */
function assignedDeck(): DeckView {
  return {
    id: "d_assigned",
    name: "TaxPilot",
    sector: "B2B SaaS",
    statusId: "assigned",
    assignedTo: "u_jury",
    assigneeIds: ["u_jury", "u_program_manager"],
    aiScore: 6.9,
  };
}

/** Production's actual shape — six of these, nothing assigned. */
const AI_EVALUATED: DeckView = {
  id: "d_eval",
  name: "InsureFlow",
  sector: "Insurtech",
  statusId: "ai_evaluated",
  aiScore: 4.8,
};

function mount(role: Role, decks: DeckView[], entry: string) {
  vi.mocked(listDecks).mockResolvedValue({ decks } as never);
  vi.mocked(listParameters).mockResolvedValue({ parameters: PARAMETERS, anchors: [] });
  vi.mocked(listRecommendations).mockResolvedValue({ recommendations: {}, evaluated: [] });
  vi.mocked(getDeck).mockResolvedValue({ scores: [], weightedTotal: undefined } as never);
  vi.mocked(getMyScores).mockResolvedValue({ scores: [] });
  vi.mocked(getDeckReport).mockResolvedValue({ columns: [], core: [], additional: [] } as never);
  vi.mocked(getMyAssignments).mockResolvedValue({ assignments: [] } as never);
  return render(
    withAuth(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/app/:navId" element={<EvaluatePage />} />
        </Routes>
      </MemoryRouter>,
      role,
    ),
  );
}

/** Open the workbench the way each role reaches it, and score every parameter. */
async function openAndScore(role: Role) {
  const jury = role === "jury";
  mount(role, [assignedDeck()], jury ? "/app/jassigned" : "/app/evaluate");
  if (jury) {
    // `panel-jassigned` launches the workbench from the startup name.
    fireEvent.click(await screen.findByRole("button", { name: "TaxPilot" }));
  } else {
    const list = await screen.findByRole("list", { name: "Decks to evaluate" });
    fireEvent.click(within(list).getByText("TaxPilot"));
  }
  const dialog = await screen.findByRole("dialog", { name: "Evaluate TaxPilot" });
  // 1-Oct put `inert` on the list panel and `hidden` on the workbench to stop
  // the two overlays stacking. Neither may reach the workbench while it is the
  // only thing open — `inert` would make every input in it unclickable in a real
  // browser while `fireEvent` happily typed into it here, so this is asserted on
  // the DOM and not through the keyboard.
  expect(dialog.closest("[inert]"), "the workbench is not inside the inert panel").toBeNull();
  expect(dialog.closest("[hidden]"), "the workbench is not hidden").toBeNull();
  for (const p of PARAMETERS) {
    const input = within(dialog).getByLabelText(`My score for ${p.name}`) as HTMLInputElement;
    expect(input.disabled, `${role} · ${p.name} · disabled`).toBe(false);
    expect(input.readOnly, `${role} · ${p.name} · readOnly`).toBe(false);
    fireEvent.change(input, { target: { value: "7" } });
    expect(input).toHaveValue(7);
  }
  return dialog;
}

beforeEach(() => {
  vi.clearAllMocks();
  // DeckPdfViewer streams the PDF; there is none in a unit test.
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 })) as typeof fetch;
  vi.mocked(scoringSettings).mockResolvedValue({ ...DEFAULT_SCORING_SETTINGS });
});

// ── Not a bug: the workbench is editable for both roles ──────────────────────

describe("issue 6 — the My score inputs take a score from BOTH reported roles", () => {
  for (const role of ["jury", "program_manager"] as const) {
    it(`${role} can type every parameter and submit is then enabled`, async () => {
      const dialog = await openAndScore(role);
      expect(within(dialog).getByRole("button", { name: "Submit my evaluation" })).toBeEnabled();
      // The "score all N first" nag is the only thing that gates the submit,
      // and it is gone once they are scored — no role test stands behind it.
      expect(within(dialog).queryByText(/Score all \d+ parameters before submitting/)).toBeNull();
    });
  }
});

// ── Why "unable to score": the deck never reaches the workbench ──────────────

describe("issue 6 — with production's deck states there is nothing to score", () => {
  it("the programme manager's Evaluate list is empty when no deck is assigned", async () => {
    mount("program_manager", [AI_EVALUATED], "/app/evaluate");
    await screen.findByRole("list", { name: "Decks to evaluate" });
    // `queue` admits `assigned` / `jury_evaluation` only. Six `ai_evaluated`
    // decks are what production holds, and none of them is offered for scoring
    // — the Assign flow's gate decides that, not this screen.
    expect(screen.getByTestId("ev-decks-label")).toHaveTextContent("0 decks");
    expect(screen.queryByText("InsureFlow")).not.toBeInTheDocument();
  });

  it("the juror's Assigned screen says so in its own footer", async () => {
    mount("jury", [AI_EVALUATED], "/app/jassigned");
    expect(await screen.findByTestId("ja-foot")).toHaveTextContent("0 decks assigned to you");
  });
});

// ── A refused submit names the refusal ───────────────────────────────────────

describe("issue 6 — a refused submit says what to do about it", () => {
  async function submitAndRead(role: Role, rejection: unknown): Promise<string> {
    const dialog = await openAndScore(role);
    vi.mocked(submitJuryScores).mockRejectedValue(rejection);
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit my evaluation" }));
    const alert = await waitFor(() => {
      const found = within(dialog).getByText(/can't be recorded|cannot be scored|Try again|rationale/i);
      return found;
    });
    return alert.textContent ?? "";
  }

  it("a juror whose assignment was pulled is told to ask for one, not to try again", async () => {
    const text = await submitAndRead("jury", new ApiError(403, { error: "not_assigned" }));
    expect(text).toContain("not assigned to you");
    expect(text).toContain("add you as an evaluator");
    expect(text).not.toContain("Try again");
  });

  it("the deck-file refusal (F-FOUL) is printed in the server's own words", async () => {
    const text = await submitAndRead(
      "program_manager",
      new ApiError(409, {
        error: "no_pdf",
        reason: "no_key",
        message: "TaxPilot has no uploaded deck, so it cannot be scored.",
      }),
    );
    expect(text).toBe("TaxPilot has no uploaded deck, so it cannot be scored.");
  });

  it("the override-rationale refusal still prints its own message", async () => {
    const text = await submitAndRead(
      "program_manager",
      new ApiError(422, {
        error: "rationale_required",
        message: "Traction & Validation needs a rationale — your score is more than 2 points from the AI's.",
      }),
    );
    expect(text).toContain("needs a rationale");
  });

  // A bare `{error}` body has nothing worth printing to an evaluator, and a
  // dropped connection is not an `ApiError` at all — "Try again" is the right
  // answer for both, and is what they must keep.
  it("a refusal carrying no message keeps the generic fallback", async () => {
    const text = await submitAndRead("program_manager", new ApiError(500, { error: "db_error" }));
    expect(text).toContain("Try again");
  });

  it("a network failure keeps the generic fallback", async () => {
    const text = await submitAndRead("program_manager", new TypeError("fetch failed"));
    expect(text).toContain("Try again");
  });
});

// ── The read-only report says it is one ──────────────────────────────────────

describe("issue 6 — the report overlay no longer presents itself as the scorer", () => {
  const DECK: DeckView = { id: "d1", name: "GreenRoute" };

  function report(): DeckReportMatrix {
    return {
      deck: DECK,
      columns: [{ id: "ai", kind: "ai", name: "AI", rank: 0 }],
      core: PARAMETERS.map((p) => ({ key: p.key, name: p.name, weight: p.weight, cells: {} })),
      additional: [],
      hiddenEvaluators: 0,
    } as unknown as DeckReportMatrix;
  }

  it("states that My score is read-only here and where it is entered", async () => {
    vi.mocked(getDeckReport).mockResolvedValue(report());
    render(withAuth(<EvaluationDrawer open onClose={() => {}} deck={DECK} />, "jury"));
    const dialog = screen.getByRole("dialog");
    expect(
      await within(dialog).findByText(/My score is read-only on this report/),
    ).toBeInTheDocument();
    const note = within(dialog).getByText(/My score is read-only on this report/).closest("p");
    expect(note?.textContent).toContain("entered in the evaluator workbench");
    expect(note?.textContent).toContain("assigned for evaluation");
  });

  it("is additive: the prototype's own hint is still printed verbatim", async () => {
    vi.mocked(getDeckReport).mockResolvedValue(report());
    render(withAuth(<EvaluationDrawer open onClose={() => {}} deck={DECK} />, "program_manager"));
    const dialog = screen.getByRole("dialog");
    // `test/client/reportV3.test.tsx` pins this against AISJ_SuperuserV3, and
    // the note must not have displaced it — the prototype's report IS editable,
    // which is the open parity question, not something to paper over.
    expect(within(dialog).getByText("tap any parameter to read the AI remark and add yours")).toBeInTheDocument();
    // And no new section heading: that test compares all four, in order.
    expect(
      within(dialog)
        .getAllByRole("heading", { level: 3 })
        .map((h) => (h.textContent ?? "").replace(/·.*$/, "").trim()),
    ).toHaveLength(4);
  });
});
