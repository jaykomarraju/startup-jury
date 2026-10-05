import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthContext, type AuthUser } from "../../src/client/auth/AuthProvider";
import { JuryBuddyLauncher } from "../../src/client/routes/help/JuryBuddyLauncher";
import { canAccessNav } from "../../src/shared/nav";
import type { Edition, Role } from "../../src/shared/roles";

/**
 * JURYbuddy's floating launcher — `#jb-launcher` / `#jb-panel`.
 *
 * S5-HELP shipped the panel as the `help` SCREEN and left the launcher out,
 * partly because "it would sit on top of the bottom-right controls the e2e
 * suite clicks". That was checked before building: the app's only fixed
 * elements are bottom-CENTRE, and the full e2e suite runs 246/246 green with
 * the launcher mounted, with zero "intercepts pointer events". The remaining
 * risk is the one this file pins — that it renders for somebody whose sidebar
 * has no Help, which is the role-boundary class this repo keeps reproducing.
 */

vi.mock("../../src/client/routes/help/HelpPage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/client/routes/help/HelpPage")>();
  // The panel's BODY is HelpPage's, covered by helpPage.test.tsx. Stubbing it
  // keeps this file about the launcher: its gate, and its open/close.
  return { ...actual, HelpPage: () => <div data-testid="help-body" /> };
});

function user(edition: Edition, role: Role): AuthUser {
  return { id: `u_${role}`, name: "Test User", initials: "TU", role, edition, permissions: [] };
}

function mount(edition: Edition, role: Role) {
  return render(
    <MemoryRouter>
      <AuthContext.Provider
        value={{ user: user(edition, role), loading: false, login: vi.fn(), logout: vi.fn(), updateUser: vi.fn() }}
      >
        <JuryBuddyLauncher />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("the JURYbuddy launcher", () => {
  it("renders for every role whose sidebar carries Help, and no other", () => {
    const roles: Role[] = ["superuser", "admin", "program_manager", "program_associate", "jury", "founder"];
    let shown = 0;
    for (const role of roles) {
      const reachesHelp = canAccessNav("incubator", role, "help", () => true);
      const { unmount } = mount("incubator", role);
      const drawn = screen.queryByTestId("jb-launcher") !== null;
      // The gate is the SAME predicate as the sidebar's, not a second one.
      expect(drawn, `${role}: launcher drawn=${drawn}, reaches help=${reachesHelp}`).toBe(reachesHelp);
      if (drawn) shown += 1;
      unmount();
    }
    // Guard the guard: if `canAccessNav` ever returned false for everyone, the
    // assertion above would pass vacuously against a launcher nobody can see.
    expect(shown).toBeGreaterThanOrEqual(5);
  });

  it("never renders for a founder, who has no Help and no sidebar", () => {
    mount("incubator", "founder");
    expect(screen.queryByTestId("jb-launcher")).toBeNull();
    expect(screen.queryByTestId("jb-panel")).toBeNull();
  });

  it("opens and closes the panel, and reports its state", () => {
    mount("incubator", "superuser");
    const btn = screen.getByTestId("jb-launcher");
    // Closed at rest — the spec's panel is `display:none` until `.jb-visible`.
    expect(screen.queryByTestId("jb-panel")).toBeNull();
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(btn).toHaveAccessibleName("Open FAQ search");

    fireEvent.click(btn);
    expect(screen.getByTestId("jb-panel")).toBeInTheDocument();
    expect(screen.getByTestId("help-body")).toBeInTheDocument();
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(btn).toHaveAccessibleName("Close FAQ search");

    fireEvent.click(btn);
    expect(screen.queryByTestId("jb-panel")).toBeNull();
  });

  it("closes on Escape, as the spec's own handler does", () => {
    mount("incubator", "superuser");
    fireEvent.click(screen.getByTestId("jb-launcher"));
    expect(screen.getByTestId("jb-panel")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("jb-panel")).toBeNull();
  });

  it("leaves Escape alone while closed, so it stays free for other overlays", () => {
    mount("incubator", "superuser");
    // No throw, no state change — the listener is bound only while open.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByTestId("jb-launcher")).toHaveAttribute("aria-expanded", "false");
  });

  /**
   * Class-set rather than substring membership: `toContain("bottom-7")` is also
   * satisfied by `sm:bottom-7`, which is exactly the distinction these two
   * tests now turn on.
   */
  function classes(el: HTMLElement): Set<string> {
    return new Set(el.className.split(/\s+/).filter(Boolean));
  }

  it("carries the spec's geometry from `sm:` up: 60px circle bottom-right, panel above it", () => {
    mount("incubator", "superuser");
    const btn = screen.getByTestId("jb-launcher");
    // `#jb-launcher{right:28px; bottom:28px; width:60px; height:60px;
    //  border-radius:50%; z-index:1000}` — in our tokens, same numbers. They
    // are `sm:`-prefixed because the spec is a 1440px console with no phone
    // tier, so its numbers are only claimed for the tier it was measured on;
    // the phone tier is pinned by the test below. `fixed`, `rounded-full` and
    // the z-indexes are unconditional — they are not sizes.
    for (const c of ["fixed", "sm:bottom-7", "sm:right-7", "z-[1000]", "sm:h-[60px]", "sm:w-[60px]", "rounded-full"]) {
      expect(classes(btn), c).toContain(c);
    }
    fireEvent.click(btn);
    const panel = screen.getByTestId("jb-panel");
    // `#jb-panel{bottom:100px; width:360px; max-height:520px; z-index:999}`
    for (const c of ["fixed", "sm:bottom-[100px]", "sm:w-[360px]", "sm:max-h-[520px]", "z-[999]"]) {
      expect(classes(panel), c).toContain(c);
    }
  });

  /**
   * The phone tier, added after measuring production at iPhone 13 width: the
   * spec's 60px disc 28px in from the corner lands inside a 390px content
   * column and covered the deck table's header row and the upload screen's
   * credit badge. 44px in the shell's own 16px gutter keeps it tappable and
   * out of the padding box.
   */
  it("uses a smaller, gutter-aligned geometry at phone width, and no spec size below `sm:`", () => {
    mount("incubator", "superuser");
    const btn = screen.getByTestId("jb-launcher");
    const btnClasses = classes(btn);
    for (const c of ["bottom-4", "right-4", "h-11", "w-11"]) {
      expect(btnClasses, c).toContain(c);
    }
    // The desktop numbers must not ALSO apply unprefixed, or the phone tier
    // never takes effect — this is the half-applied-fix failure.
    for (const c of ["bottom-7", "right-7", "h-[60px]", "w-[60px]"]) {
      expect(btnClasses, `${c} must be sm:-gated only`).not.toContain(c);
    }

    fireEvent.click(btn);
    const panelClasses = classes(screen.getByTestId("jb-panel"));
    // Gutter-to-gutter instead of a fixed 360px, which clips below 388px, and
    // capped against the viewport instead of a flat 520px.
    for (const c of ["left-4", "right-4", "max-h-[70vh]", "bottom-[72px]"]) {
      expect(panelClasses, c).toContain(c);
    }
    for (const c of ["w-[360px]", "max-h-[520px]", "bottom-[100px]"]) {
      expect(panelClasses, `${c} must be sm:-gated only`).not.toContain(c);
    }
  });
});
