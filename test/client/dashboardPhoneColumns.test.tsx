import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthContext, type AuthUser } from "../../src/client/auth/AuthProvider";
import {
  DashboardPage,
  ALL_DECKS_COLUMNS,
  PHONE_COLUMNS,
} from "../../src/client/routes/DashboardPage";
import type { DeckView } from "../../src/client/types";
import * as api from "../../src/client/api";

/**
 * The Dashboard's deck TABLE at phone width (L7, 2026-10-05).
 *
 * MEASURED at 393x659 before the change, signed in as the incubator superuser:
 * the `v3Default` table laid out at **1045px inside a 359px pane**, so 686px of
 * it was off screen. The four columns a phone could see were Startup name,
 * Founder, Phone and a clipped Email; AI score (x=564), Status (x=622) and the
 * row's Actions menu (x=764) were all past the right edge. The client's words
 * were "all the stat boxes, reports and actions on the dashboard must be
 * working" — and the Actions menu could not be reached at all.
 *
 * `PHONE_COLUMNS` is the fix: below 640px the two incubator staff shapes and
 * the two jury shapes render a subset of their own columns and the table fits
 * the pane (measured after: **359px, 0 hidden**). This file pins the three
 * things that make that safe —
 *
 *  1. the phone vocabulary is a SUBSET of the desktop one, never a new word;
 *  2. the row renders exactly as many cells as the header promises, at both
 *     widths, which is the invariant a `colSpan` and a `<td>` can silently
 *     break;
 *  3. the contact details Edit opens are still reachable at phone width, since
 *     Edit is precisely the four columns the phone drops.
 */

vi.mock("../../src/client/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/client/api")>();
  return {
    ...actual,
    listDecks: vi.fn(),
    getDeck: vi.fn(),
    getDeckReport: vi.fn(),
    getConfigSummary: vi.fn(),
    listPrograms: vi.fn(),
    listDeckTags: vi.fn(),
    listActivity: vi.fn(),
  };
});

vi.mock("../../src/client/routes/SignupWorkspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/client/routes/SignupWorkspace")>();
  return { ...actual, listSignups: vi.fn().mockResolvedValue({ signups: [] }) };
});

const DECKS: DeckView[] = [
  {
    id: "d_one",
    name: "FinStack",
    sector: "B2B Fintech",
    stage: "Seed",
    city: "Hyderabad",
    founder: "Ananya Reddy",
    founderEmail: "ananya@finstack.in",
    founderPhone: "+91 98450 11111",
    missingFields: [],
    statusId: "ai_evaluated",
    status: "AI Evaluated",
    aiScore: 7.2,
    actions: [],
  },
];

function principal(): AuthUser {
  return {
    id: "u_su",
    name: "Priya Sharma",
    initials: "PS",
    role: "superuser",
    edition: "incubator",
    permissions: ["alldecks", "evaluate", "adminconsole"],
  };
}

const realMatchMedia = window.matchMedia;

/** Same stub as `dashboardHeaderPhone.test.tsx` — `useIsPhone`'s own query. */
function atWidth(phone: boolean) {
  window.matchMedia = ((query: string) => ({
    media: query,
    matches: phone && query === "(max-width: 639px)",
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function mount() {
  return render(
    <MemoryRouter>
      <AuthContext.Provider
        value={{ user: principal(), loading: false, login: vi.fn(), logout: vi.fn(), updateUser: vi.fn() }}
      >
        <DashboardPage />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

function headers(): string[] {
  return [...document.querySelectorAll("table[data-shape] thead th")].map((th) =>
    (th.textContent ?? "").trim(),
  );
}

beforeEach(() => {
  localStorage.clear();
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 })) as typeof fetch;
  vi.mocked(api.listDecks).mockResolvedValue({ decks: DECKS });
  vi.mocked(api.listPrograms).mockResolvedValue({ programs: [], cohorts: [] } as unknown as api.ProgramsResponse);
  vi.mocked(api.getConfigSummary).mockResolvedValue({
    thresholdBest: 7,
    thresholdMediocre: 5,
    aiGateThreshold: 5,
  } as unknown as api.ConfigSummary);
  vi.mocked(api.listDeckTags).mockResolvedValue({ tags: [] });
  vi.mocked(api.listActivity).mockResolvedValue({ events: [] });
});

afterEach(() => {
  window.matchMedia = realMatchMedia;
});

describe("PHONE_COLUMNS", () => {
  it("never invents a column name — every entry is verbatim from the shape's own header list", () => {
    for (const [shape, cols] of Object.entries(PHONE_COLUMNS)) {
      const wide: readonly string[] = ALL_DECKS_COLUMNS[shape as keyof typeof ALL_DECKS_COLUMNS];
      for (const col of cols ?? []) {
        expect(wide, `${shape} / ${col}`).toContain(col);
      }
      // Order is kept too: a phone must not re-rank the columns, or the same
      // screen reads differently on the two devices.
      const ranks = (cols ?? []).map((c) => wide.indexOf(c));
      expect([...ranks].sort((a, b) => a - b), `${shape} keeps the desktop order`).toEqual(ranks);
    }
  });

  it("keeps the deck's identity first and its actions last where the shape has them", () => {
    for (const [shape, cols] of Object.entries(PHONE_COLUMNS)) {
      const list = cols ?? [];
      expect(list[0], `${shape} leads with the startup`).toMatch(/^Startup/);
      const wide: readonly string[] = ALL_DECKS_COLUMNS[shape as keyof typeof ALL_DECKS_COLUMNS];
      if (wide.includes("Actions")) expect(list.at(-1), `${shape} keeps Actions`).toBe("Actions");
    }
  });
});

describe("the Dashboard deck table at phone width", () => {
  it("renders the four phone columns, and the row has exactly four cells", async () => {
    atWidth(true);
    mount();
    await waitFor(() => expect(screen.getByText("FinStack")).toBeInTheDocument());

    expect(headers()).toEqual(["Startup name", "AI score", "Status", "Actions"]);
    // The header promises four columns; a row with a different number of cells
    // is the defect this asserts away.
    const cells = document.querySelectorAll("table[data-shape] tbody tr td");
    expect(cells).toHaveLength(4);
    // The three the client asked for by name, all on the row.
    expect(screen.getByText("7.2")).toBeInTheDocument();
    expect(screen.getByLabelText("Actions for FinStack")).toBeInTheDocument();
  });

  it("leaves the desktop table alone — all eight columns, all eight cells", async () => {
    atWidth(false);
    mount();
    await waitFor(() => expect(screen.getByText("FinStack")).toBeInTheDocument());

    expect(headers()).toEqual([...ALL_DECKS_COLUMNS.v3Default]);
    expect(document.querySelectorAll("table[data-shape] tbody tr td")).toHaveLength(8);
    expect(screen.getByText("+91 98450 11111")).toBeInTheDocument();
  });

  it("still opens the four contact fields when Edit is chosen on a phone", async () => {
    atWidth(true);
    mount();
    await waitFor(() => expect(screen.getByText("FinStack")).toBeInTheDocument());

    // The phone row drops Founder / Phone / Email / City — which is exactly
    // what Edit edits, so Edit has to put them back somewhere.
    expect(screen.queryByText("+91 98450 11111")).toBeNull();
    fireEvent.change(screen.getByLabelText("Actions for FinStack"), { target: { value: "__edit" } });

    for (const label of ["Founder", "Phone", "Email", "City"]) {
      expect(screen.getByLabelText(`${label} — FinStack`), `${label} field`).toBeInTheDocument();
    }
    // Still a four-column row: name, the stacked form across two, and Save.
    const row = document.querySelector("table[data-shape] tbody tr")!;
    const span = [...row.querySelectorAll("td")].reduce((n, td) => n + (td.colSpan || 1), 0);
    expect(span, "cells plus colSpan still cover the four headers").toBe(4);
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("drops the sideways scroll instead of making it survivable", async () => {
    atWidth(true);
    mount();
    await waitFor(() => expect(screen.getByText("FinStack")).toBeInTheDocument());
    // `min-w-[48rem]` is what forced 768px into a 359px pane. With a phone
    // column set there is nothing left to scroll to, so it goes.
    const table = document.querySelector("table[data-shape]")!;
    expect(table.className).not.toContain("min-w-[48rem]");
  });
});
