import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UploadPage } from "../../src/client/routes/UploadPage";
import { ResultsScreen, RESULTS_COLUMNS } from "../../src/client/routes/upload/ResultsScreen";
import { ReviewScreen, isFlaggable, isUploadable } from "../../src/client/routes/upload/ReviewScreen";
import { AuthContext, type AuthUser } from "../../src/client/auth/AuthProvider";
import type { StagedDeck } from "../../src/client/routes/upload/types";
import { catalogueFixture } from "../unit/fixtures/accountCatalogue";
import { PROGRAM_MANAGER_PENDING_Q_P, V3_UP_ROLES, isV3Up } from "../../src/client/routes/upload/v3Up";

/**
 * W7-B — the Upload screen.
 *
 *   1. The credits bar: Buy credits for an `upgrade` holder and NOT for a PM, PA
 *      or VC partner — and the balance for all of them. The trial sub-line
 *      follows the published catalogue, so changing the fixture changes it.
 *   2. The review screen's empty and populated states, and a cost preview that
 *      counts credits and never shows money (§8 Q1).
 *   3. The results table's exact header set.
 *   4. The founder route shares none of the staff surfaces (F0302).
 */

// pdf.js does not run in jsdom; the review list's slide badge is not under test.
vi.mock("../../src/client/routes/upload/stagedPdf", () => ({
  countPdfPages: async () => 14,
  StagedSlides: () => <div>slide previews</div>,
}));

const MONEY = /₹|\$\s?\d|per[- ]deck|\/\s*deck|rupee/i;

/**
 * The wizard's forward button under EITHER label. V3-UP renames it "Evaluate &
 * Go to Dashboard →" for the roles in `V3_UP_ROLES`, and three of the tests
 * below drive it as a PA — who now has that label. Those tests are about what
 * the button LEADS TO, so they must not also pin its wording; the wording
 * itself is pinned per role in the V3 describe. Anchored at both ends, so it
 * matches the two real labels and nothing else.
 */
const FORWARD = /^(?:Evaluate & )?Go to [Dd]ashboard →$/;

let trialDecks = 3;
let balance = 42;
/**
 * What `GET /api/decks` answers the review screen's AI poll. Empty by default,
 * which is what a 404 amounted to before — the poll's own catch swallowed it —
 * so no existing test changes. The row-2 seam test fills it, because since row
 * 2 the AI's own verdict is the only thing that opens the flag panel, and this
 * is the only place a jsdom test can put that verdict.
 */
let pollDecks: unknown[] = [];

function json(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

beforeEach(() => {
  trialDecks = 3;
  balance = 42;
  pollDecks = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/programs")) {
        return json(200, {
          sectors: [
            { id: "s1", name: "FinTech", active: true },
            { id: "s2", name: "CleanTech", active: true },
          ],
          programs: [
            {
              id: "p1",
              name: "Climate Programme",
              sector: "CleanTech",
              active: true,
              cohorts: [{ id: "c1", programId: "p1", name: "Cohort 2026-A", active: true }],
            },
          ],
        });
      }
      if (url === "/api/config/summary") {
        return json(200, { plan: "pro", creditsBalance: balance, branding: {}, coreParams: [], additionalParams: [] });
      }
      if (url === "/api/pricing/published") {
        const book = catalogueFixture();
        return json(200, { ...book, trial: { ...book.trial, decks: trialDecks } });
      }
      if (url === "/api/billing") return json(200, { purchased: 84 });
      // The one POST any test here drives to completion. Only the V3 describe's
      // "Send to Evaluate" test needs it: the results view exists solely after a
      // real upload, and that is the view the link lives on. The tests that
      // assert nothing was uploaded assert on the CALLS, so a reachable route
      // does not weaken them.
      if (url === "/api/decks/upload") return json(200, { deckId: "deck_uploaded", evaluated: true });
      if (url === "/api/decks") return json(200, { decks: pollDecks });
      if (url === "/api/decks/deck_uploaded/queries") return json(200, { ok: true, queryId: "q_1", emailStatus: "sent" });
      if (url === "/api/parameters") return json(200, { parameters: [{ key: "traction", name: "Traction & Validation", weight: 10 }] });
      return json(404, { error: "not_found" });
    }),
  );
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function principal(role: AuthUser["role"], permissions: string[], edition: AuthUser["edition"] = "incubator"): AuthUser {
  return { id: `u_${role}`, name: "Test User", initials: "TU", role, edition, permissions };
}

const ADMIN = () => principal("admin", ["upload", "query", "upgrade", "adminconsole"]);
const PM = () => principal("program_manager", ["upload", "query"]);
const PA = () => principal("program_associate", ["upload", "query"]);

function mount(user: AuthUser) {
  return render(
    <AuthContext.Provider value={{ user, loading: false, login: vi.fn(), logout: vi.fn(), updateUser: vi.fn() }}>
      <MemoryRouter initialEntries={["/app/upload"]}>
        <UploadPage />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe("the credits bar", () => {
  it("offers Buy credits and Balance to a billing administrator", async () => {
    mount(ADMIN());
    const bar = await screen.findByTestId("up-credits-bar");
    await waitFor(() => expect(within(bar).getByText("Credits balance — 42 remaining")).toBeInTheDocument());
    expect(within(bar).getByRole("link", { name: "Buy credits" })).toHaveAttribute("href", "/app/billing");
    expect(within(bar).getByRole("link", { name: "Balance" })).toHaveAttribute("href", "/app/admin?section=bl");
    await waitFor(() => expect(within(bar).getByText("3 free trial credits · Pro plan")).toBeInTheDocument());
  });

  it.each([
    ["a Program Manager", PM],
    ["a Program Associate", PA],
    ["a VC partner", () => principal("partner", ["upload"], "vc")],
  ])("shows %s the balance and no button they cannot follow", async (_label, who) => {
    mount(who());
    const bar = await screen.findByTestId("up-credits-bar");
    await waitFor(() => expect(within(bar).getByText("Credits balance — 42 remaining")).toBeInTheDocument());
    expect(within(bar).queryByRole("link", { name: "Buy credits" })).toBeNull();
    expect(within(bar).queryByRole("link", { name: "Balance" })).toBeNull();
    expect(screen.queryByText("Buy credits")).toBeNull();
  });

  it("reads the trial count from the published catalogue, not a literal", async () => {
    trialDecks = 7;
    mount(PA());
    expect(await screen.findByText("7 free trial credits · Pro plan")).toBeInTheDocument();
    expect(screen.queryByText(/3 free trial/)).toBeNull();
  });
});

describe("the wizard", () => {
  it("draws the stepper, the flow chips and three methods, and prices nothing in money", async () => {
    mount(PA());
    expect(await screen.findByRole("heading", { name: "Upload your first pitchdecks" })).toBeInTheDocument();
    expect(within(screen.getByTestId("up-steps")).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Org type",
      "Configure",
      "Select",
      "4Upload",
    ]);
    const chips = within(screen.getByTestId("up-flow-bar")).getAllByText(/./).map((c) => c.textContent);
    expect(chips.filter((c) => c !== "→")).toEqual(["Credits required", "Cost preview", "You approve", "Credits deducted", "AI evaluates"]);
    expect(screen.getAllByRole("radio").map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
    expect(screen.getByTestId("up-cost-bar")).toHaveTextContent("Cost for this deck1 credit");
    await waitFor(() => expect(screen.getByText("Credits balance — 42 remaining")).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(MONEY);
  });

  it("defaults the cohort from the active context and the sector from its programme", async () => {
    localStorage.setItem("sj_active_context_incubator", JSON.stringify({ programId: "p1", cohortId: "c1" }));
    mount(PA());
    await waitFor(() => expect((screen.getByLabelText("Cohort") as HTMLSelectElement).value).toBe("c:c1"));
    expect((screen.getByLabelText("Sector") as HTMLSelectElement).value).toBe("CleanTech");
  });

  it("opens CRM as the third method, with its providers and no dead link for a PA", async () => {
    mount(PA());
    fireEvent.click(await screen.findByRole("radio", { name: /Upload from CRM/ }));
    const grid = screen.getByTestId("up-crm-grid");
    expect(within(grid).getAllByText(/./).map((t) => t.textContent)).toEqual(["Salesforce", "HubSpot", "Pipedrive", "Other API"]);
    expect(within(grid).queryAllByRole("link")).toHaveLength(0);
    // Pro plan → no lock bar.
    await waitFor(() => expect(screen.queryByTestId("up-lock-bar")).toBeNull());
  });
});

describe("Review uploaded decks", () => {
  it("says so when nothing is staged", async () => {
    mount(PA());
    fireEvent.click(await screen.findByRole("button", { name: FORWARD }));
    expect(screen.getByRole("heading", { name: "Review uploaded decks" })).toBeInTheDocument();
    expect(screen.getByText("0 decks staged")).toBeInTheDocument();
    expect(screen.getByTestId("up-review-empty")).toHaveTextContent("No decks staged yet");
    expect(screen.getByRole("button", { name: "Upload selected decks" })).toBeDisabled();
  });

  it("lists a staged deck and previews its cost in credits before anything is spent", async () => {
    mount(PA());
    await waitFor(() => expect(screen.getByText("Credits balance — 42 remaining")).toBeInTheDocument());
    const deck = new File([new Uint8Array([37, 80, 68, 70])], "PayRoute.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Choose a pitch deck"), { target: { files: [deck] } });
    fireEvent.change(screen.getByLabelText("Startup name"), { target: { value: "PayRoute" } });
    fireEvent.click(screen.getByRole("button", { name: FORWARD }));

    expect(screen.getByText("1 deck staged")).toBeInTheDocument();
    const row = screen.getByTestId("up-deck-row");
    expect(within(row).getByText("PayRoute")).toBeInTheDocument();
    expect(within(row).getByText("PayRoute.pdf · not yet analysed")).toBeInTheDocument();
    expect(await within(row).findByText("14 slides")).toBeInTheDocument();
    expect(screen.getByTestId("up-bottom-summary")).toHaveTextContent("Select decks to confirm, then click Upload.");

    fireEvent.click(within(row).getByRole("checkbox", { name: "Select PayRoute" }));
    expect(screen.getByTestId("up-sel-label")).toHaveTextContent("1 deck selected");
    expect(screen.getByTestId("up-cost-preview")).toHaveTextContent("Cost 1 credit · balance 42 → 41");
    expect(screen.getByRole("button", { name: "Upload selected decks" })).toBeEnabled();

    // Unticking takes it back out of the batch — since row 2 removed "Mark
    // incomplete", unticking is the only way to hold a staged deck back.
    fireEvent.click(within(row).getByRole("checkbox", { name: "Select PayRoute" }));
    expect(screen.getByTestId("up-sel-label")).toHaveTextContent("0 decks selected");
    expect(screen.getByRole("button", { name: "Upload selected decks" })).toBeDisabled();

    // Nothing reached an upload route.
    const calls = (fetch as unknown as { mock: { calls: [RequestInfo][] } }).mock.calls.map(([u]) => String(u));
    expect(calls.some((u) => u.startsWith("/api/decks/"))).toBe(false);
    expect(document.body.textContent).not.toMatch(MONEY);
  });

  /**
   * Feedback row 2 — "Mark incomplete" is deleted, "not required since we have
   * automated this part". Asserted three ways because the button had three
   * dependents, and a deletion that leaves any of them behind leaves chrome
   * that can never fire: the control, the filter option whose predicate it was
   * the only writer of, and the footer count it alone incremented.
   */
  it("offers no Mark incomplete control, filter option or excluded count (row 2)", async () => {
    mount(PA());
    const deck = new File([new Uint8Array([37, 80, 68, 70])], "PayRoute.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Choose a pitch deck"), { target: { files: [deck] } });
    fireEvent.click(await screen.findByRole("button", { name: FORWARD }));

    const row = screen.getByTestId("up-deck-row");
    expect(within(row).queryByRole("button", { name: /incomplete/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Mark incomplete/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^Filter/ }));
    expect(screen.getAllByRole("menuitemradio").map((o) => o.textContent)).toEqual([
      "All decks",
      "Ready to upload",
      "Uploaded",
    ]);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "All decks" }));

    // A staged deck is uploadable on the file alone now — no hand-set flag.
    fireEvent.click(within(row).getByRole("checkbox", { name: "Select PayRoute" }));
    expect(screen.getByTestId("up-bottom-summary")).not.toHaveTextContent(/marked incomplete/i);
    expect(screen.getByTestId("up-bottom-summary")).toHaveTextContent("1 deck ready to upload");
  });

  /**
   * What row 2 leaves behind, at the level that can still reach it. The
   * "Parameters needing response" panel used to be opened by the deleted
   * button; the surviving opener is the AI landing the deck at `incomplete`,
   * which is the automation the client is invoking. Driven as a PROP because
   * a jsdom upload cannot make the AI return a verdict — and the e2e specs
   * that covered this path opened the panel with the button, so without this
   * test the panel's only coverage leaves with it (see the handoff note).
   */
  describe("the flag panel after row 2", () => {
    function reviewProps(deck: Partial<StagedDeck>, onSend = vi.fn()) {
      const staged: StagedDeck[] = [
        {
          key: "k",
          name: "PayRoute",
          fileName: "payroute.pdf",
          size: 1000,
          file: null,
          source: "bulk",
          context: { sector: "FinTech" },
          slides: 10,
          issues: [],
          checked: false,
          flags: {},
          sentToQuery: false,
          ...deck,
        },
      ];
      return {
        staged,
        activeKey: "k",
        onSelect: vi.fn(),
        onToggle: vi.fn(),
        onToggleAll: vi.fn(),
        onBack: vi.fn(),
        onUpload: vi.fn(),
        busy: false,
        preview: { decks: 1, credits: 1, balance: 42, balanceAfter: 41, shortfall: 0, affordable: true },
        error: null,
        canBuy: false,
        parameters: ["Traction & Validation"],
        canQuery: true,
        onFlag: vi.fn(),
        onSignal: vi.fn(),
        onSend,
        sending: null,
        sendError: null,
        renderDetails: () => null,
      };
    }

    it("opens for a deck the AI landed at Incomplete, with nothing clicked first", () => {
      const onSend = vi.fn();
      const props = reviewProps(
        { deckId: "deck_1", deck: { id: "deck_1", name: "PayRoute", statusId: "ai_evaluated", missingFields: ["founderEmail"] } },
        onSend,
      );
      expect(isFlaggable(props.staged[0])).toBe(true);
      render(
        <MemoryRouter>
          <ReviewScreen {...props} />
        </MemoryRouter>,
      );
      const panel = screen.getByTestId("up-flag-panel");
      expect(within(panel).getByText("Parameters needing response")).toBeInTheDocument();
      expect(within(panel).getByRole("checkbox", { name: "Flag Traction & Validation" })).toBeInTheDocument();
      // No flag yet, so no send — the panel's own precondition, unchanged.
      expect(within(panel).getByText("Flag at least one parameter to send a query.")).toBeInTheDocument();
      expect(within(panel).queryByRole("button", { name: "Send to Query" })).toBeNull();
    });

    it("sends the query once an area is flagged", () => {
      const onSend = vi.fn();
      const props = reviewProps(
        {
          deckId: "deck_1",
          deck: { id: "deck_1", name: "PayRoute", statusId: "ai_evaluated", missingFields: ["founderEmail"] },
          flags: { "Traction & Validation": "absent" },
        },
        onSend,
      );
      render(
        <MemoryRouter>
          <ReviewScreen {...props} />
        </MemoryRouter>,
      );
      const panel = screen.getByTestId("up-flag-panel");
      expect(within(panel).getByText("1 parameter flagged · these appear on the founder clarification form")).toBeInTheDocument();
      fireEvent.click(within(panel).getByRole("button", { name: "Send to Query" }));
      expect(onSend).toHaveBeenCalledWith("k");
      // The row carries the flagged-area count that the deleted button's badge used to.
      expect(within(screen.getByTestId("up-deck-row")).getByText("Incomplete · 1 area")).toBeInTheDocument();
    });

    it("stays shut while the AI is still reading, and for a deck it found Complete", () => {
      for (const deck of [
        { id: "deck_1", name: "PayRoute", statusId: "pending_ai", missingFields: ["founderEmail" as const] },
        { id: "deck_1", name: "PayRoute", statusId: "ai_evaluated", missingFields: [] },
      ]) {
        const props = reviewProps({ deckId: "deck_1", deck });
        expect(isFlaggable(props.staged[0])).toBe(false);
        const { unmount } = render(
          <MemoryRouter>
            <ReviewScreen {...props} />
          </MemoryRouter>,
        );
        expect(screen.queryByTestId("up-flag-panel")).toBeNull();
        unmount();
      }
    });

    it("tells the operator why a warned, not-yet-uploaded deck has no panel", () => {
      const warned = reviewProps({ issues: ["too_large"] });
      expect(isUploadable(warned.staged[0])).toBe(false);
      const { unmount } = render(
        <MemoryRouter>
          <ReviewScreen {...warned} />
        </MemoryRouter>,
      );
      expect(screen.queryByTestId("up-flag-panel")).toBeNull();
      expect(screen.getByText(/a query needs the deck on file/)).toBeInTheDocument();
      unmount();

      // ...and stays silent on a clean staged deck rather than captioning every
      // row with an answer to a question that deck does not raise.
      const clean = reviewProps({ file: new File([new Uint8Array([37, 80, 68, 70])], "payroute.pdf") });
      expect(isUploadable(clean.staged[0])).toBe(true);
      render(
        <MemoryRouter>
          <ReviewScreen {...clean} />
        </MemoryRouter>,
      );
      expect(screen.getByTestId("up-preview")).toBeInTheDocument();
      expect(screen.queryByText(/a query needs the deck on file/)).toBeNull();
    });

    /**
     * The whole seam, through the real screen: upload → the AI comes back
     * Incomplete → the panel opens with no operator click → Send to Query
     * reaches `POST /api/decks/:id/queries` with the composed letter. This is
     * the path `e2e/upload.spec.ts` and `e2e/vc-intake.spec.ts` walked, and
     * they walked it by clicking "Mark incomplete" — which is why it is
     * re-covered here rather than left to a patch on specs that cannot reach
     * it any more (their dev server has no AI key, so no deck of theirs ever
     * lands at Incomplete).
     */
    it("raises the founder query end to end, with no Mark incomplete anywhere in it", async () => {
      pollDecks = [
        { id: "deck_uploaded", name: "PayRoute", statusId: "ai_evaluated", missingFields: ["founderEmail"] },
      ];
      mount(PA());
      await waitFor(() => expect(screen.getByText("Credits balance — 42 remaining")).toBeInTheDocument());
      const file = new File([new Uint8Array([37, 80, 68, 70])], "PayRoute.pdf", { type: "application/pdf" });
      fireEvent.change(screen.getByLabelText("Choose a pitch deck"), { target: { files: [file] } });
      fireEvent.change(screen.getByLabelText("Startup name"), { target: { value: "PayRoute" } });
      fireEvent.click(screen.getByRole("button", { name: FORWARD }));
      fireEvent.click(within(screen.getByTestId("up-deck-row")).getByRole("checkbox", { name: "Select PayRoute" }));
      fireEvent.click(screen.getByRole("button", { name: "Upload selected decks" }));
      fireEvent.click(await screen.findByRole("button", { name: "View uploaded details →" }));
      fireEvent.click(await screen.findByRole("button", { name: "← Back to review" }));

      // The AI's verdict alone opens it.
      const panel = await screen.findByTestId("up-flag-panel");
      expect(screen.queryByRole("button", { name: /Mark incomplete/i })).toBeNull();
      fireEvent.click(within(panel).getByRole("checkbox", { name: "Flag Traction & Validation" }));
      const signal = within(panel).getByRole("group", { name: "Traction & Validation signal" });
      fireEvent.click(within(signal).getByRole("button", { name: "Absent" }));
      fireEvent.click(within(panel).getByRole("button", { name: "Send to Query" }));
      await waitFor(() => expect(within(panel).getByText("✓ Sent to Query")).toBeInTheDocument());

      const calls = (fetch as unknown as { mock: { calls: [RequestInfo, RequestInit?][] } }).mock.calls;
      const posted = calls.find(([u]) => String(u) === "/api/decks/deck_uploaded/queries");
      expect(posted).toBeDefined();
      const { questions } = JSON.parse(String(posted?.[1]?.body)) as { questions: string };
      expect(questions).toContain("PayRoute");
      expect(questions).toContain("• Traction & Validation (absent)");
    });
  });

  it("blocks a batch the balance cannot cover, and tells a PA who can top up", async () => {
    balance = 0;
    mount(PA());
    await waitFor(() => expect(screen.getByText("Credits balance — 0 remaining")).toBeInTheDocument());
    const deck = new File([new Uint8Array([37, 80, 68, 70])], "A.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Choose a pitch deck"), { target: { files: [deck] } });
    fireEvent.click(screen.getByRole("button", { name: FORWARD }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select A" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Not enough credits");
    expect(screen.getByRole("alert")).toHaveTextContent("Ask an administrator to add credits");
    expect(screen.queryByRole("link", { name: "Buy credits" })).toBeNull();
    expect(screen.getByRole("button", { name: "Upload selected decks" })).toBeDisabled();
  });
});

describe("Uploaded decks — AI-extracted details", () => {
  function uploaded(over: Partial<StagedDeck>): StagedDeck {
    return {
      key: over.key ?? "k",
      name: "Deck",
      fileName: "deck.pdf",
      size: 1000,
      file: null,
      source: "bulk",
      context: { sector: "FinTech" },
      slides: 10,
      issues: [],
      checked: false,
      deckId: "deck_1",
      flags: {},
      sentToQuery: false,
      ...over,
    };
  }

  it("has exactly the prototype's seven columns", () => {
    render(
      <MemoryRouter>
        <ResultsScreen uploaded={[]} workspaceSector={null} onBack={() => {}} />
      </MemoryRouter>,
    );
    const headers = screen.getAllByRole("columnheader").map((th) => th.textContent);
    expect(headers).toEqual(["Deck", "Founder name", "Email ID", "Phone number", "City", "Sector", "Status"]);
    expect(RESULTS_COLUMNS).toEqual(headers);
    expect(screen.getByTestId("up-results-summary")).toHaveTextContent("No decks uploaded yet.");
  });

  it("marks what the AI could not capture, never the sector, and pills the status", () => {
    render(
      <MemoryRouter>
        <ResultsScreen
          workspaceSector="FinTech"
          onBack={() => {}}
          uploaded={[
            uploaded({
              key: "a",
              deck: {
                id: "deck_a",
                name: "TaxPilot",
                founder: "Arjun Pillai",
                founderEmail: "arjun@taxpilot.in",
                city: "Chennai",
                statusId: "incomplete",
                missingFields: ["founderPhone"],
              },
            }),
            uploaded({
              key: "b",
              context: {},
              deck: {
                id: "deck_b",
                name: "FinStack",
                founder: "Ananya Reddy",
                founderEmail: "ananya@finstack.io",
                founderPhone: "+91 98480 21345",
                city: "Hyderabad",
                statusId: "ai_evaluated",
                missingFields: [],
              },
            }),
            uploaded({ key: "c", name: "Queued deck", deck: undefined }),
          ]}
        />
      </MemoryRouter>,
    );
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getAllByTestId("up-miss")).toHaveLength(1);
    expect(within(rows[0]).getByText("FinTech")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Incomplete")).toBeInTheDocument();
    // No sector anywhere for this deck, and still no "not captured".
    expect(within(rows[1]).queryAllByTestId("up-miss")).toHaveLength(0);
    expect(within(rows[1]).getByText("Complete")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Awaiting AI")).toBeInTheDocument();
    expect(screen.getByTestId("up-results-summary")).toHaveTextContent(
      "3 decks uploaded. The AI records the founder’s name, email, phone and city from each deck; sector is taken from your setup context. 1 deck marked Incomplete — details missing. 1 still being read by the AI.",
    );
  });
});

describe("V3 item 8 — Upload & Evaluate, the half the export supports", () => {
  const SU = () => principal("superuser", ["upload", "query", "adminconsole"]);

  /**
   * R2-UPEVAL widened the gate from `role === "superuser"` to `V3_UP_ROLES`.
   * This is the pin on the set itself, so a widening cannot happen quietly in
   * one of the two screens that read it.
   */
  it("admits exactly the superuser, the admin and the program associate — and records Q-P", () => {
    expect([...V3_UP_ROLES]).toEqual(["superuser", "admin", "program_associate"]);

    // The program manager is WITHHELD, not forgotten: their own prototype draws
    // a different multi-select (a bottom action bar) and Q-P asks the client
    // which to build. Answering it "V3's" flips this constant.
    expect(PROGRAM_MANAGER_PENDING_Q_P).toBe(true);
    expect(isV3Up("incubator", "program_manager")).toBe(false);

    // The jury is excluded on purpose, and it is the load-bearing exclusion:
    // `App.tsx` routes their `jassigned` screen through EvaluatePage too, so
    // admitting them here would rebuild the screen a juror actually scores on.
    expect(isV3Up("incubator", "jury")).toBe(false);

    // The VC edition was not rescoped, whatever the role.
    expect(isV3Up("vc", "superuser")).toBe(false);
    expect(isV3Up("vc", "admin")).toBe(false);
  });

  it.each([
    ["the incubator superuser", SU],
    ["an admin", ADMIN],
    ["a Program Associate", PA],
  ])("renames the wizard's forward button for %s", async (_label, who) => {
    mount(who());
    expect(await screen.findByRole("button", { name: "Evaluate & Go to Dashboard →" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Go to dashboard →" })).toBeNull();
  });

  it.each([
    ["a Program Manager — pending Q-P", PM],
    ["a VC partner", () => principal("partner", ["upload"], "vc")],
    ["a VC superuser — the VC edition was not rescoped", () => principal("superuser", ["upload"], "vc")],
  ])("leaves %s on the unchanged label", async (_label, who) => {
    mount(who());
    expect(await screen.findByRole("button", { name: "Go to dashboard →" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Evaluate & Go to Dashboard →" })).toBeNull();
  });

  it("offers Send to Evaluate from the results card — the prototype's only route to that screen", () => {
    render(
      <MemoryRouter>
        <ResultsScreen
          workspaceSector="FinTech"
          onBack={() => {}}
          showSendToEvaluate
          uploaded={[
            {
              key: "a",
              name: "TaxPilot",
              fileName: "taxpilot.pdf",
              size: 1000,
              file: null,
              source: "bulk",
              context: { sector: "FinTech" },
              slides: 10,
              issues: [],
              checked: false,
              deckId: "deck_a",
              flags: {},
              sentToQuery: false,
            },
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Send to Evaluate →" })).toHaveAttribute("href", "/app/evaluate");
  });

  it("offers it to nobody else, and never with an empty batch", () => {
    const { rerender } = render(
      <MemoryRouter>
        <ResultsScreen uploaded={[]} workspaceSector={null} onBack={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("link", { name: "Send to Evaluate →" })).toBeNull();
    rerender(
      <MemoryRouter>
        <ResultsScreen uploaded={[]} workspaceSector={null} onBack={() => {}} showSendToEvaluate />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("link", { name: "Send to Evaluate →" })).toBeNull();
  });

  /**
   * The results card's `Send to Evaluate` is tested twice on purpose. Above, as a
   * PROP, because that is the prototype's own markup. Here, through the real
   * screen, because a prop test cannot see `UploadPage` passing `false` where it
   * meant `v3Up` — and that wiring is the whole of this session's change. These
   * are the only tests in the file that drive an upload to completion, which is
   * what `POST /api/decks/upload` is mocked for.
   */
  async function uploadOneDeckAndOpenResults() {
    await waitFor(() => expect(screen.getByText("Credits balance — 42 remaining")).toBeInTheDocument());
    const deck = new File([new Uint8Array([37, 80, 68, 70])], "PayRoute.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Choose a pitch deck"), { target: { files: [deck] } });
    fireEvent.change(screen.getByLabelText("Startup name"), { target: { value: "PayRoute" } });
    fireEvent.click(screen.getByRole("button", { name: FORWARD }));
    fireEvent.click(within(screen.getByTestId("up-deck-row")).getByRole("checkbox", { name: "Select PayRoute" }));
    fireEvent.click(screen.getByRole("button", { name: "Upload selected decks" }));
    fireEvent.click(await screen.findByRole("button", { name: "View uploaded details →" }));
    expect(await screen.findByRole("heading", { name: "Uploaded decks — AI-extracted details" })).toBeInTheDocument();
  }

  it.each([
    ["an admin", ADMIN],
    ["a Program Associate", PA],
  ])("wires Send to Evaluate through to %s, not just to the superuser", async (_label, who) => {
    mount(who());
    await uploadOneDeckAndOpenResults();
    expect(screen.getByRole("link", { name: "Send to Evaluate →" })).toHaveAttribute("href", "/app/evaluate");
  });

  it("withholds it from a Program Manager while Q-P is open", async () => {
    mount(PM());
    await uploadOneDeckAndOpenResults();
    expect(screen.queryByRole("link", { name: "Send to Evaluate →" })).toBeNull();
    // The screen still works — only the v3 entry point is absent.
    expect(screen.getByRole("link", { name: "✓ Done" })).toHaveAttribute("href", "/app/alldecks");
  });

  it("keeps the review step and its cost preview — credits are never spent unpreviewed (Q51)", async () => {
    mount(SU());
    fireEvent.click(await screen.findByRole("button", { name: "Evaluate & Go to Dashboard →" }));
    expect(await screen.findByRole("heading", { name: "Review uploaded decks" })).toBeInTheDocument();
  });

  it.each([
    ["an admin", ADMIN],
    ["a Program Associate", PA],
  ])("keeps it for %s too — the label changed, the flow did not", async (_label, who) => {
    mount(who());
    fireEvent.click(await screen.findByRole("button", { name: "Evaluate & Go to Dashboard →" }));
    expect(await screen.findByRole("heading", { name: "Review uploaded decks" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload selected decks" })).toBeInTheDocument();
  });
});

describe("the founder's Upload", () => {
  it("shares none of the staff screen's credits, review or CRM surfaces", async () => {
    mount(principal("founder", []));
    expect(await screen.findByRole("heading", { name: "Upload pitch decks" })).toBeInTheDocument();
    expect(screen.queryByTestId("up-credits-bar")).toBeNull();
    expect(screen.queryByText(/credit/i)).toBeNull();
    expect(screen.queryByText(/CRM|Salesforce|Email triage/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Go to dashboard →" })).toBeNull();
    const calls = (fetch as unknown as { mock: { calls: [RequestInfo][] } }).mock.calls.map(([u]) => String(u));
    expect(calls).not.toContain("/api/config/summary");
  });
});
