import { StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { DeckView } from "../../src/client/types";
import { deckListRoute } from "../../src/shared/queries";

/**
 * S1-DASH items 4 and 5 — the deck hand-off between the three screens.
 *
 * `AssignPage` has navigated to `/app/query` with `state: { deckIds }` since
 * V4-ROUTE and `QueryPage` never read it — zero hits across 1,084 lines, found
 * in passing while scoping the 21-Sep feedback (plan §12.4). So "Send to
 * Query", the one button on the Assign screen whose whole job is to carry a
 * selection, dropped it silently: the operator landed on the Query list with
 * nothing ticked and re-picked the same rows by hand. This wave repairs that
 * direction and builds the mirror of it — the Dashboard's row menu sending one
 * deck to Assign.
 *
 * Both ends resolve the incoming ids against the list the SERVER served, never
 * against what the sending page believed: `?list=assign` and `?list=query` are
 * partitioned by `deckListRoute`, so an id the response does not contain does
 * not belong on that screen.
 *
 * The Dashboard end of the hand-off (the guard on the option itself) is pinned
 * in `allDecks.test.tsx`; this file is the RECEIVING end of both.
 */

vi.mock("../../src/client/auth/useAuth", () => ({
  useAuth: () => ({
    user: { id: "inc_pa", edition: "incubator", role: "program_associate", name: "Sunita Rao", initials: "SR" },
  }),
}));

vi.mock("../../src/client/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/client/api")>();
  return {
    ...actual,
    listDecks: vi.fn(),
    listAllQueries: vi.fn(),
    listQueries: vi.fn(),
    getAssignBoard: vi.fn(),
    listEvaluators: vi.fn(),
    listParameters: vi.fn(),
    getDeckReport: vi.fn(() => new Promise(() => {})),
  };
});

// `recordQuery` lives in `queryApi`, NOT `api` — mocking the wrong module here
// leaves the real one to hit an unstubbed `fetch`, which throws into sendQuery's
// catch, so nothing is recorded and no refetch happens.
vi.mock("../../src/client/queryApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/client/queryApi")>();
  return { ...actual, recordQuery: vi.fn() };
});

import { AssignPage } from "../../src/client/routes/AssignPage";
import { QueryPage } from "../../src/client/routes/QueryPage";
import { getAssignBoard, listAllQueries, listDecks, listEvaluators, listParameters } from "../../src/client/api";
import { recordQuery } from "../../src/client/queryApi";

function deck(over: Partial<DeckView>): DeckView {
  return { id: "d", name: "Deck", status: "AI Evaluated", statusId: "ai_evaluated", ...over };
}

/** Two assignable, two routed to Query — one per arm of the partition. */
const FINSTACK = deck({ id: "d_fin", name: "FinStack", sector: "B2B Fintech", stage: "Seed", aiScore: 7.2 });
const GREENGRID = deck({ id: "d_green", name: "GreenGrid", sector: "Climatetech", stage: "Pre-seed", aiScore: 9.1 });
/** Evaluated, then stripped of a required detail — plan §4.1 case (b). */
const PAYROUTE = deck({
  id: "d_pay",
  name: "PayRoute",
  founder: "Vikram Singh",
  founderEmail: "vikram@payroute.in",
  aiComplete: true,
  complete: true,
  missingFields: ["founderPhone"],
});
const AGRICHAIN = deck({
  id: "d_agri",
  name: "AgriChain",
  status: "Incomplete",
  statusId: "incomplete",
  founder: "Neha Iyer",
  founderEmail: "neha@agrichain.in",
  missingFields: ["founderPhone"],
});

const DECKS = [FINSTACK, GREENGRID, PAYROUTE, AGRICHAIN];

beforeEach(() => {
  // Routed with `deckListRoute` — the same function the server partitions on —
  // so a fixture cannot hand a screen a deck the real response would withhold.
  vi.mocked(listDecks).mockImplementation(async (filter) => ({
    decks: filter?.list
      ? DECKS.filter((d) => deckListRoute(d, "incubator", { queried: d.queried === true }) === filter.list)
      : DECKS,
  }));
  vi.mocked(listAllQueries).mockResolvedValue({ queries: [] });
  vi.mocked(getAssignBoard).mockResolvedValue({
    decks: Object.fromEntries(
      [FINSTACK, GREENGRID].map((d) => [
        d.id,
        {
          core: [{ key: "problem", value: 8 }],
          additional: { program_associate: 21.4, program_manager: 18, jury: null },
          withheld: false,
          assignees: [],
        },
      ]),
    ),
  });
  vi.mocked(listEvaluators).mockResolvedValue({
    groups: [
      {
        role: "jury",
        roleLabel: "Jury Member",
        members: [{ id: "u_rk", name: "Rajesh Kumar", initials: "RK", role: "jury", openDecks: 4, capacity: 6 }],
      },
    ],
  });
  vi.mocked(listParameters).mockResolvedValue({
    parameters: [{ key: "problem", name: "Problem & Market Clarity", weight: 8 }],
  });
  // The letter bank is not this file's subject; the page composes a local
  // fallback when the draft request fails, which is enough to count recipients.
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mount(page: "assign" | "query", state?: { deckIds: string[] }) {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[{ pathname: `/app/${page}`, state }]}>
        {page === "assign" ? <AssignPage /> : <QueryPage />}
      </MemoryRouter>
    </StrictMode>,
  );
}

describe("the Assign → Query hand-off (item 5)", () => {
  it("opens with the handed-over founders selected", async () => {
    mount("query", { deckIds: ["d_pay", "d_agri"] });
    await screen.findByRole("checkbox", { name: "Select PayRoute" });

    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Select PayRoute" })).toBeChecked());
    expect(screen.getByRole("checkbox", { name: "Select AgriChain" })).toBeChecked();
  });

  // Negative control. Without the hand-off the page is exactly where it was:
  // everything unticked, which is what the operator has been seeing.
  it("without it, nothing is selected — which is the defect", async () => {
    mount("query");
    await screen.findByRole("checkbox", { name: "Select PayRoute" });
    expect(screen.getByRole("checkbox", { name: "Select PayRoute" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select AgriChain" })).not.toBeChecked();
  });

  // The guard: the hand-off is a suggestion, the server's list is the fact. An
  // id that is not on this screen is dropped rather than conjuring a row.
  it("ignores an id the Query list does not hold", async () => {
    mount("query", { deckIds: ["d_pay", "d_fin", "nonexistent"] });
    await screen.findByRole("checkbox", { name: "Select PayRoute" });

    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Select PayRoute" })).toBeChecked());
    // FinStack is assignable, so it is not on this screen at all…
    expect(screen.queryByRole("checkbox", { name: "Select FinStack" })).toBeNull();
    // …and exactly one row ended up selected.
    expect(screen.getAllByRole("checkbox").filter((c) => (c as HTMLInputElement).checked)).toHaveLength(1);
  });

  // StrictMode mounts every effect twice. A seed that re-runs would undo the
  // operator's first deselection — the trap this codebase has paid for before.
  it("does not re-tick a row the operator has just unticked (StrictMode)", async () => {
    mount("query", { deckIds: ["d_pay", "d_agri"] });
    const pay = await screen.findByRole("checkbox", { name: "Select PayRoute" });
    await waitFor(() => expect(pay).toBeChecked());

    fireEvent.click(pay);
    expect(pay).not.toBeChecked();
    // Give the effect every chance to fire again.
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Select AgriChain" })).toBeChecked());
    expect(pay).not.toBeChecked();
  });

  /**
   * …and the case the test above CANNOT catch, which the wave-integration audit
   * found (plan §12.9). The seeding effect depends on `[decks, handedIds, rows]`
   * and all three are stable after a click, so neutralising `handOffApplied`
   * leaves that test green. The dependency that really does change is `decks`,
   * and exactly one thing changes it: `sendQuery` calls `load()` when any query
   * was recorded (`QueryPage.tsx`). So the refetch is where the ref earns its
   * place, and this is the test that goes red without it.
   */
  it("does not re-seed when the post-send refetch replaces the deck list", async () => {
    vi.mocked(recordQuery).mockResolvedValue({
      ok: true,
      queryId: "qry_1",
      emailStatus: "recorded",
      delivered: true,
    } as Awaited<ReturnType<typeof recordQuery>>);

    mount("query", { deckIds: ["d_pay", "d_agri"] });
    const pay = await screen.findByRole("checkbox", { name: "Select PayRoute" });
    await waitFor(() => expect(pay).toBeChecked());

    // The operator drops PayRoute and writes to AgriChain alone.
    fireEvent.click(pay);
    expect(pay).not.toBeChecked();

    fireEvent.click(screen.getByRole("tab", { name: /Email query/ }));
    const body = (await screen.findByRole("textbox", { name: "Body" })) as HTMLTextAreaElement;
    await waitFor(() => expect(body.value.length).toBeGreaterThan(0));
    fireEvent.change(screen.getByRole("textbox", { name: "Subject" }), {
      target: { value: "One quick question" },
    });

    const loadsBefore = vi.mocked(listDecks).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Send query" }));

    // One letter, to the founder who was still selected — not to the one dropped.
    await waitFor(() => expect(vi.mocked(recordQuery)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(recordQuery).mock.calls[0][0]).toBe("d_agri");
    // …and the refetch it triggers hands the effect a brand-new `decks`.
    await waitFor(() =>
      expect(vi.mocked(listDecks).mock.calls.length).toBeGreaterThan(loadsBefore),
    );

    fireEvent.click(screen.getByRole("tab", { name: /Founder queries/ }));
    const payAfter = await screen.findByRole("checkbox", { name: "Select PayRoute" });
    expect(payAfter).not.toBeChecked();
  });
});

describe("the Dashboard → Assign hand-off (item 4)", () => {
  it("opens with the handed-over deck ticked, ready to pick an evaluator", async () => {
    mount("assign", { deckIds: ["d_green"] });
    await screen.findByRole("checkbox", { name: "Select GreenGrid" });

    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Select GreenGrid" })).toBeChecked());
    expect(screen.getByRole("checkbox", { name: "Select FinStack" })).not.toBeChecked();
  });

  it("without it, nothing is selected", async () => {
    mount("assign");
    await screen.findByRole("checkbox", { name: "Select GreenGrid" });
    expect(screen.getByRole("checkbox", { name: "Select GreenGrid" })).not.toBeChecked();
  });

  // The roster is `?list=assign`, and it is the authority. A deck the partition
  // sent to Query cannot be ticked here by arriving with its id in hand — which
  // is the whole of item 4 stated from the receiving side.
  it("ignores a deck the Assign roster does not hold", async () => {
    mount("assign", { deckIds: ["d_pay"] });
    await screen.findByRole("checkbox", { name: "Select GreenGrid" });

    // PayRoute IS drawn in column 1 — V4-ROUTE keeps the marked-incomplete
    // decks visible there, greyed and untickable, rather than vanishing them.
    // Arriving with its id in hand must not tick it anyway.
    const box = screen.getByRole("checkbox", { name: "Select PayRoute" });
    expect(box).toBeDisabled();
    expect(box).not.toBeChecked();
    expect(box.closest("li")).toHaveAttribute("data-testid", "assign-incomplete-row");
    // And nothing assignable was ticked in its place.
    for (const row of screen.getAllByTestId("assign-deck-row")) {
      expect(within(row).getByRole("checkbox")).not.toBeChecked();
    }
  });
});
