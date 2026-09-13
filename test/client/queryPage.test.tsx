import { StrictMode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import type { DeckView } from "../../src/client/types";
import type { QueryView } from "../../src/client/api";

/**
 * W7-C — the Query screen at prototype parity (`panel-query.html`).
 *
 *   • #qview-list    — the exact column set; loading, empty, populated and
 *                      Responded states; Filter and Export.
 *   • #qview-email   — every founder's own letter, and a send that posts
 *                      exactly the Subject and Body the card shows.
 *   • #qview-founder — completion bar, sufficient-signal roster, checklist, and
 *                      the founder's answer readable after they respond.
 */

vi.mock("../../src/client/auth/useAuth", () => ({
  useAuth: () => ({ user: { id: "inc_pa", role: "program_associate", edition: "incubator" } }),
}));

const csv = vi.hoisted(() => ({ files: [] as { name: string; content: string }[] }));
vi.mock("../../src/client/exportCsv", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/client/exportCsv")>();
  return {
    ...real,
    downloadCsv: (name: string, content: string) => csv.files.push({ name, content }),
  };
});

import { QueryPage } from "../../src/client/routes/QueryPage";

const NOW = Date.now();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

function deck(overrides: Partial<DeckView>): DeckView {
  return { id: "d", name: "Deck", status: "Incomplete", statusId: "incomplete", ...overrides };
}

const PAYROUTE = deck({
  id: "d_pay",
  name: "PayRoute",
  sector: "Fintech",
  city: "Pune",
  founder: "Vikram Singh",
  founderEmail: "vikram@payroute.in",
  missingFields: ["founderPhone"],
  weakAreas: ["Traction & Validation"],
});
const NIMBUS = deck({
  id: "d_nimbus",
  name: "NimbusHR",
  founder: "Meera Sharma",
  founderEmail: "meera@nimbushr.in",
  founderPhone: "+91 98480 21345",
  missingSections: ["Team"],
  weakAreas: ["Business Risks"],
});
/** Answered: `founder_response` moved it incomplete → uploaded. */
const WEALTHOS = deck({
  id: "d_wealth",
  name: "WealthOS",
  status: "Uploaded",
  statusId: "uploaded",
  founder: "Diya Kapoor",
  founderEmail: "diya@wealthos.app",
  weakAreas: ["Go-To-Market Strategy"],
});
const OVERDUE = deck({
  id: "d_credit",
  name: "CreditBridge",
  statusId: "manual_review",
  founder: "Kavya Nair",
  founderEmail: "kavya@creditbridge.co",
  missingFields: ["city"],
});
/** Not flagged and past intake — must not be listed. */
const SHORTLISTED = deck({ id: "d_short", name: "AgroFresh", statusId: "shortlisted", weakAreas: ["Team"] });

function query(overrides: Partial<QueryView>): QueryView {
  return {
    id: `q_${Math.random()}`,
    deck_id: "d",
    questions: "Please share your MRR.",
    email_status: "sent",
    founder_response: null,
    created_at: daysAgo(1),
    resolved_at: null,
    ...overrides,
  };
}

interface Api {
  decks: DeckView[];
  queries: QueryView[];
  posts: { deckId: string; body: Record<string, unknown> }[];
  /** Hold a deck's draft until the test releases it. */
  holdDraft?: Set<string>;
  release: Map<string, () => void>;
  delivered?: boolean;
  decksStatus?: number;
}

let api: Api;

function draftFor(d: DeckView) {
  return `Dear Founder,\n\nBANK LETTER for ${d.name}: ${[...(d.weakAreas ?? []), ...(d.missingSections ?? [])].join(", ")}`;
}

function installFetch() {
  const ok = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "POST") {
        const m = url.match(/^\/api\/decks\/([^/]+)\/queries$/);
        if (m) {
          const body = JSON.parse(String(init!.body)) as Record<string, unknown>;
          api.posts.push({ deckId: decodeURIComponent(m[1]), body });
          return ok({ ok: true, queryId: `qry_${api.posts.length}`, emailStatus: "recorded", delivered: api.delivered ?? false });
        }
        return ok({ error: "not_found" }, 404);
      }
      if (url === "/api/decks") {
        return api.decksStatus ? ok({ error: "boom" }, api.decksStatus) : ok({ decks: api.decks });
      }
      if (url === "/api/queries") return ok({ queries: api.queries });
      let m = url.match(/^\/api\/questions\/draft\/([^/]+)$/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        const d = api.decks.find((x) => x.id === id)!;
        const payload = {
          deckId: id,
          deckName: d.name,
          message: draftFor(d),
          areas: [],
          questions: (d.weakAreas ?? []).map((area) => ({ area, questions: [`What is your plan for ${area}?`] })),
          autoClarification: true,
          triggered: true,
        };
        if (api.holdDraft?.has(id)) {
          return new Promise<Response>((resolve) => api.release.set(id, () => resolve(ok(payload))));
        }
        return ok(payload);
      }
      m = url.match(/^\/api\/decks\/([^/]+)\/queries$/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        return ok({ queries: api.queries.filter((q) => q.deck_id === id) });
      }
      m = url.match(/^\/api\/decks\/([^/]+)$/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        const d = api.decks.find((x) => x.id === id)!;
        return ok({
          deck: d,
          scores: [
            { key: "traction", label: "Traction & Validation", weight: 10, value: 2, comment: "No revenue figures were found." },
            { key: "team", label: "Team & Execution Capability", weight: 10, value: 9, comment: "Strong." },
            { key: "market", label: "Market Size & Opportunity", weight: 7, value: 6, comment: null },
            { key: "risk", label: "Business Risks", weight: 8, value: 7, comment: null },
          ],
        });
      }
      return ok({ error: "not_found" }, 404);
    }),
  );
}

beforeEach(() => {
  csv.files.length = 0;
  api = {
    decks: [PAYROUTE, NIMBUS, WEALTHOS, OVERDUE, SHORTLISTED],
    queries: [
      query({ deck_id: "d_wealth", founder_response: "Our GTM is partner-led: 3 bank pilots signed.", created_at: daysAgo(4), resolved_at: daysAgo(2) }),
      query({ deck_id: "d_credit", created_at: daysAgo(10) }),
    ],
    posts: [],
    release: new Map(),
  };
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

/** Wait on a POPULATED element — the loading branch renders the heading too. */
async function populated() {
  await screen.findByRole("checkbox", { name: "Select PayRoute" });
}

const rowOf = (name: string) => screen.getByRole("checkbox", { name: `Select ${name}` }).closest("tr")!;

describe("Founder queries list (#qview-list)", () => {
  it("shows the loading marker before the decks arrive", async () => {
    renderPage();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    await populated();
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("renders the prototype's exact header set", async () => {
    renderPage();
    await populated();
    const headers = within(screen.getByRole("table"))
      .getAllByRole("columnheader")
      .map((th) => th.textContent?.trim());
    expect(headers).toEqual(["", "Startup", "Founder", "Phone", "Email", "Status", "Parameters needing response"]);
    expect(screen.getByRole("heading", { level: 1, name: "Founder queries" })).toBeInTheDocument();
    expect(screen.getByText("AI-flagged decks awaiting founder clarification")).toBeInTheDocument();
  });

  it("lists flagged decks and keeps an answered one as Responded; never an unflagged stage", async () => {
    renderPage();
    await populated();
    for (const name of ["PayRoute", "NimbusHR", "WealthOS", "CreditBridge"]) {
      expect(screen.getByRole("checkbox", { name: `Select ${name}` })).toBeInTheDocument();
    }
    expect(screen.queryByRole("checkbox", { name: "Select AgroFresh" })).toBeNull();

    expect(within(rowOf("PayRoute")).getByText("Pending")).toBeInTheDocument();
    expect(within(rowOf("CreditBridge")).getByText("Overdue")).toBeInTheDocument();
    expect(within(rowOf("WealthOS")).getByText("Responded")).toBeInTheDocument();
    // Nothing outside the prototype's three words.
    expect(screen.queryByText(/not asked/i)).toBeNull();
  });

  it("renders every area chip, green once the founder has responded", async () => {
    renderPage();
    await populated();
    const pay = within(rowOf("PayRoute"));
    expect(pay.getByText("Phone")).toBeInTheDocument();
    expect(pay.getByText("Traction & Validation")).toBeInTheDocument();
    expect(pay.queryByText(/more/)).toBeNull();
    expect(pay.getByText("Phone").className).toContain("bg-[#FBEFD6]");
    expect(within(rowOf("WealthOS")).getByText("Go-To-Market Strategy").className).toContain("bg-[#EAF3E2]");
  });

  it("shows the empty state when nothing is flagged", async () => {
    api.decks = [SHORTLISTED];
    api.queries = [];
    renderPage();
    expect(await screen.findByText("Nothing to query")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("says so when the decks cannot be loaded, rather than claiming nothing is flagged", async () => {
    api.decksStatus = 500;
    renderPage();
    expect(await screen.findByText("Couldn't load founder queries")).toBeInTheDocument();
    expect(screen.queryByText("Nothing to query")).toBeNull();
  });

  it("filters by status from the topbar Filter", async () => {
    renderPage();
    await populated();
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Overdue" }));
    expect(screen.getByRole("checkbox", { name: "Select CreditBridge" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Select PayRoute" })).toBeNull();
    expect(screen.getByRole("button", { name: "Filter · Overdue" })).toBeInTheDocument();
  });

  it("exports the visible rows under the list's own headers", async () => {
    renderPage();
    await populated();
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Responded" }));
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(csv.files).toHaveLength(1);
    const lines = csv.files[0].content.replace(/^\uFEFF/, "").trim().split("\r\n");
    expect(lines[0]).toBe("Startup,Founder,Phone,Email,Status,Parameters needing response");
    expect(lines.slice(1)).toEqual(["WealthOS,Diya Kapoor,,diya@wealthos.app,Responded,Go-To-Market Strategy"]);
  });

  it("opens the dark bulk bar on selection and carries the count to the Email query tab", async () => {
    renderPage();
    await populated();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select PayRoute" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select NimbusHR" }));
    const bar = screen.getByText("2 founders selected").closest("div")!.parentElement!;
    expect(bar.className).toContain("bg-olive-dk");
    expect(screen.getByRole("tab", { name: /Email query/ })).toHaveTextContent("2");
  });
});

describe("Email query compose (#qview-email)", () => {
  async function composeFor(names: string[]) {
    renderPage();
    await populated();
    for (const name of names) fireEvent.click(screen.getByRole("checkbox", { name: `Select ${name}` }));
    fireEvent.click(screen.getByRole("tab", { name: /Email query/ }));
  }

  it("gives each founder only their own letter, and sends exactly the Subject and Body shown", async () => {
    await composeFor(["PayRoute", "NimbusHR"]);
    const body = screen.getByRole("textbox", { name: "Body" }) as HTMLTextAreaElement;
    await waitFor(() => expect(body.value).toBe(draftFor(PAYROUTE)));

    const subject = screen.getByRole("textbox", { name: "Subject" });
    fireEvent.change(subject, { target: { value: "PayRoute and NimbusHR — two quick questions" } });

    // The operator edits PayRoute's letter…
    fireEvent.change(body, { target: { value: `${draftFor(PAYROUTE)}\n\nAlso: your phone number, please.` } });
    const shownPay = body.value;
    expect(shownPay).not.toContain("NimbusHR");
    expect(shownPay).not.toContain("Business Risks");

    // …and switches to NimbusHR's, which is its own.
    fireEvent.change(screen.getByRole("combobox", { name: "Letter for" }), { target: { value: "d_nimbus" } });
    await waitFor(() => expect(body.value).toBe(draftFor(NIMBUS)));
    const shownNimbus = body.value;
    expect(shownNimbus).not.toContain("PayRoute");
    expect(shownNimbus).not.toContain("Traction & Validation");

    fireEvent.click(screen.getByRole("button", { name: "Send query" }));
    await screen.findByRole("button", { name: "Query recorded for 2 founders" });

    expect(api.posts).toEqual([
      { deckId: "d_pay", body: { subject: "PayRoute and NimbusHR — two quick questions", questions: shownPay } },
      { deckId: "d_nimbus", body: { subject: "PayRoute and NimbusHR — two quick questions", questions: shownNimbus } },
    ]);
    // Recorded, not sent — delivery is not configured.
    expect(screen.getByText(/recorded in the outbox and not emailed/)).toBeInTheDocument();
    expect(screen.queryByText(/Query sent to/)).toBeNull();
  });

  it("says 'sent' only when the server reports delivery", async () => {
    api.delivered = true;
    await composeFor(["PayRoute"]);
    const body = screen.getByRole("textbox", { name: "Body" }) as HTMLTextAreaElement;
    await waitFor(() => expect(body.value).toBe(draftFor(PAYROUTE)));
    fireEvent.click(screen.getByRole("button", { name: "Send query" }));
    expect(await screen.findByRole("button", { name: "Query sent to 1 founder" })).toBeDisabled();
  });

  it("keeps an edit made before the bank draft arrives (StrictMode double mount)", async () => {
    api.holdDraft = new Set(["d_pay"]);
    await composeFor(["PayRoute"]);
    const body = screen.getByRole("textbox", { name: "Body" }) as HTMLTextAreaElement;
    // The local letter is there at once: this deck's areas and nobody else's.
    await waitFor(() => expect(body.value).toContain("• Phone (missing detail)"));
    expect(body.value).toContain("• Traction & Validation (weak signal)");

    fireEvent.change(body, { target: { value: "My own words." } });
    await waitFor(() => expect(api.release.has("d_pay")).toBe(true));
    await act(async () => {
      api.release.get("d_pay")!();
    });
    expect(body.value).toBe("My own words.");

    fireEvent.click(screen.getByRole("button", { name: "Reset to the generated message" }));
    await waitFor(() => expect(body.value).not.toBe("My own words."));
  });

  it("shows the empty recipients copy and no send with nobody selected", async () => {
    renderPage();
    await populated();
    fireEvent.click(screen.getByRole("tab", { name: /Email query/ }));
    expect(screen.getByText("No founders selected. Pick founders from the list to email them a query.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send query" })).toBeDisabled();
    expect(screen.getByText("Link the founder receives")).toBeInTheDocument();
  });
});

describe("Founder clarification flow (#qview-founder)", () => {
  it("previews completion, flagged areas with their questions, the sufficient roster and the checklist", async () => {
    renderPage();
    await populated();
    fireEvent.click(screen.getByRole("button", { name: "PayRoute" }));

    // Traction is weak; Team (9) and Business Risks (7) are Strong, Market (6) Moderate.
    expect(await screen.findByText("75% complete")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Founder clarification flow" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(
      screen.getByText(/3 of 4 evaluation areas have sufficient signal · 2 areas require your responses below · 2 areas are strong/),
    ).toBeInTheDocument();

    expect(screen.getByText("Areas requiring your input")).toBeInTheDocument();
    expect(screen.getByText("No revenue figures were found.")).toBeInTheDocument();
    expect(screen.getByText("What is your plan for Traction & Validation?")).toBeInTheDocument();
    expect(screen.getByText("AI detected absent signal · Weight 10%")).toBeInTheDocument();

    expect(screen.getByText("Areas with sufficient signal (no action needed)")).toBeInTheDocument();
    expect(screen.getAllByText("Strong signal detected · No questions triggered")).toHaveLength(2);
    expect(screen.getByText("Moderate signal · Sufficient for evaluation")).toBeInTheDocument();

    const checklist = screen.getByRole("list", { name: "Submission checklist" });
    expect(within(checklist).getByText("Phone — provide the missing detail")).toBeInTheDocument();
    expect(within(checklist).getByText("Traction & Validation — 0 of 1 question answered")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Submit responses — complete all required answers first/ })).toBeDisabled();
  });

  it("keeps the founder's answer readable after they respond (F0214)", async () => {
    renderPage();
    await populated();
    fireEvent.click(screen.getByRole("button", { name: "WealthOS" }));
    expect(await screen.findByText("Our GTM is partner-led: 3 bank pilots signed.")).toBeInTheDocument();
    expect(screen.getByText("Founder response")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Responses submitted" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Back to founder queries" }));
    expect(screen.getByRole("checkbox", { name: "Select WealthOS" })).toBeInTheDocument();
  });

  it("is what 'Link the founder receives' previews for the letter on screen", async () => {
    renderPage();
    await populated();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select NimbusHR" }));
    fireEvent.click(screen.getByRole("tab", { name: /Email query/ }));
    fireEvent.click(screen.getByRole("button", { name: "Respond to your evaluation questions" }));
    expect(await screen.findByText("No Team section was found in the deck.")).toBeInTheDocument();
  });
});
