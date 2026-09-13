import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MyParamsPage, myParamsTabs } from "../../src/client/routes/MyParamsPage";
import {
  getParameterConfig,
  saveRoleParam,
  type ParameterConfigView,
  type RoleParamView,
} from "../../src/client/routes/parametersApi";
import type { Edition, Role } from "../../src/shared/roles";

/**
 * W8-B — My Parameters to `panel-myparams.html`: the role TABS (one role at a
 * time, the set each role's build draws), the four fields per parameter plus its
 * switch, the "How this works" box, and the read-only states the server's
 * configuration view decides.
 */

vi.mock("../../src/client/routes/parametersApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/routes/parametersApi")>()),
  getParameterConfig: vi.fn(),
  saveRoleParam: vi.fn(),
  addRoleParam: vi.fn(),
  removeRoleParam: vi.fn(),
}));

const principal: { role: Role; edition: Edition } = { role: "superuser", edition: "incubator" };
vi.mock("../../src/client/auth/useAuth", () => ({
  useAuth: () => ({ user: { id: "u1", name: "P", initials: "P", ...principal } }),
}));

function param(
  id: string,
  roleScope: string,
  name: string,
  over: Partial<RoleParamView> = {},
): RoleParamView {
  return {
    id,
    key: id,
    name,
    weight: 0,
    informational: true,
    roleScope,
    description: `${name} — shown while scoring.`,
    prompt: `Assess {{startup_name}} for ${name}. Score 0–10.`,
    enabled: true,
    editable: true,
    ...over,
  };
}

const INCUBATOR: RoleParamView[] = [
  param("pm1", "program_manager", "TRL stage"),
  param("pm2", "program_manager", "Product-Market Fit"),
  param("pm3", "program_manager", "Traction"),
  param("pa1", "program_associate", "Program fit"),
  param("pa2", "program_associate", "Investment stage"),
  param("pa3", "program_associate", "Ask"),
  param("j1", "jury", "Barriers of entry"),
  param("j2", "jury", "Scalability"),
  param("j3", "jury", "Industry growth"),
];

function config(over: Partial<ParameterConfigView> = {}): ParameterConfigView {
  return {
    plan: "premium",
    memberTier: "premium",
    effectivePlan: "premium",
    coreConfigEnabled: true,
    additionalEnabled: true,
    coreEditor: true,
    additionalEditor: true,
    coreParams: Array.from({ length: 13 }, (_, i) => ({
      id: `c${i}`,
      key: `c${i}`,
      name: `Area ${i + 1}`,
      weight: i === 0 ? 16 : 7,
      informational: false,
    })),
    additionalParams: INCUBATOR,
    ...over,
  };
}

function as(role: Role, edition: Edition = "incubator") {
  principal.role = role;
  principal.edition = edition;
}

async function mount() {
  render(<MyParamsPage />);
  // Gate on a POPULATED element, not on the shell.
  return screen.findByRole("tablist", { name: "Owning roles" });
}

const tabNames = (list: HTMLElement) => within(list).getAllByRole("tab").map((t) => t.textContent?.trim());

beforeEach(() => {
  vi.clearAllMocks();
  as("superuser");
  vi.mocked(getParameterConfig).mockResolvedValue(config());
  vi.mocked(saveRoleParam).mockResolvedValue({
    ok: true,
    param: { id: "x", name: "x", enabled: true },
  });
});

describe("My Parameters · the role tabs", () => {
  it("incubator Program Manager: Program Manager · Program Associate · Jury Member", async () => {
    as("program_manager");
    expect(tabNames(await mount())).toEqual(["Program Manager", "Program Associate", "Jury Member"]);
  });

  it("incubator Program Associate: the same three", async () => {
    as("program_associate");
    expect(tabNames(await mount())).toEqual(["Program Manager", "Program Associate", "Jury Member"]);
  });

  it("incubator Jury: the juror's own tab alone (`AISJ_IC_Jury_V4`)", async () => {
    as("jury");
    vi.mocked(getParameterConfig).mockResolvedValue(
      config({
        memberTier: "standard",
        effectivePlan: "standard",
        additionalEnabled: false,
        coreConfigEnabled: false,
        coreEditor: false,
        additionalEditor: false,
        additionalParams: INCUBATOR.map((p) => ({ ...p, editable: false })),
      }),
    );
    const list = await mount();
    expect(tabNames(list)).toEqual(["Jury Member"]);
    expect(screen.getByText("Barriers of entry")).toBeInTheDocument();
    expect(screen.queryByText("TRL stage")).not.toBeInTheDocument();
  });

  it("VC: three owner roles for every role, the analyst included — no fourth tab (§8 Q3)", () => {
    for (const role of ["superuser", "admin", "partner", "ic_member", "associate", "analyst"] as Role[]) {
      expect(myParamsTabs("vc", role)).toEqual(["associate", "partner", "ic_member"]);
    }
  });

  it("VC Analyst renders Investment Associate · Partner · IC Member", async () => {
    as("analyst", "vc");
    vi.mocked(getParameterConfig).mockResolvedValue(
      config({
        additionalParams: [
          param("v1", "associate", "Thesis fit"),
          param("v2", "partner", "TRL stage"),
          param("v3", "ic_member", "Exit attractiveness"),
        ],
      }),
    );
    expect(tabNames(await mount())).toEqual(["Investment Associate", "Partner", "IC Member"]);
  });

  it("shows one role at a time, and the tab switches it", async () => {
    await mount();
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("Program Manager · 3 configurable parameters")).toBeInTheDocument();
    expect(within(panel).getByDisplayValue("TRL stage")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Program fit")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Program Associate" }));
    expect(screen.getByRole("tab", { name: "Program Associate" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByDisplayValue("Program fit")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("TRL stage")).not.toBeInTheDocument();
  });
});

describe("My Parameters · each parameter", () => {
  it("carries label, weight (Informational / 5% / 10%), scoring description, AI prompt and a switch", async () => {
    await mount();
    expect(screen.getAllByTestId("param-block")).toHaveLength(3);

    expect(screen.getByLabelText("Label for TRL stage")).toHaveValue("TRL stage");
    const weight = screen.getByLabelText("Scoring weight for TRL stage");
    expect(within(weight).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Informational (not weighted)",
      "5% additional weight",
      "10% additional weight",
    ]);
    // §8 Q21 — drawn, but only Informational can be chosen.
    expect(within(weight).getByRole("option", { name: "5% additional weight" })).toBeDisabled();
    expect(weight).toHaveValue("informational");
    expect(screen.getByLabelText("Scoring description for TRL stage")).toHaveValue("TRL stage — shown while scoring.");
    expect(screen.getByLabelText("AI prompt for TRL stage")).toHaveValue(
      "Assess {{startup_name}} for TRL stage. Score 0–10.",
    );
    expect(screen.getByRole("switch", { name: "TRL stage enabled" })).toHaveAttribute("aria-checked", "true");

    expect(screen.getByText(/How this works:/)).toBeInTheDocument();
    expect(screen.getByText(/a description visible to them during scoring, and an AI extraction prompt/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save all parameters/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Preview in scoring view/ })).toBeInTheDocument();
  });

  it("Save all parameters sends only what changed — label, description and the switch", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("Label for TRL stage"), { target: { value: "TRL" } });
    fireEvent.change(screen.getByLabelText("Scoring description for Traction"), { target: { value: "Momentum." } });
    fireEvent.click(screen.getByRole("switch", { name: "Product-Market Fit enabled" }));
    fireEvent.click(screen.getByRole("button", { name: /Save all parameters/ }));

    await waitFor(() => expect(saveRoleParam).toHaveBeenCalledTimes(3));
    expect(saveRoleParam).toHaveBeenCalledWith("pm1", { name: "TRL" });
    expect(saveRoleParam).toHaveBeenCalledWith("pm2", { enabled: false });
    expect(saveRoleParam).toHaveBeenCalledWith("pm3", { description: "Momentum." });
  });

  it("Reset brings back the last saved prompt", async () => {
    await mount();
    const prompt = screen.getByLabelText("AI prompt for TRL stage");
    fireEvent.change(prompt, { target: { value: "Something else" } });
    const block = prompt.closest("[data-testid=param-block]") as HTMLElement;
    fireEvent.click(within(block).getByRole("button", { name: "Reset" }));
    expect(prompt).toHaveValue("Assess {{startup_name}} for TRL stage. Score 0–10.");
  });

  it("Preview in scoring view shows the draft as the evaluator's glance card, switched-off ones left out", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("Scoring description for TRL stage"), { target: { value: "Draft text." } });
    fireEvent.click(screen.getByRole("switch", { name: "Traction enabled" }));
    fireEvent.click(screen.getByRole("button", { name: /Preview in scoring view/ }));
    const dialog = screen.getByRole("dialog", { name: "Preview in scoring view" });
    expect(within(dialog).getByText("Your three additional parameters at a glance")).toBeInTheDocument();
    expect(within(dialog).getByText("Draft text.")).toBeInTheDocument();
    expect(within(dialog).queryByText("Traction")).not.toBeInTheDocument();
    expect(within(dialog).getByText(/1 switched off/)).toBeInTheDocument();
  });

  it("a draft survives the mount fetch landing late (StrictMode runs it twice)", async () => {
    let resolveSecond: (v: ParameterConfigView) => void = () => undefined;
    vi.mocked(getParameterConfig)
      .mockResolvedValueOnce(config())
      .mockReturnValueOnce(new Promise((r) => (resolveSecond = r)));
    const { rerender } = render(<MyParamsPage />);
    const label = await screen.findByLabelText("Label for TRL stage");
    fireEvent.change(label, { target: { value: "Typed before the refetch" } });

    // A second read (as a save or StrictMode would trigger) lands afterwards.
    fireEvent.change(screen.getByLabelText("Scoring description for Traction"), { target: { value: "x" } });
    vi.mocked(saveRoleParam).mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: /Save all parameters/ }));
    resolveSecond(config());
    rerender(<MyParamsPage />);

    await waitFor(() => expect(screen.getByText("Couldn't save. Try again.")).toBeInTheDocument());
    expect(screen.getByLabelText("Label for TRL stage")).toHaveValue("Typed before the refetch");
  });
});

describe("My Parameters · read-only", () => {
  it("a role without the permission sees everything, disabled, with the role note", async () => {
    as("program_associate");
    vi.mocked(getParameterConfig).mockResolvedValue(
      config({ additionalEditor: false, additionalParams: INCUBATOR.map((p) => ({ ...p, editable: false })) }),
    );
    await mount();
    expect(screen.getByRole("note")).toHaveTextContent(
      "Read-only — your role doesn’t have permission to configure additional parameters.",
    );
    expect(screen.getByLabelText("Label for TRL stage")).toBeDisabled();
    expect(screen.getByLabelText("AI prompt for TRL stage")).toBeDisabled();
    expect(screen.getByRole("switch", { name: "TRL stage enabled" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Save all parameters/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Save all$/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("a plan that stops short of Premium keeps the parameters visible and says which plan", async () => {
    as("admin");
    vi.mocked(getParameterConfig).mockResolvedValue(
      config({
        memberTier: "pro",
        effectivePlan: "pro",
        additionalEnabled: false,
        additionalParams: INCUBATOR.map((p) => ({ ...p, editable: false })),
      }),
    );
    await mount();
    expect(screen.getByRole("note")).toHaveTextContent(
      "Read-only — the 3 additional parameters require the Premium plan. Your current plan is Pro plan.",
    );
    // Not an empty state: the real content, greyed (F0509 / F0528).
    expect(screen.getByDisplayValue("TRL stage")).toBeDisabled();
  });

  it("a per-parameter grant makes just that one editable", async () => {
    as("jury");
    vi.mocked(getParameterConfig).mockResolvedValue(
      config({
        additionalEditor: false,
        additionalParams: INCUBATOR.map((p) => ({ ...p, editable: p.id === "j1" })),
      }),
    );
    await mount();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Label for Barriers of entry")).toBeEnabled();
    expect(screen.getByLabelText("Label for Scalability")).toBeDisabled();
  });
});
