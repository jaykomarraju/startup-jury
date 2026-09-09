import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  PanelFrame,
  PageToolbar,
  ToolbarButton,
  ToastProvider,
  useToast,
  TOAST_DURATION_MS,
  Sidebar,
} from "../../src/client/components";

/**
 * W1-A — the chrome primitives the prototype builds every screen out of:
 * the `.tb` surface toolbar, the `showToast()` confirmation surface, and the
 * `.sb` sidebar's olive active state, count badges and ruled sections.
 */

describe("PageToolbar (.tb)", () => {
  it("renders the title, subtitle and right-hand action group", () => {
    const { container } = render(
      <PageToolbar
        title="All decks"
        subtitle="24 decks · Cohort 3"
        actions={<ToolbarButton primary>Export</ToolbarButton>}
      />,
    );
    // A real heading, so the page still has one — it just lives in the bar now.
    expect(screen.getByRole("heading", { name: "All decks" })).toHaveClass("tbt");
    expect(screen.getByText("24 decks · Cohort 3")).toHaveClass("tbs");
    expect(container.querySelector(".tb")).toBeTruthy();
    expect(container.querySelector(".tbr")).toBeTruthy();
  });

  it("omits the subtitle and action group when not given", () => {
    const { container } = render(<PageToolbar title="Upload" />);
    expect(container.querySelector(".tbs")).toBeNull();
    expect(container.querySelector(".tbr")).toBeNull();
  });

  it("marks a primary toolbar action with .pr (the olive fill)", () => {
    render(
      <PageToolbar title="Assign" actions={<ToolbarButton primary>Assign all</ToolbarButton>} />,
    );
    expect(screen.getByRole("button", { name: "Assign all" })).toHaveClass("tbb", "pr");
  });
});

describe("PanelFrame", () => {
  it("pins the toolbar and footer around an independently scrolling body", () => {
    const { container } = render(
      <PanelFrame title="Curation" footer={<span>12 decks</span>}>
        <p>rows</p>
      </PanelFrame>,
    );
    const frame = container.querySelector(".sj-frame")!;
    expect(frame).toBeTruthy();
    // Toolbar first, footer last — the body scrolls between them.
    expect(frame.firstElementChild).toHaveClass("tb");
    expect(frame.lastElementChild).toHaveClass("tb-foot");
    expect(screen.getByText("12 decks")).toBeInTheDocument();
    expect(container.querySelector(".overflow-y-auto")).toBeTruthy();
  });

  it("renders the 278px right rail only when one is supplied", () => {
    const { container, rerender } = render(
      <PanelFrame title="Dashboard">
        <p>body</p>
      </PanelFrame>,
    );
    expect(container.querySelector("aside")).toBeNull();
    rerender(
      <PanelFrame title="Dashboard" rail={<p>Activity</p>}>
        <p>body</p>
      </PanelFrame>,
    );
    expect(container.querySelector("aside")).toHaveClass("w-[278px]");
  });
});

// ── Toast ────────────────────────────────────────────────────────────────────

function Firer({ label, tone }: { label: string; tone?: "success" | "error" }) {
  const { showToast } = useToast();
  return (
    <button type="button" onClick={() => showToast(label, tone)}>
      fire {label}
    </button>
  );
}

describe("Toast", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("appears on demand and auto-dismisses after the prototype's 2.4s", () => {
    render(
      <ToastProvider>
        <Firer label="Deck shortlisted" />
      </ToastProvider>,
    );
    expect(screen.queryByText("Deck shortlisted")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "fire Deck shortlisted" }));
    expect(screen.getByText("Deck shortlisted")).toBeInTheDocument();

    // Still up a tick before the deadline…
    act(() => void vi.advanceTimersByTime(TOAST_DURATION_MS - 50));
    expect(screen.getByText("Deck shortlisted")).toBeInTheDocument();
    // …and gone after it.
    act(() => void vi.advanceTimersByTime(100));
    expect(screen.queryByText("Deck shortlisted")).toBeNull();
  });

  it("stacks concurrent toasts in arrival order, each on its own timer", () => {
    render(
      <ToastProvider>
        <Firer label="First" />
        <Firer label="Second" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "fire First" }));
    act(() => void vi.advanceTimersByTime(1000));
    fireEvent.click(screen.getByRole("button", { name: "fire Second" }));

    const live = screen.getByRole("status");
    expect(live.textContent).toBe("FirstSecond");

    // The first expires 1s before the second.
    act(() => void vi.advanceTimersByTime(TOAST_DURATION_MS - 900));
    expect(screen.queryByText("First")).toBeNull();
    expect(screen.getByText("Second")).toBeInTheDocument();

    act(() => void vi.advanceTimersByTime(1000));
    // The live region stays mounted (announcements need it to pre-exist); what
    // empties is its content.
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("dismisses early when the pill is clicked", () => {
    render(
      <ToastProvider>
        <Firer label="Saved" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "fire Saved" }));
    fireEvent.click(screen.getByText("Saved"));
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("degrades to a no-op outside a provider rather than throwing", () => {
    render(<Firer label="Orphan" />);
    expect(() =>
      fireEvent.click(screen.getByRole("button", { name: "fire Orphan" })),
    ).not.toThrow();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

// ── Sidebar chrome ───────────────────────────────────────────────────────────

function renderSidebar(path: string, badges?: Record<string, { count: number; tone?: "blue" | "red" }>) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar edition="incubator" role="admin" badges={badges} />
    </MemoryRouter>,
  );
}

describe("Sidebar chrome", () => {
  beforeEach(() => localStorage.clear());

  it("paints the active item olive, not gold", () => {
    renderSidebar("/app/upload");
    const link = screen.getByRole("link", { name: /Upload/ });
    expect(link.className).toContain("bg-sidebar-active");
    expect(link.className).toContain("text-olive-dk");
    expect(link.className).toContain("border-l-olive");
    expect(link.className).not.toContain("amber");
  });

  it("hangs a .bx count badge off the items that carry one", () => {
    const { container } = renderSidebar("/app/alldecks", {
      alldecks: { count: 24, tone: "blue" },
      support: { count: 3, tone: "red" },
    });
    const deckBadge = screen.getByText("24");
    expect(deckBadge).toHaveClass("bx", "bx-b");
    expect(screen.getByText("3")).toHaveClass("bx", "bx-r");
    // No badge where no count was supplied.
    expect(container.querySelectorAll(".bx")).toHaveLength(2);
  });

  it("omits a badge whose count is zero", () => {
    const { container } = renderSidebar("/app/alldecks", { support: { count: 0, tone: "red" } });
    expect(container.querySelector(".bx")).toBeNull();
  });

  it("rules each section off from the one above it", () => {
    const { container } = renderSidebar("/app/alldecks");
    const sections = [...container.querySelectorAll("[data-section]")];
    expect(sections.length).toBeGreaterThan(1);
    expect(sections[0].className).not.toContain("border-t");
    for (const s of sections.slice(1)) expect(s.className).toContain("border-t");
  });

  it("force-expands the section holding the active item, as the prototype does", () => {
    // The user collapsed Evaluation, then navigated into it.
    localStorage.setItem("sj.sidebar.collapsed", JSON.stringify(["Evaluation", "Reports"]));
    renderSidebar("/app/evaluate");

    // Evaluation is expanded again because that is where the user now is…
    expect(screen.getByRole("link", { name: /Evaluate/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Evaluation/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    // …while a collapsed section the user is NOT in stays collapsed.
    expect(screen.getByRole("button", { name: /Reports/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("still lets the user collapse the section they are in — the rescue is per navigation", () => {
    renderSidebar("/app/evaluate");
    const evaluation = screen.getByRole("button", { name: /Evaluation/ });
    expect(evaluation).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(evaluation);
    expect(evaluation).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: /Evaluate/ })).toBeNull();
  });

  it("still lets the user collapse a section they are not in", () => {
    renderSidebar("/app/alldecks");
    const reports = screen.getByRole("button", { name: /Reports/ });
    expect(reports).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(reports);
    expect(reports).toHaveAttribute("aria-expanded", "false");
    expect(JSON.parse(localStorage.getItem("sj.sidebar.collapsed")!)).toContain("Reports");
  });
});
