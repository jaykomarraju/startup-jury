import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { queryStatusOf } from "../../src/client/routes/QueryPage";
import { DeckRow } from "../../src/client/components";
import type { QueryView } from "../../src/client/api";
import type { DeckView } from "../../src/client/types";

function query(overrides: Partial<QueryView> = {}): QueryView {
  return {
    id: "q1",
    deck_id: "d1",
    questions: "Share your MRR.",
    email_status: "sent",
    founder_response: null,
    created_at: new Date().toISOString(),
    resolved_at: null,
    ...overrides,
  };
}

describe("queryStatusOf", () => {
  it("is 'not asked' before anyone raises a query", () => {
    expect(queryStatusOf([])).toBe("not_asked");
  });

  it("is 'pending' while a recent query is unanswered", () => {
    expect(queryStatusOf([query()])).toBe("pending");
  });

  it("is 'overdue' once an unanswered query passes the window", () => {
    const old = new Date(Date.now() - 6 * 86_400_000).toISOString();
    expect(queryStatusOf([query({ created_at: old })])).toBe("overdue");
  });

  it("is 'responded' as soon as the founder replies, however old", () => {
    const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
    expect(queryStatusOf([query({ created_at: old, founder_response: "MRR is ₹4L." })])).toBe(
      "responded",
    );
  });

  it("reads the newest query — the list is already newest-first", () => {
    const newest = query({ id: "new", created_at: new Date().toISOString() });
    const older = query({
      id: "old",
      created_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      founder_response: "answered ages ago",
    });
    expect(queryStatusOf([newest, older])).toBe("pending");
  });
});

function deck(overrides: Partial<DeckView> = {}): DeckView {
  return { id: "d1", name: "Stuck Co", status: "Pending AI", statusId: "pending_ai", ...overrides };
}

function renderRow(d: DeckView) {
  return render(
    <table>
      <tbody>
        <DeckRow deck={d} />
      </tbody>
    </table>,
  );
}

describe("DeckRow AI health (§9)", () => {
  it("says nothing extra for a normally-evaluated deck", () => {
    renderRow(deck({ status: "AI Evaluated", statusId: "ai_evaluated", aiState: "ok" }));
    expect(screen.queryByText(/Failed|Retrying|In progress/)).toBeNull();
  });

  it("distinguishes an evaluation in progress from one that failed", () => {
    const { unmount } = renderRow(deck({ aiState: "in_progress" }));
    expect(screen.getByText("In progress")).toBeInTheDocument();
    unmount();

    renderRow(
      deck({ aiState: "failed", aiError: "AI provider billing — out of credits" }),
    );
    // The real cause, not the old blanket "no AI key configured yet".
    expect(screen.getByText(/Failed · AI provider billing/)).toBeInTheDocument();
  });

  it("shows a retrying deck with its last error", () => {
    renderRow(deck({ aiState: "retrying", aiError: "AI provider rate limit" }));
    expect(screen.getByText(/Retrying · AI provider rate limit/)).toBeInTheDocument();
  });
});
