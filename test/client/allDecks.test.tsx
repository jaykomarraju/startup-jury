import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, waitFor, configure } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthContext, type AuthUser } from "../../src/client/auth/AuthProvider";
import { DashboardPage, juryBucket } from "../../src/client/routes/DashboardPage";
import { EvaluationDrawer } from "../../src/client/components/EvaluationDrawer";
import type { DeckView } from "../../src/client/types";
import type { Role } from "../../src/shared/roles";
import { canAccessNav, isInSidebar, navItemById } from "../../src/shared/nav";
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
    transitionDeck: vi.fn(),
    updateDeckDetails: vi.fn(),
  };
});

// V3-DASH — the Shortlisted shape's Sign-up status column reads the real
// sign-up records; nothing else on this screen touches the workspace.
vi.mock("../../src/client/routes/SignupWorkspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/client/routes/SignupWorkspace")>();
  return { ...actual, listSignups: vi.fn().mockResolvedValue({ signups: [] }) };
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

/**
 * V3-DASH — the default role here is the ADMIN, not the superuser.
 *
 * `AISJ_SuperuserV3.HTM` reshaped this screen into a Dashboard for the
 * SUPERUSER ONLY; the admin, program-manager, program-associate and jury
 * prototypes were not reshared, so everything below this line is the assertion
 * that their screen did not move. The superuser's new one has its own block at
 * the end of the file.
 */
function mount(role: Role = "admin", id = "u_admin") {
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
      { id: "u_admin", kind: "human", name: "Test User", rank: 1, total: 7.4, submittedAt: "2026-06-06T10:00:00Z" },
      { id: "u_jury", kind: "human", name: "Rajesh", rank: 2, total: 8.3, submittedAt: "2026-06-09T10:00:00Z" },
    ],
    core: [
      { key: "traction", name: "Traction & Validation", weight: 60, cells: { ai: { value: 8 }, u_admin: { value: 7, comment: "Pilots, not revenue." } } },
      { key: "team", name: "Team & Execution", weight: 40, cells: { ai: { value: 6 } } },
    ],
    additional: [],
    hiddenEvaluators: 0,
  }));
  vi.mocked(api.updateThresholds).mockResolvedValue({ ok: true, thresholdBest: 8, thresholdMediocre: 6 });
  vi.mocked(api.transitionDeck).mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof api.transitionDeck>>);
  vi.mocked(api.updateDeckDetails).mockResolvedValue({ ok: true, deck: null });
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
    mount("admin", "u_admin");
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
    // V3-REP: a deck with no AI score at all is not "the AI wrote no narrative"
    // (F0197) — it is `AISJ_SuperuserV3`'s `hideAi`, which names the next step.
    // The F0197 copy still covers an EVALUATED deck with no overall remark; both
    // are pinned in `reportV3.test.tsx`.
    expect(
      within(dialog).getByRole("heading", { name: /^Overall AI remarks/ })!.closest("section")!.textContent,
    ).toMatch(/Not evaluated yet\. Click AI Evaluate on the Evaluate page/);
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

/**
 * V3-DASH — the reshared superuser prototype (`AISJ_SuperuserV3.HTM`).
 *
 * Every literal below is copied from the prototype — the six `.stat-card`s in
 * `panel-alldecks.html`, and the two `thead` strings `_scripts.js`
 * `adRenderTable()` builds — NOT imported from the screen, so renaming a
 * column or a tile in the screen fails here.
 */
const V3_DEFAULT = ["Startup name", "Founder", "Phone", "Email", "City", "AI score", "Status", "Actions"];
const V3_SHORTLISTED = ["Startup name", "AI score", "Avg. score", "Signup status", "Actions"];

/** Hours ago, so the row clock always reads "… ago" whatever day this runs. */
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

/** Six live decks and one archived one — the archived deck is the point. */
const V3_DECKS: DeckView[] = [
  {
    id: "d_fin",
    name: "FinStack",
    sector: "B2B Fintech",
    stage: "Seed",
    city: "Hyderabad",
    founder: "Ananya Reddy",
    founderEmail: "ananya@finstack.in",
    founderPhone: "+91 98450 11111",
    statusId: "ai_evaluated",
    status: "AI Evaluated",
    aiScore: 7.2,
    lastActivityAt: hoursAgo(2),
    actions: [
      // Withheld: it needs an evaluator, and only `POST /decks/:id/assign` sets one.
      { action: "assign_jury", label: "Assign jury", to: "assigned" },
      { action: "reject_ai_gate", label: "Reject (below AI gate)", to: "rejected" },
    ],
  },
  {
    id: "d_green",
    name: "GreenRoute",
    sector: "Climatetech",
    city: "Hyderabad",
    founder: "Sunita R.",
    founderEmail: "s@greenroute.in",
    founderPhone: "+91 90000 00000",
    statusId: "shortlisted",
    status: "Shortlisted",
    aiScore: 9.1,
    decisionScore: 8.8,
    queried: true,
    lastActivityAt: hoursAgo(1),
    actions: [{ action: "schedule_intro", label: "Schedule intro call", to: "intro" }],
  },
  {
    id: "d_pay",
    name: "PayRoute",
    sector: "Payments",
    founder: "Kabir Shah",
    statusId: "incomplete",
    status: "Incomplete",
    lastActivityAt: hoursAgo(26),
  },
  { id: "d_wealth", name: "WealthOS", statusId: "pending_ai", status: "Pending AI", lastActivityAt: hoursAgo(50) },
  { id: "d_tax", name: "TaxPilot", statusId: "uploaded", status: "Uploaded", lastActivityAt: hoursAgo(74) },
  { id: "d_credit", name: "CreditBridge", statusId: "manual_review", status: "Manual Review", lastActivityAt: hoursAgo(98) },
  // Archived, AND carrying an AI score — so a tile that forgets to exclude it
  // shows up as a wrong number, not as a missing row.
  {
    id: "d_dormant",
    name: "DormantAI",
    statusId: "archived",
    status: "Archived",
    aiScore: 5.2,
    lastActivityAt: hoursAgo(600),
  },
];

function v3Tiles(): { label: string; value: string }[] {
  return [...document.querySelectorAll("button[aria-pressed]")].map((b) => ({
    label: b.querySelector(".u-label")?.textContent ?? "",
    value: b.querySelector(".font-mono")?.textContent ?? "",
  }));
}

describe("V3 — the superuser Dashboard", () => {
  beforeEach(() => {
    vi.mocked(api.listDecks).mockResolvedValue({ decks: V3_DECKS });
  });

  it("is titled Dashboard and draws the v3 six, in order, with the static sub-labels", async () => {
    mount("superuser", "u_super");
    await screen.findByRole("button", { name: "FinStack" });

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Dashboard");
    expect(v3Tiles().map((t) => t.label)).toEqual([
      "Uploaded",
      "AI Evaluated",
      "Not AI Evaluated",
      "Incomplete",
      "Archived",
      // Q7 — retained until the client confirms its removal (plan §4).
      "Assigned",
      "Shortlisted",
    ]);
    expect(tile("Uploaded")).toHaveTextContent("All decks in the pipeline");
    expect(tile("AI Evaluated")).toHaveTextContent("Scored by AI");
    expect(tile("Not AI Evaluated")).toHaveTextContent("Awaiting AI score");
    expect(tile("Incomplete")).toHaveTextContent("Deck missing slides");
    expect(tile("Archived")).toHaveTextContent("Set aside");
    expect(tile("Shortlisted")).toHaveTextContent("Advanced to signup");
    // v15's computed sub-labels are gone with their helpers.
    expect(screen.queryByText(/since yesterday/)).toBeNull();
    expect(screen.queryByText(/% of uploaded/)).toBeNull();
    expect(screen.queryByText(/shortlist rate/)).toBeNull();
  });

  it("THE DENOMINATOR: the archived deck is counted once and excluded everywhere else", async () => {
    mount("superuser", "u_super");
    await screen.findByRole("button", { name: "FinStack" });

    // Seven decks in the payload, ONE archived.
    expect(Object.fromEntries(v3Tiles().map((t) => [t.label, t.value]))).toEqual({
      Uploaded: "6", // not 7
      "AI Evaluated": "2", // FinStack + GreenRoute — NOT the archived DormantAI, which is scored
      "Not AI Evaluated": "3",
      Incomplete: "1",
      Archived: "1",
      Assigned: "0",
      Shortlisted: "1",
    });
    // The default view draws the six live decks and not the archived one.
    expect(screen.getByText(/^Recent activity · 6 decks/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "DormantAI" })).toBeNull();

    // Archived is the one view it appears in — and the only row there.
    fireEvent.click(tile("Archived"));
    expect(await screen.findByRole("button", { name: "DormantAI" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "FinStack" })).toBeNull();
    expect(screen.getByText(/^Recent activity · 1 deck ·/)).toBeInTheDocument();
  });

  it("collapses to two table shapes, with the v3 status vocabulary and the row tags", async () => {
    mount("superuser", "u_super");
    await screen.findByRole("button", { name: "FinStack" });

    expect(headers()).toEqual(V3_DEFAULT);
    // Sector, Assigned to / date, Due date and the sparkline are gone.
    expect(headers()).not.toContain("Sector");
    expect(headers()).not.toContain("Parameter scores");

    const fin = screen.getByRole("button", { name: "FinStack" }).closest("tr")!;
    expect(within(fin).getByText("AI Evaluated")).toBeInTheDocument();
    const wealth = screen.getByRole("button", { name: "WealthOS" }).closest("tr")!;
    expect(within(wealth).getByText("Not AI Evaluated")).toBeInTheDocument();
    const pay = screen.getByRole("button", { name: "PayRoute" }).closest("tr")!;
    expect(within(pay).getByText("Incomplete deck")).toBeInTheDocument();
    // …and the missing contact columns still say so.
    expect(within(pay).getAllByText("not captured")).toHaveLength(3);
    // `.ad-tag.q` — a founder query has been raised on GreenRoute.
    const green = screen.getByRole("button", { name: "GreenRoute" }).closest("tr")!;
    expect(within(green).getByText("Queried")).toBeInTheDocument();
    expect(within(fin).queryByText("Queried")).toBeNull();
    // V4-ROUTE — the Status word is the AI-evaluation state and cannot show the
    // complete/incomplete MARK, so a deck can read "AI Evaluated" while being
    // routed to Query. Nothing here is marked, so nothing carries the tag.
    expect(screen.queryAllByTestId("v3-incomplete-mark")).toEqual([]);

    // Every box but Shortlisted shares the default shape.
    for (const box of ["AI Evaluated", "Not AI Evaluated", "Incomplete", "Archived", "Assigned"]) {
      fireEvent.click(tile(box));
      expect(headers(), `${box} uses the default shape`).toEqual(V3_DEFAULT);
    }

    fireEvent.click(tile("Shortlisted"));
    expect(headers()).toEqual(V3_SHORTLISTED);
    expect(screen.getByText(/^Shortlisted · 1 deck ·/)).toBeInTheDocument();
    const row = screen.getByRole("button", { name: "GreenRoute" }).closest("tr")!;
    expect(within(row).getByText("8.8")).toBeInTheDocument(); // Avg. score
  });

  // V4-ROUTE — items 6 and 7. The routing mark lives on `decks.complete` +
  // `missing_fields`; the Status column's three words are the AI-evaluation
  // state. Those two disagree exactly when a deck was evaluated and then lost a
  // required intake detail — measured case (b) in plan §4.1 — and that is the
  // one case the operator changing nothing at all would otherwise never see.
  it("tags an evaluated deck that is marked incomplete, where the Status word cannot", async () => {
    vi.mocked(api.listDecks).mockResolvedValue({
      decks: V3_DECKS.map((d) => {
        if (d.id === "d_fin") return { ...d, complete: true, missingFields: ["founderEmail" as const] };
        // PayRoute is marked incomplete too — its pill already says so, which is
        // what the tag's guard is for, so give it the mark to exercise that.
        if (d.statusId === "incomplete") return { ...d, complete: false, missingFields: ["founderPhone" as const] };
        return d;
      }),
    });
    mount("superuser", "u_super");
    await screen.findByRole("button", { name: "FinStack" });

    const fin = screen.getByRole("button", { name: "FinStack" }).closest("tr")!;
    // The word is unchanged — the deck really is AI-evaluated…
    expect(within(fin).getByText("AI Evaluated")).toBeInTheDocument();
    // …and the mark says where it actually goes.
    expect(within(fin).getByTestId("v3-incomplete-mark")).toHaveTextContent("Incomplete details");
    // Not doubled up on the deck whose pill already says Incomplete deck.
    const pay = screen.getByRole("button", { name: "PayRoute" }).closest("tr")!;
    expect(within(pay).queryByTestId("v3-incomplete-mark")).toBeNull();
    // One row tagged, no others.
    expect(screen.getAllByTestId("v3-incomplete-mark")).toHaveLength(1);
  });

  it("sorts by recent activity descending and prints the row clock", async () => {
    mount("superuser", "u_super");
    await screen.findByRole("button", { name: "FinStack" });
    const names = [...document.querySelectorAll("table[data-shape] tbody tr")].map(
      (tr) => tr.querySelector("button")?.textContent,
    );
    // GreenRoute 1h · FinStack 2h · PayRoute 26h · WealthOS 50h · TaxPilot 74h
    // · CreditBridge 98h. The payload's own order is none of these.
    expect(names).toEqual(["GreenRoute", "FinStack", "PayRoute", "WealthOS", "TaxPilot", "CreditBridge"]);
    const green = screen.getByRole("button", { name: "GreenRoute" }).closest("tr")!;
    expect(within(green).getByText(/ago$/)).toBeInTheDocument();
  });

  it("each row carries an Actions ▾ select; the Shortlisted shape's omits Edit", async () => {
    mount("superuser", "u_super");
    await screen.findByRole("button", { name: "FinStack" });

    const actions = screen.getByRole("combobox", { name: "Actions for FinStack" });
    expect([...actions.querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "Actions ▾",
      // The transitions the SERVER says this role may make from this stage —
      // never an option it would refuse…
      "Reject (below AI gate)",
      "Edit",
    ]);
    // …and never `assign_jury`, which the generic transition route would apply
    // WITHOUT an evaluator, stranding the deck at Assigned with assigned_to
    // NULL. `StagePage` withholds it for the same reason.
    expect([...actions.querySelectorAll("option")].map((o) => o.textContent)).not.toContain("Assign jury");

    fireEvent.click(tile("Shortlisted"));
    const shortlisted = screen.getByRole("combobox", { name: "Actions for GreenRoute" });
    expect([...shortlisted.querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "Actions ▾",
      "Schedule intro call",
    ]);
    expect([...shortlisted.querySelectorAll("option")].map((o) => o.textContent)).not.toContain("Edit");
  });

  it("never offers the sign-up bypass, whatever the server permits", async () => {
    // A superuser IS allowed `signup → onboard_ready` by the pipeline, so the
    // list payload offers it. The Dashboard must not: a sign-up completes on
    // the countersign, not on a click (Q33).
    vi.mocked(api.listDecks).mockResolvedValue({
      decks: [
        {
          ...V3_DECKS[1],
          statusId: "signup",
          status: "Signup",
          actions: [{ action: "complete_signup", label: "Complete signup", to: "onboard_ready" }],
        },
      ],
    });
    mount("superuser", "u_super");
    await screen.findByRole("button", { name: "GreenRoute" });
    const options = [...screen.getByRole("combobox", { name: "Actions for GreenRoute" }).querySelectorAll("option")];
    expect(options.map((o) => o.textContent)).toEqual(["Actions ▾", "Edit"]);
  });

  it("Edit opens the inline contact row and saves it through the details route", async () => {
    mount("superuser", "u_super");
    await screen.findByRole("button", { name: "FinStack" });

    fireEvent.change(screen.getByRole("combobox", { name: "Actions for FinStack" }), {
      target: { value: "__edit" },
    });
    const phone = await screen.findByLabelText("Phone — FinStack");
    fireEvent.change(phone, { target: { value: "+91 90000 12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.updateDeckDetails).toHaveBeenCalledWith(
        "d_fin",
        expect.objectContaining({ founderPhone: "+91 90000 12345", founder: "Ananya Reddy" }),
      ),
    );
    // Only this row goes into edit mode.
    expect(screen.queryByLabelText("Phone — GreenRoute")).toBeNull();
  });

  it("the rail's Pipeline progress carries the new tile titles (issue 7)", async () => {
    mount("superuser", "u_super");
    await screen.findByRole("button", { name: "FinStack" });
    const rail = screen.getByText("Pipeline progress").closest("section")!;
    for (const label of ["AI Evaluated", "Not AI Evaluated", "Incomplete", "Archived", "Shortlisted"]) {
      expect(within(rail).getByText(label), label).toBeInTheDocument();
    }
    // Uploaded is the denominator, not a rail row.
    expect(within(rail).queryByText("Uploaded")).toBeNull();
    expect(within(rail).getByText("6 decks uploaded · across 6 stages")).toBeInTheDocument();
  });
});

describe("V3 — the roles whose prototype was NOT reshared keep their screen", () => {
  beforeEach(() => {
    vi.mocked(api.listDecks).mockResolvedValue({ decks: V3_DECKS });
  });

  // Only `AISJ_SuperuserV3.HTM` was reshared. If any of these three drifts onto
  // the Dashboard, this fails — which is the guarantee the wave is run under.
  for (const role of ["admin", "program_manager", "program_associate"] as const) {
    it(`${role} still sees All decks, the v15 six and the founder-details table`, async () => {
      mount(role, `u_${role}`);
      await screen.findByRole("button", { name: "FinStack" });

      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("All decks");
      expect(screen.getByRole("heading", { level: 1 })).not.toHaveTextContent("Dashboard");
      expect(v3Tiles().map((t) => t.label)).toEqual([
        "Uploaded",
        "Pending",
        "Incomplete",
        "AI Evaluated",
        "Assigned",
        "Shortlisted",
      ]);
      expect(headers()).toEqual(SU_DETAILS);
      // The v15 denominator: all seven decks, the archived one included.
      expect(v3Tiles()[0].value).toBe("7");
      expect(screen.getByRole("button", { name: "DormantAI" })).toBeInTheDocument();
      // Their sub-labels are still computed, not the v3 prose.
      expect(tile("Uploaded")).toHaveTextContent("since yesterday");
      expect(screen.queryByText("All decks in the pipeline")).toBeNull();
      // And no row-action select appeared on their table.
      expect(screen.queryByRole("combobox", { name: /^Actions for/ })).toBeNull();
    });
  }

  it("the jury's My Pipeline is untouched", async () => {
    vi.mocked(api.listDecks).mockResolvedValue({
      decks: [{ ...V3_DECKS[0], assignedTo: "u_jury", statusId: "assigned" }],
    });
    mount("jury", "u_jury");
    await screen.findByRole("button", { name: "FinStack" });
    expect(v3Tiles().map((t) => t.label)).toEqual([
      "Assigned",
      "Evaluated",
      "Drafts",
      "Pending Evaluation",
      "Submitted",
    ]);
    expect(headers()).toEqual(JURY_OPEN);
  });
});

describe("V3 integration — the report's Score-in-Evaluate link resolves by REACHABILITY", () => {
  /**
   * The P0 `V3-NAV` filed against its own change. It split `nav.ts` in two:
   * `reachableNav` is "can reach" (still the route guard), `navForUser` is THE
   * SIDEBAR. V3 item 10 takes `evaluate` out of the incubator superuser's
   * sidebar while leaving `/app/evaluate` live — so resolving this link through
   * `navForUser` dropped it for exactly one role, silently.
   *
   * The link only draws for a deck in a JURY_STAGES stage, hence `assigned`.
   * Asserted for the superuser (hidden from the sidebar, still reachable) AND
   * the admin (never hidden), so it fails if the link is ever resolved through
   * the sidebar again and passes only while both roles keep it.
   */
  const assigned = [{ ...V3_DECKS[0], statusId: "assigned" }];

  it("the superuser keeps it even though `evaluate` left their sidebar", async () => {
    expect(isInSidebar("superuser", navItemById("incubator", "evaluate")!)).toBe(false);
    expect(canAccessNav("incubator", "superuser", "evaluate")).toBe(true);

    vi.mocked(api.listDecks).mockResolvedValue({ decks: assigned });
    mount("superuser", "u_super");
    fireEvent.click(await screen.findByRole("button", { name: "FinStack" }));
    const dialog = await screen.findByRole("dialog", { name: "Evaluation report — FinStack" });
    expect(within(dialog).getByRole("link", { name: "Score in Evaluate" })).toHaveAttribute(
      "href",
      "/app/evaluate",
    );
  });

  it("the admin, whose sidebar still has it, keeps it too", async () => {
    expect(isInSidebar("admin", navItemById("incubator", "evaluate")!)).toBe(true);

    vi.mocked(api.listDecks).mockResolvedValue({ decks: assigned });
    mount("admin", "u_admin");
    fireEvent.click(await screen.findByRole("button", { name: "FinStack" }));
    const dialog = await screen.findByRole("dialog", { name: "Evaluation report — FinStack" });
    expect(within(dialog).getByRole("link", { name: "Score in Evaluate" })).toHaveAttribute(
      "href",
      "/app/evaluate",
    );
  });
});
