import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, configure } from "@testing-library/react";
import type { ReactElement } from "react";
import { AgreementsLibrarySection } from "../../src/client/routes/admin/AgreementsLibrary";
import { AuthorisedSignatoriesSection } from "../../src/client/routes/admin/AuthorisedSignatories";
import { AdminSaveContext, type AdminSaveState } from "../../src/client/routes/admin/saveContext";
import { AuthContext, type AuthUser } from "../../src/client/auth/AuthProvider";
import type { Edition, Role } from "../../src/shared/roles";
import type { AgreementTemplateView, SignatoryPool } from "../../src/shared/agreements";

/**
 * W5-B — Admin console → Sign-up → **Agreements library** and **Authorised
 * signatories**.
 *
 * Both sections in the three states the prototype implies — empty, populated
 * and failed — plus the pieces that are behaviour rather than decoration: the
 * merge-field editor's validation, the signing-workflow reorder, and the
 * countersign-picker projection that makes "only those enabled here" visible.
 */

// Load tolerance, per `W4-B`'s §9 note and §8 Q32. Every assertion here is
// downstream of a mocked fetch, and testing-library's 1 s default plus vitest's
// 5 s test budget are both easy to blow on a box running four worktrees'
// suites at once — which cost this session one false red. Neither number
// weakens an assertion; they only stop a slow machine reading as a broken one.
configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 30_000 });

function principal(edition: Edition, role: Role = "admin"): AuthUser {
  return {
    id: `${edition}_${role}`,
    name: "Nisha Kapoor",
    initials: "NK",
    role,
    edition,
  };
}

let save: AdminSaveState | null = null;

function mount(node: ReactElement, edition: Edition = "incubator") {
  save = null;
  return render(
    <AuthContext.Provider
      value={{
        user: principal(edition),
        loading: false,
        login: vi.fn(),
        logout: vi.fn(),
        updateUser: vi.fn(),
      }}
    >
      <AdminSaveContext.Provider value={{ register: (s) => (save = s) }}>
        {node}
      </AdminSaveContext.Provider>
    </AuthContext.Provider>,
  );
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

function template(over: Partial<AgreementTemplateView> = {}): AgreementTemplateView & {
  summary: string;
} {
  const base: AgreementTemplateView = {
    id: "at_inc_incub",
    edition: "incubator",
    code: "incubation_agreement",
    name: "Incubation Agreement",
    fileName: "incubation-agreement-v3.docx",
    fileStored: true,
    version: "v3",
    status: "active",
    stage: "on_signup",
    fields: [
      { key: "startup", label: "Startup legal name", sample: "NeuraLeaf AI Pvt Ltd" },
      { key: "founder", label: "Founder name", sample: "Ananya Menon" },
    ],
    programIds: ["prog_incubator_0002"],
    programNames: ["Fintech Accelerator"],
    flow: [
      { actor: "program_associate", action: "fill_blanks" },
      { actor: "founder", action: "sign_first" },
      { actor: "superuser", action: "countersign" },
    ],
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    agreementCount: 2,
    ...over,
  };
  return {
    ...base,
    summary: `${base.fileName ?? "(no file yet)"} · ${base.version} · ${base.fields.length} merge field${base.fields.length === 1 ? "" : "s"} · ${base.programNames.length ? base.programNames.join(", ") : "unmapped"}`,
  };
}

const TEMPLATES = [
  template(),
  template({
    id: "at_inc_mou",
    code: "mentorship_mou",
    name: "Mentorship MOU",
    fileName: "mentorship-mou-v1.docx",
    fileStored: false,
    version: "v1",
    status: "draft",
    programIds: [],
    programNames: [],
    fields: [{ key: "startup", label: "Startup name", sample: null }],
    agreementCount: 0,
  }),
  template({
    id: "at_inc_nda",
    code: "mutual_nda",
    name: "Mutual NDA",
    fileName: "mutual-nda-v1.pdf",
    version: "v1",
    status: "retired",
    stage: "pre_signup",
    programIds: [],
    programNames: [],
    fields: [{ key: "party", label: "Counterparty", sample: null }],
    agreementCount: 1,
  }),
];

const PROGRAMMES = [
  { id: "prog_incubator_0001", name: "Climate Cohort" },
  { id: "prog_incubator_0002", name: "Fintech Accelerator" },
  { id: "prog_incubator_0003", name: "SaaS Accelerator" },
];

interface Sent {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

function mockLibrary(templates = TEMPLATES) {
  const sent: Sent[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method !== "GET") {
      const raw = init?.body;
      sent.push({
        url,
        method,
        // A multipart upload's body is FormData, not JSON.
        body:
          typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : {},
      });
      if (method === "POST" && url.endsWith("/api/esign/templates")) {
        return json({ template: templates[1] }, 201);
      }
      if (url.endsWith("/file")) {
        // The upload response carries the template with its new file, which is
        // what the Template file card re-reads.
        return json({ template: { ...templates[0], fileName: "renamed.pdf", fileStored: true } });
      }
      return json({ template: templates[0] });
    }
    return json({ edition: "incubator", templates, programmes: PROGRAMMES });
  }) as typeof fetch;
  return sent;
}

const POOL: SignatoryPool = {
  roles: [
    { role: "superuser", label: "Super User", enabled: true },
    { role: "admin", label: "Admin", enabled: false },
    { role: "program_manager", label: "Program Manager", enabled: true },
    { role: "program_associate", label: "Program Associate", enabled: false },
    { role: "jury", label: "Jury Member", enabled: false },
  ],
  users: [
    {
      userId: "inc_superuser",
      name: "Priya Sharma",
      role: "superuser",
      roleLabel: "Super User",
      enabled: true,
    },
    {
      userId: "inc_pm",
      name: "Raj Kumar",
      role: "program_manager",
      roleLabel: "Program Manager",
      enabled: true,
    },
    {
      userId: "inc_admin",
      name: "Nisha Kapoor",
      role: "admin",
      roleLabel: "Admin",
      enabled: false,
    },
  ],
};

function mockPool(pool: SignatoryPool = POOL) {
  const sent: Sent[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method !== "GET") {
      sent.push({
        url: String(input),
        method,
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
      });
    }
    return json({ edition: "incubator", pool, options: { byRole: [], named: [] } });
  }) as typeof fetch;
  return sent;
}

/** The `<li>` for one template in the library list. */
function row(name: string) {
  return screen.getByText(name).closest("li") as HTMLElement;
}

// ── Agreements library ───────────────────────────────────────────────────────

describe("Agreements library — states", () => {
  it("renders the prototype's heading and sub-line", async () => {
    mockLibrary();
    mount(<AgreementsLibrarySection />);
    expect(
      await screen.findByRole("heading", { level: 2, name: "Agreements library" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/map it to programs and stages/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Retired templates stay for audit/)).toBeInTheDocument();
  });

  it("says funds, not programs, in the VC edition", async () => {
    mockLibrary();
    mount(<AgreementsLibrarySection />, "vc");
    expect(await screen.findByText(/map it to funds and stages/)).toBeInTheDocument();
  });

  it("has a loading state", () => {
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as typeof fetch;
    mount(<AgreementsLibrarySection />);
    expect(screen.getByText(/Loading agreement templates/)).toBeInTheDocument();
  });

  it("has an empty state that says what sign-up is missing", async () => {
    mockLibrary([]);
    mount(<AgreementsLibrarySection />);
    expect(await screen.findByText(/No agreement templates yet/)).toBeInTheDocument();
    expect(screen.getByText(/nothing to send until one is Active/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add template/ })).toBeInTheDocument();
  });

  it("has an error state with a retry", async () => {
    globalThis.fetch = vi.fn(async () => json({ error: "boom" }, 500)) as typeof fetch;
    mount(<AgreementsLibrarySection />);
    expect(await screen.findByText(/Couldn.t load the agreements library/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("renders each template with its badge, summary line and actions", async () => {
    mockLibrary();
    mount(<AgreementsLibrarySection />);
    await screen.findByText("Incubation Agreement");

    const incub = row("Incubation Agreement");
    expect(within(incub).getByText("Active")).toBeInTheDocument();
    expect(incub).toHaveTextContent(
      "incubation-agreement-v3.docx · v3 · 2 merge fields · Fintech Accelerator",
    );
    expect(within(incub).getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(within(incub).getByRole("button", { name: "New version" })).toBeInTheDocument();
    expect(within(incub).getByRole("button", { name: "Retire" })).toBeInTheDocument();

    // An unmapped draft says so, and pluralises correctly at one.
    expect(row("Mentorship MOU")).toHaveTextContent("1 merge field · unmapped");

    // Retired offers Restore rather than Retire.
    const nda = row("Mutual NDA");
    expect(within(nda).getByText("Retired")).toBeInTheDocument();
    expect(within(nda).getByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(within(nda).queryByRole("button", { name: "Retire" })).toBeNull();
  });

  it("offers delete only on a draft that has raised no agreement", async () => {
    mockLibrary();
    mount(<AgreementsLibrarySection />);
    await screen.findByText("Mentorship MOU");
    expect(screen.getByRole("button", { name: "Delete Mentorship MOU" })).toBeInTheDocument();
    // Active, and a used retired template, cannot be deleted — only retired.
    expect(screen.queryByRole("button", { name: "Delete Incubation Agreement" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete Mutual NDA" })).toBeNull();
  });
});

describe("Agreements library — the editor", () => {
  async function openEditor() {
    const sent = mockLibrary();
    mount(<AgreementsLibrarySection />);
    await screen.findByText("Incubation Agreement");
    fireEvent.click(within(row("Incubation Agreement")).getByRole("button", { name: "Edit" }));
    await screen.findByText("Editing: Incubation Agreement");
    return sent;
  }

  it("opens the four prototype cards, seeded from the template", async () => {
    await openEditor();
    expect(screen.getByText("Template file")).toBeInTheDocument();
    expect(screen.getByText("Merge fields")).toBeInTheDocument();
    expect(screen.getByText("Applies to")).toBeInTheDocument();
    expect(screen.getByText("Signing workflow")).toBeInTheDocument();

    expect(screen.getByLabelText("Version label")).toHaveValue("v3");
    expect(screen.getByLabelText("Status")).toHaveValue("active");
    expect(screen.getByLabelText("Stage")).toHaveValue("on_signup");
    expect(screen.getByLabelText("Field key 1")).toHaveValue("startup");
    expect(screen.getByLabelText("Field label 1")).toHaveValue("Startup legal name");
    expect(screen.getByLabelText("Sample value 1")).toHaveValue("NeuraLeaf AI Pvt Ltd");
  });

  it("renders the merge-field table's exact column set", async () => {
    await openEditor();
    const headers = screen
      .getAllByRole("columnheader")
      .map((h) => h.textContent?.trim())
      .filter((t) => t !== "");
    expect(headers).toEqual(["Field key", "Label", "Sample value"]);
    expect(
      screen.getByText(/The key maps to the placeholder in the uploaded file/),
    ).toBeInTheDocument();
  });

  it("adds and removes a merge field", async () => {
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: /Add field/ }));
    expect(screen.getByLabelText("Field key 3")).toHaveValue("new_field");
    fireEvent.click(screen.getByRole("button", { name: "Remove field 3" }));
    expect(screen.queryByLabelText("Field key 3")).toBeNull();
  });

  it("refuses a duplicate key before it reaches the server", async () => {
    const sent = await openEditor();
    fireEvent.change(screen.getByLabelText("Field key 2"), { target: { value: "startup" } });
    save?.onSave();
    expect(await screen.findByRole("alert")).toHaveTextContent("used by two merge fields");
    expect(sent.filter((s) => s.method === "PUT")).toHaveLength(0);
  });

  it("refuses a countersign step placed before the signature", async () => {
    const sent = await openEditor();
    // Move the countersign (step 3) above the founder's signature (step 2).
    fireEvent.click(screen.getByRole("button", { name: "Move step 3 up" }));
    fireEvent.click(screen.getByRole("button", { name: "Move step 2 up" }));
    save?.onSave();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "countersign step has to come after",
    );
    expect(sent.filter((s) => s.method === "PUT")).toHaveLength(0);
  });

  it("posts the whole editor — fields, stage, programme map and flow — on save", async () => {
    const sent = await openEditor();
    fireEvent.change(screen.getByLabelText("Stage"), { target: { value: "post_signup" } });
    fireEvent.click(screen.getByRole("switch", { name: "SaaS Accelerator" }));
    fireEvent.change(screen.getByLabelText("Sample value 2"), { target: { value: "Ravi" } });
    save?.onSave();

    await waitFor(() => expect(sent.some((s) => s.method === "PUT")).toBe(true));
    const put = sent.find((s) => s.method === "PUT")!;
    expect(put.url).toBe("/api/esign/templates/at_inc_incub");
    expect(put.body.stage).toBe("post_signup");
    expect(put.body.programIds).toEqual(["prog_incubator_0002", "prog_incubator_0003"]);
    expect((put.body.fields as Array<{ sample: string }>)[1].sample).toBe("Ravi");
    expect(put.body.flow).toEqual([
      { actor: "program_associate", action: "fill_blanks" },
      { actor: "founder", action: "sign_first" },
      { actor: "superuser", action: "countersign" },
    ]);
  });

  it("only enables the console's Save changes button once something moves", async () => {
    await openEditor();
    expect(save?.dirty).toBe(false);
    fireEvent.change(screen.getByLabelText("Version label"), { target: { value: "v4" } });
    await waitFor(() => expect(save?.dirty).toBe(true));
  });

  it("offers the edition's own flow actors, founder last", async () => {
    await openEditor();
    const who = screen.getByLabelText("Step 1 who") as HTMLSelectElement;
    expect([...who.options].map((o) => o.textContent)).toEqual([
      "Super User",
      "Admin",
      "Program Manager",
      "Program Associate",
      "Jury Member",
      "Startup founder",
    ]);
    const action = screen.getByLabelText("Step 1 action") as HTMLSelectElement;
    expect([...action.options].map((o) => o.textContent)).toEqual([
      "Fill blanks",
      "Sign first",
      "Countersign",
    ]);
  });

  it("an upload does not discard what the admin has typed but not saved", async () => {
    // Found by `e2e/agreements.spec.ts`: the upload's post-write refresh used
    // to re-seed the draft from the server, so a template typed-then-uploaded
    // saved under its old name. The file card reads the SERVER's template; the
    // draft is the admin's, and only a save or an explicit lifecycle action may
    // replace it.
    const sent = await openEditor();
    fireEvent.change(screen.getByLabelText("Template name"), {
      target: { value: "Renamed Before Upload" },
    });
    fireEvent.change(screen.getByLabelText("Template source file"), {
      target: {
        files: [new File(["%PDF-1.4"], "renamed.pdf", { type: "application/pdf" })],
      },
    });
    await waitFor(() => expect(sent.some((x) => x.url.endsWith("/file"))).toBe(true));
    await waitFor(() =>
      expect(screen.getByLabelText("Template name")).toHaveValue("Renamed Before Upload"),
    );

    save?.onSave();
    await waitFor(() => expect(sent.some((x) => x.method === "PUT")).toBe(true));
    expect(sent.find((x) => x.method === "PUT")!.body.name).toBe("Renamed Before Upload");
  });

  it("says a template with no file has nothing for its merge fields to map into", async () => {
    mockLibrary();
    mount(<AgreementsLibrarySection />);
    await screen.findByText("Mentorship MOU");
    fireEvent.click(within(row("Mentorship MOU")).getByRole("button", { name: "Edit" }));
    await screen.findByText("Editing: Mentorship MOU");
    expect(screen.getByText(/No source file uploaded yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload file" })).toBeInTheDocument();
  });
});

// ── Authorised signatories ───────────────────────────────────────────────────

describe("Authorised signatories", () => {
  it("renders the prototype's two cards with the seeded switches", async () => {
    mockPool();
    mount(<AuthorisedSignatoriesSection />);
    await screen.findByText("By role");
    expect(screen.getByText("Named individuals")).toBeInTheDocument();

    expect(screen.getByRole("switch", { name: "Super User" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("switch", { name: "Program Manager" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("switch", { name: "Program Associate" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    // Granted individuals show by default; the rest are behind Add individual.
    expect(screen.getByRole("switch", { name: "Priya Sharma" })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Nisha Kapoor" })).toBeNull();
  });

  it("says 'firm' rather than 'organisation' in the VC edition", async () => {
    mockPool();
    mount(<AuthorisedSignatoriesSection />, "vc");
    expect(await screen.findByText(/on the firm's behalf/)).toBeInTheDocument();
  });

  it("reveals the ungranted staff behind Add individual", async () => {
    mockPool();
    mount(<AuthorisedSignatoriesSection />);
    await screen.findByText("Named individuals");
    fireEvent.click(screen.getByRole("button", { name: /Add individual/ }));
    expect(screen.getByRole("switch", { name: "Nisha Kapoor" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("shows exactly what the sign-up countersign picker will offer", async () => {
    mockPool();
    mount(<AuthorisedSignatoriesSection />);
    await screen.findByText("The sign-up countersign picker");
    const picker = screen
      .getByText("The sign-up countersign picker")
      .closest("div.rounded-xl") as HTMLElement;
    expect(within(picker).getByText("Super User (any)")).toBeInTheDocument();
    expect(within(picker).getByText("Program Manager (any)")).toBeInTheDocument();
    expect(within(picker).getByText("Priya Sharma — Super User")).toBeInTheDocument();
    // Not granted, so not offered.
    expect(within(picker).queryByText("Nisha Kapoor — Admin")).toBeNull();
    expect(within(picker).queryByText("Program Associate (any)")).toBeNull();
  });

  it("updates the picker preview live, and says it is unsaved", async () => {
    mockPool();
    mount(<AuthorisedSignatoriesSection />);
    await screen.findByText("The sign-up countersign picker");
    fireEvent.click(screen.getByRole("switch", { name: "Program Associate" }));
    const picker = screen
      .getByText("The sign-up countersign picker")
      .closest("div.rounded-xl") as HTMLElement;
    expect(within(picker).getByText("Program Associate (any)")).toBeInTheDocument();
    expect(screen.getByText(/the workspace still reads the saved set/)).toBeInTheDocument();
  });

  it("warns when nobody is authorised — no agreement could be countersigned", async () => {
    mockPool({
      roles: POOL.roles.map((r) => ({ ...r, enabled: false })),
      users: POOL.users.map((u) => ({ ...u, enabled: false })),
    });
    mount(<AuthorisedSignatoriesSection />);
    expect(await screen.findByRole("status")).toHaveTextContent(/Nobody is authorised/);
    expect(screen.getByText(/No named individuals granted/)).toBeInTheDocument();
  });

  it("posts only the grants, and enables Save changes when one moves", async () => {
    const sent = mockPool();
    mount(<AuthorisedSignatoriesSection />);
    await screen.findByText("By role");
    expect(save?.dirty).toBe(false);
    fireEvent.click(screen.getByRole("switch", { name: "Jury Member" }));
    await waitFor(() => expect(save?.dirty).toBe(true));
    save?.onSave();
    await waitFor(() => expect(sent.some((s) => s.method === "PUT")).toBe(true));
    const put = sent.find((s) => s.method === "PUT")!;
    expect(put.url).toBe("/api/esign/signatories");
    expect((put.body.roles as Record<string, boolean>).jury).toBe(true);
    expect((put.body.roles as Record<string, boolean>).superuser).toBe(true);
  });

  it("has a loading state and an error state", async () => {
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as typeof fetch;
    const { unmount } = mount(<AuthorisedSignatoriesSection />);
    expect(screen.getByText(/Loading authorised signatories/)).toBeInTheDocument();
    unmount();

    globalThis.fetch = vi.fn(async () => json({ error: "boom" }, 500)) as typeof fetch;
    mount(<AuthorisedSignatoriesSection />);
    expect(await screen.findByText(/Couldn.t load the authorised signatories/)).toBeInTheDocument();
  });
});
