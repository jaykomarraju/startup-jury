import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within, configure, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { StagePage, INCUBATOR_STAGE_CONFIG, VC_STAGE_CONFIG } from "../../src/client/routes/StagePage";
import { AuthContext, type AuthContextValue } from "../../src/client/auth/AuthProvider";
import type { DeckView } from "../../src/client/types";
import type { Edition, Role } from "../../src/shared/roles";

/**
 * **23-Oct tracker, P1 — the Jury Pipeline draws every juror and each one's score.**
 *
 * `jpRender`'s two cells: the Jury members cell is one line per juror (name, then
 * Evaluated / Pending), and the Jury score column is one line per juror, ALIGNED
 * with the names. Which numbers arrive is decided on the server
 * (`test/worker/jury-pipeline-jurors.test.ts` owns that half, negative controls
 * included); this file proves the screen draws what arrives and decides nothing.
 *
 * The acceptance lines, each a test below: three jurors → three names and three
 * scores; one juror → the cell reads exactly as it did; the associate sees names
 * and Hidden; the row count and the footer are IDENTICAL with and without the new
 * field.
 *
 * Negative controls, run 2026-10-23 (each break restored by copying
 * `StagePage.tsx` back; 20/20 green before and after):
 *   • the members cell ignoring `jurors` fails 12;
 *   • a client-side `ctx.role === "program_associate"` filter in the score cell
 *     fails 1 — "the screen is not a second rule";
 *   • the two variants' Jury score put back on the built-in deck average fails 6.
 */

configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 30_000 });

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Juror {
  id: string;
  name: string;
  submitted: boolean;
  score?: number;
  scoreWithheld?: true;
}

/** `DeckView` does not declare `jurors` yet (see `jurorsOf`), so the fixture adds it as the wire does. */
type WireDeck = DeckView & { jurors?: Juror[] };

function deck(over: Partial<WireDeck>): WireDeck {
  return {
    id: "d",
    name: "Deck",
    sector: "Insurtech",
    stage: "Seed",
    city: "Bengaluru",
    aiScore: 8.6,
    juryScore: 7.4,
    decisionScore: 8.0,
    statusId: "jury_evaluation",
    status: "Jury Evaluation",
    actions: [],
    ...over,
  };
}

/** The prototype's own first `jpData` panel: Meera 8.9 · Vikram 9.0 · Rajesh 8.8. */
const THREE: Juror[] = [
  { id: "j1", name: "Meera Sharma", submitted: true, score: 8.9 },
  { id: "j2", name: "Vikram Nair", submitted: true, score: 9.0 },
  { id: "j3", name: "Rajesh Kumar", submitted: true, score: 8.8 },
];

/** The same panel as the server serves it to a viewer the rule withholds from. */
const THREE_WITHHELD: Juror[] = THREE.map(({ id, name }) => ({ id, name, submitted: true, scoreWithheld: true }));

function threeJurors(jurors: Juror[] | undefined): WireDeck {
  return deck({
    id: "d3",
    name: "InsureFlow",
    assignedTo: "j1",
    assignedToName: "Meera Sharma",
    assigneeSubmitted: true,
    assigneeIds: ["j1", "j2", "j3"],
    ...(jurors ? { jurors } : {}),
  });
}

function oneJuror(withPanel: boolean): WireDeck {
  return deck({
    id: "d1",
    name: "TaxPilot",
    statusId: "assigned",
    status: "Assigned",
    assignedTo: "j3",
    assignedToName: "Rajesh Kumar",
    assigneeSubmitted: false,
    assigneeIds: ["j3"],
    ...(withPanel ? { jurors: [{ id: "j3", name: "Rajesh Kumar", submitted: false }] } : {}),
  });
}

function shortlisted(withPanel: boolean): WireDeck {
  return deck({
    id: "d2",
    name: "GreenRoute",
    statusId: "shortlisted",
    status: "Shortlisted",
    assignedTo: "j2",
    assignedToName: "Vikram Nair",
    assigneeSubmitted: true,
    assigneeIds: ["j2"],
    ...(withPanel ? { jurors: [{ id: "j2", name: "Vikram Nair", submitted: true, score: 7.2 }] } : {}),
  });
}

function mockApi(decks: WireDeck[]) {
  const calls: string[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    let body: unknown = {};
    if (url === "/api/decks" || url.startsWith("/api/decks?")) body = { decks };
    else if (/^\/api\/decks\/[^/]+\/report/.test(url)) body = { core: [], additional: [], columns: [] };
    else if (url.startsWith("/api/decks/")) body = { deck: decks[0], scores: [], extraction: [], versions: [] };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

function renderAs(role: Role, edition: Edition = "incubator") {
  const auth: AuthContextValue = {
    user: { id: "viewer", name: "Priya Sharma", initials: "PS", role, edition },
    loading: false,
    login: () => Promise.reject(new Error("not used in these tests")),
    logout: () => Promise.resolve(),
    updateUser: () => {},
  };
  const config = edition === "vc" ? VC_STAGE_CONFIG.jurypipeline : INCUBATOR_STAGE_CONFIG.jurypipeline;
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={["/app/jurypipeline"]}>
        <Routes>
          <Route path="/app/jurypipeline" element={<StagePage config={config} />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

const items = (list: HTMLElement) => within(list).getAllByRole("listitem");
const membersOf = (name: string) => screen.getByRole("list", { name: `Jury members for ${name}` });
const scoresOf = (name: string) => screen.getByRole("list", { name: `Jury scores for ${name}` });

/** Every role that reaches the incubator slug and draws the panel column. */
const PANEL_ROLES = ["superuser", "admin", "program_manager", "program_associate"] as const;

// ═══════════════════════════════════════════════════════════════════════════

describe("three jurors: three names, three scores, each on its own juror's line", () => {
  it.each(PANEL_ROLES)("%s — the names in panel order, each with its pill", async (role) => {
    mockApi([threeJurors(THREE)]);
    renderAs(role);
    await screen.findByRole("row", { name: /InsureFlow/ });

    const lines = items(membersOf("InsureFlow"));
    expect(lines.map((li) => li.textContent)).toEqual([
      "Meera SharmaEvaluated",
      "Vikram NairEvaluated",
      "Rajesh KumarEvaluated",
    ]);
  });

  it("the scores line up with the names — juror N's score is on line N", async () => {
    mockApi([threeJurors(THREE)]);
    renderAs("superuser");
    await screen.findByRole("row", { name: /InsureFlow/ });

    const names = items(membersOf("InsureFlow")).map((li) => li.textContent?.replace(/Evaluated|Pending$/, ""));
    const scores = items(scoresOf("InsureFlow"));
    expect(scores).toHaveLength(3);
    expect(scores.map((li) => li.textContent)).toEqual(["8.9", "9.0", "8.8"]);
    scores.forEach((li, i) => {
      expect(within(li).getByRole("button").getAttribute("aria-label")).toBe(`${names[i]}: ${li.textContent}`);
    });
    // The deck-level average this column drew before P1 is not on the row: the
    // prototype's Jury score is per juror, and Avg. score keeps the composite.
    expect(within(screen.getByRole("row", { name: /InsureFlow/ })).queryByText("7.4")).toBeNull();
  });

  it("a juror's score opens the report on the Core Parameters tab (`jpOpenScores`)", async () => {
    const calls = mockApi([threeJurors(THREE)]);
    renderAs("superuser");
    await screen.findByRole("row", { name: /InsureFlow/ });

    fireEvent.click(screen.getByRole("button", { name: "Vikram Nair: 9.0" }));
    await waitFor(() => expect(calls.some((u) => u.startsWith("/api/decks/d3/report"))).toBe(true));
  });

  it("a juror who has not submitted reads Pending and —, never a number", async () => {
    mockApi([
      threeJurors([
        { id: "j1", name: "Meera Sharma", submitted: true, score: 8.9 },
        { id: "j2", name: "Vikram Nair", submitted: false },
      ]),
    ]);
    renderAs("program_manager");
    await screen.findByRole("row", { name: /InsureFlow/ });

    expect(items(membersOf("InsureFlow")).map((li) => li.textContent)).toEqual([
      "Meera SharmaEvaluated",
      "Vikram NairPending",
    ]);
    const pending = items(scoresOf("InsureFlow"))[1];
    expect(within(pending).getByLabelText("Vikram Nair: not yet scored")).toHaveTextContent("—");
  });
});

describe("the programme associate: names, and the server's absence drawn as Hidden", () => {
  it("sees every name and pill, and no juror's number anywhere on the row", async () => {
    mockApi([threeJurors(THREE_WITHHELD)]);
    renderAs("program_associate");
    const row = await screen.findByRole("row", { name: /InsureFlow/ });

    expect(items(membersOf("InsureFlow")).map((li) => li.textContent)).toEqual([
      "Meera SharmaEvaluated",
      "Vikram NairEvaluated",
      "Rajesh KumarEvaluated",
    ]);
    expect(items(scoresOf("InsureFlow")).map((li) => li.textContent)).toEqual(["Hidden", "Hidden", "Hidden"]);
    expect(within(row).getByLabelText("Meera Sharma: score hidden")).toBeInTheDocument();
    for (const n of ["8.9", "9.0", "8.8"]) expect(within(row).queryByText(n)).toBeNull();
    // Read-only is untouched: no Action column on their screen.
    expect(screen.queryByRole("columnheader", { name: "Action" })).not.toBeInTheDocument();
  });

  it("the screen is not a second rule: a number the server DID send is drawn, for any role", async () => {
    // An admin can turn the associate → jury cell on (`score_visibility`), and
    // the server then sends the numbers. A client-side filter here would be a
    // second answer to "may they see it?", which is the bug this repo keeps
    // reproducing — so the cell must draw whatever arrives.
    mockApi([threeJurors(THREE)]);
    renderAs("program_associate");
    await screen.findByRole("row", { name: /InsureFlow/ });
    expect(items(scoresOf("InsureFlow")).map((li) => li.textContent)).toEqual(["8.9", "9.0", "8.8"]);
  });
});

describe("one juror: unchanged", () => {
  it.each(PANEL_ROLES)("%s — the members cell reads exactly as it did before the panel existed", async (role) => {
    mockApi([oneJuror(false)]);
    const before = renderAs(role);
    const cellBefore = within(await screen.findByRole("row", { name: /TaxPilot/ })).getAllByRole("cell")[1].textContent;
    before.unmount();
    cleanup();

    mockApi([oneJuror(true)]);
    renderAs(role);
    await screen.findByRole("row", { name: /TaxPilot/ });
    expect(items(membersOf("TaxPilot"))).toHaveLength(1);
    expect(within(screen.getByRole("row", { name: /TaxPilot/ })).getAllByRole("cell")[1].textContent).toBe(cellBefore);
    expect(cellBefore).toBe("Rajesh KumarPending");
  });

  it("a deck with no one assigned still reads Unassigned", async () => {
    mockApi([deck({ id: "d0", name: "Nobody", statusId: "assigned", status: "Assigned", jurors: [] })]);
    renderAs("superuser");
    const row = await screen.findByRole("row", { name: /Nobody/ });
    expect(within(row).getByText("Unassigned")).toBeInTheDocument();
  });
});

describe("the screen's shape is identical with and without the panel", () => {
  it.each(PANEL_ROLES)("%s — same rows, same footer, same headers", async (role) => {
    const shape = async (withPanel: boolean) => {
      mockApi([threeJurors(withPanel ? THREE : undefined), oneJuror(withPanel), shortlisted(withPanel)]);
      const view = renderAs(role);
      await screen.findByRole("row", { name: /GreenRoute/ });
      const table = screen.getByRole("table");
      const out = {
        // Body rows only: one per deck, whatever each deck's panel size.
        rows: within(table).getAllByRole("row").length - 1,
        footer: screen.getByTestId("stage-footer-stat").textContent,
        headers: within(table)
          .getAllByRole("columnheader")
          .map((th) => th.textContent),
      };
      view.unmount();
      cleanup();
      return out;
    };

    const before = await shape(false);
    const after = await shape(true);
    expect(after).toEqual(before);
    expect(after.rows).toBe(3);
    expect(after.footer).toBe("3 decks · 1 shortlisted · 0 rejected · 2 in progress");
  });
});

describe("at 393px the two stacks cannot drift apart", () => {
  it("every line in both cells is one fixed-height, non-wrapping line", async () => {
    // jsdom does not lay out, so this pins the two properties alignment rests on;
    // the screenshot at 393px is in the session handoff. A name that wrapped would
    // make its line taller than the score beside it.
    mockApi([threeJurors(THREE)]);
    renderAs("superuser");
    await screen.findByRole("row", { name: /InsureFlow/ });
    for (const li of [...items(membersOf("InsureFlow")), ...items(scoresOf("InsureFlow"))]) {
      expect(li).toHaveClass("h-6", "whitespace-nowrap");
    }
    // …and the table scrolls sideways inside its card rather than squashing.
    expect(screen.getByRole("table").closest(".overflow-x-auto")).not.toBeNull();
  });
});

describe("VC is untouched", () => {
  it("the Assoc. Pipeline draws no panel, even if a payload carried one", async () => {
    // `jurors` is never sent for VC (`JURORS_ON_LIST`); this is the screen half.
    mockApi([
      deck({ id: "v1", name: "Ledgerly", statusId: "analyst_scoring", status: "Analyst Scoring", jurors: THREE }),
    ]);
    renderAs("superuser", "vc");
    await screen.findByRole("row", { name: /Ledgerly/ });
    expect(screen.queryByRole("list", { name: /Jury members for/ })).toBeNull();
    expect(screen.queryByRole("list", { name: /Jury scores for/ })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Jury members & status" })).toBeNull();
  });
});
