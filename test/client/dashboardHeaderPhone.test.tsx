import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthContext, type AuthUser } from "../../src/client/auth/AuthProvider";
import { DashboardPage } from "../../src/client/routes/DashboardPage";
import type { DeckView } from "../../src/client/types";
import * as api from "../../src/client/api";

/**
 * The Dashboard's toolbar strip at PHONE width (measured on production, iPhone
 * 13, 390px).
 *
 * `.tb` is a `flex-wrap: nowrap` row and its action group `.tbr` is
 * `flex-shrink: 0`, so the search box and the tag filter kept their intrinsic
 * width and the title column — the only shrinkable item — collapsed far enough
 * that "Recent activity · 23 decks · Updated just now" wrapped to five lines.
 * A flex item cannot force a line break in a nowrap container, so the fix is
 * structural: at this width the strip gets ONE column, with the controls under
 * the subtitle instead of beside it.
 *
 * What this file pins is that structure at both tiers, and that the controls
 * exist exactly once at either — a breakpoint-gated duplicate pair would read
 * as two "Tag filter"s to a screen reader at every width.
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
    statusId: "assigned",
    status: "Assigned",
    aiScore: 7.2,
  },
  {
    id: "d_two",
    name: "PayRoute",
    sector: "Payments",
    stage: "Idea",
    founder: "Kabir Shah",
    founderEmail: "kabir@payroute.in",
    missingFields: ["founderPhone", "city"],
    statusId: "incomplete",
    status: "Incomplete",
  },
];

function principal(): AuthUser {
  return {
    id: "u_admin",
    name: "Test User",
    initials: "TU",
    role: "admin",
    edition: "incubator",
    permissions: ["alldecks", "evaluate", "adminconsole"],
  };
}

const realMatchMedia = window.matchMedia;

/**
 * `useIsPhone` asks for `(max-width: 639px)` specifically, so the stub answers
 * that query and nothing else — a stub that returned `matches` for every query
 * would also lie to any other media hook this tree grows later.
 */
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

function strip(): HTMLElement {
  const tb = document.querySelector(".tb");
  expect(tb, "the toolbar strip is on screen").not.toBeNull();
  return tb as HTMLElement;
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

describe("the Dashboard toolbar at phone width", () => {
  it("stacks: one column in the strip, controls under the subtitle", async () => {
    atWidth(true);
    mount();
    await waitFor(() => expect(screen.getByLabelText("Search decks")).toBeInTheDocument());

    // Asserted FIRST because it is the defect itself, and it reports a count:
    // the strip must have ONE element child. With two, the second is `.tbr`,
    // `flex-shrink: 0` squeezes the title column, and the subtitle wraps.
    expect(strip().children, "element children of the toolbar strip").toHaveLength(1);
    expect(strip().querySelector(":scope > .tbr"), "no action group beside the title column").toBeNull();

    // Inside the subtitle block, not a sibling of it — that is what gives the
    // subtitle the whole row.
    const stacked = screen.getByTestId("tb-stacked-actions");
    const subtitle = strip().querySelector(".tbs");
    expect(subtitle, "the subtitle block is on screen").not.toBeNull();
    expect(subtitle).toContainElement(stacked);

    // Still `.tbr`, so `@media (max-width:899px){.tbr .tbb:not(.pr){display:none}}`
    // keeps hiding the non-primary actions exactly as it does at this width now.
    expect(stacked.classList.contains("tbr")).toBe(true);
    expect(stacked.classList.contains("flex-wrap")).toBe(true);
  });

  it("leaves the desktop strip alone: the action group stays beside the title column", async () => {
    atWidth(false);
    mount();
    await waitFor(() => expect(screen.getByLabelText("Search decks")).toBeInTheDocument());

    expect(screen.queryByTestId("tb-stacked-actions")).toBeNull();
    expect(strip().querySelector(":scope > .tbr"), "the action group is a direct child").not.toBeNull();
    expect(strip().children).toHaveLength(2);
  });

  it("renders the controls exactly once at either width", async () => {
    for (const phone of [true, false]) {
      atWidth(phone);
      const { unmount } = mount();
      await waitFor(() => expect(screen.getByLabelText("Search decks")).toBeInTheDocument());
      // `getAllBy*` so a duplicated pair reports its count rather than throwing
      // the ambiguous "found multiple elements" from `getBy*`.
      expect(screen.getAllByLabelText("Search decks"), `search at phone=${phone}`).toHaveLength(1);
      expect(screen.getAllByLabelText("Tag filter"), `tag filter at phone=${phone}`).toHaveLength(1);
      unmount();
    }
  });
});
