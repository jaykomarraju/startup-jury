import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  KpiTile,
  SignalTag,
  DeckCard,
  ScoreBars,
  EvaluationDrawer,
  Sidebar,
} from "../../src/client/components";
import { navForUser, navLabel } from "../../src/shared/nav";
import type { DeckView } from "../../src/client/types";

const deck: DeckView = {
  id: "d1",
  name: "FinStack",
  sector: "FinTech",
  stage: "Seed",
  city: "Hyderabad",
  founder: "Ananya Reddy",
  aiScore: 7.2,
  signal: "moderate",
  status: "AI Evaluated",
};

describe("KpiTile", () => {
  it("renders label, value, sublabel and a clamped progress bar", () => {
    const { container } = render(
      <KpiTile label="Uploaded" value={24} sublabel="+3 since yesterday" progress={140} />,
    );
    expect(screen.getByText("Uploaded")).toBeInTheDocument();
    expect(screen.getByText("24")).toBeInTheDocument();
    expect(screen.getByText("+3 since yesterday")).toBeInTheDocument();
    const bar = container.querySelector("div[style*='width']") as HTMLElement;
    expect(bar.style.width).toBe("100%"); // clamped
  });
});

describe("SignalTag", () => {
  it("labels each signal band", () => {
    render(<SignalTag signal="strong" />);
    expect(screen.getByText("Strong")).toBeInTheDocument();
  });
});

describe("DeckCard", () => {
  it("shows name, meta, score and signal; fires onClick", () => {
    const onClick = vi.fn();
    render(<DeckCard deck={deck} onClick={onClick} />);
    expect(screen.getByText("FinStack")).toBeInTheDocument();
    expect(screen.getByText(/FinTech · Seed · Hyderabad/)).toBeInTheDocument();
    expect(screen.getByText("7.2")).toBeInTheDocument();
    expect(screen.getByText("Moderate")).toBeInTheDocument();
    fireEvent.click(screen.getByText("FinStack"));
    expect(onClick).toHaveBeenCalledWith(deck);
  });
});

describe("ScoreBars", () => {
  it("computes the weighted total from parameter scores", () => {
    render(
      <ScoreBars
        scores={[
          { label: "Traction", weight: 2, value: 10 },
          { label: "Team", weight: 1, value: 4 },
        ]}
      />,
    );
    // (2*10 + 1*4) / 3 = 8.00
    expect(screen.getByText("8.00")).toBeInTheDocument();
    expect(screen.getByText("Traction")).toBeInTheDocument();
  });
});

describe("EvaluationDrawer", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <EvaluationDrawer open={false} onClose={() => {}} deck={deck} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders report content and closes via button + Escape", () => {
    const onClose = vi.fn();
    render(
      <EvaluationDrawer
        open
        onClose={onClose}
        deck={deck}
        verdict="Shortlist"
        scores={[{ label: "Traction", weight: 2, value: 8 }]}
        extraction={[{ label: "Cover", text: "FinStack — B2B FinTech" }]}
      />,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Shortlist")).toBeInTheDocument();
    expect(screen.getByText("Cover")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("Sidebar", () => {
  function renderSidebar(edition: "incubator" | "vc", role: Parameters<typeof navForUser>[1]) {
    return render(
      <MemoryRouter>
        <Sidebar edition={edition} role={role} />
      </MemoryRouter>,
    );
  }

  it("renders exactly the nav items visible to the role (incubator jury)", () => {
    renderSidebar("incubator", "jury");
    const expected = navForUser("incubator", "jury");
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(expected.length);
    for (const item of expected) {
      expect(screen.getByText(navLabel("jury", item))).toBeInTheDocument();
    }
    // Trimmed items are absent.
    expect(screen.queryByText("Upload")).not.toBeInTheDocument();
    expect(screen.queryByText("Assign")).not.toBeInTheDocument();
    // Jury sees personalized labels.
    expect(screen.getByText("My Pipeline")).toBeInTheDocument();
    expect(screen.getByText("Evaluated")).toBeInTheDocument();
  });

  it("gives VC IC member its trimmed nav (icpipeline yes, upload no)", () => {
    renderSidebar("vc", "ic_member");
    expect(screen.getByText("IC Pipeline")).toBeInTheDocument();
    expect(screen.getByText("Invest ready")).toBeInTheDocument();
    expect(screen.queryByText("Upload")).not.toBeInTheDocument();
    expect(screen.queryByText("Legal DD")).not.toBeInTheDocument();
  });
});
