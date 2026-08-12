import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ResubmitPage from "../../src/client/routes/ResubmitPage";
import { ApiError, getResubmit, postResubmit, type ResubmitView } from "../../src/client/api";

// The public founder page (Session 6). It is deliberately outside AuthProvider
// and AppShell, so it renders bare — only the two public fetchers are stubbed.
vi.mock("../../src/client/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/client/api")>();
  return { ApiError: actual.ApiError, getResubmit: vi.fn(), postResubmit: vi.fn() };
});

const VIEW: ResubmitView = {
  deck: {
    name: "NimbusHR",
    founder: "Meera Sharma",
    sector: "HR Tech",
    stage: "Pre-seed",
    city: "Bengaluru",
    status: "incomplete",
    statusLabel: "Incomplete",
    complete: false,
    version: 1,
  },
  missingFields: ["founderPhone", "city"],
  missingSections: [
    { label: "Traction", text: "No traction or validation metrics were found." },
    { label: "Team", text: "No team slide was found." },
  ],
  versions: [{ version: 1, fileName: "NimbusHR.pdf", createdAt: "2026-08-01T00:00:00Z" }],
  expiresAt: "2026-09-11T00:00:00Z",
  usesLeft: 10,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/resubmit/tok123"]}>
      <Routes>
        <Route path="/resubmit/:token" element={<ResubmitPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(getResubmit).mockReset();
  vi.mocked(postResubmit).mockReset();
});

describe("ResubmitPage (public founder page)", () => {
  it("lists the missing contact details and the missing deck sections", async () => {
    vi.mocked(getResubmit).mockResolvedValue(VIEW);
    renderPage();

    expect(await screen.findByText("NimbusHR")).toBeInTheDocument();
    expect(screen.getByText("Action required")).toBeInTheDocument();
    // Field keys are rendered through INTAKE_FIELD_LABELS, never raw.
    expect(screen.getByText("Phone")).toBeInTheDocument();
    expect(screen.getByText("City")).toBeInTheDocument();
    expect(screen.queryByText("founderPhone")).not.toBeInTheDocument();
    // Feedback sections, per §8 — sections to update, not a Q&A form.
    expect(screen.getByText("Traction")).toBeInTheDocument();
    expect(screen.getByText("Team")).toBeInTheDocument();
    expect(screen.getAllByText("Missing")).toHaveLength(2);
    // There is exactly one action: upload the corrected deck.
    expect(screen.getByRole("button", { name: /upload & re-score/i })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("surfaces the server's founder-facing message when the link is dead", async () => {
    vi.mocked(getResubmit).mockRejectedValue(
      new ApiError(410, {
        error: "token_expired",
        message: "This link has expired. Ask the programme team to send you a new one.",
      }),
    );
    renderPage();

    expect(await screen.findByText(/this link can.t be opened/i)).toBeInTheDocument();
    expect(screen.getByText(/this link has expired/i)).toBeInTheDocument();
    // No upload control is offered on a dead link.
    expect(screen.queryByRole("button", { name: /upload/i })).not.toBeInTheDocument();
  });

  it("uploads the corrected deck and confirms the deck went back to the panel", async () => {
    vi.mocked(getResubmit).mockResolvedValue(VIEW);
    vi.mocked(postResubmit).mockResolvedValue({
      ok: true,
      version: 2,
      evaluated: true,
      ...VIEW,
      deck: { ...VIEW.deck, complete: true, status: "ai_evaluated", version: 2 },
      missingFields: [],
      missingSections: [],
      versions: [
        { version: 2, fileName: "NimbusHR-v2.pdf", createdAt: "2026-08-12T00:00:00Z" },
        ...VIEW.versions,
      ],
    });

    const { container } = renderPage();
    await screen.findByText("NimbusHR");

    const input = container.querySelector('input[type="file"]')!;
    fireEvent.change(input, {
      target: { files: [new File(["%PDF-1.4"], "NimbusHR-v2.pdf", { type: "application/pdf" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: /upload & re-score/i }));

    await waitFor(() => expect(postResubmit).toHaveBeenCalledTimes(1));
    const [token, form] = vi.mocked(postResubmit).mock.calls[0];
    expect(token).toBe("tok123");
    expect((form.get("file") as File).name).toBe("NimbusHR-v2.pdf");

    expect(await screen.findByText(/version 2 received/i)).toBeInTheDocument();
    expect(screen.getByText(/back with the evaluation panel/i)).toBeInTheDocument();
    expect(screen.getByText("Complete")).toBeInTheDocument();
  });

  it("tells the founder what is still missing after a partial fix", async () => {
    vi.mocked(getResubmit).mockResolvedValue(VIEW);
    vi.mocked(postResubmit).mockResolvedValue({
      ok: true,
      version: 2,
      evaluated: true,
      ...VIEW,
      deck: { ...VIEW.deck, version: 2 },
      missingFields: ["city"],
      missingSections: [],
    });

    const { container } = renderPage();
    await screen.findByText("NimbusHR");
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [new File(["%PDF-1.4"], "v2.pdf", { type: "application/pdf" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: /upload & re-score/i }));

    expect(await screen.findByText(/still missing/i)).toBeInTheDocument();
    expect(screen.getByText("Action required")).toBeInTheDocument();
  });

  it("refuses to submit with no file chosen, and shows a failed upload's reason", async () => {
    vi.mocked(getResubmit).mockResolvedValue(VIEW);
    const { container } = renderPage();
    await screen.findByText("NimbusHR");

    fireEvent.click(screen.getByRole("button", { name: /upload & re-score/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/choose your updated deck/i);
    expect(postResubmit).not.toHaveBeenCalled();

    vi.mocked(postResubmit).mockRejectedValue(
      new ApiError(413, { error: "pdf_too_large", message: "That PDF is larger than 24 MB." }),
    );
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [new File(["%PDF-1.4"], "big.pdf", { type: "application/pdf" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: /upload & re-score/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/larger than 24 MB/i);
  });
});
