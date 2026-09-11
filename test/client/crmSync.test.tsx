import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { CrmSyncSection } from "../../src/client/routes/admin/CrmSync";
import { AdminSaveContext, type AdminSaveState } from "../../src/client/routes/admin/saveContext";
import type { CrmConnectionView } from "../../src/shared/crm";

/**
 * W3-D — Admin console → CRM sync.
 *
 * Three things this suite holds: the prototype's four provider rows with their
 * Live / Inactive pills and Connect · Configure · Disconnect actions; the
 * **disconnected vs connected** states of the connection card; and the mapping
 * editor, including the validation that stops an ambiguous set reaching the
 * server. Plus the standing credential rule — a posted key is never rendered
 * back.
 */

const SECRET = "sk-live-supersecret-9c4f2a";

function connection(over: Partial<CrmConnectionView> = {}): CrmConnectionView {
  return {
    provider: "salesforce",
    label: "Salesforce",
    status: "live",
    summary: "Last sync: 4 Jun 2026 · 11:42 am · 3 deals pulled",
    baseUrl: "acme.my.salesforce.com",
    webhookPath: null,
    syncDirection: "both",
    syncSchedule: "hourly",
    triggerField: "Stage",
    triggerValue: "Submitted for evaluation",
    monthlyDeckCap: 50,
    scoreWritebackField: "AI_Score__c",
    autoApproveWithinCap: true,
    writeBackScores: true,
    lastSyncAt: "2026-06-04 11:42:00",
    lastSyncCount: 3,
    lastError: null,
    connectedAt: "2026-05-02 09:15:00",
    credential: {
      configured: true,
      hint: "••••4f2a",
      ref: "CRM_SALESFORCE_TOKEN",
      setAt: "2026-05-02 09:15:00",
    },
    mappings: [
      { crmField: "Account.Name", appField: "companyName", direction: "inbound" },
      { crmField: "Contact.Email", appField: "founderEmail", direction: "inbound" },
    ],
    ...over,
  };
}

const CONNECTIONS: CrmConnectionView[] = [
  connection(),
  connection({
    provider: "hubspot",
    label: "HubSpot",
    status: "inactive",
    summary: "Not connected",
    baseUrl: null,
    lastSyncAt: null,
    lastSyncCount: null,
    connectedAt: null,
    triggerField: null,
    triggerValue: null,
    monthlyDeckCap: null,
    scoreWritebackField: null,
    autoApproveWithinCap: false,
    writeBackScores: false,
    credential: { configured: false, hint: null, ref: null, setAt: null },
    mappings: [],
  }),
  connection({
    provider: "pipedrive",
    label: "Pipedrive",
    status: "inactive",
    summary: "Not connected",
    credential: { configured: false, hint: null, ref: null, setAt: null },
    mappings: [],
  }),
  connection({
    provider: "custom",
    label: "Custom API",
    status: "inactive",
    summary: "Connect any CRM via webhook or REST API",
    credential: { configured: false, hint: null, ref: null, setAt: null },
    mappings: [],
  }),
];

interface Sent {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

function mockFetch(rows: CrmConnectionView[] = CONNECTIONS) {
  const sent: Sent[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method !== "GET") {
      sent.push({ url, method, body: JSON.parse(String(init?.body ?? "{}")) });
    }
    if (url.endsWith("/log")) {
      return new Response(JSON.stringify({ entries: [] }), { status: 200 });
    }
    if (url.endsWith("/sync")) {
      return new Response(
        JSON.stringify({
          attempt: { status: "recorded", error: null },
          cap: {},
          connections: rows,
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ edition: "incubator", connections: rows }), {
      status: 200,
    });
  }) as typeof fetch;
  return sent;
}

let save: AdminSaveState | null = null;

function mount() {
  save = null;
  return render(
    <AdminSaveContext.Provider value={{ register: (s) => (save = s) }}>
      <CrmSyncSection />
    </AdminSaveContext.Provider>,
  );
}

/** The `<li>` for one provider in the prototype's connector list. */
function providerRow(label: string) {
  return screen.getByText(label).closest("li") as HTMLElement;
}

/** The "<Provider> connection" card — the one that owns the credential box. */
function connectionCard() {
  return screen.getByLabelText("API key or token").closest("div.rounded-xl") as HTMLElement;
}

async function open(label: string) {
  await waitFor(() => expect(screen.getByText(label)).toBeTruthy());
  // "Disconnect" also contains "connect" — anchor the name.
  fireEvent.click(within(providerRow(label)).getByRole("button", { name: /^(Configure|Connect)$/ }));
}

beforeEach(() => {
  vi.restoreAllMocks();
  save = null;
});

describe("the provider list", () => {
  it("renders all four prototype rows with their status pills", async () => {
    mockFetch();
    mount();
    await waitFor(() => expect(screen.getByText("Salesforce")).toBeTruthy());
    for (const label of ["Salesforce", "HubSpot", "Pipedrive", "Custom API"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(within(providerRow("Salesforce")).getByText("Live")).toBeTruthy();
    expect(within(providerRow("HubSpot")).getByText("Inactive")).toBeTruthy();
  });

  it("shows the prototype's summary lines — last sync for a live row, the blurb otherwise", async () => {
    mockFetch();
    mount();
    await waitFor(() =>
      expect(screen.getByText("Last sync: 4 Jun 2026 · 11:42 am · 3 deals pulled")).toBeTruthy(),
    );
    // HubSpot and Pipedrive both carry it.
    expect(screen.getAllByText("Not connected")).toHaveLength(2);
    expect(screen.getByText("Connect any CRM via webhook or REST API")).toBeTruthy();
  });

  it("offers Configure + Disconnect when connected, and Connect when not", async () => {
    mockFetch();
    mount();
    await waitFor(() => expect(screen.getByText("Salesforce")).toBeTruthy());

    const sf = within(providerRow("Salesforce"));
    expect(sf.getByRole("button", { name: "Configure" })).toBeTruthy();
    expect(sf.getByRole("button", { name: "Disconnect" })).toBeTruthy();

    const hs = within(providerRow("HubSpot"));
    expect(hs.getByRole("button", { name: "Connect" })).toBeTruthy();
    expect(hs.queryByRole("button", { name: "Disconnect" })).toBeNull();
  });

  it("disconnects through the API", async () => {
    const sent = mockFetch();
    mount();
    await waitFor(() => expect(screen.getByText("Salesforce")).toBeTruthy());
    fireEvent.click(within(providerRow("Salesforce")).getByRole("button", { name: "Disconnect" }));
    await waitFor(() =>
      expect(sent.some((s) => s.url === "/api/crm/salesforce/disconnect")).toBe(true),
    );
  });
});

describe("the disconnected state", () => {
  it("leads with a write-only credential box and a Connect button", async () => {
    mockFetch();
    mount();
    await open("HubSpot");

    const key = screen.getByLabelText("API key or token") as HTMLInputElement;
    expect(key.type).toBe("password");
    expect(key.autocomplete).toBe("off");
    // The provider row carries a Connect button too; this is the card's.
    expect(within(connectionCard()).getByRole("button", { name: "Connect" })).toBeTruthy();
    // No credential summary — there is nothing configured to summarise.
    expect(screen.queryByText(/never shown or returned/)).toBeNull();
  });

  it("posts the credential once and never renders it back", async () => {
    const sent = mockFetch();
    mount();
    await open("HubSpot");

    const key = screen.getByLabelText("API key or token") as HTMLInputElement;
    fireEvent.change(key, { target: { value: SECRET } });
    fireEvent.click(within(connectionCard()).getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(sent.some((s) => s.url.endsWith("/connect"))).toBe(true));
    const connect = sent.find((s) => s.url.endsWith("/connect"))!;
    expect(connect.body.credential).toBe(SECRET);

    // Cleared the moment it is posted, so it cannot be re-rendered from state.
    await waitFor(() =>
      expect((screen.getByLabelText("API key or token") as HTMLInputElement).value).toBe(""),
    );
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it("offers no Sync now until the provider is connected", async () => {
    mockFetch();
    mount();
    await open("HubSpot");
    expect(screen.queryByRole("button", { name: /sync now/i })).toBeNull();
  });
});

describe("the connected state", () => {
  it("shows the masked hint and the secret's name, never a value", async () => {
    mockFetch();
    mount();
    await open("Salesforce");

    expect(screen.getByText(/••••4f2a/)).toBeTruthy();
    expect(screen.getByText("CRM_SALESFORCE_TOKEN")).toBeTruthy();
    expect(screen.queryByLabelText("API key or token")).toBeNull();
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it("fills the prototype's filter-rules card from the stored connection", async () => {
    mockFetch();
    mount();
    await open("Salesforce");

    expect((screen.getByLabelText("Trigger field") as HTMLInputElement).value).toBe("Stage");
    expect((screen.getByLabelText("Trigger value") as HTMLInputElement).value).toBe(
      "Submitted for evaluation",
    );
    expect((screen.getByLabelText("Monthly deck cap") as HTMLInputElement).value).toBe("50");
    expect((screen.getByLabelText("Score write-back field") as HTMLInputElement).value).toBe(
      "AI_Score__c",
    );
    expect(
      screen.getByRole("switch", { name: "Auto-approve if within monthly cap" }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen
        .getByRole("switch", { name: "Write AI scores and signals back to CRM" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("carries sync direction and schedule", async () => {
    mockFetch();
    mount();
    await open("Salesforce");
    expect((screen.getByLabelText("Sync direction") as HTMLSelectElement).value).toBe("both");
    expect((screen.getByLabelText("Sync schedule") as HTMLSelectElement).value).toBe("hourly");
  });

  it("records a sync attempt and says nothing was sent", async () => {
    const sent = mockFetch();
    mount();
    await open("Salesforce");
    fireEvent.click(screen.getByRole("button", { name: /sync now/i }));
    await waitFor(() => expect(sent.some((s) => s.url.endsWith("/sync"))).toBe(true));
    expect(await screen.findByText(/nothing was sent/i)).toBeTruthy();
  });
});

describe("the mapping editor", () => {
  it("lists the stored mappings and drops one on remove", async () => {
    mockFetch();
    mount();
    await open("Salesforce");

    expect((screen.getByLabelText("CRM field 1") as HTMLInputElement).value).toBe("Account.Name");
    expect((screen.getByLabelText("Maps to 1") as HTMLSelectElement).value).toBe("companyName");
    expect((screen.getByLabelText("CRM field 2") as HTMLInputElement).value).toBe("Contact.Email");

    fireEvent.click(screen.getByLabelText("Remove mapping 1"));
    expect((screen.getByLabelText("CRM field 1") as HTMLInputElement).value).toBe("Contact.Email");
    expect(screen.queryByLabelText("CRM field 2")).toBeNull();
  });

  it("adds a row defaulted to an app field that is not already taken", async () => {
    mockFetch();
    mount();
    await open("Salesforce");
    fireEvent.click(screen.getByRole("button", { name: /add mapping/i }));

    const added = screen.getByLabelText("Maps to 3") as HTMLSelectElement;
    expect((screen.getByLabelText("Direction 3") as HTMLSelectElement).value).toBe("inbound");
    // companyName and founderEmail are taken by the two stored rows.
    expect(["companyName", "founderEmail"]).not.toContain(added.value);
  });

  it("re-targets the app field when a row is switched to outbound", async () => {
    mockFetch();
    mount();
    await open("Salesforce");

    fireEvent.change(screen.getByLabelText("Direction 1"), { target: { value: "outbound" } });
    const appField = screen.getByLabelText("Maps to 1") as HTMLSelectElement;
    expect(appField.value).toBe("aiScore");
    expect(Array.from(appField.options).map((o) => o.value)).not.toContain("companyName");
  });

  it("refuses to save an ambiguous set, and posts nothing", async () => {
    const sent = mockFetch();
    mount();
    await open("Salesforce");

    // Point row 2 at the field row 1 already fills.
    fireEvent.change(screen.getByLabelText("Maps to 2"), { target: { value: "companyName" } });
    await waitFor(() => expect(save?.dirty).toBe(true));
    await save!.onSave();

    expect(await screen.findByRole("alert")).toHaveTextContent(/mapped twice/i);
    expect(sent.some((s) => s.method === "PUT")).toBe(false);
  });

  it("saves a valid set through the console's Save changes button", async () => {
    const sent = mockFetch();
    mount();
    await open("Salesforce");

    fireEvent.change(screen.getByLabelText("CRM field 1"), {
      target: { value: "Account.AccountName" },
    });
    fireEvent.change(screen.getByLabelText("Monthly deck cap"), { target: { value: "25" } });
    await waitFor(() => expect(save?.dirty).toBe(true));
    await save!.onSave();

    await waitFor(() => expect(sent.some((s) => s.method === "PUT")).toBe(true));
    const put = sent.find((s) => s.method === "PUT")!;
    expect(put.url).toBe("/api/crm/salesforce");
    expect(put.body.monthlyDeckCap).toBe(25);
    expect((put.body.mappings as Array<{ crmField: string }>)[0].crmField).toBe(
      "Account.AccountName",
    );
  });

  it("sends a blank monthly cap as null rather than zero", async () => {
    const sent = mockFetch();
    mount();
    await open("Salesforce");
    fireEvent.change(screen.getByLabelText("Monthly deck cap"), { target: { value: "" } });
    await waitFor(() => expect(save?.dirty).toBe(true));
    await save!.onSave();
    await waitFor(() => expect(sent.some((s) => s.method === "PUT")).toBe(true));
    expect(sent.find((s) => s.method === "PUT")!.body.monthlyDeckCap).toBeNull();
  });
});

describe("load states", () => {
  it("says so while loading, and offers a retry when the load fails", async () => {
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 500 })) as typeof fetch;
    mount();
    expect(screen.getByText(/loading crm connections/i)).toBeTruthy();
    expect(await screen.findByText(/couldn.t load your CRM connections/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("prompts for a provider before showing any configuration", async () => {
    mockFetch();
    mount();
    await waitFor(() => expect(screen.getByText("Salesforce")).toBeTruthy());
    expect(screen.getByText(/choose a provider above/i)).toBeTruthy();
    expect(screen.queryByLabelText("Trigger field")).toBeNull();
  });
});
