import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { useState } from "react";
import {
  buildResearchQuery,
  RESEARCH_PROVIDERS,
} from "../../src/client/components/ResearchMenu";
import { EvalScorecard, type AiParamScore } from "../../src/client/components/EvalScorecard";
import type { DeckView } from "../../src/client/types";
import type { RubricParameter } from "../../src/client/api";
import { rescoreDeck } from "../../src/client/api";

// The scorecard mounts DeckPdfViewer (which fetches the PDF) and calls
// rescoreDeck; stub both so the tests are deterministic.
vi.mock("../../src/client/api", () => ({ rescoreDeck: vi.fn() }));

beforeEach(() => {
  vi.mocked(rescoreDeck).mockReset();
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 })) as typeof fetch;
});

describe("buildResearchQuery", () => {
  it("includes the startup's public facts", () => {
    const q = buildResearchQuery({ name: "WealthOS", sector: "Wealthtech", stage: "Seed", city: "Bengaluru" });
    expect(q).toContain("WealthOS (Wealthtech, Seed, based in Bengaluru)");
    expect(q).toContain("market size");
  });

  it("degrades gracefully when only a name is known", () => {
    const q = buildResearchQuery({ name: "WealthOS" });
    expect(q).toContain("Research the startup WealthOS.");
    expect(q).not.toContain("(");
  });
});

describe("RESEARCH_PROVIDERS", () => {
  it("prefills each provider's own AI with an encoded query (Gemini opens its app)", () => {
    const q = "acme startup research";
    const byId = Object.fromEntries(RESEARCH_PROVIDERS.map((p) => [p.id, p.toUrl(q)]));
    expect(byId.chatgpt).toBe("https://chatgpt.com/?q=acme%20startup%20research");
    expect(byId.claude).toBe("https://claude.ai/new?q=acme%20startup%20research");
    expect(byId.perplexity).toBe("https://www.perplexity.ai/search?q=acme%20startup%20research");
    expect(byId.copilot).toBe("https://copilot.microsoft.com/?q=acme%20startup%20research");
    expect(byId.gemini).toBe("https://gemini.google.com/app");
    expect(RESEARCH_PROVIDERS.map((p) => p.label)).toEqual([
      "ChatGPT",
      "Claude",
      "Perplexity",
      "Gemini",
      "Copilot",
    ]);
  });
});

const deck: DeckView = { id: "d1", name: "WealthOS", sector: "Wealthtech", stage: "Seed", city: "Bengaluru" };
const params: RubricParameter[] = [{ key: "traction", name: "Traction & Validation", weight: 10 }];
const aiScores = new Map<string, AiParamScore>([["traction", { value: 8, comment: "Strong AUM growth." }]]);

/** Stateful harness so the controlled sliders actually update on change. */
function Harness(props: { total?: number; nav?: boolean }) {
  const [values, setValues] = useState<Record<string, number>>({ traction: 4 });
  return (
    <EvalScorecard
      deck={deck}
      params={params}
      values={values}
      onChangeValue={(key, value) => setValues((v) => ({ ...v, [key]: value }))}
      remarks=""
      onChangeRemarks={() => {}}
      aiScores={aiScores}
      aiTotal={props.total ?? 8}
      nav={props.nav ? { index: 0, total: 3, onPrev: () => {}, onNext: () => {} } : undefined}
      onSave={() => {}}
    />
  );
}

describe("EvalScorecard", () => {
  it("shows AI · My · Average tiles, the per-parameter AI breakdown, and deck X of N", () => {
    render(<Harness nav />);
    expect(screen.getByText("AI Score")).toBeInTheDocument();
    expect(screen.getByText("My Score")).toBeInTheDocument();
    expect(screen.getByText("Average", { exact: true })).toBeInTheDocument();
    // Per-parameter AI breakdown (score + rationale) is visible.
    expect(screen.getByText("Strong AUM growth.")).toBeInTheDocument();
    // Deck queue position + Research affordance.
    expect(screen.getByText("Deck 1 of 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Research/ })).toBeInTheDocument();
  });

  it("updates the Average live as the juror moves a slider (AI 8 + my 4 → 6, my 6 → 7)", () => {
    render(<Harness />);
    const avgTile = screen.getByText("Average", { exact: true }).parentElement as HTMLElement;
    const myTile = screen.getByText("My Score").parentElement as HTMLElement;
    expect(within(myTile).getByText("4")).toBeInTheDocument();
    expect(within(avgTile).getByText("6")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("My score for Traction & Validation"), { target: { value: "6" } });

    expect(within(myTile).getByText("6")).toBeInTheDocument();
    expect(within(avgTile).getByText("7")).toBeInTheDocument();
  });

  it("surfaces the rescore guard's 'already scored' block", async () => {
    vi.mocked(rescoreDeck).mockResolvedValue({ ok: false, reason: "already_scored" });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Re-run AI score/ }));
    expect(await screen.findByText(/Already scored/)).toBeInTheDocument();
    expect(rescoreDeck).toHaveBeenCalledWith("d1");
  });

  it("opens the Research menu with the juror's own AIs", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Research/ }));
    await waitFor(() => expect(screen.getByRole("menu")).toBeInTheDocument());
    for (const label of ["ChatGPT", "Claude", "Perplexity", "Gemini", "Copilot"]) {
      expect(screen.getByRole("menuitem", { name: label })).toBeInTheDocument();
    }
  });
});
