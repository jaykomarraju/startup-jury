import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, within, configure } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthContext, type AuthUser } from "../../src/client/auth/AuthProvider";
import type { Role } from "../../src/shared/roles";
import {
  CallsPage,
  CallQuestions,
  INCUBATOR_CALLS_CONFIG,
  VC_CALLS_CONFIG,
  googleCalendarUrl,
  type CallsConfig,
} from "../../src/client/routes/CallsPage";
import type { CallView, DeckReportMatrix } from "../../src/client/api";
import type { DeckView } from "../../src/client/types";

/**
 * W7-F — the incubator Intro calls screen (`panel-introcalls`, and the Jury
 * build's "My intro calls"), and the AI questions that have had a tested route
 * and no screen since Wave 2.
 *
 * Gated on a POPULATED row throughout: the toolbar title renders before the
 * deck list resolves, so a test waiting on it passes before there is anything
 * to assert against.
 */

configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 30_000 });

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const DECKS: DeckView[] = [
  {
    id: "d1",
    name: "GreenRoute",
    sector: "Climatetech",
    stage: "Pre-seed",
    city: "Hyderabad",
    aiScore: 8.64,
    juryScore: 7.0,
    decisionScore: 7.82,
    statusId: "intro",
    status: "Intro",
    assignedTo: "inc_jury",
    assignedToName: "Rajesh Kumar",
    assigneeSubmitted: true,
    actions: [],
  },
  {
    id: "d2",
    name: "AgroFresh",
    sector: "AgriTech",
    stage: "Seed",
    city: "Jaipur",
    aiScore: 6.1,
    juryScore: 5.2,
    decisionScore: 5.65,
    statusId: "shortlisted",
    status: "Shortlisted",
    actions: [],
  },
];

function call(over: Partial<CallView>): CallView {
  return {
    id: "c1",
    deckId: "d1",
    deckName: "GreenRoute",
    deckStatus: "intro",
    kind: "intro",
    kindLabel: "Intro call",
    title: "Intro call — GreenRoute",
    scheduledAt: "2026-06-19T09:30:00.000Z",
    durationMinutes: 30,
    location: "Google Meet",
    notes: null,
    status: "scheduled",
    organizerId: "inc_pm",
    organizerName: "Raj Kumar",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: null,
    participants: [{ id: "p1", userId: "inc_jury", email: "rajesh@x.ai", name: "Rajesh Kumar", kind: "team" }],
    canManage: true,
    ...over,
  };
}

function matrix(deckId: string): DeckReportMatrix {
  return {
    deck: DECKS.find((d) => d.id === deckId)!,
    columns: [
      { id: "ai", kind: "ai", name: "AI", rank: 0 },
      { id: "inc_jury", kind: "human", name: "Rajesh Kumar", rank: 1, total: 7.3, submittedAt: "2026-06-02" },
      { id: "inc_pa", kind: "human", name: "Sunita Rao", rank: 1 },
    ],
    core: [
      { key: "p1", name: "Problem", weight: 10, cells: { ai: { value: 8.5 }, inc_jury: { value: 7 } } },
      { key: "p2", name: "Traction", weight: 10, cells: { ai: { value: 6.2 }, inc_jury: { value: 7.6 } } },
    ],
    additional: [
      {
        role: "jury",
        roleLabel: "Jury",
        rows: [{ key: "a1", name: "Barriers of entry", weight: 0, cells: { inc_jury: { value: 6.5 } } }],
      },
    ],
    hiddenEvaluators: 0,
  };
}

interface Mock {
  calls?: CallView[];
  canSchedule?: boolean;
  prompts?: { enabled: boolean; prompts: { topic: string; because: string; question: string }[] };
  // W9-E
  decks?: DeckView[];
  people?: { id: string; name: string; email: string; role: string }[];
  matrix?: (deckId: string) => DeckReportMatrix;
  listing?: { schedulers?: unknown[]; decided?: unknown[]; outcomes?: unknown[]; canDecide?: boolean };
}

const INC_PEOPLE = [
  { id: "inc_mentor", name: "Anil Mehta", email: "anil@x.ai", role: "mentor" },
  { id: "inc_jury", name: "Rajesh Kumar", email: "rajesh@x.ai", role: "jury" },
  { id: "inc_pm", name: "Raj Kumar", email: "raj@x.ai", role: "program_manager" },
  { id: "inc_pa", name: "Sunita Rao", email: "sunita@x.ai", role: "program_associate" },
];

function mockApi({
  calls = [call({})],
  canSchedule = true,
  prompts = { enabled: false, prompts: [] },
  decks = DECKS,
  people = INC_PEOPLE,
  matrix: matrixFor = matrix,
  listing = {},
}: Mock) {
  const seen: { url: string; method: string; body?: unknown }[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    let body: unknown = {};
    if (url === "/api/decks") body = { decks };
    else if (url.startsWith("/api/calls/directory")) body = { people };
    else if (/\/api\/calls\/[^/]+\/prompts$/.test(url)) body = prompts;
    else if (url.startsWith("/api/calls")) body = { calls, canSchedule, kinds: ["intro"], ...listing };
    else if (/\/api\/decks\/[^/]+\/report(\?.*)?$/.test(url)) body = matrixFor(url.split("/")[3]!.split("?")[0]!);
    else if (/\/api\/decks\/[^/]+\/versions$/.test(url)) body = { versions: [] };
    else if (url.startsWith("/api/decks/")) {
      body = { deck: decks[0], scores: [], extraction: [{ label: "Cover", text: "EV logistics." }], versions: [] };
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return seen;
}

function mount(config: CallsConfig, role: Role, id: string, edition: "incubator" | "vc" = "incubator", slug = "introcalls") {
  const user: AuthUser = { id, name: "Test", initials: "TT", role, edition };
  return render(
    <AuthContext.Provider value={{ user, loading: false, login: vi.fn(), logout: vi.fn(), updateUser: vi.fn() }}>
      <MemoryRouter initialEntries={[`/app/${slug}`]}>
        <Routes>
          <Route path="/app/:navId" element={<CallsPage config={config} />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

const headers = () =>
  within(screen.getByRole("table"))
    .getAllByRole("columnheader")
    .map((th) => th.textContent);

// ═══════════════════════════════════════════════════════════════════════════

describe("Intro calls — the scheduler roles (panel-introcalls)", () => {
  const CONFIG = INCUBATOR_CALLS_CONFIG.introcalls;

  it("copies the prototype's subtitle and toolbar, and prints the footer sentence beside the legend", async () => {
    mockApi({});
    mount(CONFIG, "program_manager", "inc_pm");
    await screen.findByRole("row", { name: /AgroFresh/ });

    expect(
      screen.getByText(
        "All shortlisted startups · click a name to view the deck · click the AI score for the full parameter breakdown",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Schedule intro call" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
    expect(screen.getByTestId("stage-footer-stat")).toHaveTextContent("2 shortlisted startups · 1 scheduled · 0 completed");
    expect(within(screen.getByTestId("stage-legend")).getByText("Not scheduled")).toBeInTheDocument();
  });

  it("draws the scheduler column set, Schedule inside the Call scheduled cell, and a sub-label of sector · stage · city", async () => {
    mockApi({});
    mount(CONFIG, "program_manager", "inc_pm");
    const agro = await screen.findByRole("row", { name: /AgroFresh/ });

    expect(headers()).toEqual([
      "Startup",
      "AI score",
      "Jury score",
      "Avg. score",
      "Addl. Parameter scores",
      "Call scheduled",
      "Call date",
      "Call completed",
      // V3 item 14 — the prototype's ninth and last; `Action` is ours (§8 Q104).
      "Assign scheduler",
      "Action",
    ]);
    expect(within(agro).getByText("AgriTech · Seed · Jaipur")).toBeInTheDocument();
    expect(within(agro).getByRole("button", { name: "Schedule" })).toBeInTheDocument();
    const green = screen.getByRole("row", { name: /GreenRoute/ });
    expect(within(green).getByText("Scheduled")).toBeInTheDocument();
    // One decimal, not two (F0647).
    expect(within(green).getByText("7.8")).toBeInTheDocument();
    expect(within(green).queryByText("7.82")).not.toBeInTheDocument();
  });

  it("stacks one score per evaluator, dimming the one not yet submitted", async () => {
    mockApi({});
    mount(CONFIG, "program_manager", "inc_pm");
    const green = await screen.findByRole("row", { name: /GreenRoute/ });
    const stack = await within(green).findByTestId("jury-score-stack");
    expect(within(stack).getByTitle("Rajesh Kumar — view all evaluator parameter scores")).toHaveTextContent("7.3");
    expect(within(stack).getByTitle("Sunita Rao — not submitted")).toHaveTextContent("—");
  });

  it("filters to the legend's words", async () => {
    mockApi({});
    mount(CONFIG, "program_manager", "inc_pm");
    await screen.findByRole("row", { name: /AgroFresh/ });
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Not scheduled" }));
    expect(screen.queryByRole("row", { name: /GreenRoute/ })).not.toBeInTheDocument();
    expect(screen.getByRole("row", { name: /AgroFresh/ })).toBeInTheDocument();
  });

  it("offers Cancel call behind a confirm, and Reopen on a completed call", async () => {
    const seen = mockApi({ calls: [call({}), call({ id: "c2", deckId: "d2", deckName: "AgroFresh", status: "completed" })] });
    mount(CONFIG, "program_manager", "inc_pm");
    const green = await screen.findByRole("row", { name: /GreenRoute/ });
    fireEvent.click(within(green).getByRole("button", { name: "Cancel call" }));
    fireEvent.click(within(green).getByRole("button", { name: "Confirm cancel" }));
    await vi.waitFor(() =>
      expect(seen.some((c) => c.url === "/api/calls/c1" && c.method === "PATCH")).toBe(true),
    );
    const agro = screen.getByRole("row", { name: /AgroFresh/ });
    expect(within(agro).getByRole("button", { name: "Reopen" })).toBeInTheDocument();
  });

  it("the toolbar modal is singular, picks its startup inside the dialog, and groups the roster by role with Selected chips", async () => {
    mockApi({});
    mount(CONFIG, "program_manager", "inc_pm");
    await screen.findByRole("row", { name: /AgroFresh/ });
    fireEvent.click(screen.getByRole("button", { name: "Schedule intro call" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Schedule intro call" })).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue("Intro call — ai.STARTUPJURY")).toBeInTheDocument();
    // Only startups without a live call are offered.
    const startup = within(dialog).getByRole("combobox", { name: "Startup" });
    expect(within(startup).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose a startup…", "AgroFresh"]);
    fireEvent.change(startup, { target: { value: "d2" } });
    expect(within(dialog).getByDisplayValue("Intro call — AgroFresh")).toBeInTheDocument();

    const roster = await within(dialog).findByTestId("participant-roles");
    expect(within(roster).getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual([
      "Program manager",
      "Program associate",
      "Jury member",
      "Mentor",
    ]);
    fireEvent.click(within(roster).getByRole("checkbox", { name: "Invite Rajesh Kumar" }));
    const chips = within(dialog).getByTestId("participant-selected");
    expect(within(chips).getByRole("button", { name: "Remove Rajesh Kumar" })).toBeInTheDocument();
    expect(within(chips).getByRole("button", { name: "Remove Raj Kumar" })).toBeInTheDocument();
    fireEvent.click(within(chips).getByRole("button", { name: "Remove Rajesh Kumar" }));
    expect(within(roster).getByRole("checkbox", { name: "Invite Rajesh Kumar" })).not.toBeChecked();
  });
});

describe("My intro calls — the jury (AISJ_IC_Jury_V4)", () => {
  const CONFIG = INCUBATOR_CALLS_CONFIG.introcalls;

  it("draws the jury's thirteen columns, their own score, and no scheduling controls", async () => {
    mockApi({ canSchedule: false, calls: [call({ canManage: false })] });
    mount(CONFIG, "jury", "inc_jury");
    const green = await screen.findByRole("row", { name: /GreenRoute/ });

    expect(headers()).toEqual([
      "Startup",
      "AI score",
      "Parameters score",
      "Addl. Parameters Score",
      "My score",
      "Av. Score",
      "Call scheduled",
      "Call date",
      "Call time",
      "Call completed",
      "Scheduled by",
      "View calendar",
      "Archive",
    ]);
    // My score is the viewer's own column of the report, not the jury average.
    await vi.waitFor(() => expect(within(green).getAllByText("7.3").length).toBeGreaterThan(0));
    expect(within(green).getByText("Not yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Schedule intro call" })).not.toBeInTheDocument();
    expect(within(green).queryByRole("button", { name: "Mark completed" })).not.toBeInTheDocument();
    expect(within(green).getByRole("link", { name: ".ics" })).toBeInTheDocument();
    // Archive waits for a completed call.
    expect(within(green).getByRole("button", { name: "Archive" })).toBeDisabled();

    fireEvent.click(within(green).getByRole("button", { name: "View" }));
    const menu = screen.getByRole("menu", { name: "View calendar" });
    expect(within(menu).getAllByRole("menuitem").map((a) => a.textContent)).toEqual([
      "Google Meet",
      "Microsoft Teams",
      "Zoom",
    ]);
  });
});

describe("the AI questions (GET /api/calls/:id/prompts)", () => {
  it("renders topic, question and because for each prompt", () => {
    render(
      <CallQuestions
        prompts={{
          enabled: true,
          prompts: [{ topic: "Traction & Validation", because: "Scored 4.5 — the weakest area.", question: "Who pays today?" }],
        }}
      />,
    );
    const q = screen.getByTestId("call-ai-question");
    expect(q).toHaveTextContent("Traction & Validation");
    expect(q).toHaveTextContent("Who pays today?");
    expect(q).toHaveTextContent("Scored 4.5 — the weakest area.");
  });

  it("renders NOTHING when the admin toggle is off", () => {
    const { container } = render(<CallQuestions prompts={{ enabled: false, prompts: [] }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("appears in the row's pane for a call, and stays absent when disabled", async () => {
    mockApi({
      prompts: { enabled: true, prompts: [{ topic: "Team", because: "No CTO slide.", question: "Who builds it?" }] },
    });
    const { unmount } = mount(INCUBATOR_CALLS_CONFIG.introcalls, "program_manager", "inc_pm");
    fireEvent.click(await screen.findByRole("button", { name: "GreenRoute" }));
    const pane = screen.getByRole("complementary", { name: "GreenRoute detail" });
    expect(await within(pane).findByText("Who builds it?")).toBeInTheDocument();
    expect(within(pane).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Deck", "All scores"]);
    unmount();

    mockApi({ prompts: { enabled: false, prompts: [] } });
    mount(INCUBATOR_CALLS_CONFIG.introcalls, "program_manager", "inc_pm");
    fireEvent.click(await screen.findByRole("button", { name: "GreenRoute" }));
    const again = screen.getByRole("complementary", { name: "GreenRoute detail" });
    await within(again).findByText("EV logistics.");
    expect(within(again).queryByTestId("call-ai-questions")).not.toBeInTheDocument();
  });
});

describe("a call screen that declares none of the extension", () => {
  // Until W9-E this test borrowed the VC Intro calls config as its bare example;
  // the VC configs now declare the extension, so the bare config is spelled out.
  const BARE: CallsConfig = {
    title: "Intro calls",
    subtitle: "Bare",
    kind: "intro",
    statuses: ["shortlisted", "intro"],
    emptyTitle: "No intro calls yet",
    emptyDescription: "—",
  };

  it("has no Filter, Export, legend, score stack or pane — and the name still opens the drawer", async () => {
    mockApi({});
    mount(BARE, "program_manager", "inc_pm");
    await screen.findByRole("row", { name: /AgroFresh/ });
    expect(screen.queryByRole("button", { name: /^Filter/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("stage-legend")).not.toBeInTheDocument();
    expect(screen.queryByTestId("jury-score-stack")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "GreenRoute" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByTestId("stage-pane")).not.toBeInTheDocument();
  });

  it("W9-E's keys draw nothing when omitted: W7-F's trailing pair, Jury score, no outcome, no delegation", async () => {
    mockApi({ listing: { decided: [{ deckId: "d9", action: "x", outcome: "Pass", toStage: "archived", decidedAt: "2026-06-01" }] } });
    mount(BARE, "program_manager", "inc_pm");
    await screen.findByRole("row", { name: /AgroFresh/ });
    expect(headers()).toEqual([
      "Startup",
      "AI score",
      "Jury score",
      "Avg. score",
      "Addl. Parameter scores",
      "Call scheduled",
      "Call date",
      "Call completed",
      "Scheduler",
      "Action",
    ]);
    expect(screen.queryByTestId("assign-scheduler")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /^Sponsorship|^Outcome/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(3); // header + the two live decks, no decided row
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// W9-E — the VC call screens, from the real VC configs.

function vcDeck(over: Partial<DeckView>): DeckView {
  return {
    id: "v1",
    name: "WealthOS",
    sector: "Wealthtech",
    stage: "Pre-seed",
    city: "Mumbai",
    aiScore: 7.8,
    juryScore: 5.5,
    decisionScore: 7.5,
    statusId: "associate_review",
    status: "Associate Review",
    actions: [],
    ...over,
  };
}

/** Analysts scored 7.0 and 8.0; the partner 9.0 — so a role-filtered cell is provably not the deck's juryScore. */
function vcMatrix(deckId: string): DeckReportMatrix {
  return {
    deck: vcDeck({ id: deckId }),
    columns: [
      { id: "ai", kind: "ai", name: "AI", rank: 0 },
      { id: "vc_analyst", kind: "human", name: "Rhea Nair", role: "analyst", rank: 1, total: 7.0, submittedAt: "2026-06-02" },
      { id: "vc_analyst2", kind: "human", name: "Kiran Desai", role: "analyst", rank: 1, total: 8.0, submittedAt: "2026-06-02" },
      { id: "vc_partner", kind: "human", name: "Ishaan Sethi", role: "partner", rank: 2, total: 9.0, submittedAt: "2026-06-03" },
      { id: "vc_ic", kind: "human", name: "Rajesh Kumar", role: "ic_member", rank: 2, total: 6.4, submittedAt: "2026-06-04" },
    ],
    core: [],
    additional: [],
    hiddenEvaluators: 0,
  };
}

const VC_PEOPLE = [
  { id: "vc_partner", name: "Ishaan Sethi", email: "ishaan@x.ai", role: "partner" },
  { id: "vc_analyst", name: "Rhea Nair", email: "rhea@x.ai", role: "analyst" },
  { id: "vc_associate", name: "Sunita Rao", email: "sunita@x.ai", role: "associate" },
  { id: "vc_ic", name: "Rajesh Kumar", email: "rajesh@x.ai", role: "ic_member" },
];

const vcCall = (over: Partial<CallView>) =>
  call({ id: "vc1", deckId: "v1", deckName: "WealthOS", deckStatus: "associate_review", organizerId: "vc_associate", ...over });

const DECKS_VC = [vcDeck({}), vcDeck({ id: "v2", name: "AgriChain", sector: "AgriTech", city: "Jaipur", statusId: "partner_review" })];

describe("VC Intro calls (panel-introcalls, AISJ_VC_Superuser_V8)", () => {
  const CONFIG = VC_CALLS_CONFIG.introcalls;

  it("draws the prototype's ten headers, subtitle, toolbar, footer sentence and legend", async () => {
    mockApi({ decks: DECKS_VC, calls: [vcCall({})], people: VC_PEOPLE, matrix: vcMatrix });
    mount(CONFIG, "associate", "vc_associate", "vc");
    await screen.findByRole("row", { name: /AgriChain/ });

    expect(headers()).toEqual([
      "Startup",
      "AI score",
      "Analyst Score",
      "Avg. score",
      "Addl. Parameter scores",
      "Call scheduled",
      "Call date",
      "Call completed",
      "Schedule call",
      "Assign scheduler",
    ]);
    expect(
      screen.getByText("All shortlisted startups · click a name to view the deck · click the AI score for the full parameter breakdown"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
    // `.nc-tb` has no primary button on the VC build.
    expect(screen.queryByRole("button", { name: "Schedule intro call" })).not.toBeInTheDocument();
    expect(screen.getByTestId("stage-footer-stat")).toHaveTextContent("2 shortlisted startups · 1 scheduled · 0 completed");
    expect(
      within(screen.getByTestId("stage-legend"))
        .getAllByText(/./)
        .map((n) => n.textContent),
    ).toEqual(["Scheduled", "Completed", "Not scheduled"]);
  });

  it("averages the ANALYSTS into Analyst Score, and keeps Schedule call in its own column", async () => {
    mockApi({ decks: DECKS_VC, calls: [vcCall({})], people: VC_PEOPLE, matrix: vcMatrix });
    mount(CONFIG, "associate", "vc_associate", "vc");
    const agri = await screen.findByRole("row", { name: /AgriChain/ });
    const wealth = screen.getByRole("row", { name: /WealthOS/ });
    // (7.0 + 8.0) / 2 — not the partner's 9.0, not the deck's 5.5.
    await vi.waitFor(() => expect(within(wealth).getAllByRole("cell")[2]).toHaveTextContent("7.5"));
    expect(within(wealth).queryByText("5.5")).not.toBeInTheDocument();
    // Scheduled: a pill in Call scheduled, a tick in Schedule call, no button.
    expect(within(wealth).getAllByText("Scheduled")).toHaveLength(2);
    expect(within(wealth).queryByRole("button", { name: "Schedule call" })).not.toBeInTheDocument();
    expect(within(agri).getByText("Not scheduled")).toBeInTheDocument();
    expect(within(agri).getByRole("button", { name: "Schedule call" })).toBeInTheDocument();
    // No Action column, so no pipeline verbs on this screen.
    expect(within(agri).queryByRole("button", { name: /Shortlist to partner/ })).not.toBeInTheDocument();
  });

  it("assigns a scheduler role → user → Assign, then shows '<user> · <role>' with Change", async () => {
    const seen = mockApi({ decks: DECKS_VC, calls: [vcCall({})], people: VC_PEOPLE, matrix: vcMatrix });
    mount(CONFIG, "associate", "vc_associate", "vc");
    const agri = await screen.findByRole("row", { name: /AgriChain/ });
    const user = within(agri).getByRole("combobox", { name: "Scheduler for AgriChain" });
    expect(user).toBeDisabled();
    fireEvent.change(within(agri).getByRole("combobox", { name: "Scheduler role for AgriChain" }), { target: { value: "analyst" } });
    await vi.waitFor(() => expect(within(user).getAllByRole("option").map((o) => o.textContent)).toEqual(["— user —", "Rhea Nair"]));
    expect(within(agri).getByRole("button", { name: "Assign" })).toBeDisabled();
    fireEvent.change(user, { target: { value: "vc_analyst" } });
    fireEvent.click(within(agri).getByRole("button", { name: "Assign" }));
    await vi.waitFor(() =>
      expect(seen.find((r) => r.url === "/api/calls/scheduler" && r.method === "PUT")?.body).toEqual({
        deckId: "v2",
        kind: "intro",
        userId: "vc_analyst",
      }),
    );
  });

  it("names the delegate, and gives the delegate the Schedule call their role otherwise lacks", async () => {
    const delegation = { deckId: "v2", kind: "intro", userId: "vc_analyst", userName: "Rhea Nair", role: "analyst" };
    mockApi({ decks: DECKS_VC, calls: [vcCall({})], people: VC_PEOPLE, matrix: vcMatrix, listing: { schedulers: [delegation] } });
    const { unmount } = mount(CONFIG, "associate", "vc_associate", "vc");
    const agri = await screen.findByRole("row", { name: /AgriChain/ });
    expect(within(agri).getByText("Rhea Nair · Analyst")).toBeInTheDocument();
    fireEvent.click(within(agri).getByRole("button", { name: "Change" }));
    expect(within(agri).getByRole("combobox", { name: "Scheduler role for AgriChain" })).toBeInTheDocument();
    unmount();

    // The analyst: a read-only role, on no call — but delegated AgriChain.
    mockApi({ decks: DECKS_VC, calls: [], canSchedule: false, people: VC_PEOPLE, matrix: vcMatrix, listing: { schedulers: [delegation] } });
    mount(CONFIG, "analyst", "vc_analyst", "vc");
    const mine = await screen.findByRole("row", { name: /AgriChain/ });
    expect(screen.queryByRole("row", { name: /WealthOS/ })).not.toBeInTheDocument();
    expect(within(mine).getByRole("button", { name: "Schedule call" })).toBeInTheDocument();
    // …and cannot pass the delegation on.
    expect(within(mine).queryByRole("button", { name: "Change" })).not.toBeInTheDocument();
  });

  it("heads the name's pane with the AI's questions when the toggle is on", async () => {
    mockApi({
      decks: DECKS_VC,
      calls: [vcCall({})],
      people: VC_PEOPLE,
      matrix: vcMatrix,
      prompts: { enabled: true, prompts: [{ topic: "Traction & Validation", because: "Scored 4.5.", question: "Who pays today?" }] },
    });
    mount(CONFIG, "associate", "vc_associate", "vc");
    fireEvent.click(await screen.findByRole("button", { name: "WealthOS" }));
    const pane = screen.getByRole("complementary", { name: "WealthOS detail" });
    expect(await within(pane).findByText("Who pays today?")).toBeInTheDocument();
    expect(within(pane).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Deck", "All scores"]);
  });
});

describe("VC Partner call (panel-partnercall)", () => {
  const CONFIG = VC_CALLS_CONFIG.partnercall;
  const MEDGRID = vcDeck({
    id: "m1",
    name: "MedGrid",
    sector: "Healthtech",
    statusId: "partner_call",
    actions: [
      { action: "sponsor_to_ic", label: "Sponsor to IC", to: "investment_dd" },
      { action: "pass_at_call", label: "Pass", to: "archived" },
      { action: "another_meeting", label: "Need another meeting", to: "partner_review" },
    ] as DeckView["actions"],
  });
  // Decided here, now at partner_review — whose actions must NOT surface on this row.
  // `pass_at_call` is not a partner_review action; it is in the mock so the decided
  // select is proven disabled BY the decision, not merely by having no allowed option.
  const PAYWISE = vcDeck({
    id: "p1",
    name: "PayWise",
    statusId: "partner_review",
    actions: [
      { action: "advance_to_call", label: "Advance to partner call", to: "partner_call" },
      { action: "pass_at_call", label: "Pass", to: "archived" },
    ] as DeckView["actions"],
  });
  const DECIDED = [{ deckId: "p1", action: "another_meeting", outcome: "Need another meeting", toStage: "partner_review", decidedAt: "2026-06-05" }];
  const mc = vcCall({ id: "mc", deckId: "m1", deckName: "MedGrid", kind: "partner", deckStatus: "partner_call" });

  it("draws the V8 headers, pcRender's footer and the outcome legend; keeps the decided row with its outcome and no verbs", async () => {
    mockApi({ decks: [MEDGRID, PAYWISE], calls: [mc], people: VC_PEOPLE, matrix: vcMatrix, listing: { decided: DECIDED, canDecide: true } });
    mount(CONFIG, "partner", "vc_partner", "vc", "partnercall");
    const pay = await screen.findByRole("row", { name: /PayWise/ });

    expect(headers()).toEqual([
      "Startup",
      "AI score",
      "Partner",
      "Avg. score",
      "Addl. Parameter scores",
      "Call scheduled",
      "Call date",
      "Call completed",
      "Schedule call",
      "Sponsorship",
    ]);
    expect(screen.getByTestId("stage-footer-stat")).toHaveTextContent("2 deals in partner review · 1 call scheduled · 0 sponsored to IC");
    expect(
      within(screen.getByTestId("stage-legend"))
        .getAllByText(/./)
        .map((n) => n.textContent),
    ).toEqual(["Sponsor to IC", "Need another meeting", "Pass"]);

    const decided = within(pay).getByRole("combobox", { name: "Sponsorship for PayWise" });
    expect(decided).toBeDisabled();
    expect(decided).toHaveDisplayValue("Need another meeting");
    expect(within(pay).queryByRole("button", { name: /Advance to partner call|Schedule call/ })).not.toBeInTheDocument();

    const med = screen.getByRole("row", { name: /MedGrid/ });
    // The Partner column is the partner's own 9.0.
    await vi.waitFor(() => expect(within(med).getAllByRole("cell")[2]).toHaveTextContent("9.0"));
    const live = within(med).getByRole("combobox", { name: "Sponsorship for MedGrid" });
    expect(live).toBeEnabled();
    expect(within(live).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "— decide —",
      "Sponsor to IC",
      "Pass",
      "Need another meeting",
    ]);
  });

  it("choosing Sponsor to IC performs the transition", async () => {
    const seen = mockApi({ decks: [MEDGRID], calls: [mc], people: VC_PEOPLE, matrix: vcMatrix, listing: { canDecide: true } });
    mount(CONFIG, "partner", "vc_partner", "vc", "partnercall");
    const med = await screen.findByRole("row", { name: /MedGrid/ });
    fireEvent.change(within(med).getByRole("combobox", { name: "Sponsorship for MedGrid" }), { target: { value: "sponsor_to_ic" } });
    await vi.waitFor(() =>
      expect(seen.find((r) => r.url === "/api/decks/m1/transition")?.body).toMatchObject({ action: "sponsor_to_ic" }),
    );
  });

  it("carries NO AI questions: the name opens the report, and /prompts is never asked", async () => {
    const seen = mockApi({
      decks: [MEDGRID],
      calls: [mc],
      people: VC_PEOPLE,
      matrix: vcMatrix,
      prompts: { enabled: true, prompts: [{ topic: "Team", because: "x", question: "Should never render" }] },
    });
    mount(CONFIG, "partner", "vc_partner", "vc", "partnercall");
    fireEvent.click(await screen.findByRole("button", { name: "MedGrid" }));
    const report = await screen.findByRole("dialog", { name: "Evaluation report — MedGrid" });
    // Settled: the report's own request has been answered before absence is asserted.
    await vi.waitFor(() => expect(seen.some((r) => r.url.startsWith("/api/decks/m1/report"))).toBe(true));
    expect(report).toBeInTheDocument();
    expect(screen.queryByTestId("call-ai-questions")).not.toBeInTheDocument();
    expect(screen.queryByText("Should never render")).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(seen.some((r) => r.url.includes("/prompts"))).toBe(false);
  });
});

describe("VC Alignment call (panel-alignmentcall)", () => {
  const CONFIG = VC_CALLS_CONFIG.alignmentcall;
  const LEARNLOOP = vcDeck({
    id: "l1",
    name: "LearnLoop",
    sector: "Edtech",
    statusId: "alignment_call",
    actions: [{ action: "issue_term_sheet", label: "Issue term sheet", to: "term_sheet" }] as DeckView["actions"],
  });
  const lc = vcCall({ id: "lc", deckId: "l1", deckName: "LearnLoop", kind: "alignment", deckStatus: "alignment_call" });

  it("draws the V8 headers and alRender's footer; records Renegotiate, and asks for the term sheet's fields before issuing", async () => {
    const seen = mockApi({ decks: [LEARNLOOP], calls: [lc], people: VC_PEOPLE, matrix: vcMatrix, listing: { canDecide: true } });
    mount(CONFIG, "partner", "vc_partner", "vc", "alignmentcall");
    const row = await screen.findByRole("row", { name: /LearnLoop/ });
    expect(headers()).toEqual([
      "Startup",
      "AI score",
      "Partner",
      "Avg. score",
      "Addl. Parameter scores",
      "Call scheduled",
      "Call date",
      "Call completed",
      "Schedule call",
      "Outcome",
    ]);
    expect(screen.getByTestId("stage-footer-stat")).toHaveTextContent("1 deal post-IC · 1 call scheduled · 0 clear to issue term sheet");
    expect(
      screen.getByText("Post-IC term alignment with the founder · confirm valuation and key terms, then decide whether to issue the term sheet"),
    ).toBeInTheDocument();

    const select = within(row).getByRole("combobox", { name: "Outcome for LearnLoop" });
    fireEvent.change(select, { target: { value: "renegotiate" } });
    await vi.waitFor(() =>
      expect(seen.find((r) => r.url === "/api/calls/outcome")?.body).toEqual({ deckId: "l1", kind: "alignment", outcome: "renegotiate" }),
    );

    fireEvent.change(select, { target: { value: "issue_term_sheet" } });
    fireEvent.change(within(row).getByRole("textbox", { name: "Valuation" }), { target: { value: "₹60 Cr" } });
    expect(seen.some((r) => r.url === "/api/decks/l1/transition")).toBe(false);
    fireEvent.click(within(row).getByRole("button", { name: "Confirm" }));
    await vi.waitFor(() =>
      expect(seen.find((r) => r.url === "/api/decks/l1/transition")?.body).toMatchObject({
        action: "issue_term_sheet",
        valuation: "₹60 Cr",
      }),
    );
  });

  it("a role that may not decide sees the select disabled", async () => {
    mockApi({ decks: [{ ...LEARNLOOP, actions: [] }], calls: [lc], people: VC_PEOPLE, matrix: vcMatrix, listing: { canDecide: false } });
    mount(CONFIG, "associate", "vc_associate", "vc", "alignmentcall");
    const row = await screen.findByRole("row", { name: /LearnLoop/ });
    expect(within(row).getByRole("combobox", { name: "Outcome for LearnLoop" })).toBeDisabled();
  });

  it("the IC member gets their own ten columns and two-verb legend, and may close out the call they are on", async () => {
    const seen = mockApi({
      decks: [LEARNLOOP],
      calls: [{ ...lc, canManage: false, canComplete: true } as CallView],
      canSchedule: false,
      people: VC_PEOPLE,
      matrix: vcMatrix,
    });
    mount(CONFIG, "ic_member", "vc_ic", "vc", "alignmentcall");
    const row = await screen.findByRole("row", { name: /LearnLoop/ });
    expect(headers()).toEqual([
      "Startup",
      "AI score",
      "My score",
      "Avg. score",
      "Addl. Parameter scores",
      "Call scheduled",
      "Call date",
      "Call completed",
      "View Calendar",
      "Archive",
    ]);
    expect(
      within(screen.getByTestId("stage-legend"))
        .getAllByText(/./)
        .map((n) => n.textContent),
    ).toEqual(["Launch on Google Meet, Teams or Zoom", "Archive to remove from the queue"]);
    await vi.waitFor(() => expect(within(row).getByText("6.4")).toBeInTheDocument());
    // No transition leaves alignment_call for Archive yet (§9).
    expect(within(row).getByRole("button", { name: "Archive" })).toBeDisabled();
    expect(within(row).getByText("Not yet")).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "Mark completed" }));
    await vi.waitFor(() =>
      expect(seen.find((r) => r.url === "/api/calls/lc" && r.method === "PATCH")?.body).toEqual({ status: "completed" }),
    );
  });
});

describe("the incubator Intro calls screen takes W9-E's delegation and nothing else", () => {
  it("declares W7-F's keys plus the one trailing pair V3 item 14 adds", () => {
    expect(Object.keys(INCUBATOR_CALLS_CONFIG.introcalls).sort()).toEqual(
      [
        "title",
        "subtitle",
        "kind",
        "statuses",
        "emptyTitle",
        "emptyDescription",
        "toolbar",
        "footer",
        "subTabs",
        "aiQuestions",
        "juryStack",
        "participantColumns",
        "trailing",
      ].sort(),
    );
    expect(INCUBATOR_CALLS_CONFIG.introcalls.trailing).toEqual(["assignScheduler", "action"]);
    expect(INCUBATOR_CALLS_CONFIG.introcalls.footer).toEqual({ noun: "shortlisted startup" });
  });

  it("still puts Schedule inside Call scheduled, draws no leaf, and offers no outcome", async () => {
    mockApi({});
    mount(INCUBATOR_CALLS_CONFIG.introcalls, "program_manager", "inc_pm");
    const agro = await screen.findByRole("row", { name: /AgroFresh/ });
    expect(within(agro).getByRole("button", { name: "Schedule" })).toBeInTheDocument();
    expect(within(agro).queryByRole("button", { name: "Schedule call" })).not.toBeInTheDocument();
    expect(within(agro).getByRole("button", { name: "AgroFresh" }).querySelector("svg")).toBeNull();
    // Narrowed by V3 item 14 — "Assign scheduler" IS this screen's ninth column
    // now, so the guard keeps the three headers that still must not appear.
    expect(screen.queryByRole("columnheader", { name: /Schedule call|Sponsorship|Outcome|Analyst Score/ })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Assign scheduler" })).toBeInTheDocument();
    expect(within(screen.getByTestId("stage-legend")).getAllByText(/./).map((n) => n.textContent)).toEqual([
      "Scheduled",
      "Completed",
      "Not scheduled",
    ]);
  });
});

/**
 * V3 item 14 — the incubator scheduling flow, measured against `ncRoles` /
 * `ncAssign` in `AISJ_SuperuserV3` (and `AISJ_IC_SuserV15`, in which every one
 * of the 16 `nc*` functions is byte-identical, so this is a build defect and
 * not a v3 change). The two editions name three DIFFERENT roles and W9-E built
 * the cell against the VC triple alone.
 *
 * The role names are written out here rather than imported from the component,
 * so renaming `ASSIGN_SCHEDULER_ROLES`' labels fails this suite.
 */
describe("Intro calls — Assign scheduler offers each edition's own ncRoles (V3 item 14)", () => {
  const roleOptions = (row: HTMLElement, deck: string) =>
    within(within(row).getByRole("combobox", { name: `Scheduler role for ${deck}` }))
      .getAllByRole("option")
      .map((o) => o.textContent);

  it("offers Jury member · Program associate · Program manager on the incubator, and none of the VC roles", async () => {
    mockApi({});
    mount(INCUBATOR_CALLS_CONFIG.introcalls, "program_manager", "inc_pm");
    const agro = await screen.findByRole("row", { name: /AgroFresh/ });
    // `ncRoles` in all five incubator builds, in its own order and casing.
    expect(roleOptions(agro, "AgroFresh")).toEqual([
      "— role —",
      "Jury member",
      "Program associate",
      "Program manager",
    ]);
    // The negative control: the VC triple this cell used to offer everywhere.
    for (const vcRole of ["IC member", "Analyst", "Partner"]) {
      expect(roleOptions(agro, "AgroFresh")).not.toContain(vcRole);
    }
  });

  it("assigns role → user → Assign and PUTs the delegation, then names the delegate in the incubator's own casing", async () => {
    const seen = mockApi({});
    const { unmount } = mount(INCUBATOR_CALLS_CONFIG.introcalls, "program_manager", "inc_pm");
    const agro = await screen.findByRole("row", { name: /AgroFresh/ });
    const person = within(agro).getByRole("combobox", { name: "Scheduler for AgroFresh" });
    expect(person).toBeDisabled();
    fireEvent.change(within(agro).getByRole("combobox", { name: "Scheduler role for AgroFresh" }), {
      target: { value: "program_associate" },
    });
    await vi.waitFor(() =>
      expect(within(person).getAllByRole("option").map((o) => o.textContent)).toEqual(["— user —", "Sunita Rao"]),
    );
    expect(within(agro).getByRole("button", { name: "Assign" })).toBeDisabled();
    fireEvent.change(person, { target: { value: "inc_pa" } });
    fireEvent.click(within(agro).getByRole("button", { name: "Assign" }));
    await vi.waitFor(() =>
      expect(seen.find((r) => r.url === "/api/calls/scheduler" && r.method === "PUT")?.body).toEqual({
        deckId: "d2",
        kind: "intro",
        userId: "inc_pa",
      }),
    );
    unmount();

    mockApi({
      listing: {
        schedulers: [{ deckId: "d2", kind: "intro", userId: "inc_jury", userName: "Rajesh Kumar", role: "jury" }],
      },
    });
    mount(INCUBATOR_CALLS_CONFIG.introcalls, "program_manager", "inc_pm");
    const again = await screen.findByRole("row", { name: /AgroFresh/ });
    // `ncAssign`'s "<user> · <role>" — the incubator's "Jury member", never "Jury".
    expect(within(again).getByText("Rajesh Kumar · Jury member")).toBeInTheDocument();
    expect(within(again).getByRole("button", { name: "Change" })).toBeInTheDocument();
  });

  it("leaves the VC screen on its own three roles — the VC edition was not rescoped", async () => {
    mockApi({ decks: DECKS_VC, calls: [vcCall({})], people: VC_PEOPLE, matrix: vcMatrix });
    mount(VC_CALLS_CONFIG.introcalls, "associate", "vc_associate", "vc");
    const agri = await screen.findByRole("row", { name: /AgriChain/ });
    expect(roleOptions(agri, "AgriChain")).toEqual(["— role —", "IC member", "Analyst", "Partner"]);
  });
});

/**
 * V3 item 14 — the scheduling modal's own copy, against `ncCallOpenModal` /
 * `ncCallRenderSelected`. The role is the GROUP HEADING in the prototype, so a
 * participant row names only what the heading does not.
 */
describe("Intro calls — the schedule modal's participant picker (V3 item 14)", () => {
  it("heads each group with the role and names the person by email, not by the role again", async () => {
    mockApi({ calls: [] });
    mount(INCUBATOR_CALLS_CONFIG.introcalls, "program_manager", "inc_pm");
    await screen.findByRole("row", { name: /AgroFresh/ });
    fireEvent.click(screen.getByRole("button", { name: "Schedule intro call" }));
    const roster = await screen.findByTestId("participant-roles");
    // `ncCallRenderRoles`: one `.nccall-rolegrp` per role, headed by its name.
    expect(within(roster).getByRole("group", { name: "Program manager" })).toBeInTheDocument();
    const jury = within(roster).getByRole("group", { name: "Jury member" });
    expect(within(jury).getByText("· rajesh@x.ai")).toBeInTheDocument();
    expect(within(jury).queryByText(/· Jury member · /)).not.toBeInTheDocument();
  });

  it("empties the Selected box with the prototype's own sentence", async () => {
    mockApi({ calls: [], people: [] });
    mount(INCUBATOR_CALLS_CONFIG.introcalls, "program_manager", "inc_pm");
    await screen.findByRole("row", { name: /AgroFresh/ });
    fireEvent.click(screen.getByRole("button", { name: "Schedule intro call" }));
    const selected = await screen.findByTestId("participant-selected");
    expect(selected).toHaveTextContent("No participants selected yet.");
  });
});

describe("calendar composers (F0617)", () => {
  it("prefills Google Calendar with one add= per attendee", () => {
    const url = googleCalendarUrl({
      title: "Intro call — GreenRoute",
      start: new Date("2026-06-19T09:30:00.000Z"),
      minutes: 30,
      emails: ["a@x.ai", "b@y.com"],
    });
    expect(url).toContain("dates=20260619T093000Z%2F20260619T100000Z");
    expect(url).toContain("&add=a%40x.ai&add=b%40y.com");
  });
});
