import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, waitFor, configure } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthContext, type AuthUser } from "../../src/client/auth/AuthProvider";
import { DashboardPage, juryBucket } from "../../src/client/routes/DashboardPage";
import { EvaluationDrawer } from "../../src/client/components/EvaluationDrawer";
import type { DeckView } from "../../src/client/types";
import type { Role } from "../../src/shared/roles";
import * as api from "../../src/client/api";

/**
 * W7-A — All decks (`panel-alldecks.html` + `adRenderTable()` / the jury build's
 * `mpRender()`) and the deck report overlay (`openReport()`).
 *
 * The header sets below are LITERALS copied from the prototype renderers, not
 * imported from the screen, so a column silently renamed in the screen fails
 * here — which is the failure this wave exists to end.
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
    getConfigSummary: vi.fn(),
    listPrograms: vi.fn(),
    listDeckTags: vi.fn(),
    setDeckTags: vi.fn(),
    listActivity: vi.fn(),
    retryDeckAi: vi.fn(),
    updateThresholds: vi.fn(),
  };
});

const SU_DETAILS = ["Startup", "Founder name", "Email ID", "Phone number", "City", "Sector", "Status"];
const SU_EVALUATED = ["Startup", "AI score", "Parameter scores"];
const SU_ASSIGNED = ["Startup", "Status", "AI score", "Parameter scores", "Assigned to", "Assigned date", "Due date"];
const SU_SHORTLISTED = ["Startup", "AI score", "Jury score", "Avg. score", "Addl. Parameter scores"];
const JURY_OPEN = ["Startup", "Status", "AI score", "Assigned by", "Assigned date", "Due date"];
const JURY_SUBMITTED = ["Startup", "AI Score", "My Score", "Av. Score", "Submitted to", "Submitted date", "By Due date"];

const DECKS: DeckView[] = [
  {
    id: "d_fin",
    name: "FinStack",
    sector: "B2B Fintech",
    stage: "Seed",
    city: "Hyderabad",
    founder: "Ananya Reddy",
    founderEmail: "ananya@finstack.in",
    founderPhone: "+91 98450 11111",
    missingFields: [],
    statusId: "assigned",
    status: "Assigned",
    aiScore: 7.2,
    assignedTo: "u_jury",
    assignedToName: "Rajesh K.",
    assignedAt: "2026-06-02T09:00:00Z",
  },
  {
    id: "d_pay",
    name: "PayRoute",
    sector: "Payments",
    stage: "Idea",
    founder: "Kabir Shah",
    founderEmail: "kabir@payroute.in",
    missingFields: ["founderPhone", "city"],
    statusId: "incomplete",
    status: "Incomplete",
  },
  {
    id: "d_green",
    name: "GreenRoute",
    sector: "Climatetech",
    stage: "Pre-seed",
    city: "Hyderabad",
    founder: "Sunita R.",
    founderEmail: "s@greenroute.in",
    founderPhone: "+91 90000 00000",
    missingFields: [],
    statusId: "shortlisted",
    status: "Shortlisted",
    aiScore: 9.1,
    juryScore: 8.1,
    decisionScore: 8.5,
    assignedTo: "u_jury",
    assignedToName: "Rajesh K.",
    assigneeSubmitted: true,
  },
  {
    id: "d_wealth",
    name: "WealthOS",
    sector: "Wealthtech",
    founder: "Diya K.",
    founderEmail: "d@wealthos.app",
    founderPhone: "+91 91678 40023",
    city: "Pune",
    missingFields: [],
    statusId: "pending_ai",
    status: "Pending AI",
  },
  {
    id: "d_insure",
    name: "InsureFlow",
    sector: "Insurtech",
    founder: "Arjun P.",
    founderEmail: "a@insureflow.in",
    founderPhone: "+91 99999 99999",
    city: "Bengaluru",
    missingFields: [],
    statusId: "jury_evaluation",
    status: "Jury Evaluation",
    aiScore: 8.3,
    assignedTo: "u_other",
    assignedToName: "Meera S.",
  },
];

const PROGRAMS = {
  sectors: [],
  programs: [
    {
      id: "p_climate",
      name: "Climate Cohort",
      active: true,
      cohorts: [
        { id: "c5", programId: "p_climate", name: "Cohort 5", active: true, startsOn: "2025-01-01", endsOn: "2025-06-30" },
        { id: "c6", programId: "p_climate", name: "Cohort 6", active: true, startsOn: "2025-07-01", endsOn: "2025-12-31" },
      ],
    },
    { id: "p_saas", name: "SaaS Studio", active: true, cohorts: [] },
  ],
};

const AI_SCORES = [
  { key: "traction", label: "Traction & Validation", weight: 60, value: 8, comment: "Strong month-on-month growth." },
  { key: "team", label: "Team & Execution", weight: 40, value: 6 },
  // An informational role parameter: scored by the AI, but not in the composite.
  { key: "program_fit", label: "Program fit", weight: 0, value: 7 },
];

function principal(role: Role, id: string): AuthUser {
  // The task ids `/api/auth/me` resolves; `adminconsole` is what the threshold
  // editor is gated on, exactly as `PUT /api/config/thresholds` is.
  const permissions = ["alldecks", "evaluate", ...(role === "superuser" || role === "admin" ? ["adminconsole"] : [])];
  return { id, name: "Test User", initials: "TU", role, edition: "incubator", permissions };
}

function mount(role: Role = "superuser", id = "u_super") {
  return render(
    <MemoryRouter>
      <AuthContext.Provider
        value={{ user: principal(role, id), loading: false, login: vi.fn(), logout: vi.fn(), updateUser: vi.fn() }}
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

function tile(label: string) {
  // A KpiTile's accessible name runs label, value and sub-label together.
  return screen.getByRole("button", { name: new RegExp(`^${label}\\s*\\d`) });
}

const realFetch = globalThis.fetch;

beforeEach(() => {
  localStorage.clear();
  // DeckPdfViewer fetches the PDF itself; nothing is stored in these tests.
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 })) as typeof fetch;
  vi.mocked(api.listDecks).mockResolvedValue({ decks: DECKS });
  vi.mocked(api.listPrograms).mockResolvedValue(PROGRAMS as unknown as api.ProgramsResponse);
  vi.mocked(api.getConfigSummary).mockResolvedValue({
    thresholdBest: 7,
    thresholdMediocre: 5,
  } as unknown as api.ConfigSummary);
  vi.mocked(api.listDeckTags).mockResolvedValue({ tags: [] });
  vi.mocked(api.listActivity).mockResolvedValue({ events: [] });
  vi.mocked(api.getDeck).mockImplementation(async (id: string) => ({
    deck: DECKS.find((d) => d.id === id)!,
    extraction: [],
    scores: AI_SCORES,
    versions: [],
    verdict: "Advanced — AI gate passed",
    weightedTotal: 7.2,
  }));
  vi.mocked(api.getDeckReport).mockImplementation(async (id: string): Promise<api.DeckReportMatrix> => ({
    deck: DECKS.find((d) => d.id === id)!,
    columns: [
      { id: "ai", kind: "ai", name: "AI", rank: 0 },
      { id: "u_super", kind: "human", name: "Test User", rank: 1, total: 7.4, submittedAt: "2026-06-06T10:00:00Z" },
      { id: "u_jury", kind: "human", name: "Rajesh", rank: 2, total: 8.3, submittedAt: "2026-06-09T10:00:00Z" },
    ],
    core: [
      { key: "traction", name: "Traction & Validation", weight: 60, cells: { ai: { value: 8 }, u_super: { value: 7, comment: "Pilots, not revenue." } } },
      { key: "team", name: "Team & Execution", weight: 40, cells: { ai: { value: 6 } } },
    ],
    additional: [],
    hiddenEvaluators: 0,
  }));
  vi.mocked(api.updateThresholds).mockResolvedValue({ ok: true, thresholdBest: 8, thresholdMediocre: 6 });
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.clearAllMocks();
});

describe("All decks — staff table", () => {
  it("renders the founder-details header set by default, with the intake status vocabulary", async () => {
    mount();
    // Gate on a populated row, never on the heading the loading state also draws.
    await screen.findByRole("button", { name: "FinStack" });
    expect(headers()).toEqual(SU_DETAILS);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("All decks");
    expect(screen.getByText("5 submissions · Updated just now")).toBeInTheDocument();

    // Status means intake completeness here, not the pipeline stage (F0236/F0241).
    const payRow = screen.getByRole("button", { name: "PayRoute" }).closest("tr")!;
    expect(within(payRow.lastElementChild as HTMLElement).getByText("Incomplete")).toBeInTheDocument();
    expect(within(payRow).getAllByText("not captured")).toHaveLength(2);
    const finRow = screen.getByRole("button", { name: "FinStack" }).closest("tr")!;
    expect(within(finRow.lastElementChild as HTMLElement).getByText("Complete")).toBeInTheDocument();
    expect(within(finRow).queryByText("not captured")).toBeNull();
    // The name is the report link, titled as the prototype titles it.
    expect(screen.getByRole("button", { name: "FinStack" })).toHaveAttribute("title", "Open deck & evaluation report");
  });

  it("uses the prototype's stat-box copy", async () => {
    mount();
    await screen.findByRole("button", { name: "FinStack" });
    expect(
      screen.getAllByRole("button", { pressed: false }).concat(screen.getAllByRole("button", { pressed: true }))
        .map((b) => b.querySelector(".u-label")?.textContent)
        .filter(Boolean),
    ).toEqual(expect.arrayContaining(["Uploaded", "Pending", "Incomplete", "AI Evaluated", "Assigned", "Shortlisted"]));
    expect(tile("Uploaded")).toHaveTextContent("since yesterday");
    expect(tile("Incomplete")).toHaveTextContent("Missing slides");
  });

  it("re-shapes the table per stat box and narrows the rows (F0192)", async () => {
    mount();
    await screen.findByRole("button", { name: "FinStack" });

    fireEvent.click(tile("AI Evaluated"));
    expect(headers()).toEqual(SU_EVALUATED);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("AI Evaluated");
    expect(screen.queryByRole("button", { name: "PayRoute" })).toBeNull();
    expect(screen.getByText("3 submissions · Updated just now")).toBeInTheDocument();
    // The sparkline column loads each row's breakdown.
    await waitFor(() => expect(api.getDeck).toHaveBeenCalledWith("d_fin"));

    fireEvent.click(tile("Assigned"));
    expect(headers()).toEqual(SU_ASSIGNED);
    const fin = screen.getByRole("button", { name: "FinStack" }).closest("tr")!;
    expect(within(fin).getByText("Assigned")).toBeInTheDocument();
    expect(within(fin).getByText("Rajesh K.")).toBeInTheDocument();
    expect(within(fin).getByText("2 Jun 2026")).toBeInTheDocument();
    const green = screen.getByRole("button", { name: "GreenRoute" }).closest("tr")!;
    expect(within(green).getByText("Shortlisted")).toBeInTheDocument();

    fireEvent.click(tile("Shortlisted"));
    expect(headers()).toEqual(SU_SHORTLISTED);
    expect(screen.getAllByRole("button", { name: /^View scores/ })).toHaveLength(1);
    const row = screen.getByRole("button", { name: "GreenRoute" }).closest("tr")!;
    expect(within(row).getByText("8.1")).toBeInTheDocument(); // jury
    expect(within(row).getByText("8.5")).toBeInTheDocument(); // decision score
  });

  it("the parameter popover lists only the composite parameters", async () => {
    mount();
    await screen.findByRole("button", { name: "FinStack" });
    fireEvent.click(tile("AI Evaluated"));
    const spark = await screen.findByRole("button", { name: "Parameter scores — FinStack" });
    fireEvent.click(spark);
    const pop = await screen.findByRole("dialog", { name: "AI parameter scores — FinStack" });
    await within(pop).findByText("Traction & Validation");
    expect(within(pop).getByText(/AI scores across all 2 parameters/)).toBeInTheDocument();
    expect(within(pop).queryByText("Program fit")).toBeNull();
  });

  it("the Program menu filters the request and titles the screen (F0238)", async () => {
    mount();
    await screen.findByRole("button", { name: "FinStack" });
    fireEvent.click(screen.getByRole("button", { name: "Program filter" }));
    const list = screen.getByRole("listbox", { name: "Programs" });
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "All Programs",
      "Climate Cohort",
      "SaaS Studio",
    ]);
    fireEvent.click(within(list).getByRole("option", { name: "Climate Cohort" }));
    await waitFor(() =>
      expect(api.listDecks).toHaveBeenLastCalledWith(expect.objectContaining({ programId: "p_climate" })),
    );
    await screen.findByRole("button", { name: "FinStack" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("All decks — Climate Cohort");
    expect(screen.getByRole("button", { name: "Program filter" })).toHaveTextContent("Climate Cohort");
  });

  it("the Cohort menu works without a program and marks the current cohort (F0240)", async () => {
    mount();
    await screen.findByRole("button", { name: "FinStack" });
    const cohort = screen.getByRole("button", { name: "Cohort filter" });
    expect(cohort).not.toBeDisabled();
    fireEvent.click(cohort);
    const list = screen.getByRole("listbox", { name: "Cohorts" });
    // Every programme's cohorts, each named with its programme, the running one
    // flagged — the prototype's "Cohort 7 · Current".
    const options = within(list).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "All Cohorts",
      "Cohort 5 · Climate Cohort",
      "Cohort 6 · Current · Climate Cohort",
    ]);
    fireEvent.click(options[2]);
    await waitFor(() =>
      expect(api.listDecks).toHaveBeenLastCalledWith(
        expect.objectContaining({ programId: "p_climate", cohortId: "c6" }),
      ),
    );
    await screen.findByRole("button", { name: "FinStack" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("All decks — Climate Cohort, Cohort 6");
  });

  it("empty state: a workspace with no decks", async () => {
    vi.mocked(api.listDecks).mockResolvedValue({ decks: [] });
    mount();
    expect(await screen.findByText("No decks yet")).toBeInTheDocument();
    expect(document.querySelector("table[data-shape]")).toBeNull();
  });

  it("empty state: a view the filters leave empty keeps its headers", async () => {
    vi.mocked(api.listDecks).mockResolvedValue({ decks: [DECKS[1]] }); // PayRoute only
    mount();
    await screen.findByRole("button", { name: "PayRoute" });
    fireEvent.click(tile("Shortlisted"));
    expect(headers()).toEqual(SU_SHORTLISTED);
    expect(screen.getByText("No decks in this view for the selected filters.")).toBeInTheDocument();
    expect(screen.getByText("0 submissions · Updated just now")).toBeInTheDocument();
  });

  it("the rail carries the three sections, and only admins may edit the thresholds (F0237)", async () => {
    mount("superuser");
    await screen.findByRole("button", { name: "FinStack" });
    for (const title of ["Pipeline progress", "Cohort rating thresholds", "Activity log"]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    fireEvent.change(screen.getByLabelText("Best threshold"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Mediocre threshold"), { target: { value: "6" } });
    expect(screen.getByText("6.0 – 7.9")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save & apply to all evaluators" }));
    await waitFor(() => expect(api.updateThresholds).toHaveBeenCalledWith(8, 6));
    expect(await screen.findByText("Applied to all evaluators")).toBeInTheDocument();
  });

  it("a Program Manager sees the thresholds read-only", async () => {
    mount("program_manager", "u_pm");
    await screen.findByRole("button", { name: "FinStack" });
    expect(screen.getByText("5.0 – 6.9")).toBeInTheDocument();
    expect(screen.queryByLabelText("Best threshold")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save & apply to all evaluators" })).toBeNull();
  });
});

describe("All decks — the jury's My Pipeline (F0189)", () => {
  it("shows five first-person tiles, only the viewer's decks, and a progress-only rail", async () => {
    mount("jury", "u_jury");
    await screen.findByRole("button", { name: "FinStack" });
    const labels = [...document.querySelectorAll("button[aria-pressed] .u-label")].map((l) => l.textContent);
    expect(labels).toEqual(["Assigned", "Evaluated", "Drafts", "Pending Evaluation", "Submitted"]);
    expect(headers()).toEqual(JURY_OPEN);
    // InsureFlow is allocated to someone else; PayRoute to nobody.
    expect(screen.queryByRole("button", { name: "InsureFlow" })).toBeNull();
    expect(screen.queryByRole("button", { name: "PayRoute" })).toBeNull();
    const fin = screen.getByRole("button", { name: "FinStack" }).closest("tr")!;
    expect(within(fin).getByText("Assigned")).toBeInTheDocument();
    expect(screen.getByText("Pipeline progress")).toBeInTheDocument();
    expect(screen.queryByText("Cohort rating thresholds")).toBeNull();
    expect(screen.queryByText("Activity log")).toBeNull();
    expect(screen.getByText("1 deck · Updated just now")).toBeInTheDocument();
  });

  it("the Submitted view has its own columns and the viewer's own score", async () => {
    mount("jury", "u_jury");
    await screen.findByRole("button", { name: "FinStack" });
    fireEvent.click(tile("Submitted"));
    expect(headers()).toEqual(JURY_SUBMITTED);
    const row = screen.getByRole("button", { name: "GreenRoute" }).closest("tr")!;
    expect(await within(row).findByText("8.3")).toBeInTheDocument(); // my total
    expect(within(row).getByText("9 Jun 2026")).toBeInTheDocument(); // my submitted date
  });

  it("Drafts is an empty view with the prototype's message", async () => {
    mount("jury", "u_jury");
    await screen.findByRole("button", { name: "FinStack" });
    fireEvent.click(tile("Drafts"));
    expect(headers()).toEqual(JURY_OPEN);
    expect(screen.getByText("No decks in this view for the selected filters.")).toBeInTheDocument();
  });

  it("empty state: nothing allocated to this jury member", async () => {
    vi.mocked(api.listDecks).mockResolvedValue({ decks: [DECKS[1], DECKS[4]] });
    mount("jury", "u_jury");
    expect(await screen.findByText("No decks have been assigned to you yet")).toBeInTheDocument();
  });

  it("buckets are disjoint and follow submission and stage", () => {
    expect(juryBucket({ id: "a", name: "a", statusId: "assigned" })).toBe("assigned");
    expect(juryBucket({ id: "b", name: "b", statusId: "jury_evaluation" })).toBe("pending");
    expect(juryBucket({ id: "c", name: "c", statusId: "jury_evaluation", assigneeSubmitted: true })).toBe("evaluated");
    expect(juryBucket({ id: "d", name: "d", statusId: "shortlisted", assigneeSubmitted: true })).toBe("submitted");
  });
});

describe("The deck report overlay (F0196 / F0235)", () => {
  it("opens from the startup name with the prototype's sections, in order", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "FinStack" }));
    const dialog = await screen.findByRole("dialog", { name: "Evaluation report — FinStack" });
    await within(dialog).findByText("Traction & Validation");

    const order = [
      "Evaluate — FinStack",
      "ai·STARTUPJURY · Evaluation report",
      "AI Score",
      "My Score",
      "Overall AI remarks",
      "Parameter evaluation",
      "My parameters evaluation",
      "Intro call remarks",
    ];
    const text = dialog.textContent ?? "";
    const positions = order.map((s) => text.indexOf(s));
    expect(positions.every((p) => p >= 0), `all present: ${JSON.stringify(positions)}`).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);

    // Parameter · Weight · AI · My score, the composite only.
    const table = within(dialog).getAllByRole("table")[0];
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent).filter(Boolean)).toEqual([
      "Parameter",
      "Weight",
      "AI",
      "My score",
    ]);
    expect(within(dialog).queryByText("Program fit")).toBeNull();
    expect(within(dialog).getByText("Weighted total")).toBeInTheDocument();
    expect(within(dialog).getByText("Research")).toBeInTheDocument();
    // My score comes from the viewer's column in the consolidated report.
    expect(await within(dialog).findByText("1 of 2 parameters scored")).toBeInTheDocument();

    // A row expands to the AI remark and the viewer's own.
    fireEvent.click(within(table).getByText("Traction & Validation"));
    expect(within(dialog).getByText("Strong month-on-month growth.")).toBeInTheDocument();
    expect(within(dialog).getByText("Pilots, not revenue.")).toBeInTheDocument();
  });
});

describe("EvaluationDrawer empty states", () => {
  it("says so for every section a fresh deck has nothing in", () => {
    render(
      <EvaluationDrawer open onClose={() => {}} deck={{ id: "x", name: "Fresh Co" }} />,
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("The AI has not written an overall remark for this deck yet.")).toBeInTheDocument();
    expect(within(dialog).getByText("This deck has not been scored yet.")).toBeInTheDocument();
    expect(within(dialog).getByText(/These auto-fill from the role/)).toBeInTheDocument();
    expect(within(dialog).getByText("No intro call remarks yet.")).toBeInTheDocument();
    expect(within(dialog).getByText("0 of 0 parameters scored")).toBeInTheDocument();
  });

  it("explains a blind-scoring withholding rather than showing an empty table", () => {
    render(
      <EvaluationDrawer open onClose={() => {}} deck={{ id: "x", name: "Blind Co" }} aiScoreWithheld />,
    );
    expect(screen.getByText(/Blind scoring is on/)).toBeInTheDocument();
    expect(screen.getByText("Hidden until you submit your own evaluation")).toBeInTheDocument();
  });
});
