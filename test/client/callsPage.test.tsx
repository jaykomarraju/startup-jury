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
}

function mockApi({ calls = [call({})], canSchedule = true, prompts = { enabled: false, prompts: [] } }: Mock) {
  const seen: { url: string; method: string }[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, method: init?.method ?? "GET" });
    let body: unknown = {};
    if (url === "/api/decks") body = { decks: DECKS };
    else if (url.startsWith("/api/calls/directory")) {
      body = {
        people: [
          { id: "inc_pm", name: "Raj Kumar", email: "raj@x.ai", role: "program_manager" },
          { id: "inc_pa", name: "Sunita Rao", email: "sunita@x.ai", role: "program_associate" },
          { id: "inc_jury", name: "Rajesh Kumar", email: "rajesh@x.ai", role: "jury" },
        ],
      };
    } else if (/\/api\/calls\/[^/]+\/prompts$/.test(url)) body = prompts;
    else if (url.startsWith("/api/calls")) body = { calls, canSchedule, kinds: ["intro"] };
    else if (/\/api\/decks\/[^/]+\/report$/.test(url)) body = matrix(url.split("/")[3]!);
    else if (/\/api\/decks\/[^/]+\/versions$/.test(url)) body = { versions: [] };
    else if (url.startsWith("/api/decks/")) {
      body = { deck: DECKS[0], scores: [], extraction: [{ label: "Cover", text: "EV logistics." }], versions: [] };
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return seen;
}

function mount(config: CallsConfig, role: Role, id: string) {
  const user: AuthUser = { id, name: "Test", initials: "TT", role, edition: "incubator" };
  return render(
    <AuthContext.Provider value={{ user, loading: false, login: vi.fn(), logout: vi.fn(), updateUser: vi.fn() }}>
      <MemoryRouter initialEntries={["/app/introcalls"]}>
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
      "Scheduler",
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
      "Program Manager",
      "Program Associate",
      "Jury Member",
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

describe("a call screen that declares none of the extension (VC, until W9-E)", () => {
  it("has no Filter, Export, legend, score stack or pane — and the name still opens the drawer", async () => {
    mockApi({});
    const bare: CallsConfig = { ...VC_CALLS_CONFIG.introcalls, statuses: ["shortlisted", "intro"] };
    mount(bare, "program_manager", "inc_pm");
    await screen.findByRole("row", { name: /AgroFresh/ });
    expect(screen.queryByRole("button", { name: /^Filter/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("stage-legend")).not.toBeInTheDocument();
    expect(screen.queryByTestId("jury-score-stack")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "GreenRoute" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByTestId("stage-pane")).not.toBeInTheDocument();
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
