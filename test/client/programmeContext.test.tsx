import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { AssignPage } from "../../src/client/routes/AssignPage";
import { QueryPage } from "../../src/client/routes/QueryPage";
import { StagePage, INCUBATOR_STAGE_CONFIG, VC_STAGE_CONFIG } from "../../src/client/routes/StagePage";
import { AuthContext, type AuthUser } from "../../src/client/auth/AuthProvider";
import { getActiveContext, setActiveContext, useActiveContext } from "../../src/client/activeContext";
import type { ProgramView } from "../../src/client/api";
import type { DeckView } from "../../src/client/types";
import type { Edition, Role } from "../../src/shared/roles";
import { deckListRoute } from "../../src/shared/queries";

/**
 * S1 of the 23-Oct tracker — the programme context, everywhere.
 *
 * Two client rows: other programmes' decks on Assign (row 20) and on Query
 * (row 23), with "the context of the program ... same as what is selected on
 * the dashboard". And the live incident under them: a programme picked in one
 * organisation was applied in the other, because the store was keyed by
 * edition alone, and GCW's CEO saw none of his own 28 decks with nothing on
 * screen to say why.
 *
 * The screens run against a fake `/api/decks` that applies the two arms the
 * real route runs before its partition (`routes/decks.ts:653-654`) and then
 * the partition itself, through `deckListRoute` — so every assertion here is
 * about what the screen ASKED for, read off the request URL, and what it drew
 * from the answer.
 */

const DEMO = "t_default";
const GCW = "t_gcw";
const EMPTY = { programId: null, cohortId: null };

function principal(over: { id: string; tenantId: string; role: Role; edition: Edition }) {
  return { name: "Test User", initials: "TU", ...over };
}

// The demo workspace's Program Manager, and the customer's CEO, signing into
// the same browser one after the other — the incident's two principals.
const PRIYA = principal({ id: "u_priya", tenantId: DEMO, role: "program_manager", edition: "incubator" });
const VIIVECK = principal({ id: "u_viiveck", tenantId: GCW, role: "admin", edition: "incubator" });
// A second person in Priya's organisation, on the same device.
const SUNITA = principal({ id: "u_sunita", tenantId: DEMO, role: "program_associate", edition: "incubator" });
const PARTNER = principal({ id: "u_partner", tenantId: DEMO, role: "partner", edition: "vc" });

function deck(over: Partial<DeckView>): DeckView {
  return { id: "d", name: "Deck", status: "AI Evaluated", statusId: "ai_evaluated", aiScore: 7, ...over };
}

/** A deck as the server files it: the view, plus the two columns `?programId=` / `?cohortId=` read. */
interface Filed {
  deck: DeckView;
  programId: string;
  cohortId?: string;
}

const INCOMPLETE: Partial<DeckView> = { status: "Incomplete", statusId: "incomplete", missingFields: ["founderEmail"] };

const DEMO_DECKS: Filed[] = [
  { deck: deck({ id: "d_green", name: "GreenGrid" }), programId: "p_climate24", cohortId: "c_2026a" },
  { deck: deck({ id: "d_solar", name: "SolarLoop" }), programId: "p_climate24", cohortId: "c_2025b" },
  { deck: deck({ id: "d_fin", name: "FinStack" }), programId: "p_saas" },
  { deck: deck({ id: "d_agri", name: "AgriChain", ...INCOMPLETE }), programId: "p_climate24", cohortId: "c_2026a" },
  { deck: deck({ id: "d_tax", name: "TaxBot", ...INCOMPLETE }), programId: "p_saas" },
  { deck: deck({ id: "d_old", name: "OldCo", status: "Archived", statusId: "archived" }), programId: "p_climate24" },
  { deck: deck({ id: "d_gone", name: "GoneCo", status: "Archived", statusId: "archived" }), programId: "p_saas" },
];

const GCW_DECKS: Filed[] = [
  { deck: deck({ id: "d_carbon", name: "CarbonKey" }), programId: "p_gcw" },
  { deck: deck({ id: "d_peat", name: "PeatWatch" }), programId: "p_gcw" },
];

const PROGRAMS: Record<string, ProgramView[]> = {
  [DEMO]: [
    {
      id: "p_climate24",
      name: "Climate24",
      active: true,
      cohorts: [
        { id: "c_2026a", programId: "p_climate24", name: "Cohort 2026-A", active: true },
        { id: "c_2025b", programId: "p_climate24", name: "Cohort 2025-B", active: true },
      ],
    },
    { id: "p_saas", name: "SaaS Studio", active: true, cohorts: [] },
  ],
  [GCW]: [{ id: "p_gcw", name: "GCW Accelerator", active: true, cohorts: [] }],
};

/** The signed-in organisation the fake server answers for, and everything it was asked. */
const server: { tenant: string; edition: Edition; programsStatus: number; requests: string[] } = {
  tenant: DEMO,
  edition: "incubator",
  programsStatus: 200,
  requests: [],
};

function installServer() {
  const ok = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      server.requests.push(url);
      if (url === "/api/decks" || url.startsWith("/api/decks?")) {
        const qs = new URL(url, "https://x").searchParams;
        const programId = qs.get("programId");
        const cohortId = qs.get("cohortId");
        const list = qs.get("list");
        const filed = server.tenant === GCW ? GCW_DECKS : DEMO_DECKS;
        const decks = filed
          .filter((f) => !programId || f.programId === programId)
          .filter((f) => !cohortId || f.cohortId === cohortId)
          .map((f) => f.deck)
          .filter((d) => !list || deckListRoute(d, server.edition, { queried: d.queried === true }) === list);
        return ok({ decks });
      }
      if (url.startsWith("/api/programs")) {
        if (server.programsStatus !== 200) return ok({ error: "boom" }, server.programsStatus);
        return ok({ sectors: [], programs: PROGRAMS[server.tenant] ?? [] });
      }
      if (url === "/api/queries") return ok({ queries: [] });
      if (/^\/api\/decks\/[^/]+\/report/.test(url)) return ok({ core: [], additional: [] });
      if (url.startsWith("/api/decks/")) return ok({ scores: [], extraction: [], versions: [] });
      if (url === "/api/assignments/board") return ok({ decks: {} });
      if (url === "/api/assignments/mine") return ok({ assignments: [] });
      if (url === "/api/evaluators") return ok({ groups: [] });
      if (url === "/api/parameters") return ok({ parameters: [] });
      if (url.startsWith("/api/signups")) return ok({ signups: [] });
      return ok({});
    }),
  );
}

/** Every `GET /api/decks` the screens sent, parsed. */
function deckRequests() {
  return server.requests
    .filter((u) => u === "/api/decks" || u.startsWith("/api/decks?"))
    .map((u) => new URL(u, "https://x").searchParams);
}

function Signed({ user, children }: { user: AuthUser | null; children: ReactNode }) {
  return (
    <AuthContext.Provider value={{ user, loading: false, login: vi.fn(), logout: vi.fn(), updateUser: vi.fn() }}>
      <MemoryRouter>{children}</MemoryRouter>
    </AuthContext.Provider>
  );
}

function signIn(user: AuthUser, screenEl: ReactNode) {
  server.tenant = "tenantId" in user && user.tenantId === GCW ? GCW : DEMO;
  server.edition = user.edition;
  return render(<Signed user={user}>{screenEl}</Signed>);
}

/**
 * The store, Assign and the auth context as a page load sees them. Source
 * modules are re-evaluated; React and the router live in node_modules, which
 * vitest does not reset, so the fresh screen still shares the test's React.
 */
async function freshPageLoad() {
  vi.resetModules();
  const [{ AssignPage: FreshAssign }, { AuthContext: FreshAuth }, store] = await Promise.all([
    import("../../src/client/routes/AssignPage"),
    import("../../src/client/auth/AuthProvider"),
    import("../../src/client/activeContext"),
  ]);
  return { FreshAssign, FreshAuth, store };
}

const strip = () => screen.queryByTestId("programme-context");
const assignRows = () => screen.queryAllByTestId("assign-deck-row").map((r) => within(r).getByRole("button", { name: /./ }).textContent);

beforeEach(() => {
  localStorage.clear();
  server.requests = [];
  server.programsStatus = 200;
  installServer();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ═══════════════════════════════════════════════════════════════════════════

describe("the store is keyed by organisation and person, not by edition", () => {
  it("a programme chosen in one organisation is NOT applied in another signed into the same browser", async () => {
    // The incident, end to end: Priya filters to Climate24 in the demo
    // workspace; the customer's CEO then signs into GCW in the same browser.
    setActiveContext(PRIYA, "incubator", { programId: "p_climate24", cohortId: null });
    const first = signIn(PRIYA, <AssignPage />);
    await waitFor(() => expect(assignRows()).toEqual(["GreenGrid", "SolarLoop"]));
    expect(deckRequests().every((q) => q.get("programId") === "p_climate24")).toBe(true);
    first.unmount();

    server.requests = [];
    signIn(VIIVECK, <AssignPage />);
    // Every one of his decks, and no strip — because nothing is in force for HIM.
    await waitFor(() => expect(assignRows()).toEqual(["CarbonKey", "PeatWatch"]));
    expect(deckRequests().length).toBeGreaterThan(0);
    expect(deckRequests().some((q) => q.has("programId") || q.has("cohortId"))).toBe(false);
    expect(strip()).toBeNull();
    expect(getActiveContext(VIIVECK, "incubator")).toEqual(EMPTY);

    // …and Priya's own selection is untouched: it was hers, and it stays hers.
    expect(getActiveContext(PRIYA, "incubator")).toEqual({ programId: "p_climate24", cohortId: null });
  });

  it("holds when the second sign-in happens without a page load", async () => {
    // `AuthProvider` swaps `user` in place on logout -> login, so the mounted
    // tree re-reads the context under the new principal rather than keeping
    // the first one's.
    setActiveContext(PRIYA, "incubator", { programId: "p_climate24", cohortId: null });
    const view = signIn(PRIYA, <AssignPage />);
    await waitFor(() => expect(assignRows()).toEqual(["GreenGrid", "SolarLoop"]));

    server.tenant = GCW;
    server.requests = [];
    view.rerender(
      <Signed user={VIIVECK}>
        <AssignPage />
      </Signed>,
    );
    await waitFor(() => expect(assignRows()).toEqual(["CarbonKey", "PeatWatch"]));
    expect(deckRequests().some((q) => q.has("programId"))).toBe(false);
    expect(strip()).toBeNull();
  });

  it("is one person's working view: a colleague on the same device does not inherit it", async () => {
    setActiveContext(PRIYA, "incubator", { programId: "p_climate24", cohortId: null });
    signIn(SUNITA, <QueryPage />);
    await screen.findByText("TaxBot");
    expect(screen.getByText("AgriChain")).toBeInTheDocument();
    expect(deckRequests().some((q) => q.has("programId"))).toBe(false);
    expect(strip()).toBeNull();
  });

  it("files the value under the tenant and the user, and under nothing edition-only", () => {
    setActiveContext(PRIYA, "incubator", { programId: "p_climate24", cohortId: null });
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain(DEMO);
    expect(keys[0]).toContain(PRIYA.id);
    expect(keys[0]).toContain("incubator");
    expect(localStorage.getItem("sj_active_context_incubator")).toBeNull();
  });

  it("never applies a value left under the old edition-only key — not even for the organisation that wrote it", async () => {
    // What every browser that used the product before this change holds. It
    // cannot be attributed to an organisation, so it is not migrated anywhere —
    // and the tempting case is the one tested: the demo workspace's own PM,
    // for whom the value may well have been right.
    //
    // On a FRESH module graph, as a page load is. The discard runs once per
    // load, so against the modules this file already loaded it has been spent
    // and the migration path would never execute — measured: a negative
    // control that migrated the old value passed this test until it was fresh.
    localStorage.setItem("sj_active_context_incubator", JSON.stringify({ programId: "p_climate24", cohortId: null }));
    const { FreshAssign, FreshAuth } = await freshPageLoad();
    server.tenant = DEMO;
    render(
      <FreshAuth.Provider value={{ user: PRIYA, loading: false, login: vi.fn(), logout: vi.fn(), updateUser: vi.fn() }}>
        <MemoryRouter>
          <FreshAssign />
        </MemoryRouter>
      </FreshAuth.Provider>,
    );
    await waitFor(() => expect(assignRows()).toEqual(["GreenGrid", "SolarLoop", "FinStack"]));
    expect(deckRequests().some((q) => q.has("programId"))).toBe(false);
    expect(strip()).toBeNull();
    expect(localStorage.getItem("sj_active_context_incubator")).toBeNull();
  });

  it("removes the old key on first use, in both editions", async () => {
    localStorage.setItem("sj_active_context_incubator", JSON.stringify({ programId: "p_climate24", cohortId: null }));
    localStorage.setItem("sj_active_context_vc", JSON.stringify({ programId: "p_fund", cohortId: null }));
    const { store } = await freshPageLoad();
    expect(store.getActiveContext(VIIVECK, "incubator")).toEqual(EMPTY);
    expect(store.getActiveContext(PARTNER, "vc")).toEqual(EMPTY);
    expect(localStorage.getItem("sj_active_context_incubator")).toBeNull();
    expect(localStorage.getItem("sj_active_context_vc")).toBeNull();
  });

  it("has nothing to read and files nothing for a signed-out visitor", () => {
    function Probe() {
      const [ctx, setCtx] = useActiveContext("incubator");
      return (
        <button type="button" onClick={() => setCtx({ programId: "p_climate24", cohortId: null })}>
          {ctx.programId ?? "none"}
        </button>
      );
    }
    render(
      <Signed user={null}>
        <Probe />
      </Signed>,
    );
    fireEvent.click(screen.getByRole("button", { name: "none" }));
    expect(screen.getByRole("button", { name: "none" })).toBeInTheDocument();
    expect(localStorage.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe("Assign follows the programme in force (row 20)", () => {
  it("asks for that programme's roster AND drawer, and draws only its decks", async () => {
    setActiveContext(PRIYA, "incubator", { programId: "p_climate24", cohortId: null });
    signIn(PRIYA, <AssignPage />);
    await waitFor(() => expect(assignRows()).toEqual(["GreenGrid", "SolarLoop"]));
    const lists = deckRequests().map((q) => [q.get("list"), q.get("programId")]);
    expect(lists).toEqual(expect.arrayContaining([["assign", "p_climate24"], ["query", "p_climate24"]]));
    // The Incomplete drawer is Climate24's one incomplete deck, not TaxBot as well.
    expect(screen.getByTestId("assign-incomplete-count")).toHaveTextContent("1");
    expect(await screen.findByTestId("programme-context")).toHaveTextContent("Showing only Climate24");
  });

  it("shows every programme once it is cleared — on this screen and on the Dashboard", async () => {
    setActiveContext(PRIYA, "incubator", { programId: "p_climate24", cohortId: null });
    signIn(PRIYA, <AssignPage />);
    await waitFor(() => expect(assignRows()).toEqual(["GreenGrid", "SolarLoop"]));
    await screen.findByText("Climate24");

    server.requests = [];
    fireEvent.click(screen.getByRole("button", { name: "Show all programs" }));
    await waitFor(() => expect(assignRows()).toEqual(["GreenGrid", "SolarLoop", "FinStack"]));
    expect(strip()).toBeNull();
    expect(screen.getByTestId("assign-incomplete-count")).toHaveTextContent("2");
    expect(deckRequests().length).toBeGreaterThan(0);
    expect(deckRequests().some((q) => q.has("programId"))).toBe(false);
    // One context across the sidebar: this cleared the Dashboard's too.
    expect(getActiveContext(PRIYA, "incubator")).toEqual(EMPTY);
  });

  it("carries the cohort as well, and names both", async () => {
    setActiveContext(PRIYA, "incubator", { programId: "p_climate24", cohortId: "c_2026a" });
    signIn(PRIYA, <AssignPage />);
    await waitFor(() => expect(assignRows()).toEqual(["GreenGrid"]));
    expect(deckRequests().every((q) => q.get("cohortId") === "c_2026a")).toBe(true);
    expect(await screen.findByText("Climate24 · Cohort 2026-A")).toBeInTheDocument();
  });

  it("keeps the strip on the Incomplete view, which lists decks too", async () => {
    setActiveContext(PRIYA, "incubator", { programId: "p_climate24", cohortId: null });
    signIn(PRIYA, <AssignPage />);
    await waitFor(() => expect(assignRows()).toEqual(["GreenGrid", "SolarLoop"]));
    fireEvent.click(screen.getByRole("button", { name: /Incomplete/ }));
    const table = await screen.findByRole("table", { name: "Incomplete decks" });
    expect(within(table).getByText("AgriChain")).toBeInTheDocument();
    expect(within(table).queryByText("TaxBot")).toBeNull();
    expect(strip()).toHaveTextContent("Showing only Climate24");
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe("Query follows the programme in force (row 23)", () => {
  it("asks for that programme's founder-queries list and draws only its decks", async () => {
    setActiveContext(PRIYA, "incubator", { programId: "p_climate24", cohortId: null });
    signIn(PRIYA, <QueryPage />);
    await screen.findByText("AgriChain");
    expect(screen.queryByText("TaxBot")).toBeNull();
    expect(deckRequests().map((q) => [q.get("list"), q.get("programId")])).toEqual([["query", "p_climate24"]]);
    expect(await screen.findByTestId("programme-context")).toHaveTextContent("Showing only Climate24");
  });

  it("shows every programme once it is cleared", async () => {
    setActiveContext(PRIYA, "incubator", { programId: "p_climate24", cohortId: null });
    signIn(PRIYA, <QueryPage />);
    await screen.findByText("AgriChain");
    await screen.findByText("Climate24");
    fireEvent.click(screen.getByRole("button", { name: "Show all programs" }));
    await screen.findByText("TaxBot");
    expect(strip()).toBeNull();
    expect(deckRequests().at(-1)?.has("programId")).toBe(false);
    expect(getActiveContext(PRIYA, "incubator")).toEqual(EMPTY);
  });

  it("leaves the VC Query screen exactly as it was (VC is out of scope)", async () => {
    setActiveContext(PARTNER, "vc", { programId: "p_fund", cohortId: null });
    signIn(PARTNER, <QueryPage />);
    await waitFor(() => expect(deckRequests().length).toBeGreaterThan(0));
    expect(deckRequests().map((q) => q.toString())).toEqual(["list=query"]);
    expect(strip()).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe("the incubator's stage screens follow it too", () => {
  // Every incubator stage slug a sidebar can show (`App.tsx:139-140`), because
  // the loader is shared and a screen that skipped it would be the next row.
  const SLUGS = Object.keys(INCUBATOR_STAGE_CONFIG);

  it("covers the five sidebar stage screens", () => {
    expect(SLUGS).toEqual(["jurypipeline", "pmpipeline", "incuration", "curation", "archive"]);
  });

  it.each(SLUGS)("%s asks for the programme in force and says so", async (slug) => {
    setActiveContext(PRIYA, "incubator", { programId: "p_climate24", cohortId: null });
    signIn(PRIYA, <StagePage config={INCUBATOR_STAGE_CONFIG[slug]} />);
    await waitFor(() => expect(deckRequests().length).toBeGreaterThan(0));
    expect(deckRequests().every((q) => q.get("programId") === "p_climate24")).toBe(true);
    expect(await screen.findByTestId("programme-context")).toHaveTextContent("Showing only Climate24");
  });

  it("draws only that programme's rows, and all of them once cleared", async () => {
    setActiveContext(PRIYA, "incubator", { programId: "p_climate24", cohortId: null });
    signIn(PRIYA, <StagePage config={INCUBATOR_STAGE_CONFIG.archive} />);
    await screen.findByText("OldCo");
    expect(screen.queryByText("GoneCo")).toBeNull();
    await screen.findByText("Climate24");
    fireEvent.click(screen.getByRole("button", { name: "Show all programs" }));
    await screen.findByText("GoneCo");
    expect(strip()).toBeNull();
    expect(deckRequests().at(-1)?.has("programId")).toBe(false);
  });

  it("leaves the VC stage screens exactly as they were", async () => {
    setActiveContext(PARTNER, "vc", { programId: "p_fund", cohortId: null });
    signIn(PARTNER, <StagePage config={VC_STAGE_CONFIG.archive} />);
    await waitFor(() => expect(deckRequests().length).toBeGreaterThan(0));
    expect(deckRequests().map((q) => q.toString())).toEqual([""]);
    expect(strip()).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe("the strip says what is in force even when it cannot name it", () => {
  it("names a retired programme as retired rather than going blank", async () => {
    // `GET /api/programs` returns active programmes only, and soft-delete is
    // how one leaves — so a stored id can outlive its programme inside one
    // organisation. That is the incident's shape again, minus the second tenant.
    setActiveContext(PRIYA, "incubator", { programId: "p_retired", cohortId: null });
    signIn(PRIYA, <AssignPage />);
    expect(await screen.findByText("a program that is no longer active")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show all programs" })).toBeInTheDocument();
  });

  it("says 'one program' when the programme list does not answer", async () => {
    server.programsStatus = 500;
    setActiveContext(PRIYA, "incubator", { programId: "p_climate24", cohortId: null });
    signIn(PRIYA, <QueryPage />);
    await waitFor(() => expect(server.requests).toContain("/api/programs"));
    expect(await screen.findByTestId("programme-context")).toHaveTextContent("Showing only one program");
  });

  it("is not a toolbar button, so the phone rule that hides those cannot hide it", async () => {
    // Below 900px `index.css:478` hides every non-primary `.tbb` inside `.tbr`
    // except a listbox trigger — this selector, copied. Reading it from the
    // stylesheet was tried and does not work here: `node:fs` fails the
    // typecheck (no node types in tsconfig.json), and vitest hands back an
    // EMPTY string for a CSS module even under `?raw` (measured: length 0).
    const hidden = '.tbr .tbb:not(.pr):not([aria-haspopup="listbox"])';

    setActiveContext(PRIYA, "incubator", { programId: "p_climate24", cohortId: null });
    signIn(PRIYA, <AssignPage />);
    const bar = await screen.findByTestId("programme-context");
    expect(bar.closest(".tbr")).toBeNull();
    for (const el of [bar, ...Array.from(bar.querySelectorAll("*"))]) expect(el.matches(hidden)).toBe(false);
    // …and its Clear meets the phone tier's 36px tap floor on its own.
    expect(within(bar).getByRole("button", { name: "Show all programs" }).className).toContain("max-[639px]:min-h-9");
  });
});
