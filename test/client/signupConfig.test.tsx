import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { RequiredDocumentsSection } from "../../src/client/routes/admin/RequiredDocuments";
import {
  FundDeploymentSection,
  SeatCapacitySection,
} from "../../src/client/routes/admin/SeatCapacity";
import { AdminSaveContext, type AdminSaveState } from "../../src/client/routes/admin/saveContext";
import { listPrograms } from "../../src/client/api";
import type {
  FundRowView,
  RequiredDocumentView,
  SeatRowView,
  SignupDocumentSetView,
} from "../../src/shared/signupConfig";
import {
  fundReconcileNote,
  seatNote,
  seatlessNote,
} from "../../src/shared/signupConfig";

/**
 * W5-A — the three Sign-up console bodies.
 *
 * What this suite holds:
 *
 *  • **Both states of each table.** Empty (no checklist, no sign-ups, no
 *    cohorts, no funds) and populated — the prototype draws both and the plan
 *    asks for both (§4).
 *  • **The four lifecycle badges**, with the prototype's own labels, and the
 *    fact that a row offers only the moves the server said it would accept —
 *    never a skip.
 *  • **The bulk verify is disabled while nothing is submitted**, which is the
 *    state machine expressed in the UI rather than only in a 400.
 *  • **The utilisation bar and the two notes**, including the red over-capacity
 *    row and the reconciliation warning that names the offending fund.
 *  • The dirty/save wiring into the console title bar.
 */

vi.mock("../../src/client/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/api")>()),
  listPrograms: vi.fn(),
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const CHECKLIST: RequiredDocumentView[] = [
  { id: "rd1", name: "Certificate of incorporation", note: "PDF · one file", mandatory: true, active: true, programId: null, cohortId: null, sortOrder: 1 },
  { id: "rd2", name: "Founder ID proof", note: "Per founder", mandatory: true, active: true, programId: null, cohortId: null, sortOrder: 2 },
  { id: "rd3", name: "Cap table", note: "Current shareholding", mandatory: true, active: true, programId: null, cohortId: null, sortOrder: 3 },
  { id: "rd4", name: "Bank account details", note: "Cancelled cheque", mandatory: false, active: true, programId: null, cohortId: null, sortOrder: 4 },
  { id: "rd5", name: "GST / tax registration", note: "If applicable", mandatory: false, active: true, programId: null, cohortId: null, sortOrder: 5 },
];

/** One set holding all four lifecycle states at once, plus a waived item. */
const SET: SignupDocumentSetView = {
  signupId: "su1",
  deckId: "d1",
  startup: "Medixir",
  programName: "Climate Cohort",
  cohortName: "Cohort 6",
  signupStatus: "progress",
  documentsStatus: "partial",
  verifiable: 1,
  items: [
    { id: "sd1", name: "Certificate of incorporation", note: null, status: "verified", mandatory: true, waived: false, waivedReason: null, verifiedAt: "2026-09-01", next: [] },
    { id: "sd2", name: "Founder ID proof", note: null, status: "submitted", mandatory: true, waived: false, waivedReason: null, verifiedAt: null, next: ["awaiting", "verified"] },
    { id: "sd3", name: "Cap table", note: null, status: "awaiting", mandatory: true, waived: false, waivedReason: null, verifiedAt: null, next: ["not_requested", "submitted"] },
    { id: "sd4", name: "Bank account details", note: null, status: "not_requested", mandatory: false, waived: false, waivedReason: null, verifiedAt: null, next: ["awaiting"] },
    { id: "sd5", name: "GST / tax registration", note: null, status: "awaiting", mandatory: false, waived: true, waivedReason: "Not registered yet", verifiedAt: null, next: [] },
  ],
};

const SEAT_ROWS: SeatRowView[] = [
  { cohortId: "coh1", programId: "p1", programName: "Climate Cohort", cohortName: "Cohort 6", name: "Climate Cohort · Cohort 6", capacity: 20, filled: 18, utilisation: 90, over: false, remaining: 2 },
  { cohortId: "coh2", programId: "p2", programName: "Fintech Accelerator", cohortName: "Cohort 5", name: "Fintech Accelerator · Cohort 5", capacity: 15, filled: 9, utilisation: 60, over: false, remaining: 6 },
  { cohortId: "coh3", programId: "p3", programName: "SaaS Accelerator", cohortName: "Cohort 6", name: "SaaS Accelerator · Cohort 6", capacity: 12, filled: 12, utilisation: 100, over: false, remaining: 0 },
];

const FUND_ROWS: FundRowView[] = [
  { programId: "pv1", name: "Seed Fund II", allotted: 300, deployed: 182, unutilised: 118, utilisation: 61, reconcileDelta: 0, reconciles: true },
  { programId: "pv2", name: "Growth Fund I", allotted: 500, deployed: 410, unutilised: 90, utilisation: 82, reconcileDelta: 0, reconciles: true },
  { programId: "pv3", name: "Deep Tech Fund", allotted: null, deployed: null, unutilised: null, utilisation: 0, reconcileDelta: null, reconciles: true },
];

interface Sent {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

/** A fetch stub keyed on the path, so all three sections share one harness. */
function mockFetch(routes: Record<string, unknown>, status = 200) {
  const sent: Sent[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method !== "GET") sent.push({ url, method, body: JSON.parse(String(init?.body ?? "{}")) });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status });
  }) as typeof fetch;
  return sent;
}

let save: AdminSaveState | null = null;

function mount(node: React.ReactElement) {
  save = null;
  return render(
    <AdminSaveContext.Provider value={{ register: (s) => (save = s) }}>
      {node}
    </AdminSaveContext.Provider>,
  );
}

beforeEach(() => {
  vi.mocked(listPrograms).mockResolvedValue({
    sectors: [],
    programs: [
      {
        id: "p1",
        name: "Climate Cohort",
        active: true,
        cohorts: [{ id: "coh1", programId: "p1", name: "Cohort 6", active: true }],
      },
    ],
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Required documents
// ═══════════════════════════════════════════════════════════════════════════

const docsPayload = (over: Partial<Record<string, unknown>> = {}) => ({
  "/api/signup-config/documents": {
    edition: "incubator",
    scope: { programId: null, cohortId: null },
    inherited: false,
    items: CHECKLIST,
    retired: [],
    signups: [SET],
    ...over,
  },
});

describe("Required documents — the checklist", () => {
  it("renders the prototype's heading, scope card and five toggles", async () => {
    mockFetch(docsPayload());
    mount(<RequiredDocumentsSection />);

    await screen.findByText("Mandatory when ON"); // populated, not loading
    expect(screen.getByRole("heading", { level: 2, name: "Required documents" })).toBeInTheDocument();
    expect(
      screen.getByText(/Configured per program \/ cohort .* each toggle marks an item mandatory/),
    ).toBeInTheDocument();
    expect(screen.getByText("Mandatory when ON")).toBeInTheDocument();

    // Program + Applies to, with the prototype's two options.
    expect(screen.getByLabelText("Program")).toBeInTheDocument();
    const applies = screen.getByLabelText("Applies to") as HTMLSelectElement;
    expect([...applies.options].map((o) => o.textContent)).toEqual([
      "All startups entering sign-up",
      "New sign-ups only",
    ]);

    for (const item of CHECKLIST) {
      const toggle = screen.getByRole("switch", { name: `${item.name} mandatory` });
      expect(toggle).toHaveAttribute("aria-checked", String(item.mandatory));
    }
  });

  it("shows the empty state when no document is configured", async () => {
    mockFetch(docsPayload({ items: [], signups: [] }));
    mount(<RequiredDocumentsSection />);
    expect(await screen.findByTestId("checklist-empty")).toHaveTextContent(
      "a sign-up would ask the founder for nothing",
    );
    expect(screen.getByTestId("signups-empty")).toBeInTheDocument();
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
  });

  it("says when a programme is showing the inherited default", async () => {
    mockFetch(docsPayload({ inherited: true }));
    mount(<RequiredDocumentsSection />);
    expect(await screen.findByTestId("checklist-inherited")).toHaveTextContent(
      "has no list of its own yet",
    );
  });

  it("stays clean until edited, then hands the console a save that posts the whole list", async () => {
    const sent = mockFetch(docsPayload());
    mount(<RequiredDocumentsSection />);
    await screen.findByText("Mandatory when ON");
    expect(save?.dirty).toBe(false);

    fireEvent.click(screen.getByRole("switch", { name: "Bank account details mandatory" }));
    await waitFor(() => expect(save?.dirty).toBe(true));

    await save!.onSave();
    const put = sent.find((s) => s.method === "PUT")!;
    expect(put.url).toBe("/api/signup-config/documents");
    expect(put.body.applyTo).toBe("all");
    expect(put.body.items).toHaveLength(5);
    expect((put.body.items as { name: string; mandatory: boolean }[])[3]).toEqual({
      id: "rd4",
      name: "Bank account details",
      note: "Cancelled cheque",
      mandatory: true,
    });
  });

  it("adds and removes a row locally before anything is posted", async () => {
    const sent = mockFetch(docsPayload());
    mount(<RequiredDocumentsSection />);
    await screen.findByText("Mandatory when ON");

    fireEvent.click(screen.getByRole("button", { name: /Add document/ }));
    await waitFor(() => expect(save?.dirty).toBe(true));
    expect(screen.getAllByRole("switch")).toHaveLength(6);
    expect(sent).toHaveLength(0); // nothing posted yet

    fireEvent.click(screen.getByRole("button", { name: "Remove new document" }));
    await waitFor(() => expect(screen.getAllByRole("switch")).toHaveLength(5));
    await waitFor(() => expect(save?.dirty).toBe(false));
  });

  it("carries the Applies to choice into the save", async () => {
    const sent = mockFetch(docsPayload());
    mount(<RequiredDocumentsSection />);
    await screen.findByText("Mandatory when ON");

    fireEvent.change(screen.getByLabelText("Applies to"), { target: { value: "new" } });
    fireEvent.click(screen.getByRole("switch", { name: "Cap table mandatory" }));
    await waitFor(() => expect(save?.dirty).toBe(true));
    await save!.onSave();
    expect(sent.find((s) => s.method === "PUT")!.body.applyTo).toBe("new");
  });

  it("re-scopes the fetch when a programme or cohort is chosen", async () => {
    mockFetch(docsPayload());
    mount(<RequiredDocumentsSection />);
    await screen.findByText("Mandatory when ON");
    await waitFor(() =>
      expect([...(screen.getByLabelText("Program") as HTMLSelectElement).options]).toHaveLength(3),
    );

    fireEvent.change(screen.getByLabelText("Program"), { target: { value: "p1/coh1" } });
    await waitFor(() =>
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
        "/api/signup-config/documents?programId=p1&cohortId=coh1",
      ),
    );
  });

  it("heads the scope card Fund in the VC edition", async () => {
    mockFetch(docsPayload({ edition: "vc" }));
    mount(<RequiredDocumentsSection />);
    await screen.findByText("Mandatory when ON");
    expect(screen.getByLabelText("Fund")).toBeInTheDocument();
    expect(screen.queryByLabelText("Program")).toBeNull();
  });

  it("reports a load failure with a retry rather than an empty screen", async () => {
    mockFetch({}, 500);
    mount(<RequiredDocumentsSection />);
    expect(
      await screen.findByText(/Couldn’t load the required-documents checklist/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("Required documents — the four badges and the lifecycle", () => {
  const row = (name: string) => screen.getByText(new RegExp(`^${name}`)).closest("li")!;

  it("draws exactly the prototype's four badges, with its labels", async () => {
    mockFetch(docsPayload());
    mount(<RequiredDocumentsSection />);
    await screen.findByTestId("signup-set-su1");

    expect(within(row("Certificate of incorporation")).getByTestId("doc-badge-verified")).toHaveTextContent("Verified");
    expect(within(row("Founder ID proof")).getByTestId("doc-badge-submitted")).toHaveTextContent("Submitted");
    expect(within(row("Cap table")).getByTestId("doc-badge-awaiting")).toHaveTextContent("Awaiting");
    expect(within(row("Bank account details")).getByTestId("doc-badge-not_requested")).toHaveTextContent("Not requested");
    // A waived item is badged as waived rather than as a lifecycle state.
    expect(within(row("GST / tax registration")).getByTestId("doc-badge-waived")).toHaveTextContent("Waived");
  });

  it("marks each item required or optional, and shows a waiver's reason", async () => {
    mockFetch(docsPayload());
    mount(<RequiredDocumentsSection />);
    await screen.findByTestId("signup-set-su1");
    expect(within(row("Cap table")).getByText("required")).toBeInTheDocument();
    expect(within(row("Bank account details")).getByText("optional")).toBeInTheDocument();
    expect(row("GST / tax registration").textContent).toContain("Not registered yet");
  });

  it("offers only the moves the server will accept — never a skip", async () => {
    mockFetch(docsPayload());
    mount(<RequiredDocumentsSection />);
    await screen.findByTestId("signup-set-su1");

    // not_requested → only Request.
    const bank = within(row("Bank account details")).getAllByRole("button");
    expect(bank.map((b) => b.textContent)).toEqual(["Request"]);
    // awaiting → stand down or mark submitted, but NOT verify.
    const cap = within(row("Cap table")).getAllByRole("button");
    expect(cap.map((b) => b.textContent)).toEqual(["Stand down", "Mark submitted"]);
    expect(cap.map((b) => b.textContent)).not.toContain("Verify");
    // submitted → send back or verify.
    expect(within(row("Founder ID proof")).getAllByRole("button").map((b) => b.textContent)).toEqual(
      ["Send back", "Verify"],
    );
    // verified is terminal — no move at all.
    expect(within(row("Certificate of incorporation")).queryAllByRole("button")).toHaveLength(0);
  });

  it("PATCHes one move at a time rather than folding it into the draft save", async () => {
    const sent = mockFetch({
      ...docsPayload(),
      "/documents/sd3": { ok: true, document: SET.items[2] },
    });
    mount(<RequiredDocumentsSection />);
    await screen.findByTestId("signup-set-su1");

    fireEvent.click(within(row("Cap table")).getByRole("button", { name: "Mark submitted" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      url: "/api/signup-config/signups/su1/documents/sd3",
      method: "PATCH",
      body: { status: "submitted" },
    });
    expect(save?.dirty).toBe(false); // the checklist draft is untouched
  });

  it("explains an illegal transition in the lifecycle's own words", async () => {
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "PATCH") {
        return new Response(
          JSON.stringify({ error: "illegal_transition", from: "awaiting", to: "verified" }),
          { status: 400 },
        );
      }
      return new Response(JSON.stringify(docsPayload()["/api/signup-config/documents"]), {
        status: 200,
      });
    }) as typeof fetch;
    mount(<RequiredDocumentsSection />);
    await screen.findByTestId("signup-set-su1");

    fireEvent.click(within(row("Cap table")).getByRole("button", { name: "Mark submitted" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A document can't go from Awaiting to Verified — the lifecycle runs Not requested → Awaiting → Submitted → Verified.",
    );
  });

  it("enables Verify all only while something is submitted, and reports what it skipped", async () => {
    const sent = mockFetch({
      ...docsPayload(),
      "verify-all": { ok: true, moved: 1, blocked: 2 },
    });
    mount(<RequiredDocumentsSection />);
    await screen.findByTestId("signup-set-su1");

    const button = screen.getByRole("button", { name: "Verify all documents" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].url).toBe("/api/signup-config/signups/su1/documents/verify-all");
    expect(
      await screen.findByText(
        /Verified 1 document for Medixir · 2 still waiting on the founder/,
      ),
    ).toBeInTheDocument();
  });

  it("disables Verify all when nothing has been submitted", async () => {
    mockFetch(
      docsPayload({
        signups: [
          {
            ...SET,
            verifiable: 0,
            items: SET.items.map((i) => ({ ...i, status: "awaiting" as const, next: [] })),
          },
        ],
      }),
    );
    mount(<RequiredDocumentsSection />);
    await screen.findByTestId("signup-set-su1");
    expect(screen.getByRole("button", { name: "Verify all documents" })).toBeDisabled();
  });

  it("shows the roll-up the Sign up Pipeline column reads", async () => {
    mockFetch(docsPayload());
    mount(<RequiredDocumentsSection />);
    const set = await screen.findByTestId("signup-set-su1");
    expect(set).toHaveTextContent("Roll-up: partial");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Seat capacity
// ═══════════════════════════════════════════════════════════════════════════

const seatPayload = (over: Partial<Record<string, unknown>> = {}) => ({
  "/api/signup-config/seats": {
    rows: SEAT_ROWS,
    note: seatNote(SEAT_ROWS),
    seatless: [],
    seatlessNote: seatlessNote(0),
    ...over,
  },
});

describe("Seat capacity", () => {
  it("draws the prototype's five columns and its three seeded rows", async () => {
    mockFetch(seatPayload());
    mount(<SeatCapacitySection />);
    await screen.findByTestId("seat-note"); // the heading renders while loading too

    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Program / cohort",
      "Seat capacity",
      "Seats filled",
      "Utilisation",
      "",
    ]);
    expect(screen.getByTestId("seat-util-coh1-pct")).toHaveTextContent("90%");
    expect(screen.getByTestId("seat-util-coh2-pct")).toHaveTextContent("60%");
    expect(screen.getByTestId("seat-util-coh3-pct")).toHaveTextContent("100%");
    expect(screen.getByTestId("seat-util-coh1-bar")).toHaveStyle({ width: "90%" });
    expect(screen.getByLabelText("Climate Cohort · Cohort 6 seat capacity")).toHaveValue(20);
    expect(screen.getByLabelText("Climate Cohort · Cohort 6 seats filled")).toHaveValue(18);
  });

  it("says sign-up is never blocked by seats, in the heading and the note", async () => {
    mockFetch(seatPayload());
    mount(<SeatCapacitySection />);
    await screen.findByTestId("seat-note"); // the heading renders while loading too
    expect(screen.getByText(/Sign-up is never blocked by seats/)).toBeInTheDocument();
    expect(screen.getByTestId("seat-note")).toHaveTextContent(
      "Startups that complete sign-up without a seat are flagged seatless in the pipeline for allocation.",
    );
  });

  it("shows the empty state when no cohort exists", async () => {
    mockFetch(seatPayload({ rows: [], note: seatNote([]) }));
    mount(<SeatCapacitySection />);
    expect(await screen.findByTestId("seat-empty")).toHaveTextContent("No cohorts yet");
    expect(screen.queryAllByRole("columnheader")).toHaveLength(0);
  });

  it("recomputes the bar as the admin types, and turns it red over capacity", async () => {
    mockFetch(seatPayload());
    mount(<SeatCapacitySection />);
    await screen.findByTestId("seat-note"); // the heading renders while loading too

    fireEvent.change(screen.getByLabelText("Climate Cohort · Cohort 6 seats filled"), {
      target: { value: "23" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("seat-util-coh1-pct")).toHaveTextContent("115%"),
    );
    // The bar is clamped at 100 % but coloured as over capacity.
    expect(screen.getByTestId("seat-util-coh1-bar")).toHaveStyle({ width: "100%" });
    expect(screen.getByTestId("seat-note")).toHaveTextContent(
      "Over capacity: Climate Cohort · Cohort 6 (23/20). Sign-up still proceeds, but these push past the cohort seat count.",
    );
    expect(save?.dirty).toBe(true);
  });

  it("posts only the rows it was given, as whole seat counts", async () => {
    const sent = mockFetch(seatPayload());
    mount(<SeatCapacitySection />);
    await screen.findByTestId("seat-note"); // the heading renders while loading too

    fireEvent.change(screen.getByLabelText("SaaS Accelerator · Cohort 6 seat capacity"), {
      target: { value: "16" },
    });
    await waitFor(() => expect(save?.dirty).toBe(true));
    await save!.onSave();

    const put = sent.find((s) => s.method === "PUT")!;
    expect(put.url).toBe("/api/signup-config/seats");
    expect(put.body.rows).toEqual([
      { cohortId: "coh1", capacity: 20, filled: 18 },
      { cohortId: "coh2", capacity: 15, filled: 9 },
      { cohortId: "coh3", capacity: 16, filled: 12 },
    ]);
  });

  it("reads a cleared or junk seat count as zero rather than NaN", async () => {
    mockFetch(seatPayload());
    mount(<SeatCapacitySection />);
    await screen.findByTestId("seat-note"); // the heading renders while loading too
    fireEvent.change(screen.getByLabelText("Climate Cohort · Cohort 6 seat capacity"), {
      target: { value: "" },
    });
    await waitFor(() => expect(screen.getByTestId("seat-util-coh1-pct")).toHaveTextContent("0%"));
  });

  it("lists the seatless queue with an Allocate seat action", async () => {
    const sent = mockFetch({
      ...seatPayload({
        seatless: [
          {
            signupId: "su1",
            startup: "Medixir",
            status: "completed",
            cohortId: "coh1",
            cohortName: "Cohort 6",
            programName: "Climate Cohort",
          },
        ],
        seatlessNote: seatlessNote(1),
      }),
      "/seat": { ok: true, seated: true, over: false, status: "onboarded" },
    });
    mount(<SeatCapacitySection />);
    await screen.findByTestId("seatless-su1");
    expect(screen.getByTestId("seatless-note")).toHaveTextContent(
      "1 signed record still needs a seat.",
    );
    expect(screen.getByTestId("seatless-su1")).toHaveTextContent(
      "Medixir — no cohort seat allocated yet",
    );

    fireEvent.click(screen.getByRole("button", { name: "Allocate seat" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ url: "/api/signup-config/signups/su1/seat", method: "POST" });
    expect(
      await screen.findByText("Seat allocated to Medixir · founder access provisioned."),
    ).toBeInTheDocument();
  });

  it("cannot allocate to a startup with no cohort", async () => {
    mockFetch(
      seatPayload({
        seatless: [
          {
            signupId: "su2",
            startup: "LedgerLite",
            status: "completed",
            cohortId: null,
            cohortName: null,
            programName: null,
          },
        ],
        seatlessNote: seatlessNote(1),
      }),
    );
    mount(<SeatCapacitySection />);
    await screen.findByTestId("seatless-su2");
    expect(screen.getByRole("button", { name: "Allocate seat" })).toBeDisabled();
  });

  it("says the queue is clear when nothing is seatless", async () => {
    mockFetch(seatPayload());
    mount(<SeatCapacitySection />);
    expect(await screen.findByTestId("seatless-note")).toHaveTextContent(
      "Every completed sign-up holds a cohort seat.",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Fund Deployment
// ═══════════════════════════════════════════════════════════════════════════

const fundPayload = (rows: FundRowView[] = FUND_ROWS) => ({
  "/api/signup-config/fund": {
    rows,
    recon: fundReconcileNote(rows),
    totals: { allotted: 800, deployed: 592, unutilised: 208, utilisation: 74 },
  },
});

describe("Fund Deployment", () => {
  it("draws the prototype's six columns and its three seeded rows", async () => {
    mockFetch(fundPayload());
    mount(<FundDeploymentSection />);
    await screen.findByTestId("fund-recon"); // the heading renders while loading too

    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Program / fund",
      "Allotted (₹ Cr)",
      "Deployed (₹ Cr)",
      "Unutilised (₹ Cr)",
      "Utilisation",
      "",
    ]);
    expect(screen.getByTestId("fund-util-pv1-pct")).toHaveTextContent("61%");
    expect(screen.getByTestId("fund-util-pv2-pct")).toHaveTextContent("82%");
    expect(screen.getByLabelText("Seed Fund II allotted")).toHaveValue(300);
    expect(screen.getByLabelText("Seed Fund II unutilised")).toHaveValue(118);
    // An uncommitted fund's inputs are blank, not zero.
    expect(screen.getByLabelText("Deep Tech Fund allotted")).toHaveValue(null);
    expect(screen.getByText(/These figures feed the Capital Deployment/)).toBeInTheDocument();
  });

  it("shows the empty state when no programme exists", async () => {
    mockFetch(fundPayload([]));
    mount(<FundDeploymentSection />);
    expect(await screen.findByTestId("fund-empty")).toHaveTextContent("No programs yet");
  });

  it("reports the reconciling state, and warns naming the fund and the delta", async () => {
    mockFetch(fundPayload());
    mount(<FundDeploymentSection />);
    await screen.findByTestId("fund-recon"); // the heading renders while loading too
    expect(screen.getByTestId("fund-recon")).toHaveTextContent(
      "Deployed + unutilised reconciles with allotted for every program.",
    );

    fireEvent.change(screen.getByLabelText("Seed Fund II unutilised"), {
      target: { value: "130" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("fund-recon")).toHaveTextContent(
        "Deployed + unutilised doesn't match allotted for: Seed Fund II (+12 Cr). Adjust so they reconcile.",
      ),
    );
  });

  it("stays quiet inside the ±0.5 Cr tolerance", async () => {
    mockFetch(fundPayload());
    mount(<FundDeploymentSection />);
    await screen.findByTestId("fund-recon"); // the heading renders while loading too
    fireEvent.change(screen.getByLabelText("Seed Fund II unutilised"), {
      target: { value: "118.4" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("fund-recon")).toHaveTextContent("reconciles with allotted"),
    );
  });

  it("recomputes the utilisation bar as the figures are typed", async () => {
    mockFetch(fundPayload());
    mount(<FundDeploymentSection />);
    await screen.findByTestId("fund-recon"); // the heading renders while loading too
    fireEvent.change(screen.getByLabelText("Seed Fund II deployed"), { target: { value: "150" } });
    await waitFor(() => expect(screen.getByTestId("fund-util-pv1-pct")).toHaveTextContent("50%"));
  });

  it("posts every row, sending a cleared figure as null rather than zero", async () => {
    const sent = mockFetch(fundPayload());
    mount(<FundDeploymentSection />);
    await screen.findByTestId("fund-recon"); // the heading renders while loading too

    fireEvent.click(screen.getByRole("button", { name: "Clear fund figures for Growth Fund I" }));
    await waitFor(() => expect(save?.dirty).toBe(true));
    await save!.onSave();

    const put = sent.find((s) => s.method === "PUT")!;
    expect(put.url).toBe("/api/signup-config/fund");
    expect(put.body.rows).toEqual([
      { programId: "pv1", allotted: 300, deployed: 182, unutilised: 118 },
      { programId: "pv2", allotted: null, deployed: null, unutilised: null },
      { programId: "pv3", allotted: null, deployed: null, unutilised: null },
    ]);
  });

  it("totals the columns the Capital Deployment report reads", async () => {
    mockFetch(fundPayload());
    mount(<FundDeploymentSection />);
    const totals = await screen.findByTestId("fund-totals");
    expect(totals).toHaveTextContent("All programs");
    expect(totals).toHaveTextContent("800");
    expect(totals).toHaveTextContent("592");
    expect(totals).toHaveTextContent("208");
    expect(totals).toHaveTextContent("74%");
  });

  it("totals from the rows as typed, so the footer never disagrees with them", async () => {
    mockFetch(fundPayload());
    mount(<FundDeploymentSection />);
    await screen.findByTestId("fund-recon");

    fireEvent.change(screen.getByLabelText("Seed Fund II deployed"), { target: { value: "200" } });
    // 200 + 410 = 610 deployed against 800 allotted -> 76 %.
    await waitFor(() => expect(screen.getByTestId("fund-totals")).toHaveTextContent("610"));
    expect(screen.getByTestId("fund-totals")).toHaveTextContent("76%");
  });

  it("reports a load failure with a retry", async () => {
    mockFetch({}, 500);
    mount(<FundDeploymentSection />);
    expect(await screen.findByText(/Couldn’t load fund deployment/)).toBeInTheDocument();
  });
});
