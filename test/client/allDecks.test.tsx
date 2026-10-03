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
    // The AI SCREENING gate, and it has to be here now: the screen reads it off
    // the summary with no `typeof` guard and no fallback, so a fixture that
    // omits it hands `screeningStatus` an undefined `gate` and every scored deck
    // reads "Below threshold". That loudness is the fix for tester issue 7 — the
    // guard it replaces was false on every real response and discarded the org's
    // setting in silence. 5 is the migration's default, so no row moves.
    aiGateThreshold: 5,
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

  /**
   * R7-JURY · P2 — My Pipeline counted `assignedTo`, which since migration 0058
   * is only the FIRST of a deck's evaluators. `deck_assignments` is the
   * authority on who may score it, and `assigneeIds` is that list, served on
   * every row. A juror added as a second assignee was fetched by the server
   * (R6-SCOPE returns them the deck) and then dropped by the screen — the one
   * deck they had been asked to score was the one they could not see.
   *
   * Negative control: put `d.assignedTo === user.id` back in `DashboardPage`'s
   * `mine` and this fails on InsureFlow.
   */
  it("counts a deck this juror is a SECOND assignee on, not just the first", async () => {
    vi.mocked(api.listDecks).mockResolvedValue({
      decks: DECKS.map((d) =>
        // InsureFlow's `assignedTo` stays someone else's; the juror is on the
        // join table beside them.
        d.name === "InsureFlow" ? { ...d, assigneeIds: ["u_other", "u_jury"] } : d,
      ),
    });
    mount("jury", "u_jury");
    await screen.findByRole("button", { name: "FinStack" });
    // InsureFlow is at `jury_evaluation` and unsubmitted, so it buckets to
    // Pending Evaluation rather than to the landing view.
    fireEvent.click(tile("Pending Evaluation"));

    expect(screen.getByRole("button", { name: "InsureFlow" })).toBeInTheDocument();
    // …and the predicate did not simply go slack: a deck on nobody's join table
    // is still not theirs, in any view.
    expect(screen.queryByRole("button", { name: "PayRoute" })).toBeNull();
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

  /**
   * R7-JURY looked at this one specifically and kept it. The tile is the
   * prototype's — label, sub-line and colour — and it counts nothing, because
   * the build has no unsubmitted evaluation to count: see the note at
   * `juryTiles` for the four server derivations a draft row would corrupt and
   * why R7 did not narrow them. This asserts the fallback that shipped, not a
   * stub awaiting removal; the session that builds draft state inverts it.
   */
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
/** Days ago — for the five-working-day no-response window (C7). */
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

/**
 * `DeckView` plus the three fields S2-SERVER's `toDeckView` adds and
 * `src/client/types.ts` does not declare yet.
 *
 * **Nobody in wave S-2 owns `src/client/types.ts`** — S2-SERVER owns the server
 * route that serves them and this session owns the screen that reads them, and
 * the declaration sits between the two. `ScreeningDeck` in
 * `src/shared/deckStats.ts` has every field optional for exactly this reason, so
 * the screen compiles and the statuses that depend on them are simply
 * unreachable until they are served. Widened here so those statuses are PINNED
 * before they can be served, rather than arriving untested. Flagged in the
 * handoff note as a one-line addition for S-INT.
 */
type ScreeningDeckView = DeckView & {
  sendToAssignAt?: string;
  lastQueryAt?: string;
  lastQueryAnswered?: boolean;
  /** Oct-2026 issue 5 — the AI run counter behind the `Reevaluated` pill. */
  evaluationRuns?: number;
};

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

/** One row's Actions ▾ options, in order, exactly as the operator reads them. */
function optionTexts(name: string): string[] {
  return [
    ...screen.getByRole("combobox", { name: `Actions for ${name}` }).querySelectorAll("option"),
  ].map((o) => o.textContent ?? "");
}

/** Is this row's named option armed? `undefined` when the option is not drawn. */
function optionState(name: string, startsWith: string): { text: string; disabled: boolean } | undefined {
  const found = [
    ...screen.getByRole("combobox", { name: `Actions for ${name}` }).querySelectorAll("option"),
  ].find((o) => (o.textContent ?? "").startsWith(startsWith));
  return found ? { text: found.textContent ?? "", disabled: (found as HTMLOptionElement).disabled } : undefined;
}

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

    // ── S2-DASH — his 24-Sep vocabulary, and the cell is now ONE string ────
    // Every one of these four words is DIFFERENT from what shipped on 21-Sep,
    // and that is the point: his spec replaces the four-word vocabulary, it
    // does not extend it. The four additive chips are gone with it — the
    // composing happened in `screeningStatus`, so "Incomplete contact details,
    // Edited" is a single value and the column can be sorted.
    const fin = screen.getByRole("button", { name: "FinStack" }).closest("tr")!;
    expect(within(fin).getByText("Complete")).toBeInTheDocument();
    expect(within(fin).queryByText("AI Evaluated")).toBeNull();
    const wealth = screen.getByRole("button", { name: "WealthOS" }).closest("tr")!;
    expect(within(wealth).getByText("Awaiting AI evaluation")).toBeInTheDocument();
    expect(within(wealth).queryByText("Not AI Evaluated")).toBeNull();
    const pay = screen.getByRole("button", { name: "PayRoute" }).closest("tr")!;
    expect(within(pay).getByText("Incomplete decks")).toBeInTheDocument();
    // …and the missing contact columns still say so.
    expect(within(pay).getAllByText("not captured")).toHaveLength(3);
    // THE CHIPS ARE GONE. GreenRoute was queried months ago, answered, and has
    // since been shortlisted — `.ad-tag.q` kept saying "Queried" for good, and
    // his sink is `Incomplete, **Queried**`, which a deck review has picked back
    // up is not. So the row reads its status and its query history lives in the
    // deck's pipeline events. Same for the Contact Details Edited chip, which is
    // now four of his own statuses.
    const green = screen.getByRole("button", { name: "GreenRoute" }).closest("tr")!;
    expect(within(green).getByText("Complete")).toBeInTheDocument();
    expect(screen.queryByText("Queried")).toBeNull();
    expect(screen.queryByText("Contact Details Edited")).toBeNull();
    // Nothing in this fixture is missing a contact detail, so neither incomplete
    // CONTACT word appears.
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
    expect(within(fin).queryByText("Complete")).toBeNull();

    // S2-DASH · C2 — this row reads **Both incomplete** now, and it is the one
    // word his own matrix names that the four-word vocabulary had to collapse.
    // (0, set) is `¬D ∧ ¬C`; "Incomplete decks" was deck-before-contact winning
    // a coin toss the data never needed to lose. The DATA always distinguished
    // the pair — only the label did not.
    const pay = screen.getByRole("button", { name: "PayRoute" }).closest("tr")!;
    expect(within(pay).getByText("Both incomplete")).toBeInTheDocument();

    // Exactly one row of each — the other five decks are complete.
    expect(screen.getAllByText("Incomplete contact details")).toHaveLength(1);
    expect(screen.getAllByText("Both incomplete")).toHaveLength(1);

    // The tile is NOT moved by the word. FinStack was AI-evaluated and still
    // counts there; `v3DeckState` and `matchesV3Stat` are untouched, which is
    // what keeps every V3-DASH count where item 19 put it.
    fireEvent.click(tile("AI Evaluated"));
    expect(screen.getByRole("button", { name: "FinStack" })).toBeInTheDocument();
  });

  // Negative control for the above. `aiComplete` is the ONLY thing separating
  // the two words: take it away — which is the state of every deck evaluated
  // before migration 0075 — and both rows collapse onto ONE word, exactly the
  // indistinguishability §8.1 reported.
  //
  // S2-DASH — under his thirteen statuses that word is **Both incomplete**
  // rather than "Incomplete deck", and it is no more wrong: the backfill is
  // `ai_complete = complete`, i.e. the already-ANDed value, so the cause really
  // is unrecoverable and a word that says "both" is a sharper way to notice the
  // same missing data. The remedy is unchanged and is one request per deck,
  // `POST /api/decks/:id/rescore`.
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
    expect(screen.queryByText("Incomplete decks")).toBeNull();
    expect(screen.getAllByText("Both incomplete")).toHaveLength(2);
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

    expect(optionTexts("FinStack")).toEqual([
      "Actions ▾",
      // FinStack is **Complete**, and his matrix's whitelist for that status is
      // Send to Assign + Edit (C8) + Archive (C8). The rest are DISABLED with
      // the status as their remark — which is the whole of C6.
      "Send to Assign",
      "Send to Query — as complete",
      // "Reject (below AI gate)" is the option the whitelist is most visibly
      // for: the server offers it from `ai_evaluated`, i.e. only on decks that
      // PASSED the gate, which makes its own label false. His matrix arms Reject
      // at Below threshold and nowhere else.
      "Reject (below AI gate) — as complete",
      "Edit",
      // The fixture's `actions` carry no `archive`, so the PERMISSION layer is
      // what refuses this one even though the whitelist allows it.
      "Archive — not available to you here",
    ]);
    // …and never `assign_jury`, which the generic transition route would apply
    // WITHOUT an evaluator, stranding the deck at Assigned with assigned_to
    // NULL. `StagePage` withholds it for the same reason.
    expect(optionTexts("FinStack")).not.toContain("Assign jury");

    fireEvent.click(tile("Shortlisted"));
    expect(optionTexts("GreenRoute")).toEqual([
      "Actions ▾",
      // HIS ROW 1, on the screen: the permission layer's stage remark used to
      // read "not available at Shortlisted" and now reads "as Shortlisted", so
      // every disabled remark on the row opens with the word he wrote.
      "Send to Assign — as Shortlisted",
      // The WHITELIST speaks first, and on purpose: his matrix's reason is the
      // one he wrote down, so a Complete deck is refused Send to Query for being
      // complete — not for the stage the permission layer would also have named.
      "Send to Query — as complete",
      // C6 again, and the cost of it stated: the Dashboard row menu no longer
      // ARMS a post-screening transition. It is not lost — `StagePage` offers
      // `deck.actions` in full on Prog-manager pipeline, which is where the
      // intro call is scheduled.
      "Schedule intro call — as complete",
      "Archive — not available to you here",
    ]);
    expect(optionTexts("GreenRoute")).not.toContain("Edit");
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
    expect(optionTexts("GreenRoute")).toEqual([
      "Actions ▾",
      // The permission layer: Send to Assign IS whitelisted at Complete, and a
      // signup-stage deck is off the Assign roster. Row 1's "as" on the stage.
      "Send to Assign — as Signup",
      // The whitelist: Send to Query is not offered at Complete at all.
      "Send to Query — as complete",
      "Edit",
      "Archive — not available to you here",
    ]);
    expect(optionTexts("GreenRoute")).not.toContain("Complete signup");
  });

  /**
   * S2-UPLOAD's row 2, and the one line that keeps it from being a relocation.
   *
   * The client asked for "Mark incomplete" to go from the Upload review screen
   * because the product decides completeness itself. `manual_review ->
   * incomplete` is the SAME capability and it was live in this menu, so deleting
   * the upload button alone would have left a `manual_review` deck still
   * offering it here. Withheld outright rather than merely disabled: a disabled
   * option still prints the name of a capability he asked us to stop offering.
   */
  it("withholds Flag incomplete, so row 2 deletes the capability rather than moving it", async () => {
    vi.mocked(api.listDecks).mockResolvedValue({
      decks: [
        {
          ...V3_DECKS[5],
          actions: [
            { action: "flag_incomplete", label: "Flag incomplete", to: "incomplete" },
            { action: "approve_review", label: "Approve for AI evaluation", to: "ai_evaluated" },
          ],
        },
      ],
    });
    mount("superuser", "u_super");
    await screen.findByRole("button", { name: "CreditBridge" });
    const options = optionTexts("CreditBridge");
    expect(options).not.toContain("Flag incomplete");
    expect(options.some((o) => o.startsWith("Flag incomplete"))).toBe(false);
    // The other transition the server offered from `manual_review` is still
    // drawn, so this is a withholding and not an emptied menu. It is ACTIVE
    // because `manual_review` is "Awaiting AI evaluation", the one status whose
    // whitelist declines to narrow (C3 — his flow diagram begins after the AI).
    expect(options).toContain("Approve for AI evaluation");
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

      // Item 2 — the collapsed shape, and his 24-Sep vocabulary in it. C3's
      // seventh word: "Not AI Evaluated" is a populated stat BOX as well as a
      // word his row 6 deletes, so the box stays and its rows say this.
      expect(headers()).toEqual(V3_DEFAULT);
      const wealth = screen.getByRole("button", { name: "WealthOS" }).closest("tr")!;
      expect(within(wealth).getByText("Awaiting AI evaluation")).toBeInTheDocument();
      // The STATUS column is sortable for every one of the four (new
      // construction — there was no column-sort primitive in this client).
      expect(screen.getByRole("button", { name: "Status" })).toBeInTheDocument();

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

    // HIS ROW 1 AND HIS ROW 4 IN ONE OPTION. The reason is the row's own Status
    // word — one vocabulary, not two — and it is now prefixed "as", which is the
    // remark his own spec writes ("as incomplete contact details"). It comes
    // from the WHITELIST layer rather than from `v3SendToAssign`, because at this
    // status his matrix does not arm Send to Assign at all.
    expect(optionState("FinStack", "Send to Assign")).toEqual({
      text: "Send to Assign — as incomplete contact details",
      disabled: true,
    });

    fireEvent.change(screen.getByRole("combobox", { name: "Actions for FinStack" }), {
      target: { value: "__assign" },
    });
    expect(screen.queryByText("at /app/assign")).toBeNull();
    expect(seen.state).toBeNull();
  });

  /**
   * ── HIS ROW 4, AND IT INVERTS THIS TEST FOR THE SECOND TIME ───────────────
   *
   * The history, because the comment this replaces was written to stop exactly
   * the change that is now required, and deleting it silently would leave the
   * next reader arguing with a ghost:
   *
   *   21-Sep · Send to Query shipped DISABLED, blocked on a question.
   *   23-Sep · Un-disabled as a correction — his own row said "should GO TO
   *            QUERY screen when Send to Query is clicked", the same sentence as
   *            the Assign row. The test was rewritten as "the old one inverted,
   *            so the block cannot come back unnoticed".
   *   24-Sep · His row 4: on a deck with a missing founder email **both** Send
   *            to Assign and Send to Query are disabled. So the block IS coming
   *            back, on this fixture, by his instruction — and the comment
   *            written to prevent it was documenting his requirement as a
   *            regression. Rewritten with the test rather than deleted.
   *
   * **Row 4 is not a reversal of the 23-Sep correction, and that matters.** Send
   * to Query is still guarded navigation and is still ARMED — at "Incomplete
   * decks", which is the status whose only other exit is Edit-to-nowhere (C4),
   * asserted in the next test. What row 4 says is narrower and is his own reason
   * for row 3: *a deck with incomplete contact details cannot be emailed.* The
   * missing field here is `founderEmail`. There is no address to send to.
   */
  it("row 4 — a deck missing a founder detail can be sent to NEITHER screen", async () => {
    vi.mocked(api.listDecks).mockResolvedValue({
      decks: V3_DECKS.map((d) =>
        d.id === "d_fin" ? { ...d, aiComplete: true, complete: true, missingFields: ["founderEmail" as const] } : d,
      ),
    });
    const seen = mountWithRoutes();
    await screen.findByRole("button", { name: "FinStack" });

    // His status for this deck, and the whitelist that goes with it: Edit and
    // Archive, and nothing else.
    const fin = screen.getByRole("button", { name: "FinStack" }).closest("tr")!;
    expect(within(fin).getByText("Incomplete contact details")).toBeInTheDocument();
    expect(optionState("FinStack", "Send to Query")).toEqual({
      text: "Send to Query — as incomplete contact details",
      disabled: true,
    });
    expect(optionState("FinStack", "Send to Assign")).toEqual({
      text: "Send to Assign — as incomplete contact details",
      disabled: true,
    });

    // And the handler re-checks the whitelist, because a disabled <option> is a
    // presentation fact and the rule is not. Neither navigation happens.
    for (const value of ["__query", "__assign"]) {
      fireEvent.change(screen.getByRole("combobox", { name: "Actions for FinStack" }), { target: { value } });
    }
    expect(screen.queryByText("at /app/query")).toBeNull();
    expect(screen.queryByText("at /app/assign")).toBeNull();
    expect(seen.state).toBeNull();
  });

  /**
   * ── HIS ROW 5 AND C4 — the one state whose exit is Send to Query ──────────
   *
   * PayRoute is `¬D ∧ C`: the model could not complete the deck, the founder's
   * details are fine. His matrix lists Send to Query in NEITHER column for that
   * row, yet the row's own *next step* fires it, and his row 5 makes the enabling
   * event impossible (it wants the contact details edited, and they are already
   * complete). Shipped ACTIVE — the largest hole in his document, Q4 — because
   * his own reason for row 3 is that a deck with incomplete CONTACT cannot be
   * emailed and here the contact is not the problem. The alternative leaves the
   * state with no exit but Edit-to-nowhere.
   *
   * **The guard behind it is no longer `deckListRoute(...) === "query"`**, and
   * that is row 3: once Query membership stops being derived from
   * incompleteness, "is it on the Query list" is false for every deck nobody has
   * sent — including this one. The button would have died at exactly the status
   * that needs it, in another session's one-line flip. It asks
   * `QUERYABLE_STAGES` and `queried` instead, neither of which row 3 moves.
   */
  it("row 5 — Send to Query is armed at Incomplete decks, and carries the selection", async () => {
    const seen = mountWithRoutes();
    await screen.findByRole("button", { name: "PayRoute" });

    const pay = screen.getByRole("button", { name: "PayRoute" }).closest("tr")!;
    expect(within(pay).getByText("Incomplete decks")).toBeInTheDocument();
    expect(optionState("PayRoute", "Send to Query")).toEqual({ text: "Send to Query", disabled: false });
    // …and Send to Assign is not, which is the other half of his row: the deck
    // itself could not be read, so there is nothing to give an evaluator.
    expect(optionState("PayRoute", "Send to Assign")?.disabled).toBe(true);

    fireEvent.change(screen.getByRole("combobox", { name: "Actions for PayRoute" }), {
      target: { value: "__query" },
    });
    // Guarded NAVIGATION — it carries the selection, it does not email anyone.
    expect(screen.getByText("at /app/query")).toBeInTheDocument();
    expect(seen.state).toEqual({ deckIds: ["d_pay"] });
  });

  it("a row no query can be raised on cannot be navigated there", async () => {
    const seen = mountWithRoutes();
    await screen.findByRole("button", { name: "WealthOS" });
    // WealthOS is at Pending AI — before the AI has read anything, so there is
    // nothing to ask a founder about yet. The remark is the STAGE, which is
    // row 1's "as" applied to the permission layer's own sentence.
    expect(optionState("WealthOS", "Send to Query")).toEqual({
      text: "Send to Query — as Pending AI",
      disabled: true,
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Actions for WealthOS" }), {
      target: { value: "__query" },
    });
    expect(screen.queryByText("at /app/query")).toBeNull();
    expect(seen.state).toBeNull();
  });

  /**
   * ── HIS "AI Evaluated, Assigned" SINK IS THE MARKER, AND ONLY THE MARKER ───
   *
   * S1-DASH's Assigned CHIP read `matchesV3Stat(deck, "assigned")`, which is
   * true of `assignedTo` and of the two assigned stages. His sink is not that:
   * `screeningStatus` reads it from `sendToAssignAt` alone — the
   * `send_to_assign` marker S2-SERVER records, a `pipeline_events` row with
   * `from_stage === to_stage` — and never from the stage or from `assignedTo`.
   *
   * **The reason is his own row 12 Foul.** `POST /decks/:id/transition` will move
   * a deck to `assigned` with `assigned_to` still NULL, which is precisely a
   * deck that claims an evaluator it does not have. The marker is what lets the
   * deck latch and join the Assign roster while `assigned_to` keeps meaning a
   * real person. The TILE keeps the wider predicate, because the tile means
   * "allocated to an evaluator" (Aug-2026 issue 4) and the sink means "the click
   * was recorded" — two questions, deliberately answered differently, and this
   * test is where they are seen to differ on one row.
   */
  it("the Assigned sink is the recorded click, not the stage and not assignedTo", async () => {
    vi.mocked(api.listDecks).mockResolvedValue({
      decks: V3_DECKS.map((d) =>
        // `sendToAssignAt` is S2-SERVER's field and `src/client/types.ts` does
        // not declare it yet — nobody in this wave owns that file, which is in
        // the handoff. Widened here so the sink is pinned before it is served.
        d.id === "d_fin"
          ? ({ ...d, statusId: "assigned", status: "Assigned", assignedTo: "u_jury" } as ScreeningDeckView)
          : d,
      ) as DeckView[],
    });
    mount("superuser", "u_super");
    await screen.findByRole("button", { name: "FinStack" });

    // Assigned a juror, at the assigned stage, and NO marker: the tile counts it
    // and the status does not claim the sink.
    const fin = screen.getByRole("button", { name: "FinStack" }).closest("tr")!;
    expect(within(fin).getByText("Complete")).toBeInTheDocument();
    expect(within(fin).queryByText("AI Evaluated, Assigned")).toBeNull();
    expect(Object.fromEntries(v3Tiles().map((t) => [t.label, t.value])).Assigned).toBe("1");
  });

  it("…and with the marker recorded it reads his sink, and latches (row 7)", async () => {
    vi.mocked(api.listDecks).mockResolvedValue({
      decks: V3_DECKS.map((d) =>
        d.id === "d_fin"
          ? ({ ...d, sendToAssignAt: hoursAgo(1) } as ScreeningDeckView)
          : d,
      ) as DeckView[],
    });
    mount("superuser", "u_super");
    await screen.findByRole("button", { name: "FinStack" });

    const fin = screen.getByRole("button", { name: "FinStack" }).closest("tr")!;
    expect(within(fin).getByText("AI Evaluated, Assigned")).toBeInTheDocument();
    // ROW 7's LATCH: no action is active once Send to Assign has been used. The
    // deck is still at `ai_evaluated`, so the SERVER would still permit Reject —
    // the whitelist is what refuses it, which is the two layers not collapsing.
    for (const o of optionTexts("FinStack").slice(1)) {
      expect(o, o).toContain(" — as ai evaluated, assigned");
    }
    // And it stays off rows that were not sent.
    const wealth = screen.getByRole("button", { name: "WealthOS" }).closest("tr")!;
    expect(within(wealth).queryByText("AI Evaluated, Assigned")).toBeNull();
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

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * S2-DASH — the eleven-row status/button matrix, as a WHITELIST (C6)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **One test, because it is one defect.** The 21-Sep action cell is a BLACKLIST
 * — `deck.actions` minus two withheld transitions minus `archive`, plus two
 * guarded navigations — so every transition the server happens to permit from
 * the deck's stage renders ACTIVE. That is the single reason ten of his eleven
 * matrix rows show "extra active options" against the build. Asserting them row
 * by row would have recorded eleven symptoms; this table asserts the mechanism.
 *
 * Every fixture below carries the SAME four server transitions, so the
 * permission layer is held constant and the only thing that moves between rows
 * is his status. An armed option that his matrix does not name is the defect;
 * a named one that is missing is the defect the other way.
 */
describe("V3 — the eleven-row whitelist (his §5 matrix · C6)", () => {
  /** The permission layer, identical on every row: what the SERVER would allow. */
  const SERVER_ALLOWS = [
    { action: "archive", label: "Archive", to: "archived" },
    { action: "reject_ai_gate", label: "Reject (below AI gate)", to: "rejected" },
    { action: "restore", label: "Restore", to: "ai_evaluated" },
    { action: "shortlist", label: "Shortlist", to: "shortlisted" },
  ];

  /** Every option the row draws that is NOT disabled, in order. */
  function armed(name: string): string[] {
    return [
      ...screen.getByRole("combobox", { name: `Actions for ${name}` }).querySelectorAll("option"),
    ]
      .filter((o) => !(o as HTMLOptionElement).disabled && o.getAttribute("value") !== "")
      .map((o) => o.textContent ?? "");
  }

  /**
   * His thirteen statuses and three sinks, the predicate that reaches each, and
   * the actions his matrix leaves ACTIVE there. `[*]` marks the five deviations
   * from his literal text — each one a client question with the fallback we
   * ship, none of them a preference (see `V3_ACTIVE_ACTIONS` for the reason on
   * each, and `docs/plan_screening.md` §2 C4–C8).
   */
  const MATRIX: { status: string; deck: Partial<ScreeningDeckView>; active: string[] }[] = [
    // C3 · ours, not his — his flow diagram begins at "Deck complete?", so
    // there is no whitelist to read off and the permission layer decides alone.
    {
      status: "Awaiting AI evaluation",
      deck: { statusId: "uploaded", status: "Uploaded" },
      active: ["Reject (below AI gate)", "Restore", "Shortlist", "Edit", "Archive"],
    },
    {
      status: "Both incomplete",
      deck: { statusId: "incomplete", status: "Incomplete", aiComplete: false, missingFields: ["founderPhone"] },
      active: ["Edit", "Archive"],
    },
    {
      // [*] C4 · Send to Query, his biggest hole. [*] C5 · Archive.
      status: "Incomplete decks",
      deck: { statusId: "incomplete", status: "Incomplete", aiComplete: false, missingFields: [] },
      active: ["Send to Query", "Edit", "Archive"],
    },
    {
      status: "Incomplete decks, Edited",
      deck: {
        statusId: "incomplete",
        status: "Incomplete",
        aiComplete: false,
        missingFields: [],
        contactEditedAt: hoursAgo(1),
      },
      active: ["Send to Query", "Archive"],
    },
    {
      // His row 4: neither handoff. The deck cannot be emailed and cannot be
      // given to an evaluator either.
      status: "Incomplete contact details",
      deck: {
        statusId: "ai_evaluated",
        status: "AI Evaluated",
        aiComplete: true,
        complete: false,
        missingFields: ["founderEmail"],
        aiScore: 7.2,
      },
      active: ["Edit", "Archive"],
    },
    {
      // [*] Oct-2026 issue 6 · **Edit, not Archive alone.** His row reads
      // "Archive only", and the tester found what that means on a real deck:
      // one edit that missed a field makes the deck terminal, with its own four
      // editable inputs sitting in the row. The deviation and its reasoning are
      // on the `V3_ACTIVE_ACTIONS` entry; the order here is the menu's order,
      // so Edit precedes Archive exactly as it does at `Incomplete contact
      // details` above.
      status: "Incomplete contact details, Edited",
      deck: {
        statusId: "ai_evaluated",
        status: "AI Evaluated",
        aiComplete: true,
        complete: false,
        missingFields: ["founderEmail"],
        aiScore: 7.2,
        contactEditedAt: hoursAgo(1),
      },
      active: ["Edit", "Archive"],
    },
    {
      // I4. The one status at which "Reject (below AI gate)" is a TRUE label:
      // the server offers it from `ai_evaluated`, which today means only decks
      // that PASSED the gate. [*] C5/C6 · Archive.
      status: "Below threshold",
      deck: {
        statusId: "ai_evaluated",
        status: "AI Evaluated",
        aiComplete: true,
        complete: true,
        missingFields: [],
        aiScore: 4.2,
      },
      active: ["Reject (below AI gate)", "Archive"],
    },
    {
      status: "Below threshold, Edited",
      deck: {
        statusId: "ai_evaluated",
        status: "AI Evaluated",
        aiComplete: true,
        complete: true,
        missingFields: [],
        aiScore: 4.2,
        contactEditedAt: hoursAgo(1),
      },
      active: ["Reject (below AI gate)", "Archive"],
    },
    {
      // [*] §2 · `restore` survives. His machine has no Restore; we shipped one
      // as Aug-2026 issue 31 and his silence is not a deletion.
      status: "Rejected",
      deck: { statusId: "rejected", status: "Rejected", aiScore: 4.2 },
      active: ["Restore", "Archive"],
    },
    {
      // [*] C8 · Edit and Archive. His row offers only Send to Assign, which
      // makes a typo in a complete deck's details uncorrectable.
      status: "Complete",
      deck: {
        statusId: "ai_evaluated",
        status: "AI Evaluated",
        aiComplete: true,
        complete: true,
        missingFields: [],
        aiScore: 7.2,
      },
      active: ["Send to Assign", "Edit", "Archive"],
    },
    {
      status: "Complete, Edited",
      deck: {
        statusId: "ai_evaluated",
        status: "AI Evaluated",
        aiComplete: true,
        complete: true,
        missingFields: [],
        aiScore: 7.2,
        contactEditedAt: hoursAgo(1),
      },
      active: ["Send to Assign", "Archive"],
    },
    {
      // ── Oct-2026 issue 5 · "it should say reevaluated" ──────────────────
      // The `Complete` row above with one field changed: the AI has read this
      // deck twice. It INHERITS `Complete`'s active set verbatim — the word is a
      // fact about the deck's history, not a change in what may be done to it —
      // and `screeningStatus` only ever returns it where `Complete` or
      // `Complete, Edited` would have stood, which is why no other row here
      // moves.
      status: "Reevaluated",
      deck: {
        statusId: "ai_evaluated",
        status: "AI Evaluated",
        aiComplete: true,
        complete: true,
        missingFields: [],
        aiScore: 7.2,
        evaluationRuns: 2,
      },
      active: ["Send to Assign", "Edit", "Archive"],
    },
    {
      // C7 · his own §7 open item, and the ONE action re-armed on a latched
      // deck. The option renames itself so the archive reason is visible before
      // the click rather than only in `exit_note` after it.
      status: "No response",
      deck: {
        statusId: "incomplete",
        status: "Incomplete",
        queried: true,
        lastQueryAt: daysAgo(14),
        lastQueryAnswered: false,
      },
      active: ["Archive (no response)"],
    },
    // ── The three sinks. Row 7: no action is active once Send to Query / Send
    // to Assign / Archive has been used. Archived keeps the way back in.
    {
      status: "Incomplete, Queried",
      deck: { statusId: "incomplete", status: "Incomplete", queried: true },
      active: [],
    },
    {
      status: "AI Evaluated, Assigned",
      deck: { statusId: "ai_evaluated", status: "AI Evaluated", aiScore: 7.2, sendToAssignAt: hoursAgo(2) },
      active: [],
    },
    {
      status: "Archived",
      deck: { statusId: "archived", status: "Archived", aiScore: 5.2 },
      active: ["Restore"],
    },
  ];

  for (const row of MATRIX) {
    it(`${row.status} → ${row.active.length === 0 ? "nothing is active" : row.active.join(" · ")}`, async () => {
      vi.mocked(api.listDecks).mockResolvedValue({
        decks: [{ id: "d_m", name: "MatrixCo", actions: SERVER_ALLOWS, ...row.deck } as ScreeningDeckView] as DeckView[],
      });
      mount("superuser", "u_super");
      await screen.findByRole("button", { name: "MatrixCo" });

      // The status his matrix keys on, then the actions it leaves active there.
      const tr = screen.getByRole("button", { name: "MatrixCo" }).closest("tr")!;
      expect(within(tr).getByTestId("v3-status")).toHaveTextContent(row.status);
      expect(armed("MatrixCo")).toEqual(row.active);

      // …and every option that is NOT active carries a remark, which is the
      // other half of his sentence ("Disabled: everything else"). A bare
      // disabled option would tell the operator nothing.
      for (const o of optionTexts("MatrixCo").slice(1)) {
        if (row.active.includes(o)) continue;
        expect(o, o).toMatch(/ — .+$/);
      }
    });
  }

  /**
   * ── OCT-2026 ISSUE 6 · THE ONE DEAD END IN THE WHITELIST ──────────────────
   *
   * The row above pins that Edit is OFFERED at `Incomplete contact details,
   * Edited`. Two things make that offer real rather than drawn, and the MATRIX
   * loop can see neither, so they are asserted here:
   *
   *  1. **`v3ActionCell(deck, withEdit)` only draws Edit under `withEdit`**,
   *     which is `true` on the `v3Default` shape and `false` on
   *     `v3Shortlisted`. This status renders on `v3Default` — if it ever moved,
   *     the whitelist entry would be a whitelist for an option nobody draws.
   *  2. **Choosing it has to open the editor.** The whitelist is re-checked in
   *     the change handler (a disabled `<option>` is a presentation fact), so an
   *     entry added to the const and missed by the handler would still read as
   *     armed. The four inputs appearing is the only proof the exit exists.
   *
   * And the HINT, because the tooltip is the other half of the cell: the gloss
   * this replaces ended at "still cannot be emailed", which told an operator
   * there was nothing to do while the menu now offers the remedy. A row whose
   * text argues with its own menu is the same defect in a different place.
   */
  it("issue 6 — Edit is a real exit from Incomplete contact details, Edited", async () => {
    vi.mocked(api.listDecks).mockResolvedValue({
      decks: [
        {
          id: "d_m",
          name: "MatrixCo",
          statusId: "ai_evaluated",
          status: "AI Evaluated",
          aiComplete: true,
          complete: false,
          missingFields: ["founderEmail"],
          aiScore: 7.2,
          contactEditedAt: hoursAgo(1),
          founder: "Ada Founder",
          founderPhone: "+91 90000 00000",
          actions: SERVER_ALLOWS,
        } as ScreeningDeckView,
      ] as DeckView[],
    });
    mount("superuser", "u_super");
    await screen.findByRole("button", { name: "MatrixCo" });
    const tr = screen.getByRole("button", { name: "MatrixCo" }).closest("tr")!;
    expect(within(tr).getByTestId("v3-status")).toHaveTextContent("Incomplete contact details, Edited");

    // Precondition 2 — the shape draws Edit, and choosing it opens the editor
    // rather than being swallowed by the handler's re-check.
    expect(optionState("MatrixCo", "Edit")).toEqual({ text: "Edit", disabled: false });
    fireEvent.change(screen.getByRole("combobox", { name: "Actions for MatrixCo" }), {
      target: { value: "__edit" },
    });
    // The field the deck is still missing is editable, which is the whole point:
    // the remedy for this status is four inputs in this row.
    expect(await screen.findByLabelText("Email — MatrixCo")).toBeInTheDocument();
    expect(screen.getByLabelText("Phone — MatrixCo")).toHaveValue("+91 90000 00000");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();

    // And the gloss names it. The sentence that stood here said only that the
    // deck still could not be emailed.
    const hint = within(tr).getByTestId("v3-status").getAttribute("title") ?? "";
    expect(hint).toMatch(/Edit/);
  });

  /**
   * The negative control for the MECHANISM, not for a row.
   *
   * Revert the enablement layer — i.e. go back to the blacklist, where an option
   * is active whenever the server permits it — and this fails on every row
   * above. So it is worth stating the thing that could not be true under a
   * blacklist and is the whole of C6: **an action the SERVER permits is refused
   * by the STATUS.** The deck below is at `ai_evaluated`, scored 7.2, so the
   * server really would take `POST /decks/:id/transition` for `shortlist` and
   * `reject_ai_gate`. His matrix arms neither at Complete.
   */
  it("THE MECHANISM: a transition the server permits is refused by the status", async () => {
    vi.mocked(api.listDecks).mockResolvedValue({
      decks: [
        {
          id: "d_m",
          name: "MatrixCo",
          statusId: "ai_evaluated",
          status: "AI Evaluated",
          aiComplete: true,
          complete: true,
          missingFields: [],
          aiScore: 7.2,
          actions: SERVER_ALLOWS,
        } as ScreeningDeckView,
      ] as DeckView[],
    });
    mount("superuser", "u_super");
    await screen.findByRole("button", { name: "MatrixCo" });

    // Drawn, so the operator can see the capability exists and why it is off…
    expect(optionState("MatrixCo", "Shortlist")).toEqual({ text: "Shortlist — as complete", disabled: true });
    expect(optionState("MatrixCo", "Reject (below AI gate)")).toEqual({
      text: "Reject (below AI gate) — as complete",
      disabled: true,
    });
    // …and the handler re-checks the whitelist, so choosing it anyway does
    // nothing. A disabled <option> is a presentation fact; the rule is not.
    fireEvent.change(screen.getByRole("combobox", { name: "Actions for MatrixCo" }), {
      target: { value: "shortlist" },
    });
    await waitFor(() => expect(api.transitionDeck).not.toHaveBeenCalled());
  });

  /**
   * The gate is a SETTING, not a constant — C12 and Q10.
   *
   * `screeningStatus` takes `gate` as a required parameter with no fallback of
   * its own, deliberately: a constant beside the setting is how this product
   * came to have three thresholds (the AI gate, `shortlist_threshold` 7.0, and
   * the cohort bands). The screen reads S2-SERVER's
   * `org_scoring_settings.ai_gate_threshold` off the config summary it already
   * fetches, so raising the gate moves a deck's status and its buttons together.
   *
   * C13 is in here too: **"at or above the threshold" is `>=`**, so a deck
   * scoring exactly the gate is Complete and not Below threshold. One character,
   * his words, and one seeded deck changes verdict.
   */
  /** One deck, scored EXACTLY 7.2 — the gate under test in both directions. */
  function mountAtGate(gate: number) {
    vi.mocked(api.getConfigSummary).mockResolvedValue({
      thresholdBest: 7,
      thresholdMediocre: 5,
      aiGateThreshold: gate,
    } as unknown as api.ConfigSummary);
    vi.mocked(api.listDecks).mockResolvedValue({
      decks: [
        {
          id: "d_m",
          name: "MatrixCo",
          statusId: "ai_evaluated",
          status: "AI Evaluated",
          aiComplete: true,
          complete: true,
          missingFields: [],
          aiScore: 7.2,
          actions: SERVER_ALLOWS,
        } as ScreeningDeckView,
      ] as DeckView[],
    });
    mount("superuser", "u_super");
  }

  it("a deck scoring EXACTLY the gate is Complete — C13's one character", async () => {
    mountAtGate(7.2);
    await screen.findByRole("button", { name: "MatrixCo" });
    // 7.2 >= 7.2. The build shipped `total > GATE` from a different diagram,
    // which rejects this deck; his words are "at or above the threshold".
    await waitFor(() => expect(screen.getByTestId("v3-status")).toHaveTextContent("Complete"));
    expect(armed("MatrixCo")).toEqual(["Send to Assign", "Edit", "Archive"]);
  });

  it("…and raising the org's gate past it moves the same deck Below threshold", async () => {
    mountAtGate(7.3);
    await screen.findByRole("button", { name: "MatrixCo" });
    await waitFor(() => expect(screen.getByTestId("v3-status")).toHaveTextContent("Below threshold"));
    // The status and the buttons move together, which is the point of the gate
    // being a setting rather than a constant: Reject is armed, Send to Assign is
    // not, and neither decision was taken in this file.
    expect(armed("MatrixCo")).toEqual(["Reject (below AI gate)", "Archive"]);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * S2-DASH — the composed Status string, and the new STATUS column sort
 * ═══════════════════════════════════════════════════════════════════════════
 */
describe("V3 — the Status cell is one sortable string", () => {
  /** Five decks whose statuses sit at known, different points in his flow. */
  const SORTABLE: ScreeningDeckView[] = [
    // "Complete" — late in his flow, and the most recent activity.
    {
      id: "d_c",
      name: "CompleteCo",
      statusId: "ai_evaluated",
      status: "AI Evaluated",
      aiComplete: true,
      complete: true,
      missingFields: [],
      aiScore: 7.2,
      lastActivityAt: hoursAgo(1),
    },
    // "Awaiting AI evaluation" — first in his flow, oldest activity.
    { id: "d_a", name: "AwaitingCo", statusId: "uploaded", status: "Uploaded", lastActivityAt: hoursAgo(90) },
    // "Archived" — last in his flow.
    { id: "d_z", name: "ArchivedCo", statusId: "archived", status: "Archived", lastActivityAt: hoursAgo(40) },
    // "Incomplete decks" — third, and it shares its status with the next row so
    // the tie-break is measured rather than assumed.
    {
      id: "d_i1",
      name: "ThinOne",
      statusId: "incomplete",
      status: "Incomplete",
      aiComplete: false,
      missingFields: [],
      lastActivityAt: hoursAgo(3),
    },
    {
      id: "d_i2",
      name: "ThinTwo",
      statusId: "incomplete",
      status: "Incomplete",
      aiComplete: false,
      missingFields: [],
      lastActivityAt: hoursAgo(10),
    },
  ];

  const names = () =>
    [...document.querySelectorAll("table[data-shape] tbody tr")].map((tr) => tr.querySelector("button")?.textContent);

  beforeEach(() => {
    vi.mocked(api.listDecks).mockResolvedValue({ decks: SORTABLE as DeckView[] });
  });

  /**
   * His four Edited statuses are what makes the cell sortable at all.
   *
   * Until 24-Sep the cell was a pill plus up to FOUR additive chips (Assigned,
   * Queried, Contact Details Edited, Archived) — five independent elements, and
   * a composite of five elements has no order. "Incomplete contact details,
   * Edited" is a single composed VALUE in his spec, so the composing happened in
   * the vocabulary: the Edited variants are their own statuses, the cell is one
   * string, and `screeningStatusRank` can sort it.
   */
  it("composes the edit into the word itself, so there are no chips left to sort", async () => {
    vi.mocked(api.listDecks).mockResolvedValue({
      decks: [
        {
          id: "d_e",
          name: "EditedCo",
          statusId: "ai_evaluated",
          status: "AI Evaluated",
          aiComplete: true,
          complete: false,
          missingFields: ["founderEmail"],
          aiScore: 7.2,
          contactEditedAt: hoursAgo(1),
        } as ScreeningDeckView,
      ] as DeckView[],
    });
    mount("superuser", "u_super");
    await screen.findByRole("button", { name: "EditedCo" });

    const cell = screen.getByTestId("v3-status");
    // ONE element, ONE string — his own composed value, not "Incomplete contact
    // details" with an "Edited" chip parked beside it.
    expect(cell).toHaveTextContent("Incomplete contact details, Edited");
    expect(cell.querySelectorAll("span")).toHaveLength(1);
    expect(screen.queryByText("Contact Details Edited")).toBeNull();
  });

  it("sorts the STATUS column both ways, and back to the prototype's order", async () => {
    mount("superuser", "u_super");
    await screen.findByRole("button", { name: "CompleteCo" });

    // The default is untouched: the prototype's `(b.act||0)-(a.act||0)`.
    const header = screen.getByRole("button", { name: "Status" });
    expect(header.closest("th")).toHaveAttribute("aria-sort", "none");
    expect(names()).toEqual(["CompleteCo", "ThinOne", "ThinTwo", "ArchivedCo", "AwaitingCo"]);

    // Ascending is SCREENING_STATUS_ORDER — his §4 flow's own order, NOT the
    // label: alphabetically "AI Evaluated, Assigned" sorts first and "Archived"
    // second, which would put the two ends of the pipeline side by side as if
    // archiving were a kind of assignment.
    fireEvent.click(header);
    expect(header.closest("th")).toHaveAttribute("aria-sort", "ascending");
    expect(names()).toEqual(["AwaitingCo", "ThinOne", "ThinTwo", "CompleteCo", "ArchivedCo"]);
    // The TIE-BREAK is the activity order, because the status sort is layered
    // over it and `Array#sort` is stable: ThinOne (3h) before ThinTwo (10h).

    fireEvent.click(header);
    expect(header.closest("th")).toHaveAttribute("aria-sort", "descending");
    expect(names()).toEqual(["ArchivedCo", "CompleteCo", "ThinOne", "ThinTwo", "AwaitingCo"]);

    // A third click returns the prototype's order, so it is somewhere the
    // operator can get back to rather than a state they can only leave.
    fireEvent.click(header);
    expect(header.closest("th")).toHaveAttribute("aria-sort", "none");
    expect(names()).toEqual(["CompleteCo", "ThinOne", "ThinTwo", "ArchivedCo", "AwaitingCo"]);
  });

  /**
   * **"Sortable on all stat boxes" cannot be literal, and this is why.**
   *
   * Every box but Shortlisted shares the `v3Default` shape, so one sortable
   * header serves six of the seven. `v3Shortlisted` has NO Status column at all
   * — `["Startup name", "AI score", "Avg. score", "Signup status", "Actions"]`,
   * copied from the prototype's own second `thead` — so there is nothing to make
   * sortable there. Recorded in the handoff note as well as here.
   */
  it("is offered on the six boxes that have a Status column, and not on Shortlisted", async () => {
    vi.mocked(api.listDecks).mockResolvedValue({
      decks: [...SORTABLE, V3_DECKS[1]] as DeckView[],
    });
    mount("superuser", "u_super");
    await screen.findByRole("button", { name: "CompleteCo" });

    for (const box of ["Uploaded", "AI Evaluated", "Not AI Evaluated", "Incomplete", "Archived", "Assigned"]) {
      fireEvent.click(tile(box));
      expect(screen.queryByRole("button", { name: "Status" }), box).not.toBeNull();
    }
    fireEvent.click(tile("Shortlisted"));
    expect(headers()).toEqual(V3_SHORTLISTED);
    expect(screen.queryByRole("button", { name: "Status" })).toBeNull();
  });

  /**
   * S0-VOCAB's note to this session: `THE DENOMINATOR` above pins that an
   * archived row stays on the uploaded status screen (the client, 2026-09-23:
   * "archive is a state, not a move"), and it now also needs a SORTABLE status
   * on that row. `archived` is in the label map and ranks last, so the row that
   * used to vanish is the one the descending sort puts at the top.
   */
  it("an archived row has a status the sort can rank (archive is a state)", async () => {
    mount("superuser", "u_super");
    await screen.findByRole("button", { name: "ArchivedCo" });
    fireEvent.click(screen.getByRole("button", { name: "Status" }));
    fireEvent.click(screen.getByRole("button", { name: "Status" }));
    expect(names()[0]).toBe("ArchivedCo");
    const row = screen.getByRole("button", { name: "ArchivedCo" }).closest("tr")!;
    expect(within(row).getByTestId("v3-status")).toHaveTextContent("Archived");
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * S2-DASH — I7, the transient zero-button state
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * His "Contact details edited" row asks for a state with **no buttons of its
 * own** while the system re-checks. It is the one status `screeningStatus`
 * deliberately never returns: the re-check is synchronous with
 * `PATCH /api/decks/:id`, so the state lives for the duration of one request and
 * storing it would be storing a request. `rowBusy` is the hook the plan says to
 * generalise (§3.2) — generalised rather than reused, because `runRowAction`
 * sets `rowBusy` too and a transition is not a contact edit.
 */
describe("V3 — Contact details edited is the in-flight save (I7)", () => {
  beforeEach(() => {
    vi.mocked(api.listDecks).mockResolvedValue({ decks: V3_DECKS });
  });

  it("shows his transient word, and no active button, while the re-check runs", async () => {
    // A save that never settles, so the transient can be observed at all.
    let release: () => void = () => {};
    vi.mocked(api.updateDeckDetails).mockImplementation(
      () => new Promise((resolve) => (release = () => resolve({ deck: V3_DECKS[0] } as never))),
    );

    mount("superuser", "u_super");
    await screen.findByRole("button", { name: "FinStack" });
    const fin = () => screen.getByRole("button", { name: "FinStack" }).closest("tr")!;

    fireEvent.change(screen.getByRole("combobox", { name: "Actions for FinStack" }), {
      target: { value: "__edit" },
    });
    fireEvent.change(await screen.findByLabelText("Phone — FinStack"), {
      target: { value: "+91 90000 12345" },
    });
    // Before the save the row still reads its derived status.
    expect(within(fin()).getByTestId("v3-status")).toHaveTextContent("Complete");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // HIS ROW: the word, and nothing on the row that can be clicked.
    await waitFor(() =>
      expect(within(fin()).getByTestId("v3-status")).toHaveTextContent("Contact details edited"),
    );
    expect(within(fin()).getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(within(fin()).queryByRole("combobox")).toBeNull();

    // And it is transient: the status returns to a derived word once the PATCH
    // settles. `PATCH /api/decks/:id` re-derives both completeness columns and
    // writes the `edit_contact` event, so the reload lands the row on one of his
    // four Edited statuses — here, nothing was missing, so Complete, Edited.
    release();
    await waitFor(() => expect(within(fin()).queryByRole("combobox")).not.toBeNull());
  });

  it("a failed save does not strand the row in the transient state", async () => {
    vi.mocked(api.updateDeckDetails).mockRejectedValue(new Error("network"));
    mount("superuser", "u_super");
    await screen.findByRole("button", { name: "FinStack" });

    fireEvent.change(screen.getByRole("combobox", { name: "Actions for FinStack" }), {
      target: { value: "__edit" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    await screen.findByText(/Couldn't save FinStack/);
    // The edit row is still open (nothing was saved), and the Save button is
    // live again rather than frozen at "Saving…".
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
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
