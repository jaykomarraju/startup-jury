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
 *
 * ── S2-DASH · 2026-09-30 — WHY THE QUERY FIXTURES CARRY `queried` NOW ───────
 *
 * The client's 24-Sep row 3: an incomplete deck must not reach the Query screen
 * automatically, only when Send to Query is clicked. S0-VOCAB implemented that
 * inside `deckListRoute` and parked it on one line —
 * `QUERY_MEMBERSHIP_IS_DERIVED_PENDING_ROW3`, which **S2-SERVER flips**. The
 * mock below routes its fixtures through that same function on purpose (a
 * fixture cannot hand a screen a deck the real response would withhold), so the
 * flip would have emptied the Query list and reddened every test in the first
 * describe at once — six failures, none of them about the hand-off, and S0-VOCAB
 * measured them and assigned them here.
 *
 * So the Query-side fixtures now say what row 3 makes them say: **a deck is on
 * the Query list because it was SENT there** (`queried`), not because it is
 * incomplete. That is true under both readings of the flag, so this file no
 * longer depends on which one is live, and it stopped depending on the wrong
 * thing rather than being pinned to today's answer.
 *
 * One consequence measured while doing it, and handed on rather than fixed here:
 * `isQueryStageWindow` (`shared/queries.ts`) does not contain `ai_evaluated`, so
 * a deck sent to Query from the EVALUATED population — the "evaluated, then
 * stripped of a required detail" case, which is PayRoute below — falls off the
 * Query list the moment the derivation stops carrying it. Under row 3 that is
 * the one deck a click cannot keep listed. Flagged in `docs/parity-requests/S2-DASH.md`
 * for S2-SERVER / S-INT; it is not this file's to change.
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

/** Two assignable, two sent to Query — one per arm of the partition. */
const FINSTACK = deck({ id: "d_fin", name: "FinStack", sector: "B2B Fintech", stage: "Seed", aiScore: 7.2 });
const GREENGRID = deck({ id: "d_green", name: "GreenGrid", sector: "Climatetech", stage: "Pre-seed", aiScore: 9.1 });
/**
 * Evaluated, then stripped of a required detail — plan §4.1 case (b). This is
 * the ASSIGN side's subject: V4-ROUTE keeps such a deck drawn in the Assign
 * screen's column 1, greyed and untickable, rather than vanishing it, and that
 * is what the last test here asserts. It is deliberately NOT queried — under
 * row 3 it is on neither list until somebody sends it.
 */
const PAYROUTE = deck({
  id: "d_pay",
  name: "PayRoute",
  founder: "Vikram Singh",
  founderEmail: "vikram@payroute.in",
  aiComplete: true,
  complete: true,
  missingFields: ["founderPhone"],
});
/**
 * The two QUERY-side decks, and both of them carry `queried`, which is row 3:
 * they are on that list because a query was raised on them. Both sit at stage
 * `incomplete`, inside the window `isQueryStageWindow` keeps a queried deck
 * listed in, so `deckListRoute` answers "query" under either reading of
 * `QUERY_MEMBERSHIP_IS_DERIVED_PENDING_ROW3`.
 */
const AGRICHAIN = deck({
  id: "d_agri",
  name: "AgriChain",
  status: "Incomplete",
  statusId: "incomplete",
  founder: "Neha Iyer",
  founderEmail: "neha@agrichain.in",
  missingFields: ["founderPhone"],
  queried: true,
});
const SOLARC = deck({
  id: "d_solar",
  name: "SolarCrest",
  status: "Incomplete",
  statusId: "incomplete",
  founder: "Arjun Mehta",
  founderEmail: "arjun@solarcrest.in",
  aiComplete: false,
  queried: true,
});

const DECKS = [FINSTACK, GREENGRID, PAYROUTE, AGRICHAIN, SOLARC];

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
    mount("query", { deckIds: ["d_solar", "d_agri"] });
    await screen.findByRole("checkbox", { name: "Select SolarCrest" });

    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Select SolarCrest" })).toBeChecked());
    expect(screen.getByRole("checkbox", { name: "Select AgriChain" })).toBeChecked();
  });

  // Negative control. Without the hand-off the page is exactly where it was:
  // everything unticked, which is what the operator has been seeing.
  it("without it, nothing is selected — which is the defect", async () => {
    mount("query");
    await screen.findByRole("checkbox", { name: "Select SolarCrest" });
    expect(screen.getByRole("checkbox", { name: "Select SolarCrest" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select AgriChain" })).not.toBeChecked();
  });

  // The guard: the hand-off is a suggestion, the server's list is the fact. An
  // id that is not on this screen is dropped rather than conjuring a row.
  it("ignores an id the Query list does not hold", async () => {
    mount("query", { deckIds: ["d_solar", "d_fin", "nonexistent"] });
    await screen.findByRole("checkbox", { name: "Select SolarCrest" });

    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Select SolarCrest" })).toBeChecked());
    // FinStack is assignable, so it is not on this screen at all…
    expect(screen.queryByRole("checkbox", { name: "Select FinStack" })).toBeNull();
    // …and exactly one row ended up selected.
    expect(screen.getAllByRole("checkbox").filter((c) => (c as HTMLInputElement).checked)).toHaveLength(1);
  });

  // StrictMode mounts every effect twice. A seed that re-runs would undo the
  // operator's first deselection — the trap this codebase has paid for before.
  it("does not re-tick a row the operator has just unticked (StrictMode)", async () => {
    mount("query", { deckIds: ["d_solar", "d_agri"] });
    const solar = await screen.findByRole("checkbox", { name: "Select SolarCrest" });
    await waitFor(() => expect(solar).toBeChecked());

    fireEvent.click(solar);
    expect(solar).not.toBeChecked();
    // Give the effect every chance to fire again.
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Select AgriChain" })).toBeChecked());
    expect(solar).not.toBeChecked();
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

    mount("query", { deckIds: ["d_solar", "d_agri"] });
    const solar = await screen.findByRole("checkbox", { name: "Select SolarCrest" });
    await waitFor(() => expect(solar).toBeChecked());

    // The operator drops SolarCrest and writes to AgriChain alone.
    fireEvent.click(solar);
    expect(solar).not.toBeChecked();

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
    const solarAfter = await screen.findByRole("checkbox", { name: "Select SolarCrest" });
    expect(solarAfter).not.toBeChecked();
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
  //
  // The subject is AgriChain rather than PayRoute since S2-DASH: AgriChain is on
  // `?list=query` because it was SENT there (`queried`), which is row 3's
  // reading and is true whichever way
  // `QUERY_MEMBERSHIP_IS_DERIVED_PENDING_ROW3` is set. See the test below for
  // what PayRoute now measures instead.
  it("ignores a deck the Assign roster does not hold", async () => {
    mount("assign", { deckIds: ["d_agri"] });
    await screen.findByRole("checkbox", { name: "Select GreenGrid" });

    // AgriChain IS drawn in column 1 — V4-ROUTE keeps the marked-incomplete
    // decks visible there, greyed and untickable, rather than vanishing them.
    // Arriving with its id in hand must not tick it anyway.
    const box = screen.getByRole("checkbox", { name: "Select AgriChain" });
    expect(box).toBeDisabled();
    expect(box).not.toBeChecked();
    expect(box.closest("li")).toHaveAttribute("data-testid", "assign-incomplete-row");
    // And nothing assignable was ticked in its place.
    for (const row of screen.getAllByTestId("assign-deck-row")) {
      expect(within(row).getByRole("checkbox")).not.toBeChecked();
    }
  });

  /**
   * …and the same invariant for a deck on **neither** list, which is a state row
   * 3 creates and the old partition could not express.
   *
   * PayRoute is evaluated and then stripped of a required detail, and nobody has
   * sent it anywhere. Before row 3 the derivation put it on `?list=query` with no
   * click; after it, it is on neither list — off Assign because it is not marked
   * complete, off Query because nobody raised a query. It is not lost: the
   * uploaded status screen draws every deck always, which is his own display
   * rule, and the Dashboard row menu is where it is sent onward.
   *
   * **Measured, and handed on rather than fixed here:** this is also what takes
   * PayRoute out of the Assign screen's greyed column-1 rows, because those come
   * from `?list=query` (`AssignPage` `incomplete`). V4-ROUTE's "keep the
   * marked-incomplete decks visible" therefore stops applying to the EVALUATED
   * arm the moment the flag flips. `AssignPage.tsx` and `assign.test.tsx` belong
   * to no session in this wave; flagged in `docs/parity-requests/S2-DASH.md`.
   */
  it("and a deck on neither list ticks nothing at all", async () => {
    mount("assign", { deckIds: ["d_pay"] });
    await screen.findByRole("checkbox", { name: "Select GreenGrid" });

    for (const box of screen.getAllByRole("checkbox")) {
      expect(box, box.getAttribute("aria-label") ?? "").not.toBeChecked();
    }
  });
});
