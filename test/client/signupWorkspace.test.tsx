import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, within, configure, waitFor } from "@testing-library/react";
import { AuthContext, type AuthUser } from "../../src/client/auth/AuthProvider";
import type { Role } from "../../src/shared/roles";
import {
  DEFAULT_SIGNING_METHOD,
  describeCountersignRefusal,
  describeSigningMethod,
  type SigningMethodView,
} from "../../src/shared/agreements";
import {
  FounderMethodMirror,
  FounderSignupPanel,
  SignupWorkspace,
  type MethodPayload,
  type SignupWorkspaceView,
  type WorkspaceDocument,
} from "../../src/client/routes/SignupWorkspace";

/**
 * W6-A — the three-tab sign-up workspace (spec §8.3).
 *
 * What this suite holds, per the session's TEST block:
 *
 *  • **One document set.** The Documents tab and the Founder tab render the
 *    SAME rows — same ids, same order — from the one view.
 *  • **The method card in both states**: editable (the selects and toggles)
 *    and locked (`describeSigningMethod` + the server's `lockReason`, nothing to
 *    change) — decided by `method.editable`, never re-derived here.
 *  • **The countersign button in both states**: offered to the assigned
 *    signatory, and REPLACED by "Assign an authorised signatory to countersign."
 *    while nobody is assigned.
 *  • The PM read-only banner, and the founder's mirror and sign guard.
 */

configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 30_000 });

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function principal(role: Role, id = `inc_${role}`): AuthUser {
  return { id, name: "Raj Kumar", initials: "RK", role, edition: "incubator" };
}

const ITEMS: WorkspaceDocument[] = [
  { id: "sd1", name: "Certificate of incorporation", note: null, status: "submitted", mandatory: true, waived: false, waivedReason: null, verifiedAt: null, next: ["awaiting", "verified"], hasFile: true },
  { id: "sd2", name: "Founder ID proof", note: null, status: "awaiting", mandatory: true, waived: false, waivedReason: null, verifiedAt: null, next: ["not_requested", "submitted"], hasFile: false },
  { id: "sd3", name: "Cap table", note: null, status: "verified", mandatory: true, waived: false, waivedReason: null, verifiedAt: "2026-09-01", next: [], hasFile: true },
  { id: "sd4", name: "Bank account details", note: null, status: "not_requested", mandatory: false, waived: false, waivedReason: null, verifiedAt: null, next: ["awaiting"], hasFile: false },
];

function view(over: Partial<SignupWorkspaceView> = {}): SignupWorkspaceView {
  return {
    signupId: "su1",
    deckId: "d1",
    startup: "LedgerLite",
    programName: "SaaS Accelerator",
    cohortName: "Cohort 6",
    status: "initiated",
    deckStatus: "signup",
    founderEmail: "meera.sharma@demo.startupjury.ai",
    founderSignedAt: null,
    completedAt: null,
    agreement: { templateName: "SAFE Note", countersignedAt: null, countersignedBy: null },
    documents: { documentsStatus: "partial", verifiable: 1, items: ITEMS },
    seat: { seatless: false, seated: false, allocatedAt: null },
    assignment: { userId: null, name: null },
    readOnly: false,
    readOnlyReason: null,
    canAssign: false,
    programManagers: [],
    ...over,
  };
}

function methodView(over: Partial<SigningMethodView> = {}): SigningMethodView {
  return {
    ...DEFAULT_SIGNING_METHOD,
    signupId: "su1",
    deckId: "d1",
    deckName: "LedgerLite",
    status: "initiated",
    founderSignedAt: null,
    configured: false,
    editable: true,
    lockReason: null,
    assignment: { role: null, userId: null },
    assignmentLabel: "Not assigned",
    ...over,
  };
}

function payload(method: SigningMethodView): MethodPayload {
  return {
    method,
    options: {
      byRole: [{ role: "program_manager", label: "Program manager", enabled: true }],
      named: [{ userId: "inc_superuser", name: "Priya Sharma", roleLabel: "Super user", role: "superuser", enabled: true }],
    },
    providerLabel: "SignDesk",
    sigTypeLabel: "Standard e-signature",
  };
}

function mockFetch(v: SignupWorkspaceView, m: MethodPayload) {
  const calls: { url: string; method: string }[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET" });
    const body = url.includes("/method") ? m : v;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

function mount(node: React.ReactElement, role: Role = "program_associate", id?: string) {
  return render(
    <AuthContext.Provider
      value={{ user: principal(role, id), loading: false, login: vi.fn(), logout: vi.fn(), updateUser: vi.fn() }}
    >
      {node}
    </AuthContext.Provider>,
  );
}

const rowIds = (list: HTMLElement) =>
  within(list)
    .getAllByRole("listitem")
    .map((li) => li.getAttribute("data-testid"));

// ═══════════════════════════════════════════════════════════════════════════

describe("the three tabs share one document set", () => {
  it("renders the SAME rows, in the same order, on Documents and on Founder", async () => {
    mockFetch(view(), payload(methodView()));
    mount(<SignupWorkspace signupId="su1" initialTab="docs" onClose={vi.fn()} />);

    // Gate on the populated list, not on a heading the loading branch shares.
    const staff = await screen.findByTestId("signup-docs-staff");
    const staffRows = rowIds(staff);
    expect(staffRows).toEqual(["signup-doc-sd1", "signup-doc-sd2", "signup-doc-sd3", "signup-doc-sd4"]);
    // The four badges come from the one table.
    expect(within(staff).getByTestId("doc-badge-submitted")).toHaveTextContent("Submitted");
    expect(within(staff).getByTestId("doc-badge-awaiting")).toHaveTextContent("Awaiting");
    expect(within(staff).getByTestId("doc-badge-verified")).toHaveTextContent("Verified");
    expect(within(staff).getByTestId("doc-badge-not_requested")).toHaveTextContent("Not requested");
    expect(screen.getByRole("button", { name: "Verify all documents" })).toBeEnabled();

    fireEvent.click(screen.getByRole("tab", { name: "Founder" }));
    const founder = await screen.findByTestId("signup-docs-mirror");
    expect(rowIds(founder)).toEqual(staffRows);
    expect(screen.getByText(/Founder view — exactly what the founder sees/)).toBeInTheDocument();
    // A mirror: staff do not attach as the founder.
    expect(within(founder).queryByLabelText(/^Attach /)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Sign with/ })).toBeNull();
  });

  it("the tabs are Documents, Agreement and Founder", async () => {
    mockFetch(view(), payload(methodView()));
    mount(<SignupWorkspace signupId="su1" onClose={vi.fn()} />);
    await screen.findByTestId("method-editable");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Documents", "Agreement", "Founder"]);
    expect(screen.getByRole("tab", { name: "Agreement" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("the signing-method card", () => {
  it("is editable while the server says so", async () => {
    const calls = mockFetch(view(), payload(methodView({ editable: true })));
    mount(<SignupWorkspace signupId="su1" onClose={vi.fn()} />);
    const card = await screen.findByTestId("method-editable");
    expect(within(card).getByText(/editable until the founder signs/)).toBeInTheDocument();
    expect(within(card).getByLabelText("eSign provider")).toHaveValue("SignDesk");
    expect(within(card).getByRole("option", { name: "Adobe Sign" })).toBeInTheDocument();
    expect(
      within(card).getByRole("option", { name: "Certificate-based (DSC / Aadhaar eSign / QES)" }),
    ).toBeInTheDocument();
    expect(within(card).getByRole("switch", { name: "In-app signature" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByTestId("method-locked")).toBeNull();

    fireEvent.change(within(card).getByLabelText("eSign provider"), { target: { value: "DocuSign" } });
    await waitFor(() =>
      expect(calls.some((c) => c.method === "PUT" && c.url === "/api/esign/signups/su1/method")).toBe(true),
    );
  });

  it("collapses to the locked line once the server says it is locked", async () => {
    const locked = methodView({
      provider: "eMudhra",
      sigType: "certificate",
      wetInk: false,
      editable: false,
      founderSignedAt: "2026-09-01T00:00:00Z",
      lockReason: "Signing method locked — founder has signed",
      status: "progress",
    });
    mockFetch(view({ status: "progress", founderSignedAt: "2026-09-01T00:00:00Z" }), payload(locked));
    mount(<SignupWorkspace signupId="su1" onClose={vi.fn()} />);
    const line = await screen.findByTestId("method-locked");
    expect(line).toHaveTextContent(describeSigningMethod(locked));
    expect(line).toHaveTextContent("eMudhra · Certificate-based · fallback: in-app");
    expect(line).toHaveTextContent("Signing method locked — founder has signed");
    expect(screen.queryByTestId("method-editable")).toBeNull();
    expect(screen.queryByLabelText("eSign provider")).toBeNull();
  });
});

describe("the authorised-signatory picker and the countersign gate", () => {
  const signed = { status: "progress", founderSignedAt: "2026-09-01T00:00:00Z" } as const;

  it("groups the pool By role and Named individuals", async () => {
    mockFetch(view(), payload(methodView()));
    mount(<SignupWorkspace signupId="su1" onClose={vi.fn()} />);
    const select = await screen.findByLabelText("Authorised signatory");
    const groups = select.querySelectorAll("optgroup");
    expect([...groups].map((g) => g.getAttribute("label"))).toEqual(["By role", "Named individuals"]);
    expect(within(groups[0] as HTMLElement).getByRole("option", { name: "Program manager (any)" })).toBeInTheDocument();
    expect(within(groups[1] as HTMLElement).getByRole("option", { name: "Priya Sharma — Super user" })).toBeInTheDocument();
  });

  it("REPLACES the Countersign button with the sentence while nobody is assigned", async () => {
    mockFetch(
      view(signed),
      payload(methodView({ ...signed, editable: false, lockReason: "Signing method locked — founder has signed" })),
    );
    mount(<SignupWorkspace signupId="su1" onClose={vi.fn()} />, "program_manager");
    const refusal = await screen.findByTestId("countersign-refusal");
    expect(refusal).toHaveTextContent(describeCountersignRefusal("no_signatory"));
    expect(refusal).toHaveTextContent("Assign an authorised signatory to countersign.");
    expect(screen.queryByRole("button", { name: /Countersign/ })).toBeNull();
  });

  it("offers Countersign & complete to the assigned signatory", async () => {
    const calls = mockFetch(
      view(signed),
      payload(
        methodView({
          ...signed,
          editable: false,
          assignment: { role: "program_manager", userId: null },
          assignmentLabel: "Program manager (any)",
        }),
      ),
    );
    mount(<SignupWorkspace signupId="su1" onClose={vi.fn()} />, "program_manager");
    const button = await screen.findByRole("button", { name: "Countersign & complete" });
    expect(screen.queryByTestId("countersign-refusal")).toBeNull();
    fireEvent.click(button);
    await waitFor(() => expect(calls.some((c) => c.url === "/api/signups/su1/complete")).toBe(true));
    expect(calls.findIndex((c) => c.url === "/api/esign/signups/su1/countersign")).toBeLessThan(
      calls.findIndex((c) => c.url === "/api/signups/su1/complete"),
    );
  });

  it("tells somebody who is NOT the signatory so, rather than offering the button", async () => {
    mockFetch(
      view(signed),
      payload(methodView({ ...signed, editable: false, assignment: { role: null, userId: "inc_superuser" } })),
    );
    mount(<SignupWorkspace signupId="su1" onClose={vi.fn()} />, "program_manager");
    expect(await screen.findByTestId("countersign-refusal")).toHaveTextContent(
      describeCountersignRefusal("not_the_signatory"),
    );
  });
});

describe("the seat card and the PM read-only gate", () => {
  it("draws the red Seatless card with Allocate seat, and the green one once seated", async () => {
    const closed = { status: "completed", deckStatus: "onboard_ready" };
    mockFetch(view({ ...closed, seat: { seatless: true, seated: false, allocatedAt: null } }), payload(methodView({ editable: false, status: "completed" })));
    const first = mount(<SignupWorkspace signupId="su1" onClose={vi.fn()} />);
    expect(await screen.findByTestId("seatless")).toHaveTextContent("Seatless — no cohort seat allocated yet");
    expect(screen.getByRole("button", { name: "Allocate seat" })).toBeInTheDocument();
    expect(screen.getByTestId("assign-locked")).toHaveTextContent("Countersignatory");
    first.unmount();

    mockFetch(view({ ...closed, seat: { seatless: false, seated: true, allocatedAt: "2026-09-02" } }), payload(methodView({ editable: false, status: "completed" })));
    mount(<SignupWorkspace signupId="su1" onClose={vi.fn()} />);
    expect(await screen.findByTestId("seat-allocated")).toHaveTextContent("Seat allocated · founder access provisioned");
  });

  it("shows an unassigned PM the prototype's read-only banner", async () => {
    mockFetch(
      view({ readOnly: true, readOnlyReason: "Read-only — a Super user or Admin hasn't assigned you to this sign-up yet. You can view, but not act." }),
      payload(methodView()),
    );
    mount(<SignupWorkspace signupId="su1" onClose={vi.fn()} />, "program_manager");
    expect(await screen.findByTestId("workspace-read-only")).toHaveTextContent(/You can view, but not act\./);
    expect(screen.getByLabelText("eSign provider")).toBeDisabled();
  });

  it("offers the PM assignment only when the server says the caller may assign", async () => {
    mockFetch(
      view({ canAssign: true, programManagers: [{ id: "inc_pm", name: "Raj Kumar" }] }),
      payload(methodView()),
    );
    mount(<SignupWorkspace signupId="su1" onClose={vi.fn()} />, "admin");
    const select = await screen.findByLabelText("Assigned program manager");
    expect(within(select).getByRole("option", { name: "Raj Kumar" })).toBeInTheDocument();
  });
});

describe("the founder's side", () => {
  it("mirrors How you'll sign — provider, short type, the certificate chip, the alternatives", () => {
    render(<FounderMethodMirror method={{ provider: "Zoho", sigType: "certificate", inApp: true, wetInk: true }} />);
    const card = screen.getByTestId("founder-method");
    expect(card).toHaveTextContent("How you'll sign");
    expect(card).toHaveTextContent("Sign with Zoho Sign");
    expect(card).toHaveTextContent("Certificate-based");
    expect(card).toHaveTextContent("DSC / Aadhaar / QES");
    expect(card).toHaveTextContent("Alternatives your team enabled: in-app signature, print & upload");
  });

  it("omits the chip on a standard signature", () => {
    render(<FounderMethodMirror method={{ provider: "SignDesk", sigType: "standard", inApp: false, wetInk: true }} />);
    expect(screen.getByTestId("founder-method")).not.toHaveTextContent("DSC / Aadhaar / QES");
    expect(screen.getByTestId("founder-method")).toHaveTextContent("Alternatives your team enabled: print & upload");
  });

  it("attaches only what the lifecycle will accept, and refuses to sign with a required document outstanding", async () => {
    const calls = mockFetch(view(), payload(methodView()));
    render(<FounderSignupPanel view={view()} method={methodView()} mode="founder" />);
    const rows = screen.getByTestId("signup-docs-founder");
    // sd2 is awaiting → Attach; sd1/sd3 are in → Attached; sd4 was never requested → its badge.
    expect(within(rows).getByLabelText("Attach Founder ID proof")).toBeInTheDocument();
    expect(within(rows).getAllByText("Attached")).toHaveLength(2);
    expect(within(rows).queryByLabelText("Attach Bank account details")).toBeNull();
    expect(within(rows).getByTestId("doc-badge-not_requested")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Type your full name to sign"), { target: { value: "Meera Sharma" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign with SignDesk" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Attach all required documents and type your name to sign.",
    );
    expect(calls.some((c) => c.url.includes("founder-signature"))).toBe(false);
  });
});
