import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, waitFor, configure } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthContext, type AuthUser } from "../../src/client/auth/AuthProvider";
import { DashboardPage, icStageCells, vcOnboardChips, vcStagePill } from "../../src/client/routes/DashboardPage";
import type { DeckView } from "../../src/client/types";
import type { Role } from "../../src/shared/roles";
import * as api from "../../src/client/api";

/**
 * W9-A — All decks on the VC edition: `AISJ_VC_Superuser_V8` `adRenderTable()`
 * (the Admin, Partner, Associate and Analyst builds are md5-identical) and the
 * IC member's "Awaiting my vote" build (`AISJ_VC_IC_member_V2`).
 *
 * Header sets are LITERALS copied from the prototype renderers, not imported
 * from the screen, so a renamed column fails here.
 */

configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 30_000 });

vi.mock("../../src/client/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/client/api")>();
  return {
    ...actual,
    listDecks: vi.fn(),
    getDeck: vi.fn(),
    getDeckReport: vi.fn(),
    getDeckEvents: vi.fn(),
    listIcVotes: vi.fn(),
    getConfigSummary: vi.fn(),
    listPrograms: vi.fn(),
    listDeckTags: vi.fn(),
    listActivity: vi.fn(),
  };
});

const VC_UPLOADED = ["Startup", "Sector", "City", "AI score", "Stage", "Submitted"];
const VC_INCOMPLETE = ["Startup", "Founder name", "Email ID", "Phone number", "City", "Status"];
const VC_EVALUATED = ["Startup", "AI score", "Parameter scores"];
const VC_DILIGENCE = ["Startup", "Sector", "AI score", "Diligence progress", "Flags", "Lead"];
const VC_IC_READY = ["Startup", "AI score", "Avg. score", "Ask", "Valuation", "Recommendation"];
const VC_ONBOARD = ["Startup", "AI score", "Term sheet", "Legal DD", "Onboarding"];
const IC_AT_IC = ["Startup", "Sector", "AI score", "Stage in IC", "My status"];
const IC_MY_VOTE = ["Startup", "Sector", "AI score", "IC avg", "Ask", "My vote"];
const IC_MY_EVAL = ["Startup", "AI score", "My score", "My recommendation", "IC outcome"];
const IC_AGENDA = ["#", "Startup", "Sector", "AI score", "Sponsor", "Ask"];
const IC_PIPELINE = ["Startup", "Cleared", "Stage", "Status", "Ask", "Owner"];
const IC_FUNDED = ["Startup", "Final check", "Round", "Close date", "Ownership"];

function deck(id: string, name: string, statusId: string, status: string, extra: Partial<DeckView> = {}): DeckView {
  return {
    id,
    name,
    sector: "Fintech",
    stage: "Seed",
    city: "Mumbai",
    founder: "A Founder",
    founderEmail: "a@example.com",
    founderPhone: "+91 90000 00000",
    missingFields: [],
    statusId,
    status,
    aiScore: 7.5,
    uploadedAt: "2026-06-02T09:00:00Z",
    ...extra,
  };
}

const DECKS: DeckView[] = [
  deck("d_north", "Northbeam Robotics", "incomplete", "incomplete", {
    aiScore: undefined,
    founderPhone: undefined,
    city: undefined,
    missingFields: ["founderPhone", "city"],
  }),
  deck("d_wealth", "WealthOS", "associate_review", "Associate Review", { aiScore: 8.06 }),
  deck("d_solar", "SolarNest", "investment_dd", "Investment DD", { aiScore: 7.9 }),
  deck("d_credit", "CreditBridge", "ic_review", "IC Review", { aiScore: 7.5, decisionScore: 7.2, juryScore: 6.9 }),
  deck("d_dock", "DockFlow", "mp_decision", "Managing Partner Decision", { aiScore: 8.2 }),
  deck("d_fresh", "FreshCart", "term_sheet", "Term Sheet", { aiScore: 7.7 }),
  deck("d_quant", "QuantIQ", "onboard_ready", "Onboard Ready", { aiScore: 9, curationStage: "Orientation", stage: "Series A" }),
  deck("d_pet", "PetPal", "archived", "Archived", { aiScore: 5.4 }),
];

const EVENTS: api.PipelineEvent[] = [
  {
    id: "e2",
    fromStage: "mp_decision",
    fromLabel: "Managing Partner Decision",
    toStage: "alignment_call",
    toLabel: "Alignment Call",
    action: "invest",
    note: null,
    actorName: "Aarav Khanna",
    createdAt: "2026-06-20T10:00:00Z",
  },
  {
    id: "e1",
    fromStage: "partner_call",
    fromLabel: "Partner Call",
    toStage: "investment_dd",
    toLabel: "Investment DD",
    action: "sponsor_to_ic",
    note: null,
    actorName: "Ishaan Sethi",
    createdAt: "2026-06-01T10:00:00Z",
  },
];

function votes(myVote: api.IcVoteValue | null, recommendation: api.IcVoteValue | null = myVote): api.IcVotes {
  return {
    votes: [],
    tally: { invest: 0, hold: 0, need_more_info: 0, pass: 0 },
    total: recommendation ? 2 : 0,
    recommendation,
    myVote,
  };
}

function principal(role: Role, permissions: string[]): AuthUser {
  return { id: `u_${role}`, name: "Test User", initials: "TU", role, edition: "vc", permissions };
}

function mount(role: Role, permissions = ["alldecks", "evaluate", "icpipeline"]) {
  return render(
    <MemoryRouter>
      <AuthContext.Provider
        value={{ user: principal(role, permissions), loading: false, login: vi.fn(), logout: vi.fn(), updateUser: vi.fn() }}
      >
        <DashboardPage />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

function headers(): string[] {
  const table = document.querySelector("table[data-shape]");
  expect(table, "the decks table is on screen").not.toBeNull();
  return within(table as HTMLElement)
    .getAllByRole("columnheader")
    .map((h) => h.textContent ?? "");
}

function tileLabels(): string[] {
  return [...document.querySelectorAll("button[aria-pressed] .u-label")].map((l) => l.textContent ?? "");
}

function tile(label: string) {
  return screen.getByRole("button", { name: new RegExp(`^${label}\\s*\\d`) });
}

function rowOf(name: string) {
  return screen.getByRole("button", { name }).closest("tr")!;
}

const realFetch = globalThis.fetch;

beforeEach(() => {
  localStorage.clear();
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 })) as typeof fetch;
  vi.mocked(api.listDecks).mockResolvedValue({ decks: DECKS });
  vi.mocked(api.listPrograms).mockResolvedValue({ sectors: [], programs: [] } as unknown as api.ProgramsResponse);
  vi.mocked(api.getConfigSummary).mockResolvedValue({ thresholdBest: 7, thresholdMediocre: 5 } as unknown as api.ConfigSummary);
  vi.mocked(api.listDeckTags).mockResolvedValue({ tags: [] });
  vi.mocked(api.listActivity).mockResolvedValue({ events: [] });
  vi.mocked(api.getDeckEvents).mockResolvedValue({ events: EVENTS });
  vi.mocked(api.getDeck).mockImplementation(async (id: string) => ({
    deck: DECKS.find((d) => d.id === id)!,
    extraction: [],
    scores: [{ key: "traction", label: "Traction & Validation", weight: 100, value: 8 }],
    versions: [],
    weightedTotal: 8,
  }));
  vi.mocked(api.getDeckReport).mockImplementation(async (id: string): Promise<api.DeckReportMatrix> => ({
    deck: DECKS.find((d) => d.id === id)!,
    columns: [
      { id: "ai", kind: "ai", name: "AI", rank: 0 },
      { id: "u_ic_member", kind: "human", name: "Test User", rank: 4, total: 8.4, submittedAt: "2026-06-06T10:00:00Z" },
    ],
    core: [],
    additional: [],
    hiddenEvaluators: 0,
  }));
  vi.mocked(api.listIcVotes).mockImplementation(async (id: string) => {
    if (id === "d_credit") return votes(null, "hold");
    if (id === "d_dock") return votes("invest");
    if (id === "d_quant") return votes("invest");
    return votes(null, null);
  });
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.clearAllMocks();
});

describe("VC All decks — staff (F0433 / F0437 / F0438 / F0440)", () => {
  it("draws the VC boxes and opens on Uploaded's table, AI score included", async () => {
    mount("partner");
    await screen.findByRole("button", { name: "WealthOS" });
    expect(tileLabels()).toEqual(["Uploaded", "Incomplete", "AI Evaluated", "In Diligence", "IC ready", "Onboard ready"]);
    expect(headers()).toEqual(VC_UPLOADED);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("All decks");
    expect(screen.getByText("8 submissions · Updated just now")).toBeInTheDocument();
    expect(tile("Incomplete")).toHaveTextContent("Missing materials");
    expect(tile("In Diligence")).toHaveTextContent("Active diligence");
    // The deal-stage vocabulary, not the cohort one — with the real stage on hover.
    const solar = rowOf("SolarNest");
    expect(within(solar).getByText("In Diligence")).toBeInTheDocument();
    expect(within(solar).getByText("7.9")).toBeInTheDocument();
    expect(within(solar).getByTitle("Investment DD")).toBeInTheDocument();
    expect(within(rowOf("FreshCart")).getByText("Onboard ready")).toBeInTheDocument();
    expect(within(rowOf("DockFlow")).getByText("IC ready")).toBeInTheDocument();
    expect(within(rowOf("WealthOS")).getByText("AI Evaluated")).toBeInTheDocument();
    expect(within(rowOf("Northbeam Robotics")).getByText("Incomplete")).toBeInTheDocument();
    expect(within(rowOf("PetPal")).getByText("Archived")).toBeInTheDocument();
    for (const word of ["Shortlisted", "Assigned", "Pending"]) expect(screen.queryByText(word)).toBeNull();
  });

  it("each box is its own table over a funnel of rows", async () => {
    mount("superuser", ["alldecks", "evaluate", "icpipeline", "adminconsole"]);
    await screen.findByRole("button", { name: "WealthOS" });

    fireEvent.click(tile("Incomplete"));
    expect(headers()).toEqual(VC_INCOMPLETE);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Incomplete");
    expect(within(rowOf("Northbeam Robotics")).getAllByText("not captured")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "WealthOS" })).toBeNull();

    fireEvent.click(tile("AI Evaluated"));
    expect(headers()).toEqual(VC_EVALUATED);
    expect(screen.getByText("7 submissions · Updated just now")).toBeInTheDocument();
    await screen.findByRole("button", { name: "Parameter scores — WealthOS" });

    fireEvent.click(tile("In Diligence"));
    expect(headers()).toEqual(VC_DILIGENCE);
    expect(screen.getByText("5 submissions · Updated just now")).toBeInTheDocument();
    expect(within(rowOf("SolarNest")).getByText("In progress")).toBeInTheDocument();
    expect(within(rowOf("DockFlow")).getByText("100%")).toBeInTheDocument();
    // Lead is the partner who sponsored the deal to IC.
    expect(await within(rowOf("SolarNest")).findByText("Ishaan Sethi")).toBeInTheDocument();

    fireEvent.click(tile("IC ready"));
    expect(headers()).toEqual(VC_IC_READY);
    expect(within(rowOf("CreditBridge")).getByText("7.2")).toBeInTheDocument();
    expect(await within(rowOf("CreditBridge")).findByText("Hold")).toBeInTheDocument();
    expect(await within(rowOf("FreshCart")).findByText("No votes yet")).toBeInTheDocument();

    fireEvent.click(tile("Onboard ready"));
    expect(headers()).toEqual(VC_ONBOARD);
    expect(screen.queryByRole("button", { name: "DockFlow" })).toBeNull();
    const fresh = rowOf("FreshCart");
    expect(within(fresh).getByText("Issued")).toBeInTheDocument();
    expect(within(fresh).getByText("Awaiting signature")).toBeInTheDocument();
    const quant = rowOf("QuantIQ");
    expect(within(quant).getByText("Signed")).toBeInTheDocument();
    expect(within(quant).getByText("Cleared")).toBeInTheDocument();
    expect(within(quant).getByText("Orientation")).toBeInTheDocument();
  });

  it("an analyst never reads committee ballots — the Recommendation cell stays blank", async () => {
    mount("analyst", ["alldecks", "evaluate"]);
    await screen.findByRole("button", { name: "WealthOS" });
    fireEvent.click(tile("IC ready"));
    expect(headers()).toEqual(VC_IC_READY);
    await waitFor(() => expect(rowOf("CreditBridge").lastElementChild).toHaveTextContent("—"));
    expect(api.listIcVotes).not.toHaveBeenCalled();
  });

  it("empty state: a fund with no deals", async () => {
    vi.mocked(api.listDecks).mockResolvedValue({ decks: [] });
    mount("associate", ["alldecks"]);
    expect(await screen.findByText("No decks yet")).toBeInTheDocument();
    expect(document.querySelector("table[data-shape]")).toBeNull();
  });
});

describe("VC All decks — the IC member's Awaiting my vote (F0434)", () => {
  it("opens on Awaiting my vote over the deals at IC, counted off the member's own ballots", async () => {
    mount("ic_member");
    await screen.findByRole("button", { name: "CreditBridge" });
    expect(tileLabels()).toEqual(["At IC", "Awaiting my vote", "Evaluated by me", "On agenda", "Investment pipeline", "Funded"]);
    expect(headers()).toEqual(IC_MY_VOTE);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Awaiting my vote");
    await waitFor(() => expect(screen.getByText("1 deal at IC · Updated just now")).toBeInTheDocument());
    const credit = rowOf("CreditBridge");
    expect(within(credit).getByText("6.9")).toBeInTheDocument(); // IC avg
    expect(within(credit).getByText("Vote pending")).toBeInTheDocument();
    // Deals short of the committee are not in the member's pool at all.
    expect(screen.queryByRole("button", { name: "WealthOS" })).toBeNull();
    expect(tile("At IC")).toHaveTextContent(/At IC\s*4/);
  });

  it("walks the other five tables", async () => {
    mount("ic_member");
    await screen.findByRole("button", { name: "CreditBridge" });
    await waitFor(() => expect(tile("Evaluated by me")).toHaveTextContent(/Evaluated by me\s*2/));

    fireEvent.click(tile("At IC"));
    expect(headers()).toEqual(IC_AT_IC);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("At IC");
    expect(within(rowOf("CreditBridge")).getByText("Awaiting vote")).toBeInTheDocument();
    expect(within(rowOf("QuantIQ")).getByText("Invested")).toBeInTheDocument();

    fireEvent.click(tile("Evaluated by me"));
    expect(headers()).toEqual(IC_MY_EVAL);
    const dock = rowOf("DockFlow");
    expect(within(dock).getByText("Invest")).toBeInTheDocument();
    expect(within(dock).getByText("Recorded")).toBeInTheDocument();
    expect(await within(dock).findByText("8.4")).toBeInTheDocument();
    expect(within(rowOf("QuantIQ")).getByText("Funded")).toBeInTheDocument();

    fireEvent.click(tile("On agenda"));
    expect(headers()).toEqual(IC_AGENDA);
    expect(await within(rowOf("CreditBridge")).findByText("Ishaan Sethi")).toBeInTheDocument();

    fireEvent.click(tile("Investment pipeline"));
    expect(headers()).toEqual(IC_PIPELINE);
    const fresh = rowOf("FreshCart");
    expect(within(fresh).getByText("Term Sheet")).toBeInTheDocument();
    expect(await within(fresh).findByText("20 Jun 2026")).toBeInTheDocument();

    fireEvent.click(tile("Funded"));
    expect(headers()).toEqual(IC_FUNDED);
    expect(within(rowOf("QuantIQ")).getByText("Series A")).toBeInTheDocument();
  });

  it("empty state: nothing has reached the committee", async () => {
    vi.mocked(api.listDecks).mockResolvedValue({ decks: [DECKS[0], DECKS[1]] });
    mount("ic_member");
    expect(await screen.findByText("No deals have reached the committee yet")).toBeInTheDocument();
  });
});

describe("VC cell vocabulary", () => {
  it("stage pills follow the prototype's .sp classes", () => {
    expect(vcStagePill(DECKS[0])).toEqual({ label: "Incomplete", tone: "red" });
    expect(vcStagePill(DECKS[2])).toEqual({ label: "In Diligence", tone: "amber" });
    expect(vcStagePill(DECKS[3])).toEqual({ label: "IC ready", tone: "blue" });
    expect(vcStagePill(DECKS[6])).toEqual({ label: "Onboard ready", tone: "green" });
  });

  it("the onboarding chips never claim a stage the deal has not reached", () => {
    const align = vcOnboardChips(deck("x", "X", "alignment_call", "Alignment Call"));
    expect(align.termSheet[0]).toBe("Not issued");
    expect(align.legal[0]).toBe("Not started");
    expect(vcOnboardChips(deck("y", "Y", "legal_dd", "Legal DD")).legal[0]).toBe("In progress");
  });

  it("a member who did not vote before the vote closed is not shown a ballot", () => {
    expect(icStageCells(DECKS[4], null).mine[0]).toBe("Did not vote");
    expect(icStageCells(DECKS[3], "pass").mine[0]).toBe("Pass");
  });
});
