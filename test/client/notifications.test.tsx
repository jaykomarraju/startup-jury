import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NotificationBell, relativeTime } from "../../src/client/components/NotificationBell";
import {
  NotificationPreferences,
  NotificationsSection,
} from "../../src/client/routes/admin/Notifications";
import { AdminSaveContext, type AdminSaveState } from "../../src/client/routes/admin/saveContext";
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_DEFAULTS,
  NOTIFICATION_EVENTS,
  notificationLabel,
  notificationSubLabel,
  type NotificationPreferenceView,
} from "../../src/shared/notifications";

/**
 * W3-B — the ribbon's bell and the Admin console's Notifications section.
 *
 * Two things this suite holds:
 *
 *  • **The bell's unread state.** The count is the whole control; a bell that
 *    lags the click that cleared it is worse than no bell. Both the badge and
 *    the per-row unread marker are asserted, before and after reading.
 *  • **The toggle grid.** Ten rows × two channels, with the prototype's own
 *    copy and its 8-on/2-off email mask, and a flip that reaches the server as
 *    one cell rather than a whole-grid overwrite.
 */

interface Sent {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

// ── The bell ─────────────────────────────────────────────────────────────────

function bellPayload(unread: number) {
  return {
    unread,
    notifications: [
      {
        id: "ntf_1",
        event: "deck_submitted",
        title: "New pitchdeck submitted: GreenRoute",
        body: "GreenRoute was uploaded by Sunita Rao.",
        link: "/app/decks/inc_deck_greenroute",
        deckId: "inc_deck_greenroute",
        readAt: null,
        createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      },
      {
        id: "ntf_2",
        event: "credits_low",
        title: "Credit balance low — 9 credits left",
        body: null,
        link: "/app/admin",
        deckId: null,
        readAt: "2026-09-09T09:00:00.000Z",
        createdAt: "2026-09-09T08:00:00.000Z",
      },
    ],
  };
}

function mockBell(unread = 1) {
  const sent: Sent[] = [];
  let current = unread;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method !== "GET") {
      sent.push({ url, method, body: JSON.parse(String(init?.body ?? "{}")) });
      // The server marks them read; the next poll reflects it.
      current = 0;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    const payload = bellPayload(current);
    if (current === 0) payload.notifications[0].readAt = "2026-09-10T10:00:00.000Z";
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as typeof fetch;
  return sent;
}

const mountBell = () =>
  render(
    <MemoryRouter>
      <NotificationBell />
    </MemoryRouter>,
  );

describe("NotificationBell (the prototype's inert `.nb`, made real)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the unread count and names it for a screen reader", async () => {
    mockBell(2);
    mountBell();
    await waitFor(() =>
      expect(screen.getByTestId("notification-bell-count")).toHaveTextContent("2"),
    );
    expect(screen.getByRole("button", { name: "Notifications, 2 unread" })).toBeTruthy();
  });

  it("caps the badge at 9+ rather than widening the ribbon", async () => {
    mockBell(41);
    mountBell();
    await waitFor(() =>
      expect(screen.getByTestId("notification-bell-count")).toHaveTextContent("9+"),
    );
  });

  it("shows no badge at all when nothing is unread", async () => {
    mockBell(0);
    mountBell();
    await waitFor(() => expect(screen.getByTestId("notification-bell")).toBeTruthy());
    expect(screen.queryByTestId("notification-bell-count")).toBeNull();
    expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy();
  });

  it("opens a centre listing the alerts, marking the unread ones", async () => {
    mockBell(1);
    mountBell();
    await waitFor(() => expect(screen.getByTestId("notification-bell")).toBeTruthy());
    fireEvent.click(screen.getByTestId("notification-bell"));

    const centre = screen.getByTestId("notification-centre");
    expect(within(centre).getByText("New pitchdeck submitted: GreenRoute")).toBeTruthy();
    expect(within(centre).getByText("Credit balance low — 9 credits left")).toBeTruthy();
    // Unread carries the marker; the already-read row does not.
    expect(screen.getByTestId("notification-item-ntf_1")).toHaveAttribute("data-unread", "1");
    expect(screen.getByTestId("notification-item-ntf_2")).not.toHaveAttribute("data-unread");
  });

  it("Mark all read posts once and clears the badge", async () => {
    const sent = mockBell(1);
    mountBell();
    await waitFor(() => expect(screen.getByTestId("notification-bell-count")).toBeTruthy());
    fireEvent.click(screen.getByTestId("notification-bell"));
    fireEvent.click(screen.getByTestId("notification-mark-all"));

    await waitFor(() => expect(screen.queryByTestId("notification-bell-count")).toBeNull());
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ url: "/api/notifications/read", method: "POST" });
    // An empty body is "all of them" — a list of ids would race the poll.
    expect(sent[0].body).toEqual({});
  });

  it("opening an alert marks that one read and closes the centre", async () => {
    const sent = mockBell(1);
    mountBell();
    await waitFor(() => expect(screen.getByTestId("notification-bell")).toBeTruthy());
    fireEvent.click(screen.getByTestId("notification-bell"));
    fireEvent.click(screen.getByTestId("notification-item-ntf_1"));

    await waitFor(() => expect(screen.queryByTestId("notification-centre")).toBeNull());
    expect(sent[0].body).toEqual({ id: "ntf_1" });
  });

  it("survives a failed poll with the last good state on screen", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("offline");
    }) as typeof fetch;
    mountBell();
    await waitFor(() => expect(screen.getByTestId("notification-bell")).toBeTruthy());
    expect(screen.queryByTestId("notification-bell-count")).toBeNull();
  });

  it("relativeTime degrades from minutes to a date", () => {
    const now = new Date("2026-09-10T12:00:00.000Z");
    expect(relativeTime("2026-09-10T11:58:00.000Z", now)).toBe("2m");
    expect(relativeTime("2026-09-10T09:00:00.000Z", now)).toBe("3h");
    expect(relativeTime("2026-09-08T12:00:00.000Z", now)).toBe("2d");
    expect(relativeTime("2026-08-20T12:00:00.000Z", now)).toBe("20 Aug");
    expect(relativeTime("2026-09-10T11:59:50.000Z", now)).toBe("just now");
  });
});

// ── The section ──────────────────────────────────────────────────────────────

function gridFor(edition: "incubator" | "vc"): NotificationPreferenceView[] {
  return NOTIFICATION_EVENTS.flatMap((event) =>
    NOTIFICATION_CHANNELS.map((channel) => ({
      event,
      channel,
      enabled: NOTIFICATION_DEFAULTS[event],
      source: "default" as const,
    })),
  ).map((c) => ({ ...c, edition })) as NotificationPreferenceView[];
}

function payload(over: Record<string, unknown> = {}) {
  return {
    scope: "user",
    edition: "incubator",
    events: NOTIFICATION_EVENTS.map((event) => ({
      event,
      label: notificationLabel(event, "incubator"),
      sub: notificationSubLabel(event),
    })),
    channels: NOTIFICATION_CHANNELS,
    preferences: gridFor("incubator"),
    delivery: { configured: false },
    canEditWorkspace: true,
    ...over,
  };
}

function mockSection(over: Record<string, unknown> = {}) {
  const sent: Sent[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.includes("/outbox")) {
      return new Response(
        JSON.stringify({
          entries: [
            {
              id: "mail_1",
              kind: "alert_deck_submitted",
              toEmail: "nisha.kapoor@demo.startupjury.ai",
              toName: "Nisha Kapoor",
              subject: "New pitchdeck submitted: GreenRoute",
              status: "recorded",
              error: null,
              createdAt: "2026-09-10T08:13:00.000Z",
            },
          ],
          delivery: { configured: false },
        }),
        { status: 200 },
      );
    }
    if (method !== "GET") {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        preferences?: Array<{ event: string; channel: string; enabled: boolean }>;
      };
      sent.push({ url, method, body });
      const next = payload(over);
      for (const w of body.preferences ?? []) {
        const cell = next.preferences.find((p) => p.event === w.event && p.channel === w.channel);
        if (cell) Object.assign(cell, { enabled: w.enabled, source: "user" });
      }
      return new Response(JSON.stringify(next), { status: 200 });
    }
    const scoped = url.includes("scope=workspace")
      ? payload({ ...over, scope: "workspace" })
      : payload(over);
    return new Response(JSON.stringify(scoped), { status: 200 });
  }) as typeof fetch;
  return sent;
}

let save: AdminSaveState | null = null;

function mountSection() {
  save = null;
  return render(
    <AdminSaveContext.Provider value={{ register: (s) => (save = s) }}>
      <NotificationsSection />
    </AdminSaveContext.Provider>,
  );
}

describe("Notifications section (admin/s-nt.html)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("draws the prototype's ten rows, in its order, with its copy", async () => {
    mockSection();
    mountSection();
    await waitFor(() => expect(screen.getByTestId("nt-row-deck_submitted")).toBeTruthy());

    for (const event of NOTIFICATION_EVENTS) {
      expect(screen.getByTestId(`nt-row-${event}`)).toBeTruthy();
    }
    expect(screen.getByText("New pitchdeck submitted")).toBeTruthy();
    expect(screen.getByText("Deck has been parsed and pre-scored by the AI engine")).toBeTruthy();
    expect(
      screen.getByText("Control which platform events trigger email and in-app alerts for your account."),
    ).toBeTruthy();
  });

  it("seeds the email column with the prototype's 8-on / 2-off mask", async () => {
    mockSection();
    mountSection();
    await waitFor(() => expect(screen.getByTestId("nt-tog-deck_submitted-email")).toBeTruthy());

    const off = NOTIFICATION_EVENTS.filter(
      (e) => screen.getByTestId(`nt-tog-${e}-email`).getAttribute("aria-checked") === "false",
    );
    expect(off).toEqual(["founder_responded", "invite_accepted"]);
  });

  it("carries both channels the section's sub-line names", async () => {
    mockSection();
    mountSection();
    await waitFor(() => expect(screen.getByTestId("nt-tog-credits_low-email")).toBeTruthy());
    expect(screen.getByTestId("nt-tog-credits_low-in_app")).toBeTruthy();
    expect(screen.getByText("Email")).toBeTruthy();
    expect(screen.getByText("In-app")).toBeTruthy();
  });

  it("a flip posts exactly that one cell and marks it as the user's own", async () => {
    const sent = mockSection();
    mountSection();
    await waitFor(() => expect(screen.getByTestId("nt-tog-deck_submitted-email")).toBeTruthy());

    fireEvent.click(screen.getByTestId("nt-tog-deck_submitted-email"));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].method).toBe("PUT");
    expect(sent[0].body).toEqual({
      preferences: [{ event: "deck_submitted", channel: "email", enabled: false }],
    });
    await waitFor(() =>
      expect(screen.getByTestId("nt-tog-deck_submitted-email")).toHaveAttribute(
        "aria-checked",
        "false",
      ),
    );
    expect(within(screen.getByTestId("nt-row-deck_submitted")).getByText("Your override")).toBeTruthy();
  });

  it("switches to the workspace policy, and hides that tab from a non-admin", async () => {
    const sent = mockSection();
    mountSection();
    await waitFor(() => expect(screen.getByTestId("nt-scope-workspace")).toBeTruthy());
    fireEvent.click(screen.getByTestId("nt-scope-workspace"));
    await waitFor(() =>
      expect(screen.getByText(/What every user in this workspace receives/)).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId("nt-tog-credits_low-email"));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].url).toContain("scope=workspace");
  });

  it("hides the scope switch from a user who cannot edit the policy", async () => {
    mockSection({ canEditWorkspace: false });
    mountSection();
    await waitFor(() => expect(screen.getByTestId("nt-row-deck_submitted")).toBeTruthy());
    expect(screen.queryByTestId("nt-scope-workspace")).toBeNull();
    expect(screen.queryByTestId("nt-scope-user")).toBeNull();
  });

  it("says so when no sending domain is configured (F0143)", async () => {
    mockSection();
    mountSection();
    await waitFor(() => expect(screen.getByTestId("nt-delivery-warning")).toBeTruthy());
    expect(screen.getByTestId("nt-delivery-warning").textContent).toContain("Recorded");
  });

  it("drops that warning once a sending domain IS verified", async () => {
    mockSection({ delivery: { configured: true } });
    mountSection();
    await waitFor(() => expect(screen.getByTestId("nt-row-credits_low")).toBeTruthy());
    expect(screen.queryByTestId("nt-delivery-warning")).toBeNull();
  });

  it("reads the delivery audit back, with its status (F0144)", async () => {
    mockSection();
    mountSection();
    await waitFor(() => expect(screen.getByTestId("nt-outbox")).toBeTruthy());
    const table = screen.getByTestId("nt-outbox");
    expect(within(table).getByText("alert_deck_submitted")).toBeTruthy();
    expect(within(table).getByText("Nisha Kapoor")).toBeTruthy();
    expect(within(table).getByText("Recorded")).toBeTruthy();
    // Node's en-GB abbreviates September as "Sept"; the assertion is on the
    // shape of the stamp, not on the ICU version that rendered it.
    expect(within(table).getByText(/10 Sept? 2026 · 08:13/)).toBeTruthy();
  });

  it("tells the console's Save button that this section saves on click", async () => {
    mockSection();
    mountSection();
    await waitFor(() => expect(screen.getByTestId("nt-row-deck_submitted")).toBeTruthy());
    expect(save?.dirty).toBe(false);
    expect(save?.hint).toBe("Notification preferences save as you change them.");
  });

  it("locks to the user's own scope on My account, even for an admin (§8 Q16(c))", async () => {
    // `lockToUserScope` is what makes the same control safe on a page every
    // role reaches: an admin looking at their own profile is not setting policy.
    mockSection({ canEditWorkspace: true });
    render(<NotificationPreferences lockToUserScope />);
    await waitFor(() => expect(screen.getByTestId("nt-tog-deck_submitted-email")).toBeTruthy());
    expect(screen.queryByTestId("nt-scope-workspace")).toBeNull();
    expect(screen.queryByTestId("nt-scope-user")).toBeNull();
    // …and it carries no delivery log: that names every recipient the workspace
    // has mailed and stays admin-only.
    expect(screen.queryByTestId("nt-outbox")).toBeNull();
  });

  it("shows an error state rather than an empty grid when the load fails", async () => {
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 500 })) as typeof fetch;
    mountSection();
    await waitFor(() =>
      expect(screen.getByText("Couldn't load your notification preferences")).toBeTruthy(),
    );
  });
});
