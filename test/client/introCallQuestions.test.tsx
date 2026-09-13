import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, within } from "@testing-library/react";
import { IntroCallQuestions } from "../../src/client/components/IntroCallQuestions";

/**
 * W7-E — the intro call's AI questions. `GET /api/calls/:id/prompts` answers
 * `{enabled, prompts:[{topic, because, question}]}`; with the admin toggle off it
 * answers `enabled:false` and the block must not exist at all.
 *
 * Absence is only meaningful once the answer has landed, so every test settles
 * the request the SAME way — and the "on" test asserts presence synchronously
 * after that settle, which is what proves the settle is long enough for the "off"
 * test's absence to mean something.
 */

vi.mock("../../src/client/api", () => ({ getCallPrompts: vi.fn() }));
import { getCallPrompts } from "../../src/client/api";

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

// Braces matter: a hook that RETURNS the mock hands vitest a function, which it
// runs as teardown — calling the mock once more after every test.
beforeEach(() => {
  vi.mocked(getCallPrompts).mockReset();
});

describe("IntroCallQuestions", () => {
  it("renders every prompt's topic, question and reason when the admin toggle is on", async () => {
    vi.mocked(getCallPrompts).mockResolvedValue({
      enabled: true,
      prompts: [
        {
          topic: "Traction & Validation",
          because: "The deck scored 2.5 here, below the rubric's 5-point Moderate band.",
          question: "Traction & Validation scored low. What evidence isn't in the deck that would change that read?",
        },
        {
          topic: "Phone",
          because: "Missing from the submission.",
          question: "We still need the phone — can you confirm it on the call?",
        },
      ],
    });
    render(<IntroCallQuestions callId="call_1" />);
    await settle();

    const block = screen.getByRole("region", { name: "AI question prompts" });
    expect(getCallPrompts).toHaveBeenCalledWith("call_1");
    expect(within(block).getByText("2 questions")).toBeInTheDocument();
    const items = within(block).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText("Traction & Validation")).toBeInTheDocument();
    expect(
      within(items[0]).getByText("Traction & Validation scored low. What evidence isn't in the deck that would change that read?"),
    ).toBeInTheDocument();
    expect(items[0]).toHaveTextContent("Why: The deck scored 2.5 here, below the rubric's 5-point Moderate band.");
    expect(within(items[1]).getByText("Phone")).toBeInTheDocument();
    expect(items[1]).toHaveTextContent("Why: Missing from the submission.");
  });

  it("renders NOTHING when the admin has the toggle off — no heading, no empty state", async () => {
    vi.mocked(getCallPrompts).mockResolvedValue({ enabled: false, prompts: [] });
    const { container } = render(
      <div data-testid="host">
        <IntroCallQuestions callId="call_1" />
      </div>,
    );
    await settle();

    expect(getCallPrompts).toHaveBeenCalledWith("call_1");
    expect(screen.getByTestId("host")).toBeEmptyDOMElement();
    expect(screen.queryByRole("region", { name: "AI question prompts" })).toBeNull();
    expect(screen.queryByText(/AI question prompts/)).toBeNull();
    expect(screen.queryByText(/No gaps to probe/)).toBeNull();
    expect(container.querySelector("[data-testid='intro-call-questions']")).toBeNull();
  });

  it("says there is nothing to probe when the toggle is on and the deck raised no gaps", async () => {
    vi.mocked(getCallPrompts).mockResolvedValue({ enabled: true, prompts: [] });
    render(<IntroCallQuestions callId="call_2" />);
    await settle();
    const block = screen.getByRole("region", { name: "AI question prompts" });
    expect(within(block).getByText(/No gaps to probe/)).toBeInTheDocument();
    expect(within(block).queryAllByRole("listitem")).toHaveLength(0);
  });

  it("renders nothing while the answer is still on its way", async () => {
    vi.mocked(getCallPrompts).mockReturnValue(new Promise(() => {}));
    render(
      <div data-testid="host">
        <IntroCallQuestions callId="call_3" />
      </div>,
    );
    await settle();
    expect(getCallPrompts).toHaveBeenCalledWith("call_3");
    expect(screen.getByTestId("host")).toBeEmptyDOMElement();
  });

  it("renders nothing if the request fails", async () => {
    vi.mocked(getCallPrompts).mockRejectedValue(new Error("500"));
    render(
      <div data-testid="host">
        <IntroCallQuestions callId="call_4" />
      </div>,
    );
    await settle();
    expect(getCallPrompts).toHaveBeenCalledWith("call_4");
    expect(screen.getByTestId("host")).toBeEmptyDOMElement();
  });
});
