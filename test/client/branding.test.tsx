import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { configure, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ThemeProvider } from "../../src/client/theme/ThemeProvider";
import { BrandingProvider } from "../../src/client/theme/BrandingProvider";
import { BrandingSection } from "../../src/client/routes/admin/Branding";
import { Logo } from "../../src/client/components/Logo";
import { AdminSaveContext, type AdminSaveState } from "../../src/client/routes/admin/saveContext";
import { getConfigSummary, updateBranding } from "../../src/client/api";
import type { AuthUser } from "../../src/client/auth/AuthProvider";

/**
 * W4-B — the branding section, and the applier that makes it visible.
 *
 * The defect these tests exist for is plan §1.5's third bullet: branding
 * round-tripped through the API and was then thrown away. So the assertion that
 * matters is never "the value was stored" — it is that the **computed** custom
 * property on `<html>` changed, and that the mark on screen changed with it.
 *
 * Every assertion here is downstream of an async read (`BrandingProvider` fetches
 * the workspace's branding, then the section adopts it, then the applier writes
 * the tokens), so the default 1 s `waitFor` budget is what decides whether this
 * file passes on a busy machine rather than anything about the code. Raised to
 * 5 s — plan §8 Q32 is the suite-wide version of the same problem.
 */
configure({ asyncUtilTimeout: 5_000 });

vi.mock("../../src/client/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/client/api")>();
  return { ...actual, getConfigSummary: vi.fn(), updateBranding: vi.fn() };
});

const USER: AuthUser = {
  id: "u1",
  name: "Nisha Kapoor",
  initials: "NK",
  role: "admin",
  edition: "incubator",
};

vi.mock("../../src/client/auth/useAuth", () => ({
  useAuth: () => ({ user: USER, loading: false }),
}));

function summaryWith(branding: Record<string, unknown>) {
  return {
    plan: "pro",
    coreConfigEnabled: true,
    additionalEnabled: true,
    thresholdBest: 8,
    thresholdMediocre: 5,
    branding,
    coreParams: [],
    additionalParams: [],
  } as never;
}

/** What `<html>` actually resolves the token to — not what was stored. */
function computed(token: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim();
}

/**
 * The console's title bar owns the Save button and the section registers its
 * handler with it (`useAdminSave`). These tests stand in for the title bar so
 * they can press Save the way an admin does.
 */
let registered: AdminSaveState | null = null;

function renderSection(branding: Record<string, unknown> = {}) {
  registered = null;
  vi.mocked(getConfigSummary).mockResolvedValue(summaryWith(branding));
  return render(
    <ThemeProvider>
      <BrandingProvider>
        <AdminSaveContext.Provider value={{ register: (s) => { registered = s; } }}>
          <BrandingSection />
        </AdminSaveContext.Provider>
        <Logo size={32} tagline="Venture Intelligence First" />
      </BrandingProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem("sj-theme", "light");
  vi.mocked(updateBranding).mockImplementation((b) =>
    Promise.resolve({ ok: true as const, branding: b }),
  );
});

afterEach(() => {
  document.documentElement.removeAttribute("style");
  delete document.documentElement.dataset.theme;
});

describe("the applier", () => {
  it("writes saved branding onto <html> as computed custom properties on load", async () => {
    renderSection({ tokens: { "--olive": "#123456", "--gold": "#ABCDEF" } });
    await waitFor(() => expect(computed("--olive")).toBe("#123456"));
    expect(computed("--gold")).toBe("#ABCDEF");
  });

  it("changes the COMPUTED accent when one is picked, before any save", async () => {
    renderSection();
    const accent = await screen.findByLabelText("Accent hex");
    expect(computed("--gold")).toBe(""); // unbranded: index.css's own value stands

    fireEvent.change(accent, { target: { value: "#C2185B" } });
    fireEvent.blur(accent);

    await waitFor(() => expect(computed("--gold")).toBe("#C2185B"));
    expect(updateBranding).not.toHaveBeenCalled(); // applied live; Save persists
  });

  it("persists the picked accent as a MERGE, so orgName survives", async () => {
    renderSection({ orgName: "T-Hub", orgType: "accelerator" });
    const accent = await screen.findByLabelText("Accent hex");
    fireEvent.change(accent, { target: { value: "#C2185B" } });
    fireEvent.blur(accent);

    await waitFor(() => expect(registered?.dirty).toBe(true));
    await registered!.onSave();

    await waitFor(() => expect(updateBranding).toHaveBeenCalled());
    const body = vi.mocked(updateBranding).mock.calls[0][0] as Record<string, unknown>;
    expect(body.orgName).toBe("T-Hub");
    expect(body.orgType).toBe("accelerator");
    expect(body.accent).toBe("#C2185B");
    expect(body.tokens).toMatchObject({ "--gold": "#C2185B" });
  });

  it("silently rejects a value that is not a hex, leaving the token alone", async () => {
    renderSection({ tokens: { "--gold": "#ABCDEF" } });
    const accent = await screen.findByLabelText("Accent hex");
    fireEvent.change(accent, { target: { value: "chartreuse" } });
    fireEvent.blur(accent);

    await waitFor(() => expect(accent).toHaveValue("#ABCDEF"));
    expect(computed("--gold")).toBe("#ABCDEF");
  });

  it("withholds surface tokens in dark mode and keeps the identity hues", async () => {
    localStorage.setItem("sj-theme", "dark");
    renderSection({ tokens: { "--bg": "#FFFFFF", "--gold": "#C2185B" } });

    await waitFor(() => expect(computed("--gold")).toBe("#C2185B"));
    // --bg is re-derived by index.css's dark block; a branded light background
    // would paint a white page at night.
    expect(computed("--bg")).toBe("");
  });
});

describe("the wordmark", () => {
  it("renders in two parts, both of them branded", async () => {
    renderSection({ wordmarkPrefix: "the", wordmark: "T-HUB JURY", tagline: "Backed by data" });

    await waitFor(() =>
      expect(screen.getByTestId("brand-wordmark-prefix")).toHaveTextContent("the"),
    );
    expect(screen.getByTestId("brand-wordmark-name")).toHaveTextContent("T-HUB JURY");
    expect(screen.getByLabelText("the.T-HUB JURY")).toBeInTheDocument();
    // The tagline shows on the mark itself, not only in the section's preview.
    expect(screen.getByTestId("brand-tagline")).toHaveTextContent("Backed by data");
  });

  it("falls back to the shipped literal when nothing is branded", async () => {
    renderSection();
    await waitFor(() => expect(screen.getByTestId("brand-wordmark-prefix")).toHaveTextContent("ai"));
    expect(screen.getByTestId("brand-wordmark-name")).toHaveTextContent("STARTUPJURY");
    // The accessible name the rest of the suite (and e2e/home.spec.ts) knows.
    expect(screen.getByLabelText("ai.STARTUPJURY")).toBeInTheDocument();
  });

  it("repaints the mark as the field is typed, with no save and no reload", async () => {
    renderSection();
    const part2 = await screen.findByLabelText("Wordmark — part 2");
    fireEvent.change(part2, { target: { value: "T-HUB JURY" } });
    await waitFor(() =>
      expect(screen.getByTestId("brand-wordmark-name")).toHaveTextContent("T-HUB JURY"),
    );
  });
});

describe("reset to defaults", () => {
  it("restores the literal wordmark, clears the image and drops every token", async () => {
    renderSection({
      wordmarkPrefix: "the",
      wordmark: "T-HUB JURY",
      tagline: "Backed by data",
      logoUrl: "/brand/logo.svg",
      tokens: { "--olive": "#123456", "--gold": "#ABCDEF" },
    });

    await waitFor(() => expect(computed("--olive")).toBe("#123456"));
    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));

    await waitFor(() => expect(screen.getByTestId("brand-wordmark-name")).toHaveTextContent("STARTUPJURY"));
    expect(screen.getByTestId("brand-wordmark-prefix")).toHaveTextContent("ai");
    expect(screen.getByLabelText("Tagline")).toHaveValue("Venture Intelligence First");
    expect(screen.getByLabelText("Logo image URL (optional)")).toHaveValue("");
    // Removed, not overwritten — index.css's own palette comes back.
    expect(computed("--olive")).toBe("");
    expect(computed("--gold")).toBe("");
  });
});

describe("the logo image", () => {
  it("replaces the mark and the wordmark when the URL is servable", async () => {
    renderSection({ logoUrl: "/brand/logo.svg" });
    await waitFor(() => expect(screen.getByTestId("brand-logo-image")).toBeInTheDocument());
    expect(screen.queryByTestId("brand-wordmark-name")).not.toBeInTheDocument();
  });

  it("warns that an off-origin URL is blocked by the app's CSP, and keeps the text mark", async () => {
    renderSection();
    const field = await screen.findByLabelText("Logo image URL (optional)");
    fireEvent.change(field, { target: { value: "https://cdn.example.com/logo.svg" } });

    await waitFor(() => expect(screen.getByTestId("br-logo-blocked")).toBeInTheDocument());
    expect(screen.queryByTestId("brand-logo-image")).not.toBeInTheDocument();
    expect(screen.getByTestId("brand-wordmark-name")).toBeInTheDocument();
  });
});

describe("the section shell", () => {
  it("renders all fourteen pickers with their token names", async () => {
    renderSection();
    await screen.findByLabelText("Accent hex");
    for (const token of [
      "--olive",
      "--olive-lt",
      "--gold",
      "--gold-dk",
      "--gold-lt",
      "--navy",
      "--text-3",
      "--bg",
      "--stone",
      "--stone-dk",
      "--green",
      "--red",
      "--blue",
      "--purple",
    ]) {
      expect(screen.getByText(token), token).toBeInTheDocument();
    }
  });

  it("carries the prototype's card headings and note", async () => {
    renderSection();
    expect(await screen.findByRole("heading", { level: 2, name: "Branding & theme" })).toBeInTheDocument();
    expect(screen.getByText("Brand colours")).toBeInTheDocument();
    expect(screen.getByText("Status colours")).toBeInTheDocument();
    expect(
      screen.getByText(/Semantic signals \(success, danger, info, special\)/),
    ).toBeInTheDocument();
  });
});

// ── S2-SETUP · 21-Sep item 7 — the org name's new home ───────────────────────

/**
 * `branding.orgName` was written ONLY by the Set up wizard's Org type step,
 * which item 7 deletes for the incubator super user. It has four readers and
 * all four are user-visible: My Account's Workspace row, the account-invite
 * email, the founder incomplete-deck email, and every invoice's bill-to name.
 * With no writer it would not go blank — it would quietly freeze, and a
 * workspace set up after the deletion would bill as "Incubator workspace".
 *
 * `persists the picked accent as a MERGE, so orgName survives` above is the
 * older, weaker guarantee (the merge does not drop a key nobody edits). These
 * are the new one: the field reads it, writes it, and cannot blank it.
 */
describe("organisation name", () => {
  it("loads the stored name into the field", async () => {
    renderSection({ orgName: "T-Hub" });
    await waitFor(() => expect(screen.getByLabelText("Organisation name")).toHaveValue("T-Hub"));
  });

  it("is empty, and not dirty, in a workspace that has never set one", async () => {
    renderSection({});
    await waitFor(() => expect(screen.getByLabelText("Organisation name")).toHaveValue(""));
    expect(registered?.dirty).toBe(false);
  });

  it("edits and persists it — the wizard's only writer, replaced", async () => {
    renderSection({ orgName: "T-Hub", tokens: { "--gold": "#ABCDEF" } });
    const field = await screen.findByLabelText("Organisation name");
    fireEvent.change(field, { target: { value: "Nasscom Foundation" } });

    await waitFor(() => expect(registered?.dirty).toBe(true));
    await registered!.onSave();

    await waitFor(() => expect(updateBranding).toHaveBeenCalled());
    const body = vi.mocked(updateBranding).mock.calls[0][0] as Record<string, unknown>;
    expect(body.orgName).toBe("Nasscom Foundation");
    // The name is not a theme token and must not have become one.
    expect(body.tokens).toMatchObject({ "--gold": "#ABCDEF" });
    expect((body.tokens as Record<string, string>).orgName).toBeUndefined();
  });

  it("trims, and a name-only edit is enough to make the section dirty", async () => {
    renderSection({ orgName: "T-Hub" });
    const field = await screen.findByLabelText("Organisation name");
    fireEvent.change(field, { target: { value: "  Horizon Ventures  " } });
    await waitFor(() => expect(registered?.dirty).toBe(true));
    await registered!.onSave();
    await waitFor(() => expect(updateBranding).toHaveBeenCalled());
    expect((vi.mocked(updateBranding).mock.calls[0][0] as Record<string, unknown>).orgName).toBe(
      "Horizon Ventures",
    );
  });

  /**
   * The failure that would actually reach a customer: the read fails, the field
   * renders empty, an admin changes a colour, and the save posts `orgName: ""`
   * over a name four surfaces depend on. `getConfigSummary` is the section's
   * own read AND the provider's, so failing it fails both, which is the real
   * shape of an offline or 500 response.
   */
  it("a failed read cannot blank a stored name — the key is not posted at all", async () => {
    registered = null;
    vi.mocked(getConfigSummary).mockRejectedValue(new Error("offline"));
    render(
      <ThemeProvider>
        <BrandingProvider>
          <AdminSaveContext.Provider value={{ register: (s) => { registered = s; } }}>
            <BrandingSection />
          </AdminSaveContext.Provider>
        </BrandingProvider>
      </ThemeProvider>,
    );
    const accent = await screen.findByLabelText("Accent hex");
    expect(screen.getByLabelText("Organisation name")).toHaveValue("");

    fireEvent.change(accent, { target: { value: "#C2185B" } });
    fireEvent.blur(accent);
    await waitFor(() => expect(registered?.dirty).toBe(true));
    await registered!.onSave();

    await waitFor(() => expect(updateBranding).toHaveBeenCalled());
    const body = vi.mocked(updateBranding).mock.calls[0][0] as Record<string, unknown>;
    expect("orgName" in body).toBe(false);
  });
});
