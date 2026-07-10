import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "../../src/client/theme/ThemeProvider";
import { useTheme } from "../../src/client/theme/useTheme";

function ThemeProbe() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button onClick={toggleTheme} data-testid="probe">
      {theme}
    </button>
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("applies data-theme to <html> and persists on toggle", () => {
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );
    const probe = screen.getByTestId("probe");
    const initial = probe.textContent;
    expect(document.documentElement.dataset.theme).toBe(initial);

    fireEvent.click(probe);
    const flipped = initial === "light" ? "dark" : "light";
    expect(probe.textContent).toBe(flipped);
    expect(document.documentElement.dataset.theme).toBe(flipped);
    expect(localStorage.getItem("sj-theme")).toBe(flipped);
  });

  it("throws if useTheme is used outside a provider", () => {
    // Silence the expected React error boundary console noise is unnecessary here;
    // rendering a bare probe should throw synchronously.
    expect(() => render(<ThemeProbe />)).toThrow(/ThemeProvider/);
  });
});
