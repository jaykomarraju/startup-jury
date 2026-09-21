import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { AuthContext, type AuthUser } from "../../src/client/auth/AuthProvider";
import { AreaWeightsSection } from "../../src/client/routes/admin/AreaWeights";
import { AdminSaveContext, type AdminSaveState } from "../../src/client/routes/admin/saveContext";
import { getConfig, updateWeights, updateAdditionalParam } from "../../src/client/api";
import { setConfigPermitted } from "../../src/client/routes/admin/scoringApi";
import {
  getPrompts,
  restoreAllPrompts,
  restorePrompt,
  savePrompt,
  setSeatCapability,
  type PromptView,
} from "../../src/client/routes/admin/aiPromptsApi";
import {
  ADDITIONAL_RESTORE_ALL_CONFIRM,
  DEFAULT_SEAT_CAPABILITY,
  RESTORE_ONE_CONFIRM,
  SEAT_CAPABILITY_FOOTNOTE,
  coreRestoreAllConfirm,
  defaultSeatCapability,
} from "../../src/shared/aiPrompts";
import type { Edition, Role } from "../../src/shared/roles";

/**
 * V3-AW — Area weights, items 11 and 12, against section `s-wt` of the v3
 * superuser prototype's BASE64 admin console (decode with
 * `docs/prototype/tools/decode-embedded.py`; a plain grep of the .HTM finds
 * none of it).
 *
 * The literals below are copied from that decoded markup rather than imported
 * from the component, so a rename in the component fails the test instead of
 * silently redefining what parity means.
 *
 * The other half of this file is the constraint: only the SUPERUSER prototype
 * was reshared, so an incubator admin and a VC superuser must still get the old
 * section — `Type`, `Permit configuration`, no grid.
 */

vi.mock("../../src/client/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/api")>()),
  getConfig: vi.fn(),
  updateWeights: vi.fn(),
  updateAdditionalParam: vi.fn(),
}));

vi.mock("../../src/client/routes/admin/scoringApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/routes/admin/scoringApi")>()),
  setConfigPermitted: vi.fn(),
}));

vi.mock("../../src/client/routes/admin/aiPromptsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/routes/admin/aiPromptsApi")>()),
  getPrompts: vi.fn(),
  savePrompt: vi.fn(),
  restorePrompt: vi.fn(),
  restoreAllPrompts: vi.fn(),
  setSeatCapability: vi.fn(),
}));

function principal(role: Role = "superuser", edition: Edition = "incubator"): AuthUser {
  return { id: "u1", name: "Priya Sharma", initials: "PS", role, edition };
}

function mountSection(role: Role = "superuser", edition: Edition = "incubator") {
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
      <AdminSaveContext.Provider value={{ register: (s) => { saved.state = s; } }}>
        <AreaWeightsSection />
      </AdminSaveContext.Provider>
    </AuthContext.Provider>,
  );
  return { view, saved };
}

const CORE = [
  { id: "p1", key: "problem_market_clarity", name: "Problem & Market Clarity", weight: 60, informational: false },
  { id: "p2", key: "market_size", name: "Market Size & Opportunity", weight: 40, informational: false },
];

const ADDITIONAL = [
  { id: "a1", key: "add_program_fit", name: "Program fit", weight: 0, informational: true, roleScope: "program_manager", configPermitted: true },
  { id: "a2", key: "add_scalability", name: "Scalability", weight: 0, informational: true, roleScope: "jury", configPermitted: false },
];

function promptView(over: Partial<PromptView> & { id: string }): PromptView {
  return {
    key: "k",
    name: "n",
    informational: false,
    roleScope: null,
    prompt: `Guidance for ${over.id}.`,
    promptDefault: `Guidance for ${over.id}.`,
    isDefault: true,
    ...over,
  };
}

const PROMPTS: PromptView[] = [
  promptView({ id: "p1", key: "problem_market_clarity", name: "Problem & Market Clarity" }),
  promptView({ id: "p2", key: "market_size", name: "Market Size & Opportunity" }),
  promptView({ id: "a1", key: "add_program_fit", name: "Program fit", informational: true, roleScope: "program_manager" }),
  promptView({ id: "a2", key: "add_scalability", name: "Scalability", informational: true, roleScope: "jury" }),
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getConfig).mockResolvedValue({
    plan: "premium",
    coreConfigEnabled: true,
    additionalEnabled: true,
    creditsBalance: 10,
    aiSystemPrompt: "",
    thresholdBest: 7,
    thresholdMediocre: 5,
    branding: { primary: "#4A6644", logoUrl: null, orgName: "Demo" },
    coreParams: CORE,
    additionalParams: ADDITIONAL,
  } as unknown as Awaited<ReturnType<typeof getConfig>>);
  vi.mocked(updateWeights).mockResolvedValue({
    ok: true,
    rescored: { decks: 0, evaluations: 0 },
    coreParams: CORE,
  } as unknown as Awaited<ReturnType<typeof updateWeights>>);
  vi.mocked(updateAdditionalParam).mockResolvedValue({
    ok: true,
    param: { id: "a1", name: "Program fit" },
  });
  vi.mocked(setConfigPermitted).mockResolvedValue({ ok: true, id: "a2", permitted: true });
  vi.mocked(getPrompts).mockResolvedValue({
    params: PROMPTS,
    capability: defaultSeatCapability(),
    tier: "premium",
    coreEditable: true,
    additionalEditable: true,
  });
  vi.mocked(savePrompt).mockImplementation((id, prompt) =>
    Promise.resolve({ ok: true, param: promptView({ id, prompt, isDefault: false }) }),
  );
  vi.mocked(restorePrompt).mockImplementation((id) =>
    Promise.resolve({ ok: true, param: promptView({ id }) }),
  );
  vi.mocked(restoreAllPrompts).mockResolvedValue({
    ok: true,
    set: "core",
    restored: 2,
    params: PROMPTS,
  });
  vi.mocked(setSeatCapability).mockResolvedValue({
    ok: true,
    capability: defaultSeatCapability(),
  });
});

/** The headers of the Nth table on screen. */
function headers(index: number): string[] {
  return headersOf(screen.getAllByRole("table")[index]);
}

function headersOf(table: HTMLElement): string[] {
  return within(table)
    .getAllByRole("columnheader")
    .map((th) => th.textContent?.trim() ?? "");
}

/**
 * The table whose first header is `first`. Indexing by position breaks the
 * moment item 12 inserts the Seat-configurability grid between the weights
 * table and the role cards, which is exactly the change under test.
 */
function tableStartingWith(first: string): HTMLElement {
  const table = screen.getAllByRole("table").find((t) => headersOf(t)[0] === first);
  expect(table, `no table whose first column is "${first}"`).toBeTruthy();
  return table!;
}

/**
 * The `Additional configurable parameters` sub-line, whole and whitespace-
 * normalised. 21-Sep item 13(a) deletes two SENTENCES out of the middle of it,
 * so the assertion has to be the whole paragraph: a `queryByText(...).toBeNull()`
 * on each deleted sentence would also pass against a section that never
 * rendered, and a regex on what survives would not notice a sentence returning.
 */
function additionalSubline(): string {
  const heading = screen.getByRole("heading", { name: "Additional configurable parameters" });
  const sub = heading.parentElement?.querySelector("p");
  expect(sub, "no sub-line under `Additional configurable parameters`").toBeTruthy();
  return (sub!.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The row editor's textarea — same accessible name as the button, other role. */
function promptTextarea(name: string): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: `AI prompt — ${name}` }) as HTMLTextAreaElement;
}

// ── Item 11 · the AI prompt column ──────────────────────────────────────────

describe("V3-AW item 11 · AI prompt per evaluation area", () => {
  it("replaces the `Type` column header with `AI prompt`", async () => {
    mountSection();
    await screen.findByDisplayValue("Problem & Market Clarity");
    expect(headers(0)).toEqual(["#", "Evaluation area", "AI prompt", "Weight %", "Visual"]);
    expect(screen.queryByRole("columnheader", { name: "Type" })).toBeNull();
  });

  it("gives every core area its own AI prompt button", async () => {
    mountSection();
    await screen.findByDisplayValue("Problem & Market Clarity");
    for (const name of ["Problem & Market Clarity", "Market Size & Opportunity"]) {
      expect(screen.getByRole("button", { name: `AI prompt — ${name}` })).toBeTruthy();
    }
  });

  it("opens the row's editor with the stored prompt, disabled until Edit", async () => {
    mountSection();
    const open = await screen.findByRole("button", {
      name: "AI prompt — Problem & Market Clarity",
    });
    fireEvent.click(open);

    const ta = await waitFor(() => promptTextarea("Problem & Market Clarity"));
    expect(ta.value).toBe("Guidance for p1.");
    expect(ta.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(ta.disabled).toBe(false);
  });

  it("saves the edited prompt through the route and closes the editor", async () => {
    mountSection();
    fireEvent.click(
      await screen.findByRole("button", { name: "AI prompt — Market Size & Opportunity" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const ta = promptTextarea("Market Size & Opportunity");
    fireEvent.change(ta, { target: { value: "Bottom-up TAM only." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(savePrompt).toHaveBeenCalledWith("p2", "Bottom-up TAM only."));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Save" })).toBeNull(),
    );
  });

  it("only one row's editor is open at a time", async () => {
    mountSection();
    fireEvent.click(
      await screen.findByRole("button", { name: "AI prompt — Problem & Market Clarity" }),
    );
    expect(screen.getByTestId("prompt-row-problem_market_clarity")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "AI prompt — Market Size & Opportunity" }));
    expect(screen.queryByTestId("prompt-row-problem_market_clarity")).toBeNull();
    expect(screen.getByTestId("prompt-row-market_size")).toBeTruthy();
  });

  it("restores one prompt behind the prototype's own confirmation", async () => {
    vi.mocked(getPrompts).mockResolvedValue({
      params: PROMPTS.map((p) => (p.id === "p1" ? { ...p, prompt: "drifted", isDefault: false } : p)),
      capability: defaultSeatCapability(),
      tier: "premium",
      coreEditable: true,
      additionalEditable: true,
    });
    mountSection();
    fireEvent.click(
      await screen.findByRole("button", { name: "AI prompt — Problem & Market Clarity" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Restore default" }));

    // Verbatim from `wtPromptRestore`'s `aisjAsk(...)`.
    expect(screen.getByText(RESTORE_ONE_CONFIRM)).toBeTruthy();
    expect(RESTORE_ONE_CONFIRM).toBe(
      "Reset this AI prompt to the shipped default? Your edits will be lost.",
    );
    expect(restorePrompt).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(restorePrompt).toHaveBeenCalledWith("p1"));
  });

  it("offers `Restore all core AI prompts` with the prototype's 13-area sentence", async () => {
    mountSection();
    const btn = await screen.findByRole("button", { name: "Restore all core AI prompts" });
    fireEvent.click(btn);
    // Two core areas in this fixture, so the count is the screen's, not a
    // hard-coded 13 — but the sentence is the prototype's.
    expect(screen.getByText(coreRestoreAllConfirm(2))).toBeTruthy();
    expect(coreRestoreAllConfirm(13)).toBe(
      "Reset ALL 13 core AI prompts to their shipped defaults? Every core prompt edit will be lost.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(restoreAllPrompts).toHaveBeenCalledWith("core"));
  });

  it("offers `Restore all additional-parameter prompts` for the role cards", async () => {
    mountSection();
    fireEvent.click(
      await screen.findByRole("button", { name: "Restore all additional-parameter prompts" }),
    );
    expect(screen.getByText(ADDITIONAL_RESTORE_ALL_CONFIRM)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(restoreAllPrompts).toHaveBeenCalledWith("addl"));
  });

  it("a Restore all reaches an editor that is open but keeps one being typed in", async () => {
    vi.mocked(getPrompts).mockResolvedValue({
      params: PROMPTS.map((p) =>
        p.id === "p1" ? { ...p, prompt: "drifted", isDefault: false } : p,
      ),
      capability: defaultSeatCapability(),
      tier: "premium",
      coreEditable: true,
      additionalEditable: true,
    });
    vi.mocked(restoreAllPrompts).mockResolvedValue({
      ok: true,
      set: "core",
      restored: 1,
      params: PROMPTS,
    });
    mountSection();

    // Open, not editing: the restore lands in the textarea.
    fireEvent.click(
      await screen.findByRole("button", { name: "AI prompt — Problem & Market Clarity" }),
    );
    expect(promptTextarea("Problem & Market Clarity").value).toBe("drifted");
    fireEvent.click(screen.getByRole("button", { name: "Restore all core AI prompts" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() =>
      expect(promptTextarea("Problem & Market Clarity").value).toBe("Guidance for p1."),
    );

    // Now being typed in: the draft survives. Taking text out from under a
    // cursor is the worse of the two wrongs.
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(promptTextarea("Problem & Market Clarity"), {
      target: { value: "half-written thought" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Restore all core AI prompts" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(restoreAllPrompts).toHaveBeenCalledTimes(2));
    expect(promptTextarea("Problem & Market Clarity").value).toBe("half-written thought");
  });

  it("swaps the role cards' `Permit configuration` column for `AI prompt`", async () => {
    mountSection();
    await screen.findByDisplayValue("Program fit");
    expect(headersOf(tableStartingWith("#"))).toEqual([
      "#",
      "Evaluation area",
      "AI prompt",
      "Weight %",
      "Visual",
    ]);
    const roleCard = screen
      .getAllByRole("table")
      .find((t) => headersOf(t)[1] === "Custom parameter name")!;
    expect(headersOf(roleCard)).toEqual(["#", "Custom parameter name", "Score", "AI prompt"]);
    expect(screen.queryByRole("button", { name: /Permit configuration/ })).toBeNull();
    expect(screen.getByRole("button", { name: "AI prompt — Program fit" })).toBeTruthy();
  });

  it("keeps the AI+ / AI++ / AI+++ badges, which name a score shown elsewhere", async () => {
    // v3's `addlRender` drops these. They are kept deliberately: F0078 put them
    // there, `AssignPage` and the report still print AI+ / AI++ / AI+++, and
    // nothing else on this screen says which role produces which. §4 Q62.
    mountSection();
    await screen.findByDisplayValue("Program fit");
    for (const badge of ["AI+ score", "AI++ score", "AI+++ score"]) {
      expect(screen.getByText(badge)).toBeTruthy();
    }
  });

});

// ── 21-Sep item 13(a) · two sentences the client struck ────────────────────

describe("21-Sep item 13(a) · the two deleted sentences", () => {
  it("drops both sentences the client struck", async () => {
    // The client marked two sentences "Not required" on the screen he was
    // reading, which is the SUPERUSER one. Both are deviations from the
    // prototype: "These parameters are configurable by default." is verbatim in
    // the decoded console, and the tier sentence is our wording for its "Super
    // User" line. Recorded in plan_v3_superuser.md §12.3 / §13 `S4-COPY` so the
    // next parity capture does not quietly restore them.
    mountSection();
    await screen.findByDisplayValue("Program fit");
    expect(additionalSubline()).toBe(
      "Each role — Program Associate, Program Manager, Jury Member — configures its own " +
        "set of 3 parameters, each scored 0–10 (set maximum 30).",
    );
  });

  it("keeps the AI+ / AI++ / AI+++ CONCEPT while the sentence naming it goes", async () => {
    // Reading (a) of item 13, not (b): only the sentences were deleted. The
    // concept has five sites — the badges here, `AssignPage`'s tier filter and
    // `server/routes/assignments.ts` among them — and none of them moved.
    mountSection();
    await screen.findByDisplayValue("Program fit");
    expect(additionalSubline()).not.toContain("AI+");
    for (const badge of ["AI+ score", "AI++ score", "AI+++ score"]) {
      expect(screen.getByText(badge)).toBeTruthy();
    }
    // And the deleted sentence took no information with it — §4 Q62 kept the
    // badges because "nothing else on this screen says which role produces
    // which", but each card header already pairs the two, so the sentence was
    // a restatement of the three headings below it.
    for (const [badge, role] of [
      ["AI+ score", "Program Associate"],
      ["AI++ score", "Program Manager"],
      ["AI+++ score", "Jury Member"],
    ]) {
      expect(screen.getByText(badge).closest("div")?.textContent).toContain(role);
    }
  });
});

// ── Item 12 · Seat configurability ──────────────────────────────────────────

describe("V3-AW item 12 · Seat configurability", () => {
  it("draws the grid with the prototype's exact columns and rows", async () => {
    mountSection();
    await screen.findByText("Seat configurability");
    expect(screen.getByRole("heading", { name: "Configurability" })).toBeTruthy();
    expect(headersOf(tableStartingWith("Parameter set"))).toEqual([
      "Parameter set",
      "Standard",
      "Pro",
      "Premium",
    ]);
    expect(screen.getByText("Core parameters")).toBeTruthy();
    expect(screen.getByText("13 evaluation areas & prompts")).toBeTruthy();
    expect(screen.getByText("Addl. parameters")).toBeTruthy();
    expect(screen.getByText("3 role-configurable parameters")).toBeTruthy();
  });

  it("states the prototype's defaults in the footnote", async () => {
    mountSection();
    await screen.findByText("Seat configurability");
    expect(screen.getByText(SEAT_CAPABILITY_FOOTNOTE)).toBeTruthy();
    expect(SEAT_CAPABILITY_FOOTNOTE).toContain(
      "Standard — none · Pro — core only · Premium — core + additional.",
    );
  });

  it("starts on the ladder the application has always used", async () => {
    mountSection();
    await screen.findByText("Seat configurability");
    for (const set of ["core", "addl"] as const) {
      for (const tier of ["standard", "pro", "premium"] as const) {
        const tog = screen.getByTestId(`cfg-${set}-${tier}`);
        expect(
          tog.getAttribute("aria-checked"),
          `${set}/${tier}`,
        ).toBe(String(DEFAULT_SEAT_CAPABILITY[set][tier]));
      }
    }
  });

  it("persists a flipped cell", async () => {
    mountSection();
    await screen.findByText("Seat configurability");
    fireEvent.click(screen.getByTestId("cfg-addl-pro"));
    await waitFor(() => expect(setSeatCapability).toHaveBeenCalledWith("addl", "pro", true));
    // …and re-reads what this session may now do, because the grid can revoke
    // the caller's own seat.
    await waitFor(() => expect(getPrompts).toHaveBeenCalledTimes(2));
  });

  it("puts a failed toggle back rather than leaving a lie on screen", async () => {
    vi.mocked(setSeatCapability).mockRejectedValue(new Error("nope"));
    mountSection();
    await screen.findByText("Seat configurability");
    const tog = screen.getByTestId("cfg-core-standard");
    expect(tog.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(tog);
    await waitFor(() =>
      expect(screen.getByTestId("cfg-core-standard").getAttribute("aria-checked")).toBe("false"),
    );
    expect(screen.getByText(/Couldn't change that seat permission/)).toBeTruthy();
  });

  it("disables every prompt editor for a seat the grid does not allow", async () => {
    vi.mocked(getPrompts).mockResolvedValue({
      params: PROMPTS,
      capability: defaultSeatCapability(),
      tier: "pro",
      coreEditable: true,
      additionalEditable: false,
    });
    mountSection();
    const restoreAll = await screen.findByRole("button", {
      name: "Restore all additional-parameter prompts",
    });
    expect((restoreAll as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Restore all core AI prompts" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "AI prompt — Program fit" }));
    const edit = await screen.findByRole("button", { name: "Edit" });
    expect((edit as HTMLButtonElement).disabled).toBe(true);
  });
});

// ── The constraint: the four roles whose prototype was NOT reshared ─────────

describe("the un-reshared surfaces keep today's design", () => {
  it("an incubator ADMIN still sees Type and Permit configuration", async () => {
    mountSection("admin");
    await screen.findByDisplayValue("Problem & Market Clarity");
    expect(headers(0)).toEqual(["#", "Evaluation area", "Type", "Weight %", "Visual"]);
    expect(headers(1)).toEqual(["#", "Custom parameter name", "Score", "Permit configuration"]);
    // No grid was inserted between them.
    expect(screen.getAllByRole("table")).toHaveLength(1 + 3);
    expect(screen.queryByText("Seat configurability")).toBeNull();
    expect(screen.queryByRole("button", { name: "Restore all core AI prompts" })).toBeNull();
    expect(screen.getAllByText("Core").length).toBe(CORE.length);
    // 21-Sep item 13(a) deleted two sentences from the SUPERUSER sub-line only.
    // The admin's still reads exactly as it did before that change.
    expect(additionalSubline()).toBe(
      "Each role — Program Associate, Program Manager, Jury Member — configures its own " +
        "set of 3 parameters, each scored 0–10 (set maximum 30). Each role's additional " +
        "score is surfaced as AI+ (Program Associate), AI++ (Program Manager), " +
        "AI+++ (Jury Member). Use Permit configuration to allow a role to edit a parameter.",
    );
    // …and it does not even ask for the prompts.
    expect(getPrompts).not.toHaveBeenCalled();
  });

  it("a VC superuser still sees the old section — that edition was not rescoped", async () => {
    mountSection("superuser", "vc");
    await screen.findByDisplayValue("Problem & Market Clarity");
    expect(headers(0)).toEqual(["#", "Evaluation area", "Type", "Weight %", "Visual"]);
    expect(screen.queryByText("Seat configurability")).toBeNull();
    // Item 13(a) is incubator-superuser copy. VC keeps both sentences, with its
    // own role labels.
    expect(additionalSubline()).toBe(
      "Each role — Investment Associate, Partner, IC Member — configures its own set of " +
        "3 parameters, each scored 0–10 (set maximum 30). Each role's additional score is " +
        "surfaced as AI+ (Investment Associate), AI++ (Partner), AI+++ (IC Member). " +
        "Use Permit configuration to allow a role to edit a parameter.",
    );
    expect(getPrompts).not.toHaveBeenCalled();
  });

  it("the admin's Permit configuration pill still works", async () => {
    mountSection("admin");
    await screen.findByDisplayValue("Scalability");
    fireEvent.click(screen.getByRole("button", { name: "Permit configuration" }));
    await waitFor(() => expect(setConfigPermitted).toHaveBeenCalledWith("a2", true));
  });

  it("the `Set total: max 30` footer stays for admin and goes for the superuser", async () => {
    const admin = mountSection("admin");
    await screen.findByDisplayValue("Program fit");
    expect(screen.getAllByText(/Set total: max/).length).toBeGreaterThan(0);
    admin.view.unmount();

    mountSection("superuser");
    await screen.findByDisplayValue("Program fit");
    expect(screen.queryByText(/Set total: max/)).toBeNull();
  });
});

// ── Everything the section already did, still doing it ──────────────────────

describe("the weights table is unchanged by either item", () => {
  it("keeps the live total, the ×3.3 bar and the save wiring", async () => {
    const { saved } = mountSection();
    const weight = await screen.findByLabelText("Problem & Market Clarity weight");
    expect(screen.getByTestId("weight-total").textContent).toContain("100");
    expect(screen.getByTestId("weight-bar-problem_market_clarity").style.width).toBe("100%");

    fireEvent.change(weight, { target: { value: "50" } });
    expect(saved.state?.dirty).toBe(false); // 90 % — not saveable
    fireEvent.change(screen.getByLabelText("Market Size & Opportunity weight"), {
      target: { value: "50" },
    });
    await waitFor(() => expect(saved.state?.dirty).toBe(true));
  });

  it("survives a prompts failure with the weights table intact", async () => {
    vi.mocked(getPrompts).mockRejectedValue(new Error("boom"));
    mountSection();
    await screen.findByDisplayValue("Problem & Market Clarity");
    expect(headers(0)).toEqual(["#", "Evaluation area", "AI prompt", "Weight %", "Visual"]);
    expect(
      (screen.getByRole("button", { name: "Restore all core AI prompts" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
