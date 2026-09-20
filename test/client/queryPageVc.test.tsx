import { StrictMode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { DeckView } from "../../src/client/types";
import { deckListRoute } from "../../src/shared/queries";
import type { QueryView } from "../../src/client/api";

/**
 * W9-A — the Query screen on the VC edition. `panel-query.html` is
 * md5-identical in all six VC builds, so the screen is `W7-C`'s; what differs
 * is which deals the list holds (the VC stages, no `founder_response`
 * transition) and blind scoring in the flow view.
 */

vi.mock("../../src/client/auth/useAuth", () => ({
  useAuth: () => ({ user: { id: "vc_analyst", role: "analyst", edition: "vc" } }),
}));

import { QueryPage } from "../../src/client/routes/QueryPage";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

function deck(overrides: Partial<DeckView>): DeckView {
  return { id: "d", name: "Deck", ...overrides };
}

/** The seeded VC flagged deck: Incomplete, with an open query. */
const NORTHBEAM = deck({
  id: "vc_deck_northbeam",
  name: "Northbeam Robotics",
  statusId: "incomplete",
  status: "incomplete",
  sector: "Deep Tech",
  founder: "Kiran Rao",
  founderEmail: "kiran@northbeam.ai",
  missingFields: ["founderPhone"],
  missingSections: ["Traction"],
});
/** Being scored, with a weak area — flagged. */
const WEALTHOS = deck({ id: "d_wealth", name: "WealthOS", statusId: "analyst_scoring", weakAreas: ["Team & Execution Capability"] });
/** Answered, still in associate review — stays as Responded. */
const LEDGER = deck({ id: "d_ledger", name: "LedgerLoop", statusId: "associate_review" });
/** Being scored, nothing flagged — not "AI-flagged". */
const CLEAN = deck({ id: "d_clean", name: "CleanCo", statusId: "analyst_scoring" });
/** Answered, but moved on to partner review — off the list. */
const MOVED = deck({ id: "d_moved", name: "MedGrid", statusId: "partner_review", weakAreas: ["Business Risks"] });

function query(overrides: Partial<QueryView>): QueryView {
  return {
    id: `q_${Math.random()}`,
    deck_id: "d",
    questions: "Please share traction.",
    email_status: "sent",
    founder_response: null,
    created_at: daysAgo(1),
    resolved_at: null,
    ...overrides,
  };
}

let withheld = false;

function installFetch() {
  const ok = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status });
  const decks = [NORTHBEAM, WEALTHOS, LEDGER, CLEAN, MOVED];
  const queries = [
    query({ deck_id: NORTHBEAM.id }),
    query({ deck_id: LEDGER.id, founder_response: "ARR is ₹2 Cr.", created_at: daysAgo(3), resolved_at: daysAgo(1) }),
    query({ deck_id: MOVED.id, founder_response: "Answered.", created_at: daysAgo(9), resolved_at: daysAgo(8) }),
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      // V4-ROUTE — the screen asks for `?list=query`. Routed with the server's
      // own function, so the VC row set here is measured, not asserted twice.
      if (url === "/api/decks" || url.startsWith("/api/decks?")) {
        const list = new URL(url, "https://x").searchParams.get("list");
        return ok({
          decks: list
            ? decks.filter(
                (d) => deckListRoute(d, "vc", { queried: queries.some((q) => q.deck_id === d.id) }) === list,
              )
            : decks,
        });
      }
      if (url === "/api/queries") return ok({ queries });
      let m = url.match(/^\/api\/questions\/draft\/([^/]+)$/);
      if (m) {
        const d = decks.find((x) => x.id === decodeURIComponent(m![1]))!;
        return ok({ deckId: d.id, deckName: d.name, message: "Dear Founder", areas: [], questions: [], autoClarification: true, triggered: true });
      }
      m = url.match(/^\/api\/decks\/([^/]+)\/queries$/);
      if (m) return ok({ queries: queries.filter((q) => q.deck_id === decodeURIComponent(m![1])) });
      m = url.match(/^\/api\/decks\/([^/]+)$/);
      if (m) {
        const d = decks.find((x) => x.id === decodeURIComponent(m![1]))!;
        return withheld
          ? ok({ deck: d, scores: [], aiScoreWithheld: true })
          : ok({
              deck: d,
              scores: [
                { key: "team", label: "Team & Execution Capability", weight: 10, value: 2, comment: "No operating history." },
                { key: "market", label: "Market Size & Opportunity", weight: 10, value: 8, comment: null },
              ],
            });
      }
      return ok({ error: "not_found" }, 404);
    }),
  );
}

beforeEach(() => {
  withheld = false;
  installFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPage() {
  return render(
    <StrictMode>
      <QueryPage />
    </StrictMode>,
  );
}

const rowOf = (name: string) => screen.getByRole("checkbox", { name: `Select ${name}` }).closest("tr")!;

describe("VC Query — which deals the list holds", () => {
  it("lists the flagged deals in screening, keeps an answered one as Responded, and drops the rest", async () => {
    renderPage();
    await screen.findByRole("checkbox", { name: "Select Northbeam Robotics" });
    const headers = within(screen.getByRole("table"))
      .getAllByRole("columnheader")
      .map((th) => th.textContent?.trim());
    expect(headers).toEqual(["", "Startup", "Founder", "Phone", "Email", "Status", "Parameters needing response"]);

    expect(within(rowOf("Northbeam Robotics")).getByText("Pending")).toBeInTheDocument();
    expect(within(rowOf("WealthOS")).getByText("Pending")).toBeInTheDocument();
    expect(within(rowOf("LedgerLoop")).getByText("Responded")).toBeInTheDocument();
    // Unflagged while being scored (F0274), and answered but moved past screening.
    expect(screen.queryByRole("checkbox", { name: "Select CleanCo" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Select MedGrid" })).toBeNull();
  });
});

describe("VC Query — the flow view under blind scoring", () => {
  it("shows the completion computed from the AI's area scores when the analyst may see them", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "WealthOS" }));
    expect(await screen.findByText("50% complete")).toBeInTheDocument();
    expect(screen.queryByTestId("flow-withheld")).toBeNull();
  });

  it("says the scores are withheld instead of inventing a 0% completion", async () => {
    withheld = true;
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "WealthOS" }));
    const box = await screen.findByTestId("flow-withheld");
    expect(box).toHaveTextContent("withheld until you submit your own evaluation");
    expect(screen.queryByText(/% complete/)).toBeNull();
    expect(screen.queryByRole("progressbar", { name: "Deck completion" })).toBeNull();
    // The flagged area is still asked about — flags are not the withheld scores.
    expect(screen.getByText("Areas requiring your input")).toBeInTheDocument();
  });
});
