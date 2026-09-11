import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { AuditLogSection } from "../../src/client/routes/admin/AuditLog";
import { AUDIT_BADGES, type AuditEventView, type AuditPage } from "../../src/shared/audit";

/**
 * W3-C — Admin console → System → **Audit log** (`admin/s-al.html`).
 *
 * Two things this suite holds: the prototype's **row** — four columns, the
 * category badge and its two colours, and the relative-then-absolute time rule
 * — and the **filter behaviour** the section adds on top of it (plan §6;
 * the conflict with F0136 is recorded in plan §8).
 */

function event(over: Partial<AuditEventView> = {}): AuditEventView {
  return {
    id: `aud_${Math.random().toString(36).slice(2, 8)}`,
    category: "config",
    action: "threshold_changed",
    summary: "Shortlist threshold changed from 6.5 to 7.0",
    actor: "Nisha K.",
    actorId: "inc_admin",
    deckId: null,
    deckName: null,
    targetType: "org_scoring_settings",
    targetId: "incubator",
    createdAt: new Date().toISOString(),
    ...over,
  };
}

/** One of each prototype category, so a filter always has something to remove. */
const EVENTS: AuditEventView[] = [
  event(),
  event({
    category: "score",
    action: "score_overridden",
    actor: "Priya S.",
    actorId: "inc_superuser",
    deckId: "inc_deck_greenroute",
    deckName: "GreenRoute",
    summary:
      'Override: Traction score for GreenRoute changed 6.2 → 8.1. Reason: "Pilot data confirmed"',
  }),
  event({
    category: "team",
    action: "user_invited",
    summary: "Invited Sunita Rao (sunita.rao@demo.startupjury.ai) as Program Associate · Standard plan",
  }),
  event({
    category: "billing",
    action: "credits_purchased",
    summary: "Purchased 50-unit pack · ₹20,000 · Transaction ID: RZP250603112244",
  }),
];

interface Sent {
  url: string;
  method: string;
}

function mockFetch(
  rows: AuditEventView[] = EVENTS,
  over: Partial<AuditPage> = {},
): { sent: Sent[] } {
  const sent: Sent[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    sent.push({ url, method: init?.method ?? "GET" });
    if (url.includes("/retention")) {
      return new Response(JSON.stringify({ ok: true, retentionDays: 365, purged: 0 }), {
        status: 200,
      });
    }
    // Honour the category filter so the component's own request is what
    // narrows the list — the section does not filter client-side.
    const params = new URLSearchParams(url.split("?")[1] ?? "");
    const cats = params.getAll("category");
    const events = cats.length > 0 ? rows.filter((e) => cats.includes(e.category)) : rows;
    const body: AuditPage = {
      events,
      nextCursor: null,
      actors: [
        { id: "inc_admin", label: "Nisha Kapoor" },
        { id: "inc_superuser", label: "Priya Sharma" },
      ],
      retentionDays: null,
      canConfigure: true,
      ...over,
    };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return { sent };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("the prototype's row", () => {
  it("renders time, actor, sentence and badge — four columns, in that order", async () => {
    mockFetch();
    render(<AuditLogSection />);
    const rows = await screen.findAllByTestId("al-row");
    expect(rows).toHaveLength(4);

    const first = within(rows[0]);
    expect(first.getByText("Nisha K.")).toBeInTheDocument();
    expect(first.getByText("Shortlist threshold changed from 6.5 to 7.0")).toBeInTheDocument();
    expect(first.getByTestId("al-badge-config")).toHaveTextContent("Config");
    // The `.log-t` column: today's row is a clock time, per `s-al.html`.
    expect(rows[0].textContent).toMatch(/\d{1,2}:\d{2} (am|pm)/);
  });

  it("paints each badge in the prototype's own two colours", async () => {
    mockFetch();
    render(<AuditLogSection />);
    await screen.findAllByTestId("al-row");
    for (const category of ["config", "score", "team", "billing"] as const) {
      const badge = screen.getAllByTestId(`al-badge-${category}`)[0];
      expect(badge).toHaveStyle({ background: AUDIT_BADGES[category].bg });
      expect(badge).toHaveTextContent(AUDIT_BADGES[category].label);
    }
  });

  it("renders older rows as 'Yesterday' and then as a date", async () => {
    const day = 86_400_000;
    mockFetch([
      event({ createdAt: new Date(Date.now() - day).toISOString() }),
      event({ createdAt: new Date(Date.now() - 5 * day).toISOString() }),
    ]);
    render(<AuditLogSection />);
    const rows = await screen.findAllByTestId("al-row");
    expect(rows[0]).toHaveTextContent("Yesterday");
    expect(rows[1].textContent).toMatch(/\d{1,2} [A-Z][a-z]{2}/);
  });

  it("shows the empty state rather than a bare card when nothing is recorded", async () => {
    mockFetch([]);
    render(<AuditLogSection />);
    expect(await screen.findByText("Nothing has been recorded yet")).toBeInTheDocument();
    expect(screen.queryAllByTestId("al-row")).toHaveLength(0);
  });
});

describe("the filter", () => {
  it("starts on All, with every category selectable", async () => {
    mockFetch();
    render(<AuditLogSection />);
    await screen.findAllByTestId("al-row");
    expect(screen.getByTestId("al-filter-all")).toHaveAttribute("aria-pressed", "true");
    for (const c of ["config", "score", "team", "billing", "pipeline", "security"]) {
      expect(screen.getByTestId(`al-filter-${c}`)).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("asks the server for one category and renders only those rows", async () => {
    const { sent } = mockFetch();
    render(<AuditLogSection />);
    await screen.findAllByTestId("al-row");

    fireEvent.click(screen.getByTestId("al-filter-billing"));

    await waitFor(() => expect(screen.getAllByTestId("al-row")).toHaveLength(1));
    expect(screen.getByTestId("al-badge-billing")).toBeInTheDocument();
    expect(screen.getByTestId("al-filter-billing")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("al-filter-all")).toHaveAttribute("aria-pressed", "false");
    expect(sent.some((r) => r.url.includes("category=billing"))).toBe(true);
  });

  it("combines two categories rather than replacing one with the other", async () => {
    const { sent } = mockFetch();
    render(<AuditLogSection />);
    await screen.findAllByTestId("al-row");

    fireEvent.click(screen.getByTestId("al-filter-billing"));
    await waitFor(() => expect(screen.getAllByTestId("al-row")).toHaveLength(1));
    fireEvent.click(screen.getByTestId("al-filter-team"));

    await waitFor(() => expect(screen.getAllByTestId("al-row")).toHaveLength(2));
    const last = sent[sent.length - 1].url;
    expect(last).toContain("category=billing");
    expect(last).toContain("category=team");
  });

  it("toggles a selected category back off", async () => {
    mockFetch();
    render(<AuditLogSection />);
    await screen.findAllByTestId("al-row");

    fireEvent.click(screen.getByTestId("al-filter-score"));
    await waitFor(() => expect(screen.getAllByTestId("al-row")).toHaveLength(1));
    fireEvent.click(screen.getByTestId("al-filter-score"));
    await waitFor(() => expect(screen.getAllByTestId("al-row")).toHaveLength(4));
  });

  it("All clears every selected category at once", async () => {
    mockFetch();
    render(<AuditLogSection />);
    await screen.findAllByTestId("al-row");

    fireEvent.click(screen.getByTestId("al-filter-config"));
    fireEvent.click(screen.getByTestId("al-filter-team"));
    await waitFor(() => expect(screen.getAllByTestId("al-row")).toHaveLength(2));

    fireEvent.click(screen.getByTestId("al-filter-all"));
    await waitFor(() => expect(screen.getAllByTestId("al-row")).toHaveLength(4));
    expect(screen.getByTestId("al-filter-all")).toHaveAttribute("aria-pressed", "true");
  });

  it("says so when a filter matches nothing, rather than showing the first-run copy", async () => {
    mockFetch([event({ category: "config" })]);
    render(<AuditLogSection />);
    await screen.findAllByTestId("al-row");

    fireEvent.click(screen.getByTestId("al-filter-billing"));
    expect(await screen.findByText("Nothing matches those filters")).toBeInTheDocument();
  });

  it("sends the actor, the date range and the search text to the server", async () => {
    const { sent } = mockFetch();
    render(<AuditLogSection />);
    await screen.findAllByTestId("al-row");

    fireEvent.change(screen.getByTestId("al-actor"), { target: { value: "inc_superuser" } });
    fireEvent.change(screen.getByTestId("al-from"), { target: { value: "2026-06-01" } });
    fireEvent.change(screen.getByTestId("al-to"), { target: { value: "2026-06-04" } });
    fireEvent.change(screen.getByTestId("al-search"), { target: { value: "threshold" } });

    await waitFor(() => {
      const last = sent[sent.length - 1].url;
      expect(last).toContain("actorId=inc_superuser");
      expect(last).toContain("from=2026-06-01");
      expect(last).toContain("to=2026-06-04");
      expect(last).toContain("q=threshold");
    });
  });
});

describe("retention and paging", () => {
  it("offers the retention window and writes the chosen one", async () => {
    const { sent } = mockFetch();
    render(<AuditLogSection />);
    await screen.findAllByTestId("al-row");

    const select = screen.getByTestId("al-retention");
    expect(select).toHaveValue("");
    fireEvent.change(select, { target: { value: "365" } });

    await waitFor(() => {
      const put = sent.find((r) => r.method === "PUT");
      expect(put?.url).toContain("/api/audit/retention");
    });
  });

  it("hides the retention control when the caller may not configure it", async () => {
    mockFetch(EVENTS, { canConfigure: false });
    render(<AuditLogSection />);
    await screen.findAllByTestId("al-row");
    expect(screen.queryByTestId("al-retention")).not.toBeInTheDocument();
  });

  it("offers Load more only while the server hands back a cursor", async () => {
    mockFetch();
    render(<AuditLogSection />);
    await screen.findAllByTestId("al-row");
    expect(screen.queryByTestId("al-more")).not.toBeInTheDocument();
    expect(screen.getByTestId("al-count")).toHaveTextContent("4 events");
  });

  it("appends the next page rather than replacing the first", async () => {
    const first = [event({ id: "a1" }), event({ id: "a2" })];
    let call = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      call += 1;
      const paged = String(input).includes("cursor=");
      return new Response(
        JSON.stringify({
          events: paged ? [event({ id: "b1" })] : first,
          nextCursor: paged ? null : "2026-06-04 08:00:00|a2",
          actors: [],
          retentionDays: null,
          canConfigure: true,
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    render(<AuditLogSection />);
    await screen.findAllByTestId("al-row");
    fireEvent.click(screen.getByTestId("al-more"));

    await waitFor(() => expect(screen.getAllByTestId("al-row")).toHaveLength(3));
    expect(call).toBe(2);
    expect(screen.queryByTestId("al-more")).not.toBeInTheDocument();
  });

  it("reports a failed read instead of rendering an empty trail as if it were empty", async () => {
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 500 })) as typeof fetch;
    render(<AuditLogSection />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the audit log");
  });
});
