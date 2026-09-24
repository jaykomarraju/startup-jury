import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, waitFor, configure } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { AuthContext, type AuthUser } from "../../src/client/auth/AuthProvider";
import { DashboardPage, juryBucket } from "../../src/client/routes/DashboardPage";
import { EvaluationDrawer } from "../../src/client/components/EvaluationDrawer";
import type { DeckView } from "../../src/client/types";
import type { Role } from "../../src/shared/roles";
import { canAccessNav, isInSidebar, navIcon, navItemById, navLabel } from "../../src/shared/nav";
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

// The v15 incubator header sets (`SU_DETAILS` / `SU_EVALUATED` / `SU_ASSIGNED`
// / `SU_SHORTLISTED`) were deleted with the screen that drew them — see the
// orphaned-screen note above the first describe. They are still pinned as pure
// data in `test/unit/deckStats.test.ts`, which is what a Wave R+1 cleanup of
// `STAT_ORDER.incubator` has to read.
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
 * The default role here is the ADMIN — who, since R1-DASH, sees the V3
 * Dashboard exactly as the superuser does.
 *
 * `AISJ_SuperuserV3.HTM` reshaped this screen into a Dashboard; R1-DASH widened
 * it from the superuser to the three other incubator STAFF roles on the
 * client's written instruction (plan_roles_incubator §2 items 1/2/3/4a/5, §6
 * Q-A). The JURY did not move — `isJury` is tested before `isV3Dash`, and their
 * screen already matches their own prototype. That split is the negative
 * control, and it has its own block at the end of the file.
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

/**
 * ── THE ORPHANED SCREEN (plan_roles_incubator §4) ──────────────────────────
 *
 * This describe used to hold TEN tests over the v15 incubator build, all under
 * `mount()`'s default admin and all mounted `edition: "incubator"`. R1-DASH
 * moved the admin, programme manager and programme associate onto the V3
 * Dashboard; the jury has its own tiles and shapes. So **no incubator role is
 * left on the v15 screen**, and `STAT_ORDER.incubator`, `matchesStat
 * ("incubator", …)` and the four shapes they drive (`details`, `evaluated`,
 * `assigned`, `shortlisted`) are unreachable in production.
 *
 * They could not be re-pointed at another role, because there is no other role.
 * VC does not inherit them either — VC staff have their own `VC_SHAPES`. So the
 * four that asserted the v15 SHAPE were deleted rather than left passing
 * against dead code, and this is the record of where each assertion went:
 *
 *   • "renders the founder-details header set by default, with the intake
 *     status vocabulary" — `SU_DETAILS` + Complete/Incomplete. Superseded by
 *     "collapses to two table shapes, with the v3 status vocabulary and the row
 *     tags" below, which pins `V3_DEFAULT` and the four V3 Status words for the
 *     same roles. The v15 header sets themselves stay pinned as pure data in
 *     `test/unit/deckStats.test.ts`.
 *   • "uses the prototype's stat-box copy" — the v15 six and their COMPUTED
 *     sub-labels ("since yesterday"). Superseded by "is titled Dashboard and
 *     draws the v3 six, in order, with the static sub-labels", which asserts the
 *     computed ones are gone.
 *   • "re-shapes the table per stat box and narrows the rows (F0192)" — the
 *     four v15 shapes. Superseded by the two-shape assertion below.
 *   • "the parameter popover lists only the composite parameters" — the V3
 *     table has no sparkline column at all (asserted below). The rule it tested,
 *     that a weight-0 role parameter is not in the composite, is still asserted
 *     on a LIVE path: the report overlay's `queryByText("Program fit")` is null
 *     (F0196/F0235 below), and the VC screen still draws the sparkline
 *     (`allDecksVc.test.tsx`).
 *
 * The three that survive re-pointed (below) tested the TOOLBAR and the empty
 * state, which are common to both builds. The three that needed no change at
 * all — the empty workspace and the two threshold-rail tests — are untouched.
 *
 * `STAT_ORDER.incubator` is deliberately LEFT in `deckStats.ts`: deleting it
 * inside a restyle would make this change unreviewable, and §6 Q-A is not yet
 * answered in writing, so the wave must stay revertible by one predicate.
 * Removing it is a Wave R+1 cleanup with its own review.
 */
describe("All decks — the incubator staff screen", () => {
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
    // R1-DASH — the base title is `homeTitle`, which is now "Dashboard" for this
    // role too. The prototype's `updateTitle()` still appends the context.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Dashboard — Climate Cohort");
    expect(screen.getByRole("button", { name: "Program filter" })).toHaveTextContent("Climate Cohort");
    // …and `adRenderTable` leads the sub-line with that same context, in place
    // of "Recent activity". This is the V3 sub-line on a non-superuser screen.
    expect(screen.getByText("Climate Cohort · 5 decks · Updated just now")).toBeInTheDocument();
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
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Dashboard — Climate Cohort, Cohort 6");
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
    // The V3 Shortlisted shape — the one box that does NOT share the default.
    expect(headers()).toEqual(V3_SHORTLISTED);
    expect(screen.getByText("No decks in this view for the selected filters.")).toBeInTheDocument();
    expect(screen.getByText("Shortlisted · 0 decks · Updated just now")).toBeInTheDocument();
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

  /**
   * 2026-09-23 — the client: "archive is a state, not a move." The archived row
   * used to leave Uploaded the moment it was archived, so the "Archived" status
   * their own row asks for was one no row ever showed again. Inverted here.
   */
  it("THE DENOMINATOR: the archived deck stays in Uploaded and is counted once", async () => {
    mount("superuser", "u_super");
    await screen.findByRole("button", { name: "FinStack" });

    // Seven decks in the payload, ONE archived — and Uploaded holds all seven.
    expect(Object.fromEntries(v3Tiles().map((t) => [t.label, t.value]))).toEqual({
      Uploaded: "7",
      // Still counted ONCE: its state is Archived, so the scored DormantAI does
      // not also swell AI Evaluated.
      "AI Evaluated": "2",
      "Not AI Evaluated": "3",
      Incomplete: "1",
      Archived: "1",
      Assigned: "0",
      Shortlisted: "1",
    });
    // The default view draws every deck, the archived one included…
    expect(screen.getByText(/^Recent activity · 7 decks/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "DormantAI" })).toBeInTheDocument();
    // …and it says so, which is the whole point of the change.
    const dormant = screen.getByRole("button", { name: "DormantAI" }).closest("tr")!;
    expect(within(dormant).getByText("Archived")).toBeInTheDocument();

    // The Archived tile still narrows to it alone.
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
    // S1-DASH item 3 — the Status word now carries the mark itself, so nothing
    // in this fixture (all of it complete) reads as either Incomplete word.
    expect(screen.queryByText("Incomplete contact details")).toBeNull();

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

  // ── S1-DASH item 3 — the two statuses, on the screen ─────────────────────
  //
  // This replaces V4-ROUTE's `v3-incomplete-mark` test, whose own title said
  // what was wrong: "where the Status word cannot". The word could not say
  // "contact details" because `decks.complete` is the AND of the two causes
  // and nothing else on the row remembered which arm failed (plan §8.1).
  // Migration 0075 records the model's verdict separately, so the word can.
  it("says WHICH of the two things is incomplete, from (aiComplete, missingFields)", async () => {
    vi.mocked(api.listDecks).mockResolvedValue({
      decks: V3_DECKS.map((d) => {
        // (1,set) — evaluated, then stripped of a required detail (plan §4.1
        // case (b)). The model passed the deck; the contacts are the problem.
        if (d.id === "d_fin") return { ...d, aiComplete: true, complete: true, missingFields: ["founderEmail" as const] };
        // (0,set) — both wrong. Deck wins: there is no point asking a founder
        // for a phone number when the deck itself could not be read.
        if (d.statusId === "incomplete")
          return { ...d, aiComplete: false, complete: false, missingFields: ["founderPhone" as const] };
        return d;
      }),
    });
    mount("superuser", "u_super");
    await screen.findByRole("button", { name: "FinStack" });

    const fin = screen.getByRole("button", { name: "FinStack" }).closest("tr")!;
    expect(within(fin).getByText("Incomplete contact details")).toBeInTheDocument();
    expect(within(fin).queryByText("AI Evaluated")).toBeNull();

    const pay = screen.getByRole("button", { name: "PayRoute" }).closest("tr")!;
    expect(within(pay).getByText("Incomplete deck")).toBeInTheDocument();

    // Exactly one row of each — the other five decks are complete.
    expect(screen.getAllByText("Incomplete contact details")).toHaveLength(1);
    expect(screen.getAllByText("Incomplete deck")).toHaveLength(1);

    // The tile is NOT moved by the word. FinStack was AI-evaluated and still
    // counts there; `v3DeckState` and `matchesV3Stat` are untouched, which is
    // what keeps every V3-DASH count where item 19 put it.
    fireEvent.click(tile("AI Evaluated"));
    expect(screen.getByRole("button", { name: "FinStack" })).toBeInTheDocument();
  });

  // Negative control for the above. `aiComplete` is the ONLY thing separating
  // the two words: take it away — which is the state of every deck evaluated
  // before migration 0075 — and both rows collapse onto "Incomplete deck",
  // exactly the indistinguishability §8.1 reported.
  it("without aiComplete recorded, the two statuses are one word again", async () => {
    vi.mocked(api.listDecks).mockResolvedValue({
      decks: V3_DECKS.map((d) => {
        // `complete: false` is what the pre-0075 backfill leaves behind, and
        // `aiComplete` follows it — so the cause is gone for BOTH rows.
        if (d.id === "d_fin") return { ...d, aiComplete: false, complete: false, missingFields: ["founderEmail" as const] };
        if (d.statusId === "incomplete")
          return { ...d, aiComplete: false, complete: false, missingFields: ["founderPhone" as const] };
        return d;
      }),
    });
    mount("superuser", "u_super");
    await screen.findByRole("button", { name: "FinStack" });
    expect(screen.queryByText("Incomplete contact details")).toBeNull();
    expect(screen.getAllByText("Incomplete deck")).toHaveLength(2);
  });

  it("sorts by recent activity descending and prints the row clock", async () => {
    mount("superuser", "u_super");
    await screen.findByRole("button", { name: "FinStack" });
    const names = [...document.querySelectorAll("table[data-shape] tbody tr")].map(
      (tr) => tr.querySelector("button")?.textContent,
    );
    // GreenRoute 1h · FinStack 2h · PayRoute 26h · WealthOS 50h · TaxPilot 74h
    // · CreditBridge 98h, and DormantAI last. The payload's own order is none
    // of these. DormantAI is archived and, since archiving became a state
    // rather than a move (2026-09-23), it sorts here like any other row.
    expect(names).toEqual([
      "GreenRoute",
      "FinStack",
      "PayRoute",
      "WealthOS",
      "TaxPilot",
      "CreditBridge",
      "DormantAI",
    ]);
    const green = screen.getByRole("button", { name: "GreenRoute" }).closest("tr")!;
    expect(within(green).getByText(/ago$/)).toBeInTheDocument();
  });

  it("each row carries an Actions ▾ select; the Shortlisted shape's omits Edit", async () => {
    mount("superuser", "u_super");
    await screen.findByRole("button", { name: "FinStack" });

    const actions = screen.getByRole("combobox", { name: "Actions for FinStack" });
    expect([...actions.querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "Actions ▾",
      // S1-DASH item 2 — the prototype's four, framing the menu…
      "Send to Assign",
      "Send to Query — not on the Query list",
      // …with the transitions the SERVER says this role may make from this
      // stage kept underneath. Built literally, item 2 would have deleted this
      // line from the screen; nobody asked for that (plan §12.3).
      "Reject (below AI gate)",
      "Edit",
      "Archive — only from Rejected",
    ]);
    // …and never `assign_jury`, which the generic transition route would apply
    // WITHOUT an evaluator, stranding the deck at Assigned with assigned_to
    // NULL. `StagePage` withholds it for the same reason.
    expect([...actions.querySelectorAll("option")].map((o) => o.textContent)).not.toContain("Assign jury");

    fireEvent.click(tile("Shortlisted"));
    const shortlisted = screen.getByRole("combobox", { name: "Actions for GreenRoute" });
    expect([...shortlisted.querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "Actions ▾",
      // Item 4's guard, doing its job: a shortlisted deck is past the Assign
      // roster, so the option says so rather than navigating to a list that
      // will not hold it.
      "Send to Assign — not available at Shortlisted",
      // …and item 5's, the same way: a shortlisted deck is off the Query list
      // too, queried once or not — `QUERYABLE_STAGES` does not hold it.
      "Send to Query — not on the Query list",
      "Schedule intro call",
      "Archive — only from Rejected",
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
    expect(options.map((o) => o.textContent)).toEqual([
      "Actions ▾",
      "Send to Assign — not available at Signup",
      "Send to Query — not on the Query list",
      "Edit",
      "Archive — only from Rejected",
    ]);
    expect(options.map((o) => o.textContent)).not.toContain("Complete signup");
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
    // Seven now: the archived deck stays in Uploaded.
    expect(within(rail).getByText("7 decks uploaded · across 6 stages")).toBeInTheDocument();
  });
});

describe("V3 — the widening reaches all four STAFF roles, and stops at the jury", () => {
  beforeEach(() => {
    vi.mocked(api.listDecks).mockResolvedValue({ decks: V3_DECKS });
  });

  /**
   * This block used to assert the OPPOSITE — that the admin, PM and PA stayed
   * on "All decks" — because only `AISJ_SuperuserV3.HTM` had been reshared.
   * R1-DASH inverts it on the client's written instruction (§6 Q-A): the three
   * roles are widened, so the assertion that proves the widening landed is the
   * same one, read the other way.
   *
   * Inverting a negative control is the moment it can quietly stop asserting
   * anything, so the boundary is pinned on BOTH sides and BOTH were measured:
   *
   *   • revert `isV3Dash` to `role === "superuser"` → the three staff cases
   *     fail, superuser and jury still pass. (6 failures, all expected.)
   *   • add `"jury"` to `isV3Dash` → the jury case FAILS, together with
   *     "shows five first-person tiles…" in the My Pipeline block. This
   *     CORRECTS plan §5 item 1, which says the jury would be dead code
   *     because `isJury` shadows it: `isJury` shadows the three TABLE sites,
   *     not `homeTitle` or the `v3Lead` sub-line, so a juror added to the flag
   *     is retitled "Dashboard" over their own unchanged tables.
   */
  for (const role of ["superuser", "admin", "program_manager", "program_associate"] as const) {
    it(`${role} gets the Dashboard: the v3 seven, two shapes and the row Actions menu`, async () => {
      mount(role, `u_${role}`);
      await screen.findByRole("button", { name: "FinStack" });

      // Item 1 — the screen's own name, and the seven tiles in prototype order.
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Dashboard");
      expect(v3Tiles().map((t) => t.label)).toEqual([
        "Uploaded",
        "AI Evaluated",
        "Not AI Evaluated",
        "Incomplete",
        "Archived",
        "Assigned",
        "Shortlisted",
      ]);
      // The v15 six are gone with their computed sub-labels.
      expect(tile("Uploaded")).toHaveTextContent("All decks in the pipeline");
      expect(screen.queryByText(/since yesterday/)).toBeNull();
      // Item 4a — archive is a STATE: the archived deck stays in Uploaded (7).
      expect(v3Tiles()[0].value).toBe("7");
      const dormant = screen.getByRole("button", { name: "DormantAI" }).closest("tr")!;
      expect(within(dormant).getByText("Archived")).toBeInTheDocument();

      // Item 2 — the collapsed shape and the four Status words' vocabulary.
      expect(headers()).toEqual(V3_DEFAULT);
      const wealth = screen.getByRole("button", { name: "WealthOS" }).closest("tr")!;
      expect(within(wealth).getByText("Not AI Evaluated")).toBeInTheDocument();

      // Items 3 and 5 — every row carries the Actions menu, with Send to Assign
      // and Send to Query in it. Both destinations are reachable for all four:
      // `assign`/`query` are `["admin","program_manager","program_associate"]`
      // plus the superuser bypass, which is exactly this list.
      const menus = screen.getAllByRole("combobox", { name: /^Actions for/ });
      expect(menus.length).toBe(V3_DECKS.length);
      const options = within(menus[0]).getAllByRole("option").map((o) => o.textContent ?? "");
      expect(options.some((o) => o.startsWith("Send to Assign"))).toBe(true);
      expect(options.some((o) => o.startsWith("Send to Query"))).toBe(true);
      expect(canAccessNav("incubator", role, "assign")).toBe(true);
      expect(canAccessNav("incubator", role, "query")).toBe(true);

      // Item 10a — the sidebar is renamed WITH the screen, so the label and the
      // H1 cannot disagree (§6 Q-B).
      const alldecks = navItemById("incubator", "alldecks")!;
      expect(navLabel(role, alldecks)).toBe("Dashboard");
      expect(navIcon(role, alldecks)).toBe("LayoutDashboard");
    });
  }

  it("the JURY is not widened — five first-person tiles, their own shape, no Actions menu", async () => {
    mount("jury", "u_jury");
    // The juror's scope is the decks allocated to them; `V3_DECKS` has none, so
    // assert on the screen's own chrome rather than on a row.
    //
    // Their H1 is still `homeTitle`'s "All decks" — the jury's sidebar override
    // has never reached the heading, and R1-DASH does not change that. It is the
    // pre-existing mismatch §6 Q-B names for the staff roles, left alone here
    // because the jury's screen is not this session's to move.
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("All decks");
    expect(screen.queryByText("Dashboard")).toBeNull();
    // Five, not seven — `juryTiles(mine)`, from their own prototype's `mpRender`.
    expect(v3Tiles()).toHaveLength(5);
    expect(v3Tiles().map((t) => t.label)).not.toContain("Not AI Evaluated");
    // No V3 row menu, and no route to the two destinations it would offer.
    expect(screen.queryByRole("combobox", { name: /^Actions for/ })).toBeNull();
    expect(canAccessNav("incubator", "jury", "assign")).toBe(false);
    expect(canAccessNav("incubator", "jury", "query")).toBe(false);
    // Their sidebar keeps its own name and the stack glyph.
    const alldecks = navItemById("incubator", "alldecks")!;
    expect(navLabel("jury", alldecks)).toBe("My Pipeline");
    expect(navIcon("jury", alldecks)).toBe("Layers");
  });
});

describe("V3 — the row menu's two real destinations (S1-DASH items 2, 4, 5)", () => {
  beforeEach(() => {
    vi.mocked(api.listDecks).mockResolvedValue({ decks: V3_DECKS });
  });

  // "Send to Assign" is guarded NAVIGATION, not a transition: the prototype's
  // own `addToAssign` pushes the row onto `asDecks` with `assigned:false`, so
  // it puts the deck on the Assign LIST and does not pick an evaluator. Our
  // roster already lists every deck the partition routes there, so the click's
  // whole job is to carry the selection across — which is the hand-off that was
  // silently dropped in the other direction (plan §12.4).

  /** Mounts the Dashboard under a router that reports where it navigated to. */
  function mountWithRoutes() {
    const seen: { path: string; state: unknown } = { path: "/app/decks", state: null };
    function Probe({ path }: { path: string }) {
      const location = useLocation();
      seen.path = path;
      seen.state = location.state;
      return <div>at {path}</div>;
    }
    render(
      <MemoryRouter initialEntries={["/app/decks"]}>
        <AuthContext.Provider
          value={{
            user: principal("superuser", "u_super"),
            loading: false,
            login: vi.fn(),
            logout: vi.fn(),
            updateUser: vi.fn(),
          }}
        >
          <Routes>
            <Route path="/app/decks" element={<DashboardPage />} />
            <Route path="/app/assign" element={<Probe path="/app/assign" />} />
            <Route path="/app/query" element={<Probe path="/app/query" />} />
          </Routes>
        </AuthContext.Provider>
      </MemoryRouter>,
    );
    return seen;
  }

  it("Send to Assign carries the row to /app/assign as a selection", async () => {
    const seen = mountWithRoutes();
    await screen.findByRole("button", { name: "FinStack" });
    fireEvent.change(screen.getByRole("combobox", { name: "Actions for FinStack" }), {
      target: { value: "__assign" },
    });
    expect(await screen.findByText("at /app/assign")).toBeInTheDocument();
    // The selection, not just the screen — landing on an empty Assign list is
    // the defect this fixes at the other end.
    expect(seen.state).toEqual({ deckIds: ["d_fin"] });
  });

  // Negative control for item 4's guard: the ONLY thing standing between a
  // blocked row and a navigation is `deckListRoute`. Give FinStack a missing
  // contact detail — the partition then routes it to Query — and the option
  // must go disabled and say so. Revert the guard and this passes with the
  // deck landing on a list that will not hold it.
  it("…and refuses the row the Assign list will not hold, with the reason", async () => {
    vi.mocked(api.listDecks).mockResolvedValue({
      decks: V3_DECKS.map((d) =>
        d.id === "d_fin" ? { ...d, aiComplete: true, complete: true, missingFields: ["founderEmail" as const] } : d,
      ),
    });
    const seen = mountWithRoutes();
    await screen.findByRole("button", { name: "FinStack" });

    const option = [...screen.getByRole("combobox", { name: "Actions for FinStack" }).querySelectorAll("option")].find(
      (o) => o.textContent?.startsWith("Send to Assign"),
    )!;
    expect(option).toBeDisabled();
    // The reason is the row's own Status word, not a second vocabulary.
    expect(option.textContent).toBe("Send to Assign — incomplete contact details");

    fireEvent.change(screen.getByRole("combobox", { name: "Actions for FinStack" }), {
      target: { value: "__assign" },
    });
    expect(screen.queryByText("at /app/assign")).toBeNull();
    expect(seen.state).toBeNull();
  });

  // Item 5. The GUARD is live and asserted above in both directions; the ACTION
  // is blocked on a client answer, because one click here emails a founder a
  // letter nobody composed (§12). The two reasons are different words on
  // purpose — one says the row does not belong on Query, the other says it does
  // and this is not where you send it from.
  /**
   * Send to Query shipped DISABLED on 21-Sep, blocked on a question the
   * client's own row had already answered — "should GO TO QUERY screen when
   * Send to Query is clicked", the same sentence as the Assign row, which was
   * built as guarded navigation. Corrected 2026-09-23; this test is the old
   * one inverted, so the block cannot come back unnoticed.
   */
  it("Send to Query carries the row to the Query screen, and says why when it cannot", async () => {
    vi.mocked(api.listDecks).mockResolvedValue({
      decks: V3_DECKS.map((d) =>
        d.id === "d_fin" ? { ...d, aiComplete: true, complete: true, missingFields: ["founderEmail" as const] } : d,
      ),
    });
    const seen = mountWithRoutes();
    await screen.findByRole("button", { name: "FinStack" });

    const optionOf = (name: string) =>
      [...screen.getByRole("combobox", { name: `Actions for ${name}` }).querySelectorAll("option")].find((o) =>
        o.textContent?.startsWith("Send to Query"),
      )!;

    // FinStack is routed to Query, so the option is armed and unqualified.
    expect(optionOf("FinStack").textContent).toBe("Send to Query");
    expect(optionOf("FinStack")).toBeEnabled();
    // WealthOS is at Pending AI: nothing to ask, so the guard speaks.
    expect(optionOf("WealthOS").textContent).toBe("Send to Query — not on the Query list");
    expect(optionOf("WealthOS")).toBeDisabled();

    fireEvent.change(screen.getByRole("combobox", { name: "Actions for FinStack" }), {
      target: { value: "__query" },
    });
    // Guarded NAVIGATION — it carries the selection, it does not email anyone.
    expect(screen.getByText("at /app/query")).toBeInTheDocument();
    expect(seen.state).toEqual({ deckIds: ["d_fin"] });
  });

  it("a row the Query list will not hold cannot be navigated there", async () => {
    const seen = mountWithRoutes();
    await screen.findByRole("button", { name: "WealthOS" });
    fireEvent.change(screen.getByRole("combobox", { name: "Actions for WealthOS" }), {
      target: { value: "__query" },
    });
    // The option is disabled, and the handler re-checks anyway: a disabled
    // option is a presentation fact and the rule is not.
    expect(screen.queryByText("at /app/query")).toBeNull();
    expect(seen.state).toBeNull();
  });

  // Item 6 — the post-action statuses. Queried and Archived already shipped
  // (V3-DASH); Assigned did not, because `assigned` is a POST_AI stage and so
  // reads "AI Evaluated" like every other one. Same predicate as the tile.
  it("a deck that has been assigned says so, as Queried and Archived already did", async () => {
    vi.mocked(api.listDecks).mockResolvedValue({
      decks: V3_DECKS.map((d) =>
        d.id === "d_fin" ? { ...d, statusId: "assigned", status: "Assigned", assignedTo: "u_jury" } : d,
      ),
    });
    mount("superuser", "u_super");
    await screen.findByRole("button", { name: "FinStack" });

    const fin = screen.getByRole("button", { name: "FinStack" }).closest("tr")!;
    expect(within(fin).getByText("Assigned")).toBeInTheDocument();
    // The Status word is unchanged — it IS AI-evaluated; the chip is the event.
    expect(within(fin).getByText("AI Evaluated")).toBeInTheDocument();
    // And it stays off rows that were not assigned.
    const wealth = screen.getByRole("button", { name: "WealthOS" }).closest("tr")!;
    expect(within(wealth).queryByText("Assigned")).toBeNull();
  });

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
