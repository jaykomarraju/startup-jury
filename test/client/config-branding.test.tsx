import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ConfigPage } from "../../src/client/routes/ConfigPage";
import {
  getConfig,
  getConfigSummary,
  updateBranding,
  listPrograms,
  type FullConfig,
} from "../../src/client/api";

/**
 * W1-A — the §1.5 branding-wipe defect, from the caller's side.
 *
 * `PUT /api/config/branding` replaces `branding_json` wholesale, so the card
 * has to send the WHOLE object. It used to send three fields and drop the Set
 * up wizard's `orgName`/`orgType` on the floor.
 */

vi.mock("../../src/client/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/client/api")>();
  return {
    ...actual,
    getConfig: vi.fn(),
    getConfigSummary: vi.fn(),
    updateBranding: vi.fn(),
    listPrograms: vi.fn(),
  };
});

vi.mock("../../src/client/auth/useAuth", () => ({
  useAuth: () => ({ user: { edition: "incubator", role: "admin", name: "A", initials: "A" } }),
}));

const BRANDING = {
  orgName: "T-Hub",
  orgType: "accelerator",
  wordmark: "STARTUPJURY",
  tagline: "Venture Intelligence First",
  accent: "#E8A020",
};

const CFG: FullConfig = {
  plan: "pro",
  coreConfigEnabled: true,
  additionalEnabled: true,
  thresholdBest: 8,
  thresholdMediocre: 5,
  branding: BRANDING,
  creditsBalance: 10,
  coreParams: [],
  additionalParams: [],
  aiSystemPrompt: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getConfig).mockResolvedValue(CFG);
  vi.mocked(getConfigSummary).mockResolvedValue({ ...CFG, branding: BRANDING });
  vi.mocked(updateBranding).mockResolvedValue({ ok: true, branding: {} });
  vi.mocked(listPrograms).mockResolvedValue({ programs: [] } as never);
});

/** The screen has a Save per card; this is the one in the branding card. */
function brandingSave(field: HTMLElement): HTMLElement {
  const card = field.closest(".rounded-xl")!;
  return within(card as HTMLElement).getByRole("button", { name: /^Save$/ });
}

describe("ConfigPage · branding", () => {
  it("re-reads and merges, so a branding save cannot wipe orgName/orgType", async () => {
    render(
      <MemoryRouter>
        <ConfigPage />
      </MemoryRouter>,
    );

    const wordmark = await screen.findByLabelText("Wordmark");
    fireEvent.change(wordmark, { target: { value: "T-HUB JURY" } });
    fireEvent.click(brandingSave(wordmark));

    await waitFor(() => expect(updateBranding).toHaveBeenCalled());
    expect(getConfigSummary).toHaveBeenCalled();
    expect(vi.mocked(updateBranding).mock.calls[0][0]).toEqual({
      orgName: "T-Hub",
      orgType: "accelerator",
      wordmark: "T-HUB JURY",
      tagline: "Venture Intelligence First",
      accent: "#E8A020",
    });
  });

  it("still saves when the re-read fails, falling back to the loaded branding", async () => {
    vi.mocked(getConfigSummary).mockRejectedValue(new Error("offline"));
    render(
      <MemoryRouter>
        <ConfigPage />
      </MemoryRouter>,
    );

    const tagline = await screen.findByLabelText("Tagline");
    fireEvent.change(tagline, { target: { value: "Backed by data" } });
    fireEvent.click(brandingSave(tagline));

    await waitFor(() => expect(updateBranding).toHaveBeenCalled());
    expect(vi.mocked(updateBranding).mock.calls[0][0]).toMatchObject({
      orgName: "T-Hub",
      tagline: "Backed by data",
    });
  });
});
