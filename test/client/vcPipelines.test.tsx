import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, within, configure } from "@testing-library/react";
import {
  StagePage,
  INCUBATOR_STAGE_CONFIG,
  VC_STAGE_CONFIG,
  type StageConfig,
} from "../../src/client/routes/StagePage";
import type { PipelineEvent } from "../../src/client/api";
import type { DeckView } from "../../src/client/types";
import { vcPipeline } from "../../src/pipeline/vc";

/**
 * W9-B — the VC Assoc. Pipeline and Partner Pipeline, from their real configs
 * (`panel-jurypipeline` / `panel-partnerpipeline`, `jpRowAssoc`, `jpFoot`).
 *
 *  • Each screen's exact header set, legend, footer sentence and subtitle.
 *  • F0627 — a deck the screen DECIDED stays on it with its outcome, read from
 *    the latest event that left the screen's stages (the reading agreed with
 *    `W9-E` in §9), and offers no transitions.
 *  • The `Action ▾` select: View deck opens the one-tab Pitch deck pane; the
 *    transitions carry the prototype's words.
 *  • The three new keys draw nothing and read no events when omitted.
 *
 * Every assertion waits on a POPULATED row, never on the toolbar title.
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
    name: "WealthOS",
    sector: "Wealthtech",
    stage: "Seed",
    city: "Bengaluru",
    aiScore: 8.1,
    juryScore: 8.0,
    decisionScore: 8.05,
    statusId: "associate_review",
    status: "Associate Review",
    actions: [],
    ...over,
  };
}

function event(over: Partial<PipelineEvent>): PipelineEvent {
  return {
    id: "e1",
    fromStage: "associate_review",
    fromLabel: "Associate Review",
    toStage: "partner_review",
    toLabel: "Partner Review",
    action: "shortlist_to_partner",
    note: null,
    actorName: "Sunita Rao",
    createdAt: "2026-06-03T09:00:00Z",
    ...over,
  };
}

const EXTRACTION = [{ label: "Cover", heading: "WealthOS", text: "Robo-advice for first-time investors." }];

/** Answers the deck list, each deck's events (newest first) and a deck read. */
function mockApi(decks: DeckView[], events: Record<string, PipelineEvent[]> = {}) {
  const calls: { url: string; method: string; body?: string }[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: typeof init?.body === "string" ? init.body : undefined });
    let body: unknown = {};
    const ev = /^\/api\/decks\/([^/]+)\/events$/.exec(url);
    if (url === "/api/decks" || url.startsWith("/api/decks?")) body = { decks };
    else if (ev) body = { events: events[ev[1]] ?? [] };
    else if (/^\/api\/decks\/[^/]+\/report/.test(url)) body = { core: [], additional: [] };
    else if (/^\/api\/decks\/[^/]+\/transition$/.test(url)) body = { ok: true, status: "partner_review", label: "Partner Review" };
    else if (url.startsWith("/api/decks/")) body = { deck: decks[0], scores: [], extraction: EXTRACTION, versions: [] };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

const headers = (table: HTMLElement) =>
  within(table)
    .getAllByRole("columnheader")
    .map((th) => th.textContent);

const legendWords = () =>
  within(screen.getByTestId("stage-legend"))
    .getAllByText(/./)
    .map((n) => n.textContent);

const options = (select: HTMLElement) => within(select).getAllByRole("option").map((o) => o.textContent);

const SHORTLIST = { action: "shortlist_to_partner", label: "Shortlist to partner", to: "partner_review" };
const NOT_SHORTLISTED = { action: "not_shortlisted", label: "Not shortlisted", to: "archived" };
const ADVANCE = { action: "advance_to_call", label: "Advance to partner call", to: "partner_call" };
const PASS_PARTNER = { action: "not_shortlisted_partner", label: "Not shortlisted", to: "archived" };

// ═══════════════════════════════════════════════════════════════════════════

describe("Assoc. Pipeline (VC jurypipeline)", () => {
  const DECKS = [
    deck({ id: "an", name: "TaxPilot", statusId: "analyst_scoring", status: "Analyst Scoring" }),
    deck({ id: "as", name: "WealthOS", statusId: "associate_review", actions: [SHORTLIST, NOT_SHORTLISTED] }),
    // Submitted by the associate, now with the partner — whose actions it carries.
    deck({ id: "sub", name: "AgriChain", statusId: "partner_review", status: "Partner Review", actions: [ADVANCE] }),
    // Passed by the associate.
    deck({ id: "rej", name: "PetPal", statusId: "archived", status: "Archived" }),
    // Archived before it ever reached the associate: never this screen's decision.
    deck({ id: "early", name: "NeverScored", statusId: "archived", status: "Archived" }),
    // Upstream of the screen: never listed.
    deck({ id: "up", name: "StillUploading", statusId: "uploaded", status: "Uploaded" }),
  ];
  const EVENTS = {
    sub: [event({ id: "e-sub" })],
    rej: [event({ id: "e-rej", toStage: "archived", toLabel: "Archived", action: "not_shortlisted" })],
    early: [event({ id: "e-early", fromStage: "uploaded", toStage: "archived", toLabel: "Archived", action: "archive" })],
  };

  it("draws the prototype's nine headers, its subtitle, the four-dot legend and jpFoot's sentence", async () => {
    mockApi(DECKS, EVENTS);
    render(<StagePage config={VC_STAGE_CONFIG.jurypipeline} />);
    // Decided rows arrive after their events: wait for one of those.
    await screen.findByRole("row", { name: /PetPal/ });

    expect(headers(screen.getByRole("table"))).toEqual([
      "Startup",
      "AI score",
      "Analyst Score",
      "Avg. score",
      "Addl. Parameter scores",
      "Submitted date",
      "Status",
      "Action",
      "Submit to",
    ]);
    expect(
      screen.getByText("Track every deck through jury evaluation — AI vs jury scoring, assignment and final decision"),
    ).toBeInTheDocument();
    expect(legendWords()).toEqual(["Assigned", "Shortlisted", "Rejected", "Pending"]);
    expect(screen.getByTestId("stage-footer-stat")).toHaveTextContent(
      "4 decks · 1 shortlisted · 1 rejected · 2 in progress",
    );
    expect(screen.getByRole("button", { name: "Filter" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /NeverScored/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /StillUploading/ })).not.toBeInTheDocument();
  });

  it("keeps a submitted deck with its date, its destination and the Shortlisted colour — and no transitions", async () => {
    mockApi(DECKS, EVENTS);
    render(<StagePage config={VC_STAGE_CONFIG.jurypipeline} />);
    const row = await screen.findByRole("row", { name: /AgriChain/ });

    expect(within(row).getByText("Submitted")).toHaveStyle({ color: "var(--green)" });
    expect(within(row).getByText("3 Jun 2026")).toBeInTheDocument();
    expect(within(row).getByText("Partner")).toBeInTheDocument();
    // The deck is at partner_review and carries the partner's transition; this
    // screen already decided it, so the menu offers only View deck.
    expect(options(within(row).getByRole("combobox", { name: "Action for AgriChain" }))).toEqual([
      "Action ▾",
      "View deck",
    ]);
  });

  it("keeps a passed deck as Rejected, with no date and no destination", async () => {
    mockApi(DECKS, EVENTS);
    render(<StagePage config={VC_STAGE_CONFIG.jurypipeline} />);
    const row = await screen.findByRole("row", { name: /PetPal/ });

    expect(within(row).getByText("Rejected")).toHaveStyle({ color: "var(--red)" });
    const cells = within(row).getAllByRole("cell").map((c) => c.textContent);
    expect(cells[5]).toBe("—"); // Submitted date
    expect(cells[8]).toBe("—"); // Submit to
  });

  it("gives active rows Assigned / Pending, and the transitions in the prototype's words", async () => {
    mockApi(DECKS, EVENTS);
    render(<StagePage config={VC_STAGE_CONFIG.jurypipeline} />);
    const pending = await screen.findByRole("row", { name: /WealthOS/ });

    expect(within(pending).getByText("Pending")).toHaveStyle({ color: "var(--gold-dk)" });
    expect(options(within(pending).getByRole("combobox", { name: "Action for WealthOS" }))).toEqual([
      "Action ▾",
      "View deck",
      "Submit forward",
      "Pass",
    ]);
    const assigned = screen.getByRole("row", { name: /TaxPilot/ });
    expect(within(assigned).getByText("Assigned")).toHaveStyle({ color: "var(--blue-dk)" });
  });

  it("reads the outcome from the latest event that LEFT the stage, not the deck's latest event", async () => {
    // Submitted by the associate, later passed at IC: still "Submitted" here.
    mockApi(
      [deck({ id: "ic", name: "CreditBridge", statusId: "archived", status: "Archived" })],
      {
        ic: [
          event({ id: "e3", fromStage: "ic_review", toStage: "archived", toLabel: "Archived", action: "pass", createdAt: "2026-07-01T09:00:00Z" }),
          event({ id: "e2", fromStage: "partner_review", toStage: "partner_call", action: "advance_to_call", createdAt: "2026-06-20T09:00:00Z" }),
          event({ id: "e1", createdAt: "2026-06-10T09:00:00Z" }),
          event({ id: "e0", fromStage: "analyst_scoring", toStage: "associate_review", action: "submit_core_scores", createdAt: "2026-06-05T09:00:00Z" }),
        ],
      },
    );
    render(<StagePage config={VC_STAGE_CONFIG.jurypipeline} />);
    const row = await screen.findByRole("row", { name: /CreditBridge/ });
    expect(within(row).getByText("Submitted")).toBeInTheDocument();
    expect(within(row).getByText("10 Jun 2026")).toBeInTheDocument();
  });

  it("filters by the legend's words while the footer still counts the whole stage", async () => {
    mockApi(DECKS, EVENTS);
    render(<StagePage config={VC_STAGE_CONFIG.jurypipeline} />);
    await screen.findByRole("row", { name: /PetPal/ });

    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    expect(screen.getAllByRole("menuitemradio").map((m) => m.textContent)).toEqual([
      "All",
      "Assigned",
      "Shortlisted",
      "Rejected",
      "Pending",
    ]);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Shortlisted" }));
    expect(screen.getByRole("row", { name: /AgriChain/ })).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /WealthOS/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("stage-footer-stat")).toHaveTextContent("4 decks");
  });

  it("Submit forward runs the associate's shortlist transition", async () => {
    const calls = mockApi(DECKS, EVENTS);
    render(<StagePage config={VC_STAGE_CONFIG.jurypipeline} />);
    const row = await screen.findByRole("row", { name: /WealthOS/ });

    fireEvent.change(within(row).getByRole("combobox", { name: "Action for WealthOS" }), {
      target: { value: "shortlist_to_partner" },
    });
    await vi.waitFor(() =>
      expect(
        calls.some(
          (c) => c.url === "/api/decks/as/transition" && c.method === "POST" && c.body?.includes('"shortlist_to_partner"'),
        ),
      ).toBe(true),
    );
  });

  it("View deck opens the one-tab Pitch deck pane beside the table, and the name still opens the drawer", async () => {
    mockApi(DECKS, EVENTS);
    render(<StagePage config={VC_STAGE_CONFIG.jurypipeline} />);
    const row = await screen.findByRole("row", { name: /WealthOS/ });

    fireEvent.change(within(row).getByRole("combobox", { name: "Action for WealthOS" }), {
      target: { value: "__view_deck" },
    });
    const pane = screen.getByRole("complementary", { name: "WealthOS detail" });
    expect(within(pane).getByText("Pitch deck")).toBeInTheDocument();
    expect(within(pane).queryByRole("tablist")).not.toBeInTheDocument();
    expect(await within(pane).findByText("Robo-advice for first-time investors.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // No slide-over tabs are declared, so the startup name keeps its drawer.
    expect(VC_STAGE_CONFIG.jurypipeline.subTabs).toBeUndefined();
    expect(within(row).getByRole("button", { name: "WealthOS" })).not.toHaveAttribute("aria-expanded");
  });
});

describe("Partner Pipeline (VC partnerpipeline)", () => {
  it("draws the same nine headers with Inv. Assoc., and jpFoot's sentence", async () => {
    mockApi(
      [
        deck({ id: "pr", name: "AgriChain", statusId: "partner_review", status: "Partner Review", actions: [ADVANCE, PASS_PARTNER] }),
        deck({ id: "call", name: "MedGrid", statusId: "partner_call", status: "Partner Call" }),
        deck({ id: "cut", name: "PetPal", statusId: "archived", status: "Archived" }),
        // Upstream of the partner: not on this screen at all.
        deck({ id: "as", name: "WealthOS", statusId: "associate_review" }),
      ],
      {
        call: [event({ fromStage: "partner_review", toStage: "partner_call", toLabel: "Partner Call", action: "advance_to_call" })],
        cut: [event({ fromStage: "partner_review", toStage: "archived", toLabel: "Archived", action: "not_shortlisted_partner" })],
      },
    );
    render(<StagePage config={VC_STAGE_CONFIG.partnerpipeline} />);
    const call = await screen.findByRole("row", { name: /MedGrid/ });

    expect(headers(screen.getByRole("table"))).toEqual([
      "Startup",
      "AI score",
      "Inv. Assoc.",
      "Avg. score",
      "Addl. Parameter scores",
      "Submitted date",
      "Status",
      "Action",
      "Submit to",
    ]);
    expect(legendWords()).toEqual(["Assigned", "Shortlisted", "Rejected", "Pending"]);
    expect(screen.getByTestId("stage-footer-stat")).toHaveTextContent(
      "3 decks · 1 shortlisted · 1 rejected · 1 in progress",
    );
    expect(within(call).getByText("Partner call")).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /WealthOS/ })).not.toBeInTheDocument();

    const active = screen.getByRole("row", { name: /AgriChain/ });
    expect(options(within(active).getByRole("combobox", { name: "Action for AgriChain" }))).toEqual([
      "Action ▾",
      "View deck",
      "Move to Partner call",
      "Pass",
    ]);
  });

  it("a deck sent back for another meeting is ACTIVE again, and reads no events", async () => {
    const calls = mockApi(
      [deck({ id: "back", name: "AgriChain", statusId: "partner_review", status: "Partner Review" })],
      {
        back: [
          event({ fromStage: "partner_call", toStage: "partner_review", action: "another_meeting" }),
          event({ fromStage: "partner_review", toStage: "partner_call", action: "advance_to_call" }),
        ],
      },
    );
    render(<StagePage config={VC_STAGE_CONFIG.partnerpipeline} />);
    const row = await screen.findByRole("row", { name: /AgriChain/ });
    expect(within(row).getByText("Pending")).toBeInTheDocument();
    expect(within(row).queryByText("Submitted")).not.toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith("/events"))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe("the new keys stay opt-in", () => {
  const BARE: StageConfig = {
    title: "Bare stage",
    subtitle: "No W9-B keys",
    statuses: ["associate_review"],
    columns: ["startup", "status"],
  };

  it("a screen without keepDecided / rowStatus / actionMenu reads no events, shows the stage label and draws buttons", async () => {
    const calls = mockApi([
      deck({ id: "as", name: "WealthOS", actions: [SHORTLIST] }),
      deck({ id: "sub", name: "AgriChain", statusId: "partner_review" }),
    ]);
    render(<StagePage config={BARE} />);
    const row = await screen.findByRole("row", { name: /WealthOS/ });

    expect(headers(screen.getByRole("table"))).toEqual(["Startup", "Status", "Action"]);
    expect(within(row).getByText("Associate Review")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Shortlist to partner" })).toBeInTheDocument();
    expect(within(row).queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /AgriChain/ })).not.toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith("/events"))).toBe(false);
  });

  it("no other stage config declares them — the incubator's and the rest of the VC edition's", () => {
    const others = [
      ...Object.entries(INCUBATOR_STAGE_CONFIG).map(([slug, cfg]) => [`incubator/${slug}`, cfg] as const),
      ...Object.entries(VC_STAGE_CONFIG)
        .filter(([slug]) => slug !== "jurypipeline" && slug !== "partnerpipeline")
        .map(([slug, cfg]) => [`vc/${slug}`, cfg] as const),
    ];
    for (const [slug, cfg] of others) {
      expect(cfg.keepDecided, slug).toBeUndefined();
      expect(cfg.rowStatus, slug).toBeUndefined();
      expect(cfg.actionMenu, slug).toBeUndefined();
      expect(cfg.columns ?? [], slug).not.toContain("submittedDate");
      expect(cfg.columns ?? [], slug).not.toContain("submitTo");
      expect(cfg.columns ?? [], slug).not.toContain("action");
    }
  });

  it("each pipeline's keepDecided covers every stage its decks can move on to (src/pipeline/vc.ts)", () => {
    for (const slug of ["jurypipeline", "partnerpipeline"] as const) {
      const cfg = VC_STAGE_CONFIG[slug];
      const own = new Set(cfg.statuses);
      // Everything reachable from the screen's stages, walking the VC transitions
      // forward (Restore re-enters at analyst scoring, which is a new pass).
      const reachable = new Set<string>();
      const queue = [...own];
      while (queue.length) {
        const from = queue.shift()!;
        for (const t of vcPipeline.transitions) {
          if (t.action !== "restore" && t.from === from && !reachable.has(t.to)) {
            reachable.add(t.to);
            queue.push(t.to);
          }
        }
      }
      for (const stage of reachable) {
        if (!own.has(stage)) expect(cfg.keepDecided, `${slug} → ${stage}`).toContain(stage);
      }
      for (const stage of cfg.keepDecided ?? []) {
        expect(vcPipeline.stages.some((s) => s.id === stage), `${slug} lists unknown ${stage}`).toBe(true);
        expect(own.has(stage), `${slug} keeps its own stage ${stage}`).toBe(false);
      }
    }
  });
});
