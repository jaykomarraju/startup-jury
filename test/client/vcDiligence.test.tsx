import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, within, configure, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { AuthContext, type AuthUser } from "../../src/client/auth/AuthProvider";
import { StagePage, VC_STAGE_CONFIG, type StageConfig } from "../../src/client/routes/StagePage";
import { IcVotePage, addlMeanAcrossRoles } from "../../src/client/routes/IcVotePage";
import { archiveReason } from "../../src/client/routes/VcDiligence";
import type { DeckView } from "../../src/client/types";
import type { Role } from "../../src/shared/roles";
import type { DdItemView, DealView, DdSummary } from "../../src/shared/diligence";

/**
 * W9-C — the VC diligence-to-close screens, from their real configs.
 *
 *  • Investment DD, Term sheet Pipeline, Legal DD, Onboard ready (and the IC
 *    member's Invest ready) and Archive: each screen's exact header set, its
 *    legend and its footer sentence.
 *  • The DD checklist is a custom sub-tab, and moving an item writes it.
 *  • IC Pipeline: the decision-queue table, the Recommendation select casting
 *    the viewer's vote, and the IC member's read-only Status.
 *  • The three StageConfig keys this session added — custom columns, `extra`
 *    and `roleVariants` — draw nothing, and fetch nothing, when omitted.
 *
 * Every assertion is gated on a POPULATED row, never on a heading the loading
 * branch also renders.
 */

configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 30_000 });

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function deck(over: Partial<DeckView>): DeckView {
  return {
    id: "d1",
    name: "GreenRoute",
    sector: "Climatetech",
    stage: "Pre-seed",
    city: "Hyderabad",
    aiScore: 8.6,
    juryScore: 7.4,
    decisionScore: 8.0,
    statusId: "investment_dd",
    status: "Investment DD",
    actions: [],
    ...over,
  };
}

const sum = (done: number, total: number, flagged = 0): DdSummary => ({ done, total, flagged, started: done + flagged > 0 });

function deal(over: Partial<DealView> & { deckId: string }): DealView {
  return {
    stage: "investment_dd",
    investment: sum(0, 6),
    legal: null,
    mpApproval: "not_approved",
    mpApprovalSet: false,
    ddStatus: "yet_to_start",
    investmentLead: null,
    legalLead: null,
    ask: null,
    valuation: null,
    partnerName: null,
    clearedAt: null,
    lastActivityAt: null,
    termSheet: { status: null, doc: null },
    ...over,
  };
}

const ITEMS: DdItemView[] = ["Market", "Team references", "Customer calls", "Product / Tech review", "Financials & metrics", "Competitive positioning"].map(
  (label, i) => ({
    id: `i${i + 1}`,
    track: "investment",
    sortOrder: i + 1,
    label,
    defaultLabel: label,
    status: i === 0 ? "done" : "not_started",
    owner: i === 0 ? "M. Sharma" : null,
    rating: i === 0 ? "strong" : null,
    finding: null,
    updatedAt: null,
  }),
);

// Two other roles' additional parameters (mean 7.0) and the IC member's own, which the headline excludes.
const REPORT_ADDITIONAL = [
  { role: "associate", roleLabel: "Associate", rows: [{ key: "a1", name: "Thesis fit", weight: 0, cells: { u1: { value: 8 } } }] },
  { role: "partner", roleLabel: "Partner", rows: [{ key: "p1", name: "Traction", weight: 0, cells: { u2: { value: 6 } } }] },
  { role: "ic_member", roleLabel: "IC member", rows: [{ key: "i1", name: "Scalability", weight: 0, cells: { u3: { value: 1 } } }] },
];

interface Mock {
  decks: DeckView[];
  deals?: DealView[];
  votes?: Record<string, { myVote: string | null }>;
}

function mockApi({ decks, deals = [], votes = {} }: Mock) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    let body: unknown = {};
    if (url === "/api/decks" || url.startsWith("/api/decks?")) body = { decks };
    else if (url === "/api/diligence") body = { deals };
    else if (/^\/api\/diligence\/[^/]+\/checklist\/investment$/.test(url)) {
      body = { deckId: "d1", startup: "GreenRoute", track: "investment", items: ITEMS, summary: sum(1, 6), renameable: true };
    } else if (/^\/api\/diligence\/[^/]+\/checklist\/investment\/[^/]+$/.test(url)) {
      const patch = JSON.parse(String(init?.body)) as Partial<DdItemView>;
      const id = url.split("/").pop();
      body = { item: { ...ITEMS.find((i) => i.id === id)!, ...patch, updatedAt: "2026-09-13" }, deal: deals[0] };
    } else if (/^\/api\/decks\/[^/]+\/ic-votes$/.test(url)) {
      const id = url.split("/")[3];
      body = {
        votes: [],
        tally: { invest: 0, hold: 0, need_more_info: 0, pass: 0 },
        total: 0,
        recommendation: null,
        myVote: votes[id]?.myVote ?? null,
      };
    } else if (/^\/api\/decks\/[^/]+\/ic-vote$/.test(url)) body = { ok: true };
    else if (/^\/api\/decks\/[^/]+\/report/.test(url)) body = { core: [], additional: REPORT_ADDITIONAL };
    else if (url.startsWith("/api/decks/")) body = { deck: decks[0], scores: [], extraction: [], versions: [] };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

function asRole(role: Role, ui: ReactNode) {
  const user: AuthUser = { id: `vc_${role}`, name: "Test", initials: "TT", role, edition: "vc" };
  return render(
    <AuthContext.Provider value={{ user, loading: false, login: vi.fn(), logout: vi.fn(), updateUser: vi.fn() }}>
      {ui}
    </AuthContext.Provider>,
  );
}

const headers = (table: HTMLElement) =>
  within(table)
    .getAllByRole("columnheader")
    .map((th) => th.textContent);

const footer = () => screen.getByTestId("stage-footer-stat").textContent;
const legend = () =>
  within(screen.getByTestId("stage-legend"))
    .getAllByText(/./)
    .map((el) => el.textContent);

// ═══════════════════════════════════════════════════════════════════════════

describe("Investment DD — panel-investmentdd", () => {
  const DEALS = [
    deal({ deckId: "d1", investment: sum(6, 6), ddStatus: "completed", mpApproval: "approved", investmentLead: "M. Sharma" }),
    deal({ deckId: "d2", investment: sum(2, 6, 1), ddStatus: "in_progress", mpApproval: "approved" }),
    deal({ deckId: "d3" }),
  ];
  const DECKS = [
    deck({ id: "d1", name: "GreenRoute" }),
    deck({ id: "d2", name: "InsureFlow", stage: "Series A" }),
    deck({ id: "d3", name: "TaxPilot", actions: [{ action: "mp_approve_dd", label: "Approve for IC", to: "ic_review" }] }),
  ];

  it("draws the prototype's eleven headers, the Done / In progress / Flagged legend and the ddRender footer", async () => {
    mockApi({ decks: DECKS, deals: DEALS });
    asRole("partner", <StagePage config={VC_STAGE_CONFIG.investmentdd} />);
    const table = await screen.findByRole("table");
    await within(table).findByText("M. Sharma");
    expect(headers(table)).toEqual([
      "Startup",
      "Avg. score",
      "Addl. parameters",
      "Sector",
      "Stage",
      "MP approval",
      "Status",
      "Diligence progress",
      "Flags",
      "Lead",
      "Checklist",
    ]);
    expect(legend()).toEqual(["Done", "In progress", "Flagged"]);
    expect(footer()).toBe("3 deals in diligence · 1 complete · 1 with flags");
    expect(screen.getByRole("heading", { name: "Investment DD" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Pre-IC investment diligence · market, team, customers, product, financials & competition · log findings before the deal reaches IC",
      ),
    ).toBeInTheDocument();

    const insure = screen.getByRole("row", { name: /InsureFlow/ });
    expect(within(insure).getByText("1 flagged")).toBeInTheDocument();
    expect(within(insure).getByTestId("dd-progress")).toHaveTextContent("2/6");
    expect(within(screen.getByRole("row", { name: /TaxPilot/ })).getByText("— not started —")).toBeInTheDocument();
    expect((screen.getByLabelText("MP approval for GreenRoute") as HTMLSelectElement).value).toBe("approved");
  });

  it("filters on the legend's words while the footer still counts the stage", async () => {
    mockApi({ decks: DECKS, deals: DEALS });
    asRole("partner", <StagePage config={VC_STAGE_CONFIG.investmentdd} />);
    await screen.findByText("M. Sharma");
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Flagged" }));
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByRole("row", { name: /InsureFlow/ })).toBeInTheDocument();
    expect(footer()).toBe("3 deals in diligence · 1 complete · 1 with flags");
  });

  it("MP approval is a record the partner sets, and an IC member only reads", async () => {
    const calls = mockApi({ decks: DECKS, deals: DEALS });
    const { unmount } = asRole("partner", <StagePage config={VC_STAGE_CONFIG.investmentdd} />);
    await screen.findByText("M. Sharma");
    fireEvent.change(screen.getByLabelText("MP approval for TaxPilot"), { target: { value: "approved" } });
    await waitFor(() =>
      expect(calls.find((c) => c.method === "PUT" && c.url === "/api/diligence/d3/mp-approval")?.body).toEqual({ value: "approved" }),
    );
    unmount();

    mockApi({ decks: DECKS, deals: DEALS });
    asRole("ic_member", <StagePage config={VC_STAGE_CONFIG.investmentdd} />);
    await screen.findByText("M. Sharma");
    expect(screen.getByLabelText("MP approval for TaxPilot")).toBeDisabled();
    expect(screen.getByLabelText("Diligence status for TaxPilot")).not.toBeDisabled();
  });

  it("the DD checklist is a custom sub-tab: Open checklist renders the six items, and moving one writes it", async () => {
    const calls = mockApi({ decks: DECKS, deals: DEALS });
    asRole("partner", <StagePage config={VC_STAGE_CONFIG.investmentdd} />);
    await screen.findByText("M. Sharma");
    fireEvent.click(within(screen.getByRole("row", { name: /TaxPilot/ })).getByRole("button", { name: /Open checklist/ }));

    const pane = await screen.findByTestId("stage-pane");
    const list = await within(pane).findByTestId("pane-checklist-investment");
    expect(within(pane).getByRole("tab", { name: /Checklist/, selected: true })).toBeInTheDocument();
    expect(within(list).getAllByTestId("dd-item")).toHaveLength(6);
    expect((within(list).getByLabelText("Checklist item 1") as HTMLInputElement).value).toBe("Market");

    fireEvent.change(within(list).getByLabelText("Status for Customer calls"), { target: { value: "flagged" } });
    await waitFor(() =>
      expect(calls.find((c) => c.method === "PATCH")).toMatchObject({
        url: "/api/diligence/d3/checklist/investment/i3",
        body: { status: "flagged" },
      }),
    );
    // The deck's own move sits at the foot of the tab — the table has no Action column.
    expect(within(pane).getByRole("button", { name: "Approve for IC" })).toBeInTheDocument();
  });
});

describe("Term sheet Pipeline — panel-incuration", () => {
  it("draws the eleven headers with the call block, the Signed / Issued / Drafted / Declined legend and the footer", async () => {
    mockApi({
      decks: [
        deck({ id: "d1", name: "GreenRoute", statusId: "term_sheet", callScheduledAt: "2026-06-24T10:00:00Z", callStatus: "completed" }),
        deck({ id: "d2", name: "AgriChain", statusId: "term_sheet" }),
        deck({ id: "d3", name: "InsureFlow", statusId: "term_sheet" }),
      ],
      deals: [
        deal({
          deckId: "d1",
          stage: "term_sheet",
          partnerName: "Ishaan Sethi",
          termSheet: {
            status: "signed",
            doc: { fileName: "GreenRoute_term-sheet-v3.docx", templateName: "Term Sheet", templateVersion: "v3", version: "executed" },
          },
        }),
        deal({ deckId: "d2", stage: "term_sheet", termSheet: { status: "issued", doc: null } }),
        deal({ deckId: "d3", stage: "term_sheet", termSheet: { status: "drafted", doc: null } }),
      ],
    });
    asRole("partner", <StagePage config={VC_STAGE_CONFIG.incuration} />);
    const table = await screen.findByRole("table");
    await within(table).findByText("Ishaan Sethi");
    expect(headers(table)).toEqual([
      "Startup",
      "AI score",
      "Partner",
      "Avg. score",
      "Addl. Parameter scores",
      "Call scheduled",
      "Call date",
      "Call completed",
      "Schedule call",
      "Term sheet status",
      "Term sheet doc",
    ]);
    expect(legend()).toEqual(["Signed", "Issued", "Drafted", "Declined"]);
    expect(footer()).toBe("3 deals in term-sheet stage · 2 issued · 1 signed");

    const green = screen.getByRole("row", { name: /GreenRoute/ });
    expect(within(green).getByText("Executed")).toBeInTheDocument();
    // Call scheduled's badge, and Schedule call's "already scheduled" in place of the button.
    expect(within(green).getAllByText("Scheduled")).toHaveLength(2);
    expect(within(green).queryByRole("button", { name: /Schedule call/ })).not.toBeInTheDocument();
    const agri = screen.getByRole("row", { name: /AgriChain/ });
    expect(within(agri).getByRole("button", { name: /Attach/ })).toBeInTheDocument();
    expect(within(agri).getByRole("button", { name: /Schedule call/ })).toBeInTheDocument();
    expect((screen.getByLabelText("Term sheet status for AgriChain") as HTMLSelectElement).value).toBe("issued");
  });
});

describe("Legal DD — panel-legaldd", () => {
  it("draws the nine headers ending in Sign up, the legend and the ldRender footer", async () => {
    mockApi({
      decks: [deck({ id: "d1", name: "GreenRoute", statusId: "legal_dd" }), deck({ id: "d2", name: "AgriChain", statusId: "legal_dd" })],
      deals: [
        deal({ deckId: "d1", stage: "legal_dd", legal: sum(7, 7), legalLead: "Legal — A. Rao" }),
        deal({ deckId: "d2", stage: "legal_dd", legal: sum(2, 7, 1) }),
      ],
    });
    asRole("partner", <StagePage config={VC_STAGE_CONFIG.legaldd} />);
    const table = await screen.findByRole("table");
    await within(table).findByText("Legal — A. Rao");
    expect(headers(table)).toEqual([
      "Startup",
      "Avg. score",
      "Addl. parameters",
      "Sector",
      "Stage",
      "Legal DD progress",
      "Flags",
      "Lead",
      "Sign up",
    ]);
    expect(legend()).toEqual(["Done", "In progress", "Flagged"]);
    expect(footer()).toBe("2 deals in legal DD · 1 cleared · 1 with flags");
    expect(screen.getByText("Post-signing confirmatory & legal diligence · clear all items before the round closes")).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole("row", { name: /AgriChain/ })).getByRole("button", { name: /Open sign up/ }));
    const pane = await screen.findByTestId("stage-pane");
    expect(within(pane).getByTestId("pane-signup-record")).toBeInTheDocument();
    expect(within(pane).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Checklist", "Sign up", "Deck", "All scores"]);
  });
});

describe("Onboard ready — panel-curation, and the IC member's Invest ready", () => {
  const DECKS = [
    deck({ id: "d1", name: "QuantIQ", statusId: "onboard_ready", curationStage: "Demo prep", onboardingProgress: 80 }),
    deck({ id: "d2", name: "FreshCart", statusId: "term_sheet" }),
  ];
  const DEALS = [
    deal({ deckId: "d1", stage: "onboard_ready", ask: "₹22 Cr", legalLead: "Legal — S. Mehta", clearedAt: "2026-06-02T09:00:00Z" }),
    deal({ deckId: "d2", stage: "term_sheet", ask: "₹5.0 Cr", investmentLead: "R. Kumar", lastActivityAt: new Date().toISOString() }),
  ];

  it("the Super User's eight headers, the Action select and the footer — with no diligence fetch", async () => {
    const calls = mockApi({ decks: DECKS, deals: DEALS });
    asRole("superuser", <StagePage config={VC_STAGE_CONFIG.curation} />);
    const table = await screen.findByRole("table");
    await within(table).findByText("QuantIQ");
    expect(headers(table)).toEqual([
      "Startup",
      "Avg. score",
      "Addl. parameters",
      "Cohort",
      "Curation stage",
      "Jury member lead",
      "Progress",
      "Action",
    ]);
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(footer()).toBe("1 startup in active curation");
    expect(within(screen.getByLabelText("Action for QuantIQ")).getByRole("option", { name: "View profile" })).toBeInTheDocument();
    expect(calls.some((c) => c.url === "/api/diligence")).toBe(false);
  });

  it("the IC member gets Invest ready: its title, its six headers, deals from alignment call to close, and its footer", async () => {
    mockApi({ decks: DECKS, deals: DEALS });
    asRole("ic_member", <StagePage config={VC_STAGE_CONFIG.curation} />);
    const table = await screen.findByRole("table");
    await within(table).findByText("₹22 Cr");
    expect(screen.getByRole("heading", { name: "Invest ready" })).toBeInTheDocument();
    expect(headers(table)).toEqual(["Startup", "Cleared", "Stage", "Status", "Ask", "Owner"]);
    expect(footer()).toBe("2 deals cleared · 1 funded");
    const quant = screen.getByRole("row", { name: /QuantIQ/ });
    expect(within(quant).getByText("Closed")).toBeInTheDocument();
    expect(within(quant).getByText("Funded")).toBeInTheDocument();
    expect(within(quant).getByText("Legal — S. Mehta")).toBeInTheDocument();
    const fresh = screen.getByRole("row", { name: /FreshCart/ });
    expect(within(fresh).getByText("Term sheet")).toBeInTheDocument();
    expect(within(fresh).getByText("On track")).toBeInTheDocument();
  });
});

describe("Archive — panel-archive", () => {
  it("draws the reason as the prototype's pill for every VC exit, never the stage name", async () => {
    mockApi({
      decks: [
        deck({ id: "d1", name: "PayRoute", statusId: "archived", status: "Archived", exitAction: "not_shortlisted_partner" }),
        deck({ id: "d2", name: "CreditBridge", statusId: "archived", status: "Archived", exitAction: "pass_at_call" }),
        deck({ id: "d3", name: "Ledger", statusId: "archived", status: "Archived", exitAction: "archive" }),
      ],
    });
    asRole("partner", <StagePage config={VC_STAGE_CONFIG.archive} />);
    const table = await screen.findByRole("table");
    await within(table).findByText("PayRoute");
    expect(headers(table)).toEqual(["Startup", "Reason", "Stage reached", "Archived on", "Archived by", "Action"]);
    expect(within(screen.getByRole("row", { name: /PayRoute/ })).getByText("Rejected")).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: /CreditBridge/ })).getByText("Rejected")).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: /Ledger/ })).getByText("Archived")).toBeInTheDocument();
    expect(footer()).toBe("3 archived startups");
  });

  it("maps every way a VC deal leaves the pipeline", () => {
    for (const a of ["not_shortlisted", "not_shortlisted_partner", "pass_at_call", "pass"]) {
      expect(archiveReason(deck({ exitAction: a })), a).toBe("rejected");
    }
    expect(archiveReason(deck({ exitAction: "archive" }))).toBe("archived");
    expect(archiveReason(deck({ exitAction: undefined }))).toBe("archived");
  });
});

describe("IC Pipeline — panel-icpipeline (icqRender)", () => {
  const DECKS = [
    deck({ id: "c1", name: "CreditBridge", statusId: "ic_review", stage: "Series A", sector: "Fintech" }),
    deck({ id: "c2", name: "DockFlow", statusId: "mp_decision", stage: "Series A", sector: "Logistics" }),
  ];
  const DEALS = [
    deal({ deckId: "c1", stage: "ic_review", investment: sum(6, 6), ask: "₹1.5 Cr", valuation: "₹8 Cr" }),
    deal({ deckId: "c2", stage: "mp_decision", investment: sum(4, 6, 1), ask: "₹4.0 Cr", valuation: "₹22 Cr" }),
  ];

  it("draws the ten-column queue, the four-word legend, the footer, and casts the viewer's vote from the Recommendation select", async () => {
    const calls = mockApi({ decks: DECKS, deals: DEALS, votes: { c2: { myVote: "invest" } } });
    asRole("partner", <IcVotePage />);
    const table = await screen.findByRole("table");
    await within(table).findByText("₹8 Cr");
    expect(headers(table)).toEqual([
      "Startup",
      "Sector",
      "Stage",
      "AI score",
      "Avg. score",
      "Addl. parameters",
      "DD",
      "Ask",
      "Valuation",
      "Recommendation",
    ]);
    expect(legend()).toEqual(["Invest", "Hold", "Need more info", "Pass"]);
    await waitFor(() => expect(footer()).toBe("2 startups in the decision queue · 1 marked Invest"));
    expect(screen.getByText("Decision Queue — Investment Committee review, scoring and final recommendation")).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: /DockFlow/ })).getByRole("button", { name: "4/6 · 1 flagged" })).toBeInTheDocument();

    // The vote is closed once the deal reaches the MP.
    expect(screen.getByLabelText("Recommendation for DockFlow")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Recommendation for CreditBridge"), { target: { value: "hold" } });
    await waitFor(() =>
      expect(calls.find((c) => c.method === "POST")).toMatchObject({ url: "/api/decks/c1/ic-vote", body: { vote: "hold" } }),
    );

    // The DD badge opens the slide-over on the checklist.
    fireEvent.click(within(screen.getByRole("row", { name: /CreditBridge/ })).getByRole("button", { name: "6/6" }));
    const pane = await screen.findByTestId("stage-pane");
    expect(await within(pane).findByTestId("pane-checklist-investment")).toBeInTheDocument();
  });

  it("the IC member's last column is a read-only Status, as their build draws it", async () => {
    mockApi({ decks: DECKS, deals: DEALS, votes: { c1: { myVote: "need_more_info" } } });
    asRole("ic_member", <IcVotePage />);
    const table = await screen.findByRole("table");
    await within(table).findByText("Need more info");
    expect(headers(table).at(-1)).toBe("Status");
    expect(screen.queryByLabelText("Recommendation for CreditBridge")).not.toBeInTheDocument();
    // F0599 — the cross-role additional-parameter mean beside a Details chip.
    const row = screen.getByRole("row", { name: /CreditBridge/ });
    await within(row).findByText("7.0");
    expect(within(row).getByRole("button", { name: "Details" })).toBeInTheDocument();
  });

  it("the cross-role mean ignores the IC member's own lens and is null before anyone scores", () => {
    expect(addlMeanAcrossRoles({ additional: REPORT_ADDITIONAL } as never)).toBe(7);
    expect(addlMeanAcrossRoles({ additional: [] } as never)).toBeNull();
    expect(addlMeanAcrossRoles(null)).toBeNull();
  });
});

describe("the keys W9-C added draw nothing when omitted", () => {
  const BARE: StageConfig = {
    title: "Bare stage",
    subtitle: "No extension points",
    statuses: ["investment_dd"],
    columns: ["startup", "ai", "status"],
  };

  it("no `extra` → no diligence fetch, no `row.extra`; no custom column → only the named headers; no `roleVariants` → the base title for every role", async () => {
    const calls = mockApi({ decks: [deck({})], deals: [deal({ deckId: "d1" })] });
    asRole("ic_member", <StagePage config={BARE} />);
    const table = await screen.findByRole("table");
    await within(table).findByText("GreenRoute");
    expect(headers(table)).toEqual(["Startup", "AI score", "Status", "Action"]);
    expect(screen.getByRole("heading", { name: "Bare stage" })).toBeInTheDocument();
    expect(calls.map((c) => c.url)).not.toContain("/api/diligence");
  });

  it("a variant for another role leaves this role on the base config", async () => {
    mockApi({ decks: [deck({})] });
    asRole("partner", <StagePage config={{ ...BARE, roleVariants: { ic_member: { title: "Only for IC" } } }} />);
    await screen.findByText("GreenRoute");
    expect(screen.getByRole("heading", { name: "Bare stage" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Only for IC" })).not.toBeInTheDocument();
  });
});
