import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ContactPage, TicketsPage, noticeText, type TicketView } from "../../src/client/routes/SupportPages";
import type { TicketNotice } from "../../src/shared/notifications";

/**
 * WAVE A · P3 — the two ticket screens.
 *
 *   • Tickets (admin) — the prototype's `#panel-support`: Open / In progress /
 *     Resolved tiles, a status select per row, and a resolve that ASKS what was done
 *     before it posts anything.
 *   • Contact Admin — the prototype's `#panel-contactadmin`: raise a ticket with its
 *     category and priority, and follow it in "My recent tickets".
 *
 * And across both, the honesty rule: every confirmation names only the people the
 * server says it wrote an in-app row for, and none of them mentions email — because a
 * ticket sends none (`routes/support.ts`).
 */

const NOW = Date.now();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

function ticket(overrides: Partial<TicketView>): TicketView {
  return {
    id: "tkt_1",
    subject: "Cannot access Jury Pipeline",
    body: "The screen shows no decks assigned to me.",
    status: "open",
    billingRouted: false,
    area: "Access & login",
    priority: "high",
    resolution: null,
    createdAt: daysAgo(1),
    updatedAt: null,
    creator: "Rajesh Kumar",
    creatorRole: "Jury Member",
    raisedByMe: false,
    ...overrides,
  };
}

interface Api {
  queue: TicketView[];
  mine: TicketView[];
  earlier: { messages: { id: string; body: string; toScope: string; createdAt: string; sender: string }[]; inbox: boolean };
  posts: { url: string; body: Record<string, unknown> }[];
  notified: TicketNotice;
  /** Status the next move answers with. */
  moveStatus?: number;
}

let api: Api;

function installFetch() {
  const ok = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if ((init?.method ?? "GET") === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        api.posts.push({ url, body });
        const m = url.match(/^\/api\/tickets\/([^/]+)\/status$/);
        if (m) {
          if (api.moveStatus) return ok({ error: "status_changed" }, api.moveStatus);
          const id = decodeURIComponent(m[1]);
          api.queue = api.queue.map((t) =>
            t.id === id
              ? { ...t, status: String(body.status), resolution: body.resolution ? String(body.resolution) : t.resolution }
              : t,
          );
          return ok({ ok: true, status: body.status, changed: true, notified: api.notified });
        }
        if (url === "/api/tickets") {
          api.mine = [ticket({ id: "tkt_new", subject: String(body.subject), raisedByMe: true }), ...api.mine];
          return ok({ ok: true, id: "tkt_new", billingRouted: body.area === "Billing & subscription", notified: api.notified });
        }
        if (url === "/api/messages") return ok({ ok: true, id: "msg_1" });
        return ok({ error: "not_found" }, 404);
      }
      if (url === "/api/tickets") return ok({ tickets: api.queue });
      if (url === "/api/tickets/mine") return ok({ tickets: api.mine });
      if (url === "/api/messages?scope=admin") return ok(api.earlier);
      if (url === "/api/messages?scope=team") return ok({ messages: [], inbox: true });
      return ok({ error: "not_found" }, 404);
    }),
  );
}

beforeEach(() => {
  api = {
    queue: [
      ticket({}),
      ticket({ id: "tkt_2", subject: "Need 5 more Pro seats", status: "in_progress", area: "Billing & subscription", priority: "medium", billingRouted: true }),
      ticket({ id: "tkt_3", subject: "AI score looks off", status: "closed", priority: "low", resolution: "Re-ran the evaluation." }),
    ],
    mine: [],
    earlier: { messages: [], inbox: false },
    posts: [],
    notified: { inApp: ["Rajesh Kumar"], failed: false },
  };
  installFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderAt(navId: string) {
  return render(
    <MemoryRouter initialEntries={[`/app/${navId}`]}>
      <Routes>
        <Route path="/app/:navId" element={navId === "support" ? <TicketsPage /> : <ContactPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Whatever a screen says about a send, it must not be about email. */
function expectNoEmailClaim() {
  const notice = screen.getByTestId("ticket-notice");
  expect(notice.textContent).not.toMatch(/e-?mail|\bsent\b|delivered|inbox/i);
}

describe("noticeText — built from the rows written, never the audience", () => {
  it("names who was told, and says it was in the app", () => {
    expect(noticeText({ inApp: ["Nisha Kapoor"], failed: false }, "x")).toBe("Nisha Kapoor was notified in the app.");
    expect(noticeText({ inApp: ["Nisha Kapoor", "Priya Sharma"], failed: false }, "x")).toBe(
      "Nisha Kapoor and Priya Sharma were notified in the app.",
    );
    expect(noticeText({ inApp: ["A", "B", "C", "D", "E"], failed: false }, "x")).toBe(
      "A, B and 3 others were notified in the app.",
    );
  });

  it("gives the caller's reason when nobody was told, and owns up when the write failed", () => {
    expect(noticeText({ inApp: [], failed: false }, "You raised it.")).toBe("You raised it.");
    expect(noticeText({ inApp: [], failed: true }, "You raised it.")).toMatch(/couldn't be recorded/);
  });
});

describe("Tickets — the admin queue", () => {
  it("draws the prototype's three tiles and the queue's columns", async () => {
    renderAt("support");
    expect(await screen.findByRole("heading", { level: 1, name: "Support tickets" })).toBeInTheDocument();
    for (const [label, n] of [["Open", "1"], ["In progress", "1"], ["Resolved", "1"]]) {
      const tile = screen.getAllByRole("button", { pressed: false }).find((b) => b.textContent?.startsWith(label));
      expect(tile?.textContent).toContain(n);
    }
    const headers = within(screen.getByRole("table")).getAllByRole("columnheader").map((th) => th.textContent);
    expect(headers).toEqual(["Ticket", "Category", "Priority", "Status", "Age", ""]);
    // From · role, as the prototype's row reads.
    expect(screen.getAllByText("Rajesh Kumar · Jury Member").length).toBeGreaterThan(0);
  });

  it("filters by status from the tiles", async () => {
    renderAt("support");
    await screen.findByText("Cannot access Jury Pipeline");
    fireEvent.click(screen.getByRole("button", { name: /^Resolved\s*1/ }));
    expect(screen.queryByText("Cannot access Jury Pipeline")).not.toBeInTheDocument();
    expect(screen.getByText("AI score looks off")).toBeInTheDocument();
  });

  it("moves a ticket in progress from its row, and reports who was told — in the app", async () => {
    renderAt("support");
    fireEvent.change(await screen.findByLabelText("Status for Cannot access Jury Pipeline"), {
      target: { value: "in_progress" },
    });
    await waitFor(() => expect(api.posts).toHaveLength(1));
    expect(api.posts[0]).toEqual({ url: "/api/tickets/tkt_1/status", body: { status: "in_progress" } });
    expect(await screen.findByTestId("ticket-notice")).toHaveTextContent(
      "“Cannot access Jury Pipeline” is now In progress. Rajesh Kumar was notified in the app.",
    );
    expectNoEmailClaim();
  });

  it("choosing Resolved asks for the resolution FIRST, and posts nothing until it has one", async () => {
    renderAt("support");
    fireEvent.change(await screen.findByLabelText("Status for Cannot access Jury Pipeline"), {
      target: { value: "closed" },
    });
    // The pane opened instead of a post the server would refuse with a 400.
    expect(api.posts).toHaveLength(0);
    const pane = screen.getByTestId("ticket-detail");
    const submit = within(pane).getByRole("button", { name: "Mark resolved" });
    expect(submit).toBeDisabled();

    fireEvent.change(within(pane).getByLabelText("Resolution"), { target: { value: "  Added you to the panel.  " } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(api.posts).toHaveLength(1));
    expect(api.posts[0].body).toEqual({ status: "closed", resolution: "Added you to the panel." });
    expect(await screen.findByTestId("ticket-notice")).toHaveTextContent("is now Resolved. Rajesh Kumar was notified");
    expectNoEmailClaim();
  });

  it("the detail pane shows the resolution once resolved, and re-opens to In progress", async () => {
    renderAt("support");
    fireEvent.click(await screen.findByRole("button", { name: "Open AI score looks off" }));
    const pane = screen.getByTestId("ticket-detail");
    expect(within(pane).getByText("Resolution")).toBeInTheDocument();
    expect(within(pane).getByText("Re-ran the evaluation.")).toBeInTheDocument();
    fireEvent.click(within(pane).getByRole("button", { name: "Re-open" }));
    await waitFor(() => expect(api.posts).toHaveLength(1));
    // `tkReopen`: back to In progress — somebody is already on it.
    expect(api.posts[0].body).toEqual({ status: "in_progress" });
    // The old answer stays as the record of what was tried.
    expect(await within(screen.getByTestId("ticket-detail")).findByText("Previously resolved")).toBeInTheDocument();
  });

  it("says nobody was told — and why — when the admin moved their own ticket", async () => {
    api.queue = [ticket({ raisedByMe: true })];
    api.notified = { inApp: [], failed: false };
    renderAt("support");
    fireEvent.click(await screen.findByRole("button", { name: "Open Cannot access Jury Pipeline" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark in progress" }));
    expect(await screen.findByTestId("ticket-notice")).toHaveTextContent(
      "You raised it, so there was no one else to tell.",
    );
  });

  it("owns up when the status moved but the alert could not be recorded", async () => {
    api.notified = { inApp: [], failed: true };
    renderAt("support");
    fireEvent.change(await screen.findByLabelText("Status for Cannot access Jury Pipeline"), {
      target: { value: "in_progress" },
    });
    expect(await screen.findByTestId("ticket-notice")).toHaveTextContent(/couldn't be recorded, so nobody has been told/);
  });

  it("explains a 409 rather than pretending the move happened", async () => {
    api.moveStatus = 409;
    renderAt("support");
    fireEvent.change(await screen.findByLabelText("Status for Cannot access Jury Pipeline"), {
      target: { value: "in_progress" },
    });
    expect(await screen.findByTestId("ticket-notice")).toHaveTextContent("Someone else changed this ticket first");
  });
});

describe("Contact Admin — raise a ticket", () => {
  it("is the prototype's raise form: nine categories, four priorities, Medium preselected", async () => {
    renderAt("contactadmin");
    expect(await screen.findByRole("heading", { level: 1, name: "Contact Admin" })).toBeInTheDocument();
    expect(screen.getByText("Raise a support ticket for any issue")).toBeInTheDocument();
    const cat = screen.getByLabelText("Issue category");
    expect(within(cat).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Access & login",
      "Billing & subscription",
      "Deck upload / viewing",
      "AI scoring & evaluation",
      "Permissions & roles",
      "Intro call scheduling",
      "Bug / technical issue",
      "Feature request",
      "Other",
    ]);
    const pri = screen.getByLabelText("Priority");
    expect(within(pri).getAllByRole("option").map((o) => o.textContent)).toEqual(["Low", "Medium", "High", "Urgent"]);
    expect(pri).toHaveValue("medium");
    // No message composer any more — that was the build's reinterpretation.
    expect(screen.queryByLabelText("Message")).not.toBeInTheDocument();
  });

  it("raises with category and priority, says who was told in the app, and lists it", async () => {
    api.notified = { inApp: ["Nisha Kapoor", "Priya Sharma"], failed: false };
    renderAt("contactadmin");
    expect(await screen.findByText("No tickets yet.")).toBeInTheDocument();
    const raise = screen.getByRole("button", { name: "Raise ticket" });
    expect(raise).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Issue category"), { target: { value: "Billing & subscription" } });
    fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "urgent" } });
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Credits not added" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Bought 50, balance unchanged." } });
    fireEvent.click(raise);

    await waitFor(() => expect(api.posts).toHaveLength(1));
    expect(api.posts[0]).toEqual({
      url: "/api/tickets",
      body: { subject: "Credits not added", body: "Bought 50, balance unchanged.", area: "Billing & subscription", priority: "urgent" },
    });
    expect(await screen.findByTestId("ticket-notice")).toHaveTextContent(
      "Ticket raised and routed to billing. Nisha Kapoor and Priya Sharma were notified in the app.",
    );
    expectNoEmailClaim();
    expect(await screen.findByTestId("my-ticket-tkt_new")).toHaveTextContent("Credits not added");
    // Clear empties subject and description, as `caClear` does.
    expect(screen.getByLabelText("Subject")).toHaveValue("");
  });

  it("shows the raiser their status in the prototype's words, and the resolution once resolved", async () => {
    api.mine = [
      ticket({ id: "m1", subject: "Deck preview not loading", status: "in_progress", raisedByMe: true }),
      ticket({ id: "m2", subject: "AI score looks off", status: "closed", resolution: "Re-ran it.", raisedByMe: true }),
      // A reopened ticket's old answer is for whoever is working it, not the raiser.
      ticket({ id: "m3", subject: "Login loop", status: "in_progress", resolution: "Cleared session.", raisedByMe: true }),
    ];
    renderAt("contactadmin");
    expect(await screen.findByTestId("my-ticket-m1")).toHaveTextContent("In progress");
    expect(screen.getByTestId("my-ticket-m2")).toHaveTextContent("Resolved");
    expect(screen.getByTestId("my-ticket-m2")).toHaveTextContent("Resolution: Re-ran it.");
    expect(screen.getByTestId("my-ticket-m3")).not.toHaveTextContent("Cleared session.");
  });

  it("keeps messages written to Admin before the change readable, and hides the section when there are none", async () => {
    api.earlier = {
      messages: [{ id: "msg_seed", body: "Can you reassign the TaxPilot deck?", toScope: "admin", createdAt: daysAgo(3), sender: "Rajesh Kumar" }],
      inbox: true,
    };
    const { unmount } = renderAt("contactadmin");
    const section = await screen.findByTestId("earlier-messages");
    expect(section).toHaveTextContent("Messages sent to Admin · 1");
    expect(section).toHaveTextContent("Can you reassign the TaxPilot deck?");
    unmount();

    api.earlier = { messages: [], inbox: false };
    renderAt("contactadmin");
    await screen.findByText("No tickets yet.");
    expect(screen.queryByTestId("earlier-messages")).not.toBeInTheDocument();
  });
});

describe("Contact team — unchanged", () => {
  it("is still the staff channel, with its composer", async () => {
    renderAt("contactteam");
    expect(await screen.findByRole("heading", { level: 1, name: "Contact team" })).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toBeInTheDocument();
    expect(screen.queryByLabelText("Issue category")).not.toBeInTheDocument();
  });
});
