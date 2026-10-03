import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { UploadPage, chunkBulk } from "../../src/client/routes/UploadPage";
import { uploadDeadlineMs } from "../../src/client/api";
import { ResultsScreen, RESULTS_COLUMNS } from "../../src/client/routes/upload/ResultsScreen";
import { ReviewScreen, isFlaggable, isUploadable } from "../../src/client/routes/upload/ReviewScreen";
import { AuthContext, type AuthUser } from "../../src/client/auth/AuthProvider";
import type { StagedDeck } from "../../src/client/routes/upload/types";
import type { DeckView } from "../../src/client/types";
import { catalogueFixture } from "../unit/fixtures/accountCatalogue";
import { PROGRAM_MANAGER_PENDING_Q_P, V3_UP_ROLES, isV3Up } from "../../src/client/routes/upload/v3Up";
import type { UploadStatusContext } from "../../src/shared/uploadReview";

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
 * The wizard's forward button. Issue 1 settled its wording — it advances to the
 * review step, so it says "Continue" — but the tests that merely need to GET to
 * the review step still go through this constant rather than the literal, so a
 * future wording change touches the pin in the issue-1 describe and nothing
 * else. Anchored, so it cannot also match "Go to dashboard →".
 */
const FORWARD = /^Continue$/;

/**
 * Where the router is, for the tests that assert a navigation. `UploadPage` is
 * mounted directly rather than under a route switch, so a `navigate` changes
 * the location without unmounting the screen — the location is the signal.
 */
function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

/**
 * The status vocabulary the prop-level tests read under — the incubator's, with
 * the AI screening gate at the migration's own 5.0. `gate: null` is the state
 * before the config summary lands and is exercised in
 * `test/unit/uploadReview.test.ts`, not here.
 */
const CTX: UploadStatusContext = { gate: 5, edition: "incubator" };

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

/**
 * Issue 3's switches. A bulk batch is several requests now, so the things that
 * matter about it are HOW MANY went out and what each one carried — `bulkCalls`
 * records one entry of file names per accepted request. `bulkHangs` stands in
 * for the stalled socket that left "Uploading…" on screen for forty minutes: it
 * answers nothing and settles only when the deadline aborts it.
 */
let bulkCalls: string[][] = [];
let bulkHangs = false;
/** How many leading bulk requests are refused for credits. */
let bulkNoCredits = 0;
/**
 * Held requests. A chunked batch settles one request per microtask, so the
 * in-flight state is gone before an assertion can see it; a gate is how a test
 * stands still inside it. The mock reads it per call, so releasing it lets the
 * requests behind the held one answer at once.
 */
let bulkGate: Promise<void> | null = null;

/** The file names a stubbed request carried. */
function filesIn(init?: RequestInit): string[] {
  const body = init?.body;
  if (!(body instanceof FormData)) return [];
  return body.getAll("files").map((f) => (f instanceof File ? f.name : String(f)));
}

function json(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

beforeEach(() => {
  trialDecks = 3;
  balance = 42;
  pollDecks = [];
  bulkCalls = [];
  bulkHangs = false;
  bulkNoCredits = 0;
  bulkGate = null;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
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
        // `aiGateThreshold` is the AI screening gate the status words are read
        // against; served here because `ConfigSummary` now requires it.
        return json(200, {
          plan: "pro",
          creditsBalance: balance,
          aiGateThreshold: 5,
          branding: {},
          coreParams: [],
          additionalParams: [],
        });
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
      /**
       * The bulk route ECHOES the request's own files, because since issue 3 a
       * batch is several bounded requests and a fixed reply would answer for
       * files the request never carried. Three file names are special, so one
       * mock serves every outcome the screen has to map back to a row:
       *
       *   `Refused.pdf` — reported failed, the per-row error path (unchanged);
       *   `Silent.pdf`  — left OUT of the report altogether, the deck that
       *                   neither uploaded nor failed;
       *   anything else — accepted. `Kept.pdf` keeps the id `pollDecks` is
       *                   keyed on, so the end-to-end query test is untouched.
       */
      if (url === "/api/decks/bulk") {
        if (bulkHangs) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
          });
        }
        bulkCalls.push(filesIn(init));
        if (bulkCalls.length <= bulkNoCredits) return json(402, { error: "no_credits" });
        const reply = () =>
          json(200, {
            results: filesIn(init)
              .filter((f) => f !== "Silent.pdf")
              .map((f) =>
                f === "Refused.pdf"
                  ? { file: f, ok: false, error: "pdf_too_large" }
                  : { file: f, ok: true, deckId: f === "Kept.pdf" ? "deck_uploaded" : `deck_${f}` },
              ),
          });
        return bulkGate ? bulkGate.then(reply) : reply();
      }
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
        <Where />
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
        statusCtx: CTX,
        showDashboard: false,
        progress: null,
      };
    }

    /**
     * The deck axis is what arms the panel now (issue 4): `aiComplete: false`
     * with the founder's four details intact is the client's "Incomplete deck",
     * whose §1 row is the one that says "Send to Query active".
     */
    const UNREADABLE_DECK: DeckView = {
      id: "deck_1",
      name: "PayRoute",
      statusId: "incomplete",
      aiComplete: false,
      missingFields: [],
    };

    it("opens for a deck the AI landed at Incomplete, with nothing clicked first", () => {
      const onSend = vi.fn();
      const props = reviewProps({ deckId: "deck_1", deck: { ...UNREADABLE_DECK } }, onSend);
      expect(isFlaggable(props.staged[0], CTX)).toBe(true);
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
          deck: { ...UNREADABLE_DECK },
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
      // The row carries the flagged-area count that the deleted button's badge
      // used to — on the client's own word for the cause, not a bare "Incomplete".
      expect(within(screen.getByTestId("up-deck-row")).getByText("Incomplete decks · 1 area")).toBeInTheDocument();
    });

    /**
     * The three states that must NOT offer it, and the third is issue 4's: a
     * deck the AI read whose founder details are missing is an Edit, not a
     * query. It was the one state the panel DID open in.
     */
    it("stays shut while the AI is still reading, for a Complete deck, and for missing contacts", () => {
      for (const deck of [
        { id: "deck_1", name: "PayRoute", statusId: "pending_ai", missingFields: ["founderEmail" as const] },
        { id: "deck_1", name: "PayRoute", statusId: "ai_evaluated", aiComplete: true, missingFields: [] },
        { id: "deck_1", name: "PayRoute", statusId: "ai_evaluated", aiComplete: true, missingFields: ["city" as const] },
      ]) {
        const props = reviewProps({ deckId: "deck_1", deck });
        expect(isFlaggable(props.staged[0], CTX)).toBe(false);
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
     * The whole seam, through the real screen: upload → the AI comes back with a
     * deck it could not read → the panel opens with no operator click → Send to
     * Query reaches `POST /api/decks/:id/queries` with the composed letter. This
     * is the path `e2e/upload.spec.ts` and `e2e/vc-intake.spec.ts` walked by
     * clicking "Mark incomplete", which row 2 deleted.
     *
     * Walked on a PARTLY FAILED batch, which is deliberate rather than
     * incidental: since issues 2 and 12 a fully successful incubator batch
     * leaves for the Dashboard, so the review screen's own flag panel is only
     * standing in front of an operator when something did not upload. Driving it
     * any other way would be testing a screen the product no longer shows.
     */
    it("raises the founder query end to end, with no Mark incomplete anywhere in it", async () => {
      pollDecks = [
        { id: "deck_uploaded", name: "Kept", statusId: "incomplete", aiComplete: false, missingFields: [] },
      ];
      mount(PA());
      await waitFor(() => expect(screen.getByText("Credits balance — 42 remaining")).toBeInTheDocument());
      fireEvent.click(screen.getByRole("radio", { name: /Bulk upload/ }));
      fireEvent.change(screen.getByLabelText("Choose a ZIP or several pitch decks"), {
        target: {
          files: [
            new File([new Uint8Array([37, 80, 68, 70])], "Kept.pdf", { type: "application/pdf" }),
            new File([new Uint8Array([37, 80, 68, 70])], "Refused.pdf", { type: "application/pdf" }),
          ],
        },
      });
      fireEvent.click(await screen.findByRole("button", { name: FORWARD }));
      fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
      fireEvent.click(screen.getByRole("button", { name: "Upload selected decks" }));

      // One failed, so the operator stays here — and the way on is the Dashboard.
      expect(await screen.findByText("1 deck could not be uploaded — see the list.")).toBeInTheDocument();
      expect(screen.getByTestId("where")).toHaveTextContent("/app/upload");
      expect(screen.getByRole("link", { name: "Go to dashboard →" })).toHaveAttribute("href", "/app/alldecks");

      // The AI's verdict alone opens it.
      fireEvent.click(screen.getAllByTestId("up-deck-row")[0]);
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
      expect(questions).toContain("Kept");
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
        <ResultsScreen uploaded={[]} workspaceSector={null} onBack={() => {}} statusCtx={CTX} />
      </MemoryRouter>,
    );
    const headers = screen.getAllByRole("columnheader").map((th) => th.textContent);
    expect(headers).toEqual(["Deck", "Founder name", "Email ID", "Phone number", "City", "Sector", "Status"]);
    expect(RESULTS_COLUMNS).toEqual(headers);
    expect(screen.getByTestId("up-results-summary")).toHaveTextContent("No decks uploaded yet.");
  });

  /**
   * Issue 5, at the level the tester saw it. Row A's PDF read fine and its phone
   * number is missing; row D's PDF is the thing the AI could not read. Both used
   * to pill "Incomplete", which is the whole complaint — one word for two
   * different things to do.
   */
  it("marks what the AI could not capture, never the sector, and names which half is incomplete", () => {
    render(
      <MemoryRouter>
        <ResultsScreen
          workspaceSector="FinTech"
          onBack={() => {}}
          statusCtx={CTX}
          uploaded={[
            uploaded({
              key: "a",
              deck: {
                id: "deck_a",
                name: "TaxPilot",
                founder: "Arjun Pillai",
                founderEmail: "arjun@taxpilot.in",
                city: "Chennai",
                statusId: "ai_evaluated",
                aiComplete: true,
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
                aiComplete: true,
                missingFields: [],
              },
            }),
            uploaded({ key: "c", name: "Queued deck", deck: undefined }),
            uploaded({
              key: "d",
              deck: {
                id: "deck_d",
                name: "PayRoute",
                founder: "Meera Sharma",
                founderEmail: "meera@payroute.in",
                founderPhone: "+91 98450 12345",
                city: "Bengaluru",
                statusId: "incomplete",
                aiComplete: false,
                missingFields: [],
              },
            }),
          ]}
        />
      </MemoryRouter>,
    );
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getAllByTestId("up-miss")).toHaveLength(1);
    expect(within(rows[0]).getByText("FinTech")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Incomplete contact details")).toBeInTheDocument();
    // No sector anywhere for this deck, and still no "not captured".
    expect(within(rows[1]).queryAllByTestId("up-miss")).toHaveLength(0);
    expect(within(rows[1]).getByText("Complete")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Awaiting AI evaluation")).toBeInTheDocument();
    // Every contact detail is on file; the DECK is what failed.
    expect(within(rows[3]).queryAllByTestId("up-miss")).toHaveLength(0);
    expect(within(rows[3]).getByText("Incomplete decks")).toBeInTheDocument();
    expect(screen.getByTestId("up-results-summary")).toHaveTextContent(
      "4 decks uploaded. The AI records the founder’s name, email, phone and city from each deck; sector is taken from your setup context. 1 deck with incomplete contact details. 1 deck the AI could not read. 1 still being read by the AI.",
    );
    // The old word is gone from the screen, not merely joined by a better one.
    expect(screen.queryByText("Incomplete")).toBeNull();
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

  it("offers Send to Evaluate from the results card — the prototype's only route to that screen", () => {
    render(
      <MemoryRouter>
        <ResultsScreen
          workspaceSector="FinTech"
          onBack={() => {}}
          statusCtx={CTX}
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
        <ResultsScreen uploaded={[]} workspaceSector={null} onBack={() => {}} statusCtx={CTX} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("link", { name: "Send to Evaluate →" })).toBeNull();
    rerender(
      <MemoryRouter>
        <ResultsScreen uploaded={[]} workspaceSector={null} onBack={() => {}} statusCtx={CTX} showSendToEvaluate />
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
  /**
   * Reached the way an incubator operator can still reach it. Issues 2 and 12
   * send a FULLY successful batch to the Dashboard, so the results card is now
   * behind a batch that partly failed: the operator stays on the review list,
   * goes back to the wizard, and "View uploaded details →" is there because
   * something did upload.
   */
  async function uploadDecksAndOpenResults() {
    await waitFor(() => expect(screen.getByText("Credits balance — 42 remaining")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("radio", { name: /Bulk upload/ }));
    fireEvent.change(screen.getByLabelText("Choose a ZIP or several pitch decks"), {
      target: {
        files: [
          new File([new Uint8Array([37, 80, 68, 70])], "Kept.pdf", { type: "application/pdf" }),
          new File([new Uint8Array([37, 80, 68, 70])], "Refused.pdf", { type: "application/pdf" }),
        ],
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: FORWARD }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    fireEvent.click(screen.getByRole("button", { name: "Upload selected decks" }));
    await screen.findByText("1 deck could not be uploaded — see the list.");
    fireEvent.click(screen.getByRole("button", { name: "← Back to upload" }));
    fireEvent.click(await screen.findByRole("button", { name: "View uploaded details →" }));
    expect(await screen.findByRole("heading", { name: "Uploaded decks — AI-extracted details" })).toBeInTheDocument();
  }

  it.each([
    ["an admin", ADMIN],
    ["a Program Associate", PA],
  ])("wires Send to Evaluate through to %s, not just to the superuser", async (_label, who) => {
    mount(who());
    await uploadDecksAndOpenResults();
    expect(screen.getByRole("link", { name: "Send to Evaluate →" })).toHaveAttribute("href", "/app/evaluate");
  });

  it("withholds it from a Program Manager while Q-P is open", async () => {
    mount(PM());
    await uploadDecksAndOpenResults();
    expect(screen.queryByRole("link", { name: "Send to Evaluate →" })).toBeNull();
    // The screen still works — only the v3 entry point is absent.
    expect(screen.getByRole("link", { name: "✓ Done" })).toHaveAttribute("href", "/app/alldecks");
  });

  it.each([
    ["the incubator superuser", SU],
    ["an admin", ADMIN],
    ["a Program Associate", PA],
  ])("keeps the review step and its cost preview for %s — credits are never spent unpreviewed (Q51)", async (_l, who) => {
    mount(who());
    fireEvent.click(await screen.findByRole("button", { name: FORWARD }));
    expect(await screen.findByRole("heading", { name: "Review uploaded decks" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload selected decks" })).toBeInTheDocument();
  });
});

/**
 * 1-Oct-2026 issues 1, 2 and 12 — the forward button's label was a promise its
 * handler never kept, and the batch ended by putting the operator back in front
 * of the dropzone. The client: "once upload is successful, we need to go to the
 * dashboard."
 */
describe("the end of the upload flow", () => {
  const SU = () => principal("superuser", ["upload", "query", "adminconsole"]);
  const VC_PARTNER = () => principal("partner", ["upload"], "vc");

  it.each([
    ["the incubator superuser", SU],
    ["an admin", ADMIN],
    ["a Program Manager", PM],
    ["a Program Associate", PA],
  ])("tells %s what the forward button actually does", async (_label, who) => {
    mount(who());
    expect(await screen.findByRole("button", { name: "Continue" })).toBeInTheDocument();
    // Both earlier labels claimed a navigation `onReview` has never performed.
    expect(screen.queryByRole("button", { name: "Go to dashboard →" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Evaluate & Go to Dashboard →" })).toBeNull();
  });

  it("leaves the VC edition on the wording it ships today — it was not rescoped", async () => {
    mount(VC_PARTNER());
    expect(await screen.findByRole("button", { name: "Go to dashboard →" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
  });

  it("goes to the Dashboard once the batch is uploaded, instead of back to the upload step", async () => {
    mount(PA());
    await waitFor(() => expect(screen.getByText("Credits balance — 42 remaining")).toBeInTheDocument());
    const deck = new File([new Uint8Array([37, 80, 68, 70])], "PayRoute.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Choose a pitch deck"), { target: { files: [deck] } });
    fireEvent.change(screen.getByLabelText("Startup name"), { target: { value: "PayRoute" } });
    fireEvent.click(screen.getByRole("button", { name: FORWARD }));
    fireEvent.click(within(screen.getByTestId("up-deck-row")).getByRole("checkbox", { name: "Select PayRoute" }));
    fireEvent.click(screen.getByRole("button", { name: "Upload selected decks" }));

    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/app/alldecks"));
    // Not the wizard with a notice beside the dropzone, which is where it went.
    expect(screen.queryByRole("button", { name: "View uploaded details →" })).toBeNull();
    expect(screen.queryByText(/the AI is reading it now/)).toBeNull();
  });

  it("keeps the VC edition where it lands today", async () => {
    mount(VC_PARTNER());
    await waitFor(() => expect(screen.getByText("Credits balance — 42 remaining")).toBeInTheDocument());
    const deck = new File([new Uint8Array([37, 80, 68, 70])], "Northbeam.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Choose a pitch deck"), { target: { files: [deck] } });
    fireEvent.change(screen.getByLabelText("Startup name"), { target: { value: "Northbeam" } });
    fireEvent.click(screen.getByRole("button", { name: "Go to dashboard →" }));
    fireEvent.click(within(screen.getByTestId("up-deck-row")).getByRole("checkbox", { name: "Select Northbeam" }));
    fireEvent.click(screen.getByRole("button", { name: "Upload selected decks" }));

    expect(await screen.findByRole("button", { name: "View uploaded details →" })).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent("/app/upload");
  });

  it("stays on the failures when part of the batch did not upload, and offers the Dashboard", async () => {
    mount(PA());
    await waitFor(() => expect(screen.getByText("Credits balance — 42 remaining")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("radio", { name: /Bulk upload/ }));
    fireEvent.change(screen.getByLabelText("Choose a ZIP or several pitch decks"), {
      target: {
        files: [
          new File([new Uint8Array([37, 80, 68, 70])], "Kept.pdf", { type: "application/pdf" }),
          new File([new Uint8Array([37, 80, 68, 70])], "Refused.pdf", { type: "application/pdf" }),
        ],
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: FORWARD }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    fireEvent.click(screen.getByRole("button", { name: "Upload selected decks" }));

    expect(await screen.findByText("1 deck could not be uploaded — see the list.")).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent("/app/upload");
    expect(screen.getByRole("heading", { name: "Review uploaded decks" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to dashboard →" })).toHaveAttribute("href", "/app/alldecks");
    // The refused deck stays ticked, so the demoted Upload button is a retry.
    expect(screen.getByRole("button", { name: "Upload selected decks" })).toBeEnabled();
    // "Cancel" would name the wrong thing for the deck that did upload.
    expect(screen.queryByRole("link", { name: "Cancel" })).toBeNull();
  });
});

/**
 * Issue 3 — "i tried uploading 10 decks at once and it still says uploading
 * after 40 minutes".
 *
 * Two independent faults, so two independent pins. The batch was ONE request
 * carrying every file, and `fetch` has no timeout — so a request that never
 * settled left `busy` raised with nothing else able to lower it. Chunking
 * bounds what any one request has to do; the deadline bounds how long the
 * screen can be wrong about it.
 */
describe("a bulk batch of ten decks (issue 3)", () => {
  /** Stage `n` bulk PDFs and land on the review list with all of them ticked. */
  async function stageBulk(names: string[]) {
    mount(PA());
    await waitFor(() => expect(screen.getByText("Credits balance — 42 remaining")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("radio", { name: /Bulk upload/ }));
    fireEvent.change(screen.getByLabelText("Choose a ZIP or several pitch decks"), {
      target: { files: names.map((n) => new File([new Uint8Array([37, 80, 68, 70])], n, { type: "application/pdf" })) },
    });
    fireEvent.click(await screen.findByRole("button", { name: FORWARD }));
    await waitFor(() => expect(screen.getByText(`${names.length} decks staged`)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    return () => fireEvent.click(screen.getByRole("button", { name: /^Upload selected decks$/ }));
  }

  const TEN = Array.from({ length: 10 }, (_, i) => `Deck${i + 1}.pdf`);

  it("cuts the batch into bounded requests instead of one unbounded POST", async () => {
    const upload = await stageBulk(TEN);
    upload();

    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/app/alldecks"));
    // Four requests of at most three files, not one of ten.
    expect(bulkCalls.map((c) => c.length)).toEqual([3, 3, 3, 1]);
    // And between them they carry every deck exactly once — chunking must not
    // drop or duplicate a file, which is the only way it could cost credits.
    expect(bulkCalls.flat().sort()).toEqual([...TEN].sort());
  });

  it("maps every outcome back to its own row across the chunk boundary", async () => {
    // Refused is in the FIRST request and Silent in the SECOND, so a row can
    // only be matched by its file name and not by its position in the batch.
    const upload = await stageBulk(["A.pdf", "Refused.pdf", "B.pdf", "C.pdf", "Silent.pdf", "D.pdf"]);
    upload();

    // Two failures: the one the server refused and the one it never mentioned.
    expect(await screen.findByText("2 decks could not be uploaded — see the list.")).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent("/app/upload");
    const rows = () => screen.getAllByTestId("up-deck-row");
    const text = rows().map((r) => r.textContent ?? "");
    // Four landed, two did not, and none is still waiting its turn.
    expect(text.filter((t) => t.includes("· uploaded"))).toHaveLength(4);
    expect(text.filter((t) => t.includes("· not uploaded"))).toHaveLength(2);
    expect(text.filter((t) => t.includes("not yet analysed"))).toHaveLength(0);

    // And each failure says its OWN reason, which is what the file-name match
    // across a chunk boundary is for.
    fireEvent.click(rows().find((r) => r.textContent?.includes("Refused.pdf"))!);
    expect(screen.getByText(/Too large/)).toBeInTheDocument();
    fireEvent.click(rows().find((r) => r.textContent?.includes("Silent.pdf"))!);
    expect(screen.getByText(/Upload failed — try this deck again/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to dashboard →" })).toHaveAttribute("href", "/app/alldecks");
  });

  it("stops the batch on no_credits without sending the remaining requests", async () => {
    bulkNoCredits = 1;
    const upload = await stageBulk(TEN);
    upload();

    // Said twice — in the banner and in the refused deck's own preview.
    expect(await screen.findAllByText(/Not enough credits/)).toHaveLength(2);
    // The refusal ends the batch where it always has: the other seven decks
    // were never sent, so they were never charged for either.
    expect(bulkCalls).toHaveLength(1);
    expect(screen.getByTestId("where")).toHaveTextContent("/app/upload");
  });

  it("gives up on a request that never answers, instead of saying Uploading for ever", async () => {
    bulkHangs = true;
    const upload = await stageBulk(TEN);

    // The clock goes fake only now: staging needs real timers, and the thing
    // under test is a `setTimeout` that no test should have to really wait out.
    vi.useFakeTimers();
    try {
      upload();
      // Every deck is 4 bytes, so this is the floor plus a rounding byte.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(uploadDeadlineMs(12) + 1000);
      });
    } finally {
      vi.useRealTimers();
    }

    // The button is a button again — this is the whole of the bug report.
    expect(screen.getByRole("button", { name: "Upload selected decks" })).toBeEnabled();
    expect(screen.queryByText(/^Uploading/)).toBeNull();
    expect(screen.queryAllByTestId("up-row-uploading")).toHaveLength(0);
    // And it says the one true thing: we stopped waiting, nobody refused
    // anything, so look before paying again.
    expect(screen.getByText(/The rest of the batch was left alone/)).toHaveTextContent(
      "check All decks before trying again",
    );
    // A dead connection ends the batch rather than spending a fresh deadline
    // on each of the three requests behind it.
    expect(bulkCalls).toHaveLength(0);
  });

  it("names the decks in flight and counts the batch down while it runs", async () => {
    let release!: () => void;
    bulkGate = new Promise<void>((r) => {
      release = r;
    });
    const upload = await stageBulk(["A.pdf", "B.pdf", "C.pdf", "D.pdf"]);
    upload();

    // The first request is out and held: its three decks say so, the fourth
    // does not, and the button counts the batch rather than just spinning.
    expect(await screen.findByRole("button", { name: "Uploading 0 of 4…" })).toBeInTheDocument();
    expect(screen.getAllByTestId("up-row-uploading")).toHaveLength(3);
    const text = screen.getAllByTestId("up-deck-row").map((r) => r.textContent ?? "");
    expect(text.filter((t) => t.includes("uploading…"))).toHaveLength(3);
    expect(text.find((t) => t.includes("D.pdf"))).toContain("not yet analysed");

    bulkGate = null;
    release();
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/app/alldecks"));
    expect(screen.queryAllByTestId("up-row-uploading")).toHaveLength(0);
  });

  it("cuts a chunk short on bytes, and never holds one deck back on its own", () => {
    const deck = (name: string, size: number) => ({ key: name, fileName: name, size }) as unknown as StagedDeck;
    // Three 10 MB decks exceed the 24 MB budget, so the third starts a request.
    expect(
      chunkBulk([deck("a", 10e6), deck("b", 10e6), deck("c", 10e6)]).map((c) => c.map((d) => d.fileName)),
    ).toEqual([["a", "b"], ["c"]]);
    // A deck at the 50 MB per-file ceiling is over the budget by itself and
    // still goes — the budget caps a request, it cannot refuse a deck.
    expect(chunkBulk([deck("big", 50 * 1024 * 1024)]).map((c) => c.length)).toEqual([1]);
    expect(chunkBulk([])).toEqual([]);
  });
});

describe("the founder's Upload", () => {
  it("shares none of the staff screen's credits, review or CRM surfaces", async () => {
    mount(principal("founder", []));
    expect(await screen.findByRole("heading", { name: "Upload pitch decks" })).toBeInTheDocument();
    expect(screen.queryByTestId("up-credits-bar")).toBeNull();
    expect(screen.queryByText(/credit/i)).toBeNull();
    expect(screen.queryByText(/CRM|Salesforce|Email triage/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Go to dashboard →" })).toBeNull();
    const calls = (fetch as unknown as { mock: { calls: [RequestInfo][] } }).mock.calls.map(([u]) => String(u));
    expect(calls).not.toContain("/api/config/summary");
  });
});
