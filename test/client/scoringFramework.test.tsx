import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { AuthContext, type AuthUser } from "../../src/client/auth/AuthProvider";
import { ScoringFrameworkSection } from "../../src/client/routes/admin/ScoringFramework";
import { AreaWeightsSection } from "../../src/client/routes/admin/AreaWeights";
import { AdminSaveContext, type AdminSaveState } from "../../src/client/routes/admin/saveContext";
import { DEFAULT_SCORING_SETTINGS, decisionScore } from "../../src/shared/scoring";
import {
  DEFAULT_VISIBILITY,
  VISIBILITY_ROLES,
} from "../../src/shared/scoreVisibility";
import { getConfig, updateWeights, updateAdditionalParam } from "../../src/client/api";
import {
  getScoringFramework,
  saveScoringFramework,
  setConfigPermitted,
  type ScoringFrameworkView,
} from "../../src/client/routes/admin/scoringApi";
import { updateThresholds } from "../../src/client/api";
import type { Edition, Role } from "../../src/shared/roles";

/**
 * W2-A — the two console sections. What is asserted here is the prototype's
 * own contract: the exact control set of `admin/s-fw.html`, the §1.2 omission,
 * the live 100 % total and its three footer strings from `admin/_scripts.js`,
 * the ×3.3 bar, and the *Permit configuration* pill.
 */

vi.mock("../../src/client/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/api")>()),
  getConfig: vi.fn(),
  updateWeights: vi.fn(),
  updateAdditionalParam: vi.fn(),
  updateThresholds: vi.fn(),
}));

vi.mock("../../src/client/routes/admin/scoringApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/routes/admin/scoringApi")>()),
  getScoringFramework: vi.fn(),
  saveScoringFramework: vi.fn(),
  setConfigPermitted: vi.fn(),
}));

function principal(role: Role = "admin", edition: Edition = "incubator"): AuthUser {
  return { id: "u1", name: "Nisha Kapoor", initials: "NK", role, edition };
}

/** Captures whatever the section registers with the console's title-bar Save. */
function mountSection(node: React.ReactNode, role: Role = "admin", edition: Edition = "incubator") {
  const saved: { state: AdminSaveState | null } = { state: null };
  const view = render(
    <AuthContext.Provider
      value={{
        user: principal(role, edition),
        loading: false,
        login: vi.fn(),
        logout: vi.fn(),
        updateUser: vi.fn(),
      }}
    >
      <AdminSaveContext.Provider
        value={{
          register: (s) => {
            saved.state = s;
          },
        }}
      >
        {node}
      </AdminSaveContext.Provider>
    </AuthContext.Provider>,
  );
  return { view, saved };
}

/**
 * V4-WEIGHT — two decks whose halves reproduce the §4.1 measurement exactly:
 * at the shipped 40 % they blend to 7.95 and 8.75, and the whole sweep to 50 %
 * moves them to 7.88 and 8.73. Those are the numbers the client saw nothing
 * change, so they are the numbers the preview has to make visible.
 */
const WEIGHT_PREVIEW_DECKS = [
  { id: "d1", name: "FinStack", aiScore: 7.53, humanAverage: 8.23 },
  { id: "d2", name: "GreenGrid", aiScore: 8.63, humanAverage: 8.83 },
];

const CORE = [
  { id: "p1", key: "problem", name: "Problem & Market Clarity", weight: 8, informational: false },
  { id: "p2", key: "solution", name: "Solution & Value Proposition", weight: 82, informational: false },
  { id: "p3", key: "story", name: "Storytelling & Deck Quality", weight: 10, informational: false },
];

const ADDITIONAL = [
  {
    id: "a1",
    key: "add_barriers_of_entry",
    name: "Barriers of entry",
    weight: 0,
    informational: true,
    roleScope: "jury",
    configPermitted: true,
  },
  {
    id: "a2",
    key: "add_scalability",
    name: "Scalability",
    weight: 0,
    informational: true,
    roleScope: "jury",
    configPermitted: false,
  },
];

/**
 * What `GET /api/config/scoring` answers for this mount.
 *
 * P0-2 — `visibilityEditable` is the SERVER's verdict on who may move the two
 * matrices, and after this session it is the ONLY thing the console consults.
 * Every mount states it, so no test can pass by accident on a role the
 * component is no longer allowed to have an opinion about.
 */
function serveFramework(over: Partial<ScoringFrameworkView> = {}): ScoringFrameworkView {
  return {
    scoring: { ...DEFAULT_SCORING_SETTINGS },
    visibility: structuredClone(DEFAULT_VISIBILITY),
    thresholdBest: 7,
    thresholdMediocre: 5,
    editable: true,
    visibilityEditable: false,
    weightPreview: { decks: [...WEIGHT_PREVIEW_DECKS], pinnedDecks: 3 },
    ...over,
  };
}

beforeEach(() => {
  vi.mocked(getScoringFramework).mockResolvedValue(serveFramework());
  vi.mocked(saveScoringFramework).mockResolvedValue({
    ok: true,
    scoring: { ...DEFAULT_SCORING_SETTINGS },
    visibility: structuredClone(DEFAULT_VISIBILITY),
    rescored: { decks: 2, evaluations: 3 },
  });
  vi.mocked(setConfigPermitted).mockResolvedValue({ ok: true, id: "a2", permitted: true });
  vi.mocked(updateThresholds).mockResolvedValue({ ok: true, thresholdBest: 7, thresholdMediocre: 5 });
  vi.mocked(updateWeights).mockResolvedValue({
    ok: true,
    rescored: { decks: 1, evaluations: 1 },
    coreParams: CORE,
  });
  vi.mocked(updateAdditionalParam).mockResolvedValue({ ok: true, param: { id: "a1", name: "x" } });
  vi.mocked(getConfig).mockResolvedValue({
    plan: "premium",
    coreConfigEnabled: true,
    additionalEnabled: true,
    creditsBalance: 50,
    aiSystemPrompt: "",
    thresholdBest: 7,
    thresholdMediocre: 5,
    branding: {},
    coreParams: CORE,
    additionalParams: ADDITIONAL,
  } as never);
});

// ── Scoring framework ────────────────────────────────────────────────────────

describe("Scoring framework section", () => {
  it("renders every control the prototype's three cards carry", async () => {
    mountSection(<ScoringFrameworkSection />);
    await screen.findByText("AI engine behaviour");

    for (const label of [
      "AI pre-scoring enabled",
      "Auto-trigger clarification questions",
      "Show AI score to jury before they score",
      "Require override rationale",
      "Jury can see each other's scores",
      "Show 3-score view (AI · Mine · Average)",
      "Show score drift analysis in reports",
      "Include AI evidence quotes in reports",
      "Intro call AI question prompts enabled",
    ]) {
      expect(screen.getByRole("switch", { name: label })).toBeInTheDocument();
    }
    for (const field of [
      "Score scale",
      "Composite formula",
      "AI weight in composite",
      "Shortlist threshold",
    ]) {
      expect(screen.getByLabelText(field)).toBeInTheDocument();
    }
  });

  it("omits 'Mentor can adjust composite' — §1.2, the column does not exist", async () => {
    mountSection(<ScoringFrameworkSection />);
    await screen.findByText("AI engine behaviour");
    expect(screen.queryByText(/Mentor can adjust composite/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/mentor/i)).not.toBeInTheDocument();
  });

  it("ships the prototype's ON/OFF state — peer visibility is the one that is off", async () => {
    mountSection(<ScoringFrameworkSection />);
    await screen.findByText("AI engine behaviour");
    expect(screen.getByRole("switch", { name: "AI pre-scoring enabled" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(
      screen.getByRole("switch", { name: "Jury can see each other's scores" }),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("offers the four AI/jury splits the prototype names, defaulted to 40/60", async () => {
    mountSection(<ScoringFrameworkSection />);
    const select = (await screen.findByLabelText("AI weight in composite")) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "40% AI · 60% Jury",
      "30% AI · 70% Jury",
      "50% AI · 50% Jury",
      "0% (jury only)",
    ]);
    expect(select.value).toBe("40");
  });

  it("still offers all three composite formulas — V3 items 3/4 are NOT shipped (§4 Q2/Q3)", async () => {
    // The client's list asks to hide everything but `Weighted average` and
    // `50% AI · 50% Jury`, and marked both *Workaround* — an explicit override
    // of "match the prototype exactly". The v3 console is BYTE-IDENTICAL to
    // v15 here: all three formulas, all four splits, and the AI-weight select
    // carries no `selected` attribute, so `40% AI · 60% Jury` is the effective
    // default and `migrations/0026` agrees (`ai_weight_pct DEFAULT 40`).
    //
    // Shipping the hide would silently re-weight every existing org's
    // composite, so it waits on Q2. This test is the tripwire: narrowing
    // either select is a deliberate edit here, never a quiet one.
    mountSection(<ScoringFrameworkSection />);
    const formula = (await screen.findByLabelText("Composite formula")) as HTMLSelectElement;
    expect([...formula.options].map((o) => o.textContent)).toEqual([
      "Weighted average (default)",
      "Unweighted average",
      "Median",
    ]);
    expect(formula.value).toBe("weighted_average");
    const weight = screen.getByLabelText("AI weight in composite") as HTMLSelectElement;
    expect(weight.options).toHaveLength(4);
    expect(weight.value).toBe("40");
  });

  it("shows what the AI split does to real decks, before and after, as it changes", async () => {
    // The client asked for every split but 50:50 to be HIDDEN, then said why:
    // "nothing was changing when I changed from 40:60 or 50:50 or any other
    // option, I saw no difference." The control was wired the whole time; the
    // number it moves simply was not on this screen, and on real data the
    // entire sweep is worth ~0.02–0.07 — under the one decimal the deck tables
    // round to. So the console shows the movement itself, at two decimals.
    mountSection(<ScoringFrameworkSection />);
    const strip = await screen.findByTestId("ai-weight-preview");

    // Before anything is touched: the blends the workspace is running on now.
    expect(strip).toHaveTextContent("What this split produces — 40% AI · 60% Jury");
    expect(within(strip).getByText("FinStack").closest("li")).toHaveTextContent("7.95");
    expect(within(strip).getByText("GreenGrid").closest("li")).toHaveTextContent("8.75");

    fireEvent.change(screen.getByLabelText("AI weight in composite"), { target: { value: "50" } });

    expect(strip).toHaveTextContent("What this split changes — 40% AI · 60% Jury → 50% AI · 50% Jury");
    expect(within(strip).getByText("FinStack").closest("li")).toHaveTextContent("7.95 → 7.88");
    expect(within(strip).getByText("GreenGrid").closest("li")).toHaveTextContent("8.75 → 8.73");

    // …and those are not four literals that happen to agree: they are what
    // `decisionScore` — the helper `GET /api/decks`, the shortlist hint and the
    // pipeline transition all use — produces at each split. One blend only.
    for (const d of WEIGHT_PREVIEW_DECKS) {
      const row = within(strip).getByText(d.name).closest("li")!;
      expect(row).toHaveTextContent(String(decisionScore(d.aiScore, [d.humanAverage], 40)));
      expect(row).toHaveTextContent(String(decisionScore(d.aiScore, [d.humanAverage], 50)));
    }

    // Decks the control cannot move are named, not silently omitted.
    expect(strip).toHaveTextContent(
      "3 decks follow a programme or cohort split of their own and are not affected by this control.",
    );
  });

  it("says nothing is blendable rather than drawing an empty strip", async () => {
    vi.mocked(getScoringFramework).mockResolvedValue(
      serveFramework({ weightPreview: { decks: [], pinnedDecks: 0 } }),
    );
    mountSection(<ScoringFrameworkSection />);
    const strip = await screen.findByTestId("ai-weight-preview");
    expect(strip).toHaveTextContent(/No deck in this workspace has both an AI score and a jury score/);
  });

  it("previews the three cohort bands and clamps Poor to Best as you type", async () => {
    mountSection(<ScoringFrameworkSection />);
    const preview = await screen.findByTestId("threshold-preview");
    expect(preview).toHaveTextContent("Best ≥ 7.0");
    expect(preview).toHaveTextContent("Mediocre 5.0 – 6.9");
    expect(preview).toHaveTextContent("Poor < 5.0");

    // The prototype's `updThr()` clamps: Poor can never exceed Best.
    fireEvent.change(screen.getByLabelText(/Poor — below/), { target: { value: "9" } });
    expect(await screen.findByTestId("threshold-preview")).toHaveTextContent("Poor < 7.0");
  });

  it("saves the whole section through the console's single Save changes", async () => {
    const { saved } = mountSection(<ScoringFrameworkSection />);
    await screen.findByText("AI engine behaviour");
    // Nothing changed yet — the title bar button stays disabled.
    expect(saved.state?.dirty).toBe(false);

    fireEvent.click(screen.getByRole("switch", { name: "AI pre-scoring enabled" }));
    await waitFor(() => expect(saved.state?.dirty).toBe(true));

    await saved.state!.onSave();
    await waitFor(() =>
      expect(saveScoringFramework).toHaveBeenCalledWith(
        expect.objectContaining({ aiPreScoringEnabled: false }),
        // V3 item 13 — the matrices ride this same save. Nothing was flipped
        // here, so no cell is sent and every one keeps following the default.
        {},
      ),
    );
    // The cohort bands are saved with it — they are one card in the prototype.
    expect(updateThresholds).toHaveBeenCalledWith(7, 5);
    expect(await screen.findByText(/2 decks re-scored/)).toBeInTheDocument();
  });

  it("is read-only for a role that may see it but not change it", async () => {
    vi.mocked(getScoringFramework).mockResolvedValue(serveFramework({ editable: false }));
    const { saved } = mountSection(<ScoringFrameworkSection />, "jury");
    expect(await screen.findByText(/only an administrator can change/i)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "AI pre-scoring enabled" })).toBeDisabled();
    expect(saved.state).toBeNull();
  });

  it("says so when it cannot load rather than rendering an empty pane", async () => {
    vi.mocked(getScoringFramework).mockRejectedValue(new Error("boom"));
    mountSection(<ScoringFrameworkSection />);
    expect(await screen.findByText(/Couldn't load the scoring framework/)).toBeInTheDocument();
  });
});

// ── Area weights ─────────────────────────────────────────────────────────────

// ── V3 item 13 · the score visibility matrices ───────────────────────────────

/**
 * The two `Score visibility matrix` cards the v3 superuser prototype adds to
 * `s-fw` (decoded from `ADMIN_B64`; a grep of the .HTM finds none of it).
 *
 * The literals below are copied from that decoded markup rather than imported
 * from the component, so a rename in the component fails the test instead of
 * silently renaming the assertion with it.
 *
 * **P0-2 (`docs/plan_roles_incubator.md` §5).** These cards were drawn for the
 * incubator superuser by a role test made HERE, while
 * `PUT /api/config/scoring-framework` accepted the grid from any console admin
 * — so an admin could grant a program associate sight of program-manager
 * scores through an API whose console did not show them the grid. Decided
 * Q-U (a): the admin keeps the capability and gains the grid, and the rule
 * moves to the server that enforces it (`config.ts` → `canEditVisibility`,
 * shipped as `visibilityEditable`).
 *
 * That makes the client's own contract narrow and testable: **the console draws
 * the grids when the server says this member may edit them, and never
 * otherwise.** The negative control runs both ways below — a role that used to
 * be refused here renders the grid when the server allows it, and the role that
 * used to be hard-coded in does NOT render it when the server refuses. Neither
 * assertion can pass if the component keeps a role opinion of its own. The
 * matching proof on the write path — that the same predicate decides the 403 —
 * is `test/worker/score-visibility-gate.test.ts`, against the payload.
 */
describe("Score visibility matrices (V3 item 13)", () => {
  const SU: [Role, Edition] = ["superuser", "incubator"];

  async function mountAsSuperuser() {
    vi.mocked(getScoringFramework).mockResolvedValue(serveFramework({ visibilityEditable: true }));
    const r = mountSection(<ScoringFrameworkSection />, ...SU);
    await screen.findByText("Visibility for Incubator");
    return r;
  }

  it("draws both matrices with the prototype's titles, caption and headers", async () => {
    await mountAsSuperuser();

    expect(screen.getByText("Visibility for Incubator")).toBeInTheDocument();
    expect(screen.getByText("Visibility for VC")).toBeInTheDocument();
    expect(screen.getByText("Score visibility matrix")).toBeInTheDocument();
    expect(screen.getByText("Score visibility matrix — Investor")).toBeInTheDocument();
    expect(screen.getAllByText("Viewer (row) → can see scores of (column)")).toHaveLength(2);

    const [inc, vc] = screen.getAllByRole("table");
    const headers = (t: HTMLElement) =>
      [...within(t).getAllByRole("columnheader")].map((h) => h.textContent);
    expect(headers(inc)).toEqual(["Role", "Super User", "Program Mgr", "Program Assoc", "Jury Member"]);
    expect(headers(vc)).toEqual(["Role", "Mng Partner", "IC", "Partner", "Inv. Assoc", "Analyst"]);

    const rows = (t: HTMLElement) => [...within(t).getAllByRole("rowheader")].map((h) => h.textContent);
    expect(rows(inc)).toEqual(["Super User", "Program Manager", "Program Associate", "Jury Member"]);
    expect(rows(vc)).toEqual([
      "Managing Partner",
      "IC member",
      "Partner/Principal",
      "Inv. Associate",
      "Analyst",
    ]);

    // One switch per cell: 4×4 + 5×5, plus the nine toggles of the three cards.
    expect(within(inc).getAllByRole("switch")).toHaveLength(VISIBILITY_ROLES.incubator.length ** 2);
    expect(within(vc).getAllByRole("switch")).toHaveLength(VISIBILITY_ROLES.vc.length ** 2);
  });

  it("carries the prototype's two footnotes verbatim", async () => {
    await mountAsSuperuser();
    expect(
      screen.getByText(
        "Defaults: Super User & Program Manager see everyone; Program Associate and Jury Member see no one — jury members cannot see each other (blind evaluation) until turned on here.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Defaults: Managing Partner, IC member and Partner/Principal see everyone; Inv. Associate and Analyst see no one until turned on here.",
      ),
    ).toBeInTheDocument();
  });

  it("renders the matrix the SERVER resolved, not a client-side default", async () => {
    // The server is the only authority on this state — it is what the report
    // route enforces. Feed a non-default cell and the screen must show it.
    const served = structuredClone(DEFAULT_VISIBILITY);
    served.incubator.jury!.jury = true;
    served.incubator.superuser!.jury = false;
    vi.mocked(getScoringFramework).mockResolvedValue(
      serveFramework({ visibility: served, visibilityEditable: true }),
    );
    const { view } = mountSection(<ScoringFrameworkSection />, ...SU);
    await screen.findByText("Visibility for Incubator");
    expect(view.container).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Jury Member can see Jury Member scores" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("switch", { name: "Super User can see Jury Member scores" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("shows the prototype's shipped toggle state for an org that has set nothing", async () => {
    await mountAsSuperuser();
    // "Super User & Program Manager see everyone…"
    for (const col of ["Super User", "Program Mgr", "Program Assoc", "Jury Member"]) {
      for (const row of ["Super User", "Program Manager"]) {
        expect(screen.getByRole("switch", { name: `${row} can see ${col} scores` })).toHaveAttribute(
          "aria-checked",
          "true",
        );
      }
      // "…Program Associate and Jury Member see no one."
      for (const row of ["Program Associate", "Jury Member"]) {
        expect(screen.getByRole("switch", { name: `${row} can see ${col} scores` })).toHaveAttribute(
          "aria-checked",
          "false",
        );
      }
    }
  });

  it("sends ONLY the flipped cells, so untouched ones keep following the default", async () => {
    const { saved } = await mountAsSuperuser();
    fireEvent.click(screen.getByRole("switch", { name: "Jury Member can see Program Assoc scores" }));
    expect(screen.getByRole("switch", { name: "Jury Member can see Program Assoc scores" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(saved.state?.dirty).toBe(true);

    await saved.state!.onSave();
    expect(saveScoringFramework).toHaveBeenCalledWith(
      expect.objectContaining({ aiWeightPct: 40 }),
      { incubator: { jury: { program_associate: true } } },
    );
  });

  it("is read-only for a superuser the server says may not edit", async () => {
    // `editable` and `visibilityEditable` are different questions: a member the
    // permission grid has locked out of the section still sees the state the
    // report route enforces, greyed out, rather than a blank where a permission
    // system used to be.
    vi.mocked(getScoringFramework).mockResolvedValue(
      serveFramework({ editable: false, visibilityEditable: true }),
    );
    mountSection(<ScoringFrameworkSection />, ...SU);
    await screen.findByText("Visibility for Incubator");
    expect(screen.getByRole("switch", { name: "Jury Member can see Jury Member scores" })).toBeDisabled();
  });

  it("the incubator ADMIN now gets the grid — P0-2, in the direction the server already took", async () => {
    // The defect: this role could already move the matrix through
    // `PUT /api/config/scoring-framework` and could not see it. It is the one
    // role whose capability and screen disagreed, so it is the one row of this
    // table that changes.
    vi.mocked(getScoringFramework).mockResolvedValue(serveFramework({ visibilityEditable: true }));
    mountSection(<ScoringFrameworkSection />, "admin", "incubator");
    await screen.findByText("Visibility for Incubator");
    expect(screen.getByText("Visibility for VC")).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "Jury Member can see Jury Member scores" }),
    ).toBeEnabled();
  });

  it("tells the admin their own role is in neither grid, rather than letting them find out", async () => {
    // Q-U (b) is deliberately NOT taken this wave: `admin` is a row and column
    // of neither matrix (`scoreVisibility.ts:78`) and adding it moves migration
    // 0072's persisted shape. An unexplained absence in a permission grid is
    // how "a role is missing" gets filed, so the screen says it.
    vi.mocked(getScoringFramework).mockResolvedValue(serveFramework({ visibilityEditable: true }));
    mountSection(<ScoringFrameworkSection />, "admin", "incubator");
    await screen.findByText("Visibility for Incubator");
    expect(screen.getByText(/Your own role, Admin, is not a row or column here/)).toBeInTheDocument();

    // …and it is NOT said to a superuser, who is the first row of both grids.
    screen.getByText("Visibility for VC");
    expect(VISIBILITY_ROLES.incubator).toContain("superuser");
  });

  // ── The negative control, both directions ─────────────────────────────────
  //
  // The component must have NO role opinion of its own left. Proving that takes
  // two mounts that contradict each other: the server's answer wins in both, so
  // neither can pass while a `role === …` test survives in the component.

  it("NEGATIVE ← the server refuses: a SUPERUSER gets no grid, however privileged", async () => {
    // The role the old client-side predicate hard-coded IN. If the component
    // still carried it, this mount would draw the matrices anyway — which is
    // exactly the failure that let the screen and the route drift apart.
    vi.mocked(getScoringFramework).mockResolvedValue(serveFramework({ visibilityEditable: false }));
    mountSection(<ScoringFrameworkSection />, ...SU);
    await screen.findByText("AI engine behaviour");
    expect(screen.queryByText("Visibility for Incubator")).not.toBeInTheDocument();
    expect(screen.queryByText("Visibility for VC")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("NEGATIVE → the server allows: a PROGRAM ASSOCIATE gets the grid, however unprivileged", async () => {
    // The mirror image. No role reaches this state through the shipped server
    // predicate — `PUT` is `requireTask("adminconsole", "admin")`, so a PA is
    // refused there and `visibilityEditable` is false for them — and that is
    // the point: if the server's rule ever moves, the console moves WITH it
    // instead of having to be found and edited a second time.
    vi.mocked(getScoringFramework).mockResolvedValue(serveFramework({ visibilityEditable: true }));
    mountSection(<ScoringFrameworkSection />, "program_associate", "incubator");
    await screen.findByText("Visibility for Incubator");
    expect(screen.getAllByRole("table")).toHaveLength(2);
  });

  it("the roles the server refuses see the section exactly as today", async () => {
    // Everyone the shipped predicate says no to — every role but the incubator
    // superuser and admin, plus BOTH VC consoles, whose `admin/s-fw.html` is
    // byte-identical (md5 c3b534ba…) and draws no matrix at all. They keep the
    // single "Jury can see each other's scores" toggle the v3 screen supersedes.
    for (const [role, edition] of [
      ["program_manager", "incubator"],
      ["program_associate", "incubator"],
      ["jury", "incubator"],
      ["superuser", "vc"],
      ["admin", "vc"],
    ] as Array<[Role, Edition]>) {
      vi.mocked(getScoringFramework).mockResolvedValue(
        serveFramework({ visibilityEditable: false }),
      );
      const { view } = mountSection(<ScoringFrameworkSection />, role, edition);
      await screen.findByText("AI engine behaviour");
      expect(screen.queryByText("Visibility for Incubator")).not.toBeInTheDocument();
      expect(screen.queryByText("Visibility for VC")).not.toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      // The note about a role outside the grid belongs to the grid — no grid,
      // no note.
      expect(screen.queryByText(/is not a row or column here/)).not.toBeInTheDocument();
      expect(
        screen.getByRole("switch", { name: "Jury can see each other's scores" }),
      ).toBeInTheDocument();
      view.unmount();
    }
  });
});

describe("Area weights section", () => {
  it("renders the prototype's five columns, the Core pill and a mono index", async () => {
    mountSection(<AreaWeightsSection />);
    await screen.findByLabelText("Problem & Market Clarity weight");
    for (const header of ["#", "Evaluation area", "Type", "Weight %", "Visual"]) {
      expect(screen.getAllByRole("columnheader", { name: header }).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText("Core")).toHaveLength(CORE.length);
    // Zero-padded mono index cells, one set per table.
    expect(screen.getAllByText("01").length).toBeGreaterThan(0);
    expect(screen.getByText("03")).toBeInTheDocument();
  });

  it("draws the bar at the prototype's ×3.3 scale", async () => {
    mountSection(<AreaWeightsSection />);
    const bar = await screen.findByTestId("weight-bar-problem");
    // 8 × 3.3 = 26.4 % of the 70 px track (`admin/_scripts.js:254`).
    expect(bar.style.width.startsWith("26.4")).toBe(true);
    fireEvent.change(screen.getByLabelText("Problem & Market Clarity weight"), {
      target: { value: "40" },
    });
    // …capped at 100 %.
    expect(screen.getByTestId("weight-bar-problem").style.width).toBe("100%");
  });

  it("reports the live total with the prototype's own three strings", async () => {
    mountSection(<AreaWeightsSection />);
    // 8 + 82 + 10 = 100.
    expect(await screen.findByTestId("weight-total")).toHaveTextContent("Total: 100% ✓");

    fireEvent.change(screen.getByLabelText("Problem & Market Clarity weight"), {
      target: { value: "4" },
    });
    expect(screen.getByTestId("weight-total")).toHaveTextContent("Total: 96% — 4% remaining");

    fireEvent.change(screen.getByLabelText("Problem & Market Clarity weight"), {
      target: { value: "12" },
    });
    expect(screen.getByTestId("weight-total")).toHaveTextContent("Total: 104% — over by 4%");
  });

  it("refuses to save while the total is not 100 % (F0153)", async () => {
    const { saved } = mountSection(<AreaWeightsSection />);
    await screen.findByLabelText("Problem & Market Clarity weight");

    fireEvent.change(screen.getByLabelText("Problem & Market Clarity weight"), {
      target: { value: "4" },
    });
    await waitFor(() => expect(saved.state?.dirty).toBe(false));
    expect(saved.state?.hint).toBe("Total: 96% — 4% remaining");

    fireEvent.change(screen.getByLabelText("Problem & Market Clarity weight"), {
      target: { value: "8" },
    });
    await waitFor(() => expect(saved.state?.dirty).toBe(true));
  });

  it("sends an area RENAME with the weights (F0079 — the API always took one)", async () => {
    const { saved } = mountSection(<AreaWeightsSection />);
    await screen.findByLabelText("Problem & Market Clarity name");
    fireEvent.change(screen.getByLabelText("Problem & Market Clarity name"), {
      target: { value: "Problem clarity" },
    });
    await waitFor(() => expect(saved.state?.dirty).toBe(true));
    await saved.state!.onSave();
    await waitFor(() =>
      expect(updateWeights).toHaveBeenCalledWith([
        { id: "p1", weight: 8, name: "Problem clarity" },
        { id: "p2", weight: 82, name: "Solution & Value Proposition" },
        { id: "p3", weight: 10, name: "Storytelling & Deck Quality" },
      ]),
    );
  });

  it("renders the role cards in the same section, with their tier badges", async () => {
    mountSection(<AreaWeightsSection />);
    expect(await screen.findByText("Additional configurable parameters")).toBeInTheDocument();
    for (const badge of ["AI+ score", "AI++ score", "AI+++ score"]) {
      expect(screen.getByText(badge)).toBeInTheDocument();
    }
    expect(screen.getAllByText("/ 10")).toHaveLength(ADDITIONAL.length);
    expect(screen.getAllByText(/Set total: max/)).toHaveLength(3); // one per owning role
  });

  it("toggles Permit configuration per parameter", async () => {
    mountSection(<AreaWeightsSection />);
    await screen.findByText("Additional configurable parameters");
    // Seeded: parameter 1 of the role is permitted, the rest are not.
    expect(screen.getByRole("button", { name: "Permitted" })).toBeInTheDocument();
    const grant = screen.getByRole("button", { name: "Permit configuration" });
    fireEvent.click(grant);
    await waitFor(() => expect(setConfigPermitted).toHaveBeenCalledWith("a2", true));
    expect(await screen.findAllByRole("button", { name: "Permitted" })).toHaveLength(2);
  });

  it("is read-only on a plan that does not include core configuration", async () => {
    vi.mocked(getConfig).mockResolvedValue({
      plan: "standard",
      coreConfigEnabled: false,
      additionalEnabled: false,
      creditsBalance: 0,
      aiSystemPrompt: "",
      thresholdBest: 7,
      thresholdMediocre: 5,
      branding: {},
      coreParams: CORE,
      additionalParams: ADDITIONAL,
    } as never);
    const { saved } = mountSection(<AreaWeightsSection />);
    expect(await screen.findByText(/requires the Pro or Premium plan/)).toBeInTheDocument();
    expect(screen.getByLabelText("Problem & Market Clarity weight")).toBeDisabled();
    expect(saved.state).toBeNull();
  });

  it("names the areas with the count the payload actually carries", async () => {
    mountSection(<AreaWeightsSection />);
    const heading = await screen.findByRole("heading", { level: 2, name: "Area weights" });
    expect(within(heading.parentElement as HTMLElement).getByText(/3 evaluation areas/)).toBeInTheDocument();
  });
});
