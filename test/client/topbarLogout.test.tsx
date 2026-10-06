import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Topbar } from "../../src/client/components/Topbar";

/**
 * Log out on the brand ribbon — one click with a mouse, two taps with a thumb.
 *
 * MEASURED at 393x659: a 28x28 button whose left edge is 6px from the avatar,
 * with nothing behind it. "Tap deliberately" was the whole mitigation
 * (docs/plan_pilot_gcw.md §11, "tell the presenter"), and a mis-aimed thumb on
 * stage signs the presenter out in front of the room.
 *
 * The confirmation is gated on `(pointer: coarse)` and not on a width, because
 * what it defends against is a stray TAP. A laptop keeps today's behaviour
 * exactly — which is also why the desktop geometry run at 1280/1440/1920 shows
 * this button unchanged at 28x28.
 */

const realMatchMedia = window.matchMedia;

function withPointer(coarse: boolean) {
  window.matchMedia = ((query: string) => ({
    media: query,
    matches: coarse && query === "(pointer: coarse)",
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function mount(onLogout: () => void) {
  return render(
    <MemoryRouter>
      <Topbar
        userName="Priya Sharma"
        initials="PS"
        roleLabel="Super User"
        editionLabel="Incubator"
        theme="light"
        onToggleTheme={vi.fn()}
        onLogout={onLogout}
        onMenu={vi.fn()}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ notifications: [] }), { status: 200 }),
  ) as typeof fetch;
});

afterEach(() => {
  vi.useRealTimers();
  window.matchMedia = realMatchMedia;
  vi.restoreAllMocks();
});

describe("the ribbon's Log out button", () => {
  it("logs out on the first click under a mouse", () => {
    withPointer(false);
    const onLogout = vi.fn();
    mount(onLogout);
    fireEvent.click(screen.getByLabelText("Log out"));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("arms on the first tap under a finger, and goes through on the second", () => {
    withPointer(true);
    const onLogout = vi.fn();
    mount(onLogout);

    fireEvent.click(screen.getByLabelText("Log out"));
    expect(onLogout, "the first tap must not end the session").not.toHaveBeenCalled();
    // The armed state has to be VISIBLE and has to be said out loud: the
    // `aria-label` carries it, because a visible "Sure?" is not announced while
    // the label overrides the content.
    expect(screen.getByText("Sure?")).toBeInTheDocument();
    const armed = screen.getByLabelText("Log out — tap again to confirm");

    fireEvent.click(armed);
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("disarms itself after four seconds, so it cannot sit armed", () => {
    withPointer(true);
    const onLogout = vi.fn();
    mount(onLogout);

    fireEvent.click(screen.getByLabelText("Log out"));
    expect(screen.getByText("Sure?")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(4100));
    expect(screen.queryByText("Sure?")).toBeNull();

    // And the next tap arms again rather than going straight through.
    fireEvent.click(screen.getByLabelText("Log out"));
    expect(onLogout).not.toHaveBeenCalled();
  });

  it("keeps 'Log out' as the prefix of the name in both states", () => {
    withPointer(true);
    mount(vi.fn());
    expect(screen.getByLabelText(/^Log out/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/^Log out/));
    expect(screen.getByLabelText(/^Log out/)).toBeInTheDocument();
  });
});
