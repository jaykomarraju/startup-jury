import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QuestionBankSection } from "../../src/client/routes/admin/QuestionBank";

/**
 * W2-C — the Clarification question bank section (`s-qb`).
 *
 * The prototype's accordion is icon · name · `<n> questions` chip · chevron,
 * over rows of `Q1…Qn` · text · Edit. These cover the four states the section
 * can be in and the four actions it adds — including the two that are easy to
 * get wrong: ordinals are POSITIONAL (so a move renumbers, it does not swap a
 * label), and delete is soft (so the count drops but the wording survives on
 * the server).
 */

interface Question {
  id: string;
  seq: number;
  text: string;
}

const TRACTION = [
  "What is your strongest proof of customer demand?",
  "How many paying customers do you have today?",
  "What has grown fastest in the last 6 months?",
];

function seed() {
  return [
    {
      parameterId: "inc_traction_validation",
      key: "traction_validation",
      name: "Traction & Validation",
      questions: TRACTION.map((text, i) => ({
        id: `q${i + 1}`,
        seq: i + 1,
        text,
      })),
    },
    {
      parameterId: "inc_climate_impact",
      key: "climate_impact",
      name: "Climate Impact & Integrity",
      questions: Array.from({ length: 8 }, (_, i) => ({
        id: `c${i + 1}`,
        seq: i + 1,
        text: `Climate question ${i + 1}`,
      })),
    },
  ];
}

/** A stand-in bank that applies the same mutations the worker route does. */
function fakeApi() {
  const areas = seed();
  const calls: {
    method: string;
    path: string;
    body?: Record<string, unknown>;
  }[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace("/api/questions", "");
    const method = init?.method ?? "GET";
    const body = init?.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : undefined;
    calls.push({ method, path, body });

    const ok = (payload: unknown, status = 200) =>
      new Response(JSON.stringify(payload), { status });

    if (method === "GET") return ok({ edition: "incubator", areas });
    if (method === "POST") {
      const area = areas.find((a) => a.parameterId === body!.parameterId)!;
      const question: Question = {
        id: `new-${area.questions.length + 1}`,
        seq: area.questions.length + 1,
        text: String(body!.text),
      };
      area.questions.push(question);
      return ok({ question }, 201);
    }
    if (method === "PUT" && path === "/reorder") {
      const area = areas.find((a) => a.parameterId === body!.parameterId)!;
      const ids = body!.ids as string[];
      area.questions = ids.map((id, i) => ({
        ...area.questions.find((q) => q.id === id)!,
        seq: i + 1,
      }));
      return ok({ ok: true });
    }
    if (method === "PUT") {
      const id = path.slice(1);
      for (const area of areas) {
        const q = area.questions.find((x) => x.id === id);
        if (q) q.text = String(body!.text);
      }
      return ok({ ok: true });
    }
    if (method === "DELETE") {
      const id = path.slice(1);
      // Soft on the server; from the accordion's side the row simply leaves
      // and the survivors renumber.
      for (const area of areas)
        area.questions = area.questions
          .filter((q) => q.id !== id)
          .map((q, i) => ({ ...q, seq: i + 1 }));
      return ok({ ok: true });
    }
    return ok({ error: "unexpected" }, 500);
  });

  return { areas, calls, fetchMock };
}

let api: ReturnType<typeof fakeApi>;

beforeEach(() => {
  api = fakeApi();
  vi.stubGlobal("fetch", api.fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

/** The open accordion body for `key`. */
function areaPanel(key: string) {
  return screen.getByTestId(`qb-area-${key}`);
}

async function openBank() {
  render(<QuestionBankSection />);
  await screen.findByText("Traction & Validation");
}

describe("question bank section", () => {
  it("renders the prototype's heading, sub-line and per-area count chip", async () => {
    await openBank();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Clarification question bank",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/auto-triggered to the startup when the AI detects weak, missing, or/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId("qb-count-traction_validation")).toHaveTextContent("3 questions");
    expect(screen.getByTestId("qb-count-climate_impact")).toHaveTextContent("8 questions");
  });

  it("opens on its first area and toggles the others", async () => {
    await openBank();
    expect(screen.getByTestId("qb-head-traction_validation")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText(TRACTION[0])).toBeInTheDocument();
    expect(screen.queryByText("Climate question 1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("qb-head-climate_impact"));
    expect(await screen.findByText("Climate question 8")).toBeInTheDocument();
  });

  it("numbers the rows Q1…Qn positionally", async () => {
    await openBank();
    const rows = within(areaPanel("traction_validation")).getAllByText(/^Q\d+$/);
    expect(rows.map((r) => r.textContent)).toEqual(["Q1", "Q2", "Q3"]);
  });

  it("edits a question in place", async () => {
    await openBank();
    fireEvent.click(screen.getByLabelText("Edit question 1 of Traction & Validation"));
    const input = screen.getByLabelText("Edit question 1 of Traction & Validation");
    fireEvent.change(input, {
      target: { value: "Which metric proves this works?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Which metric proves this works?")).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === "PUT" && c.path === "/q1")).toBe(true);
  });

  it("adds a question to the end of an area and grows the chip", async () => {
    await openBank();
    fireEvent.click(screen.getByRole("button", { name: /Add question/ }));
    fireEvent.change(screen.getByLabelText("New question for Traction & Validation"), {
      target: { value: "Who renewed, and why?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText("Who renewed, and why?")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("qb-count-traction_validation")).toHaveTextContent("4 questions"),
    );
  });

  it("deletes a question and renumbers what is left", async () => {
    await openBank();
    fireEvent.click(screen.getByLabelText("Delete question 1 of Traction & Validation"));

    await waitFor(() =>
      expect(screen.getByTestId("qb-count-traction_validation")).toHaveTextContent("2 questions"),
    );
    expect(screen.queryByText(TRACTION[0])).not.toBeInTheDocument();
    const rows = within(areaPanel("traction_validation")).getAllByText(/^Q\d+$/);
    expect(rows.map((r) => r.textContent)).toEqual(["Q1", "Q2"]);
    // The question that was Q2 is now Q1.
    expect(screen.getByText(TRACTION[1])).toBeInTheDocument();
  });

  it("reorders by writing the whole area's order, not by swapping labels", async () => {
    await openBank();
    fireEvent.click(screen.getByLabelText("Move question 3 of Traction & Validation up"));

    await waitFor(() => expect(api.calls.some((c) => c.path === "/reorder")).toBe(true));
    const reorder = api.calls.find((c) => c.path === "/reorder")!;
    expect(reorder.body).toEqual({
      parameterId: "inc_traction_validation",
      ids: ["q1", "q3", "q2"],
    });
    await waitFor(() => {
      const texts = within(areaPanel("traction_validation"))
        .getAllByText(/proof of customer demand|paying customers|grown fastest/)
        .map((n) => n.textContent);
      expect(texts).toEqual([TRACTION[0], TRACTION[2], TRACTION[1]]);
    });
  });

  it("cannot move the first row up or the last row down", async () => {
    await openBank();
    expect(screen.getByLabelText("Move question 1 of Traction & Validation up")).toBeDisabled();
    expect(screen.getByLabelText("Move question 3 of Traction & Validation down")).toBeDisabled();
  });

  it("says so when the bank cannot be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    render(<QuestionBankSection />);
    expect(await screen.findByText("Couldn't load the question bank")).toBeInTheDocument();
  });
});
