import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { RubricAnchorsSection } from "../../src/client/routes/admin/RubricAnchors";
import { AuthContext, type AuthUser } from "../../src/client/auth/AuthProvider";
import { ADDITIONAL_PARAM_OWNERS, type Edition } from "../../src/shared/roles";
import { RUBRIC_BANDS } from "../../src/shared/types";

/**
 * Admin console → Rubric anchors. The two things the prototype's screen cannot
 * be built without: the picker lists **22** parameters per edition (13 core + 9
 * role — plan §8 Q10, NOT the prototype's stale P1/P2/P3 trio), and a role
 * parameter that `0027` scaffolded with NULL text still shows five empty band
 * boxes to write into rather than an empty pane.
 */

const CORE_NAMES = [
  "Problem & Market Clarity",
  "Solution & Value Proposition",
  "Market Size & Opportunity",
  "Product & Technology",
  "Business Model & Unit Economics",
  "Traction & Validation",
  "Competitive Landscape",
  "Go-To-Market Strategy",
  "Team & Execution Capability",
  "Business Risks",
  "Business Attractiveness",
  "Climate Impact & Integrity",
  "Storytelling & Deck Quality",
];

function bands(text: (i: number) => string | null) {
  return RUBRIC_BANDS.map((b) => ({
    index: b.index,
    label: b.label,
    name: b.name,
    min: b.min,
    max: b.max,
    description: text(b.index),
  }));
}

/** 13 core with seeded anchors + 9 role-scoped scaffolded with NULLs. */
function payload(edition: Edition) {
  const owners = ADDITIONAL_PARAM_OWNERS[edition];
  const core = CORE_NAMES.map((name, i) => ({
    id: `${edition}_core_${i}`,
    key: `core_${i}`,
    name,
    informational: false,
    sortOrder: i + 1,
    prompt: `Guidance for ${name}.`,
    bands: bands((b) => `${name} band ${b}`),
  }));
  const role = owners.flatMap((r, ri) =>
    [1, 2, 3].map((n) => ({
      id: `${edition}_${r}_${n}`,
      key: `add_${r}_${n}`,
      name: `Role param ${ri + 1}.${n}`,
      informational: true,
      roleScope: r,
      sortOrder: 100 + ri * 3 + n,
      prompt: null,
      bands: bands(() => null),
    })),
  );
  return { edition, parameters: [...core, ...role] };
}

function mockFetch(edition: Edition) {
  const put = vi.fn();
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "PUT") {
      put(url, JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(JSON.stringify(payload(edition)), { status: 200 });
  }) as typeof fetch;
  return put;
}

function mount(edition: Edition) {
  const user: AuthUser = {
    id: "u1",
    name: "Nisha Kapoor",
    initials: "NK",
    role: "admin",
    edition,
  };
  return render(
    <AuthContext.Provider
      value={{ user, loading: false, login: vi.fn(), logout: vi.fn(), updateUser: vi.fn() }}
    >
      <RubricAnchorsSection />
    </AuthContext.Provider>,
  );
}

function picker() {
  return screen.getByLabelText("Evaluation area") as HTMLSelectElement;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("the area picker", () => {
  it.each(["incubator", "vc"] as const)(
    "lists 22 parameters for %s — 13 core and 9 role, in two groups",
    async (edition) => {
      mockFetch(edition);
      mount(edition);
      await waitFor(() => expect(picker().options).toHaveLength(22));

      const groups = Array.from(picker().querySelectorAll("optgroup"));
      expect(groups.map((g) => g.label)).toEqual([
        "Core evaluation areas",
        "Additional configurable parameters",
      ]);
      expect(groups[0].querySelectorAll("option")).toHaveLength(13);
      expect(groups[1].querySelectorAll("option")).toHaveLength(9);
    },
  );

  it("numbers the core areas and tiers the role ones AI+ / AI++ / AI+++", async () => {
    mockFetch("incubator");
    mount("incubator");
    await waitFor(() => expect(picker().options).toHaveLength(22));
    const labels = Array.from(picker().options).map((o) => o.textContent ?? "");
    expect(labels[0]).toBe("01 · Problem & Market Clarity");
    expect(labels[12]).toBe("13 · Storytelling & Deck Quality");
    expect(labels[13]).toContain("AI+ · Program Associate");
    expect(labels[16]).toContain("AI++ · Program Manager");
    expect(labels[19]).toContain("AI+++ · Jury Member");
  });

  it("fixes the scale — it is the BRD five-band scale and cannot be changed", async () => {
    mockFetch("incubator");
    mount("incubator");
    const scale = (await screen.findByLabelText("Scale")) as HTMLSelectElement;
    expect(scale.disabled).toBe(true);
    expect(scale.options[0].textContent).toBe("BRD 5-band (0–2 · 3–4 · 5–6 · 7–8 · 9–10)");
  });
});

describe("the band editor", () => {
  it("shows a core area's five seeded anchors and its guidance prompt", async () => {
    mockFetch("incubator");
    mount("incubator");
    await waitFor(() => expect(picker().options).toHaveLength(22));
    const prompt = screen.getByLabelText(
      "AI guidance prompt — Problem & Market Clarity",
    ) as HTMLTextAreaElement;
    expect(prompt.value).toBe("Guidance for Problem & Market Clarity.");
    for (const b of RUBRIC_BANDS) {
      const ta = screen.getByLabelText(
        `${b.label} band anchor — Problem & Market Clarity`,
      ) as HTMLTextAreaElement;
      expect(ta.value).toBe(`Problem & Market Clarity band ${b.index}`);
    }
  });

  it("gives a scaffolded role parameter FIVE empty bands, not nothing", async () => {
    mockFetch("incubator");
    mount("incubator");
    await waitFor(() => expect(picker().options).toHaveLength(22));
    fireEvent.change(picker(), { target: { value: "incubator_program_manager_2" } });

    const boxes = RUBRIC_BANDS.map(
      (b) => screen.getByLabelText(`${b.label} band anchor — Role param 2.2`) as HTMLTextAreaElement,
    );
    expect(boxes).toHaveLength(5);
    expect(boxes.every((t) => t.value === "")).toBe(true);
    expect(boxes[0].placeholder).toBe("Describe what a 9–10 score means for this area…");
    // The prompt is blank too — scaffolded means empty, not absent.
    expect((screen.getByLabelText("AI guidance prompt — Role param 2.2") as HTMLTextAreaElement).value).toBe("");
  });

  it("renders the nine role parameters as their own cards below the picker", async () => {
    mockFetch("incubator");
    mount("incubator");
    const heading = await screen.findByText("Configurable parameter anchors");
    expect(heading).toBeInTheDocument();
    // Nine cards, one per role parameter — not the prototype's three.
    const block = screen.getByRole("region", { name: "Configurable parameter anchors" });
    expect(within(block).getAllByRole("button", { name: /Save anchors/ })).toHaveLength(9);
    // Ten in total — the nine cards plus the picker's own.
    const saves = await screen.findAllByRole("button", { name: /Save anchors/ });
    expect(saves).toHaveLength(10);
    expect(within(block).getAllByText("AI+")).toHaveLength(3);
    expect(within(block).getAllByText("AI+++")).toHaveLength(3);
  });
});

describe("save and revert", () => {
  it("saves the edited area's prompt and all five bands", async () => {
    const put = mockFetch("incubator");
    mount("incubator");
    await waitFor(() => expect(picker().options).toHaveLength(22));

    fireEvent.change(screen.getByLabelText("9–10 band anchor — Problem & Market Clarity"), {
      target: { value: "Regulator-forced, budgeted pain." },
    });
    const [save] = screen.getAllByRole("button", { name: /Save anchors/ });
    fireEvent.click(save);

    await waitFor(() => expect(put).toHaveBeenCalled());
    const [url, body] = put.mock.calls[0];
    expect(url).toBe("/api/anchors/incubator_core_0");
    expect(body.bands).toHaveLength(5);
    expect(body.bands[0]).toEqual({ index: 0, description: "Regulator-forced, budgeted pain." });
  });

  it("Revert discards unsaved edits and restores the stored value", async () => {
    mockFetch("incubator");
    mount("incubator");
    await waitFor(() => expect(picker().options).toHaveLength(22));

    const box = screen.getByLabelText(
      "9–10 band anchor — Problem & Market Clarity",
    ) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "scratch" } });
    expect(box.value).toBe("scratch");

    fireEvent.click(screen.getByRole("button", { name: /Revert/ }));
    expect(box.value).toBe("Problem & Market Clarity band 0");
  });

  it("a save's refresh does not discard an unsaved edit on another area", async () => {
    // `save()` re-reads the server; a blanket re-seed of the drafts would wipe
    // whatever else the admin has typed. `<StrictMode>` makes the same clobber
    // happen on mount, which is how this was found.
    mockFetch("incubator");
    mount("incubator");
    await waitFor(() => expect(picker().options).toHaveLength(22));

    // Edit area 1…
    fireEvent.change(screen.getByLabelText("9–10 band anchor — Problem & Market Clarity"), {
      target: { value: "edited but not saved" },
    });
    // …then switch to area 2, edit it, and save only that one.
    fireEvent.change(picker(), { target: { value: "incubator_core_1" } });
    fireEvent.change(screen.getByLabelText("9–10 band anchor — Solution & Value Proposition"), {
      target: { value: "saved" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: /Save anchors/ })[0]);
    await waitFor(() => expect(screen.getByText(/Rubric anchors saved for/)).toBeInTheDocument());

    // Area 1's edit is still there.
    fireEvent.change(picker(), { target: { value: "incubator_core_0" } });
    expect(
      (screen.getByLabelText("9–10 band anchor — Problem & Market Clarity") as HTMLTextAreaElement)
        .value,
    ).toBe("edited but not saved");
  });

  it("Save is disabled until something is edited", async () => {
    mockFetch("incubator");
    mount("incubator");
    await waitFor(() => expect(picker().options).toHaveLength(22));
    const [save] = screen.getAllByRole("button", { name: /Save anchors/ });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("AI guidance prompt — Problem & Market Clarity"), {
      target: { value: "changed" },
    });
    expect(save).toBeEnabled();
  });
});

describe("failure states", () => {
  it("offers a retry when the anchors cannot be loaded", async () => {
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 500 })) as typeof fetch;
    mount("incubator");
    expect(await screen.findByText(/Couldn’t load the rubric anchors/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("keeps the admin's edits on screen when a save fails", async () => {
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") return new Response("nope", { status: 500 });
      return new Response(JSON.stringify(payload("incubator")), { status: 200 });
    }) as typeof fetch;
    mount("incubator");
    await waitFor(() => expect(picker().options).toHaveLength(22));

    const box = screen.getByLabelText(
      "9–10 band anchor — Problem & Market Clarity",
    ) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "kept" } });
    fireEvent.click(screen.getAllByRole("button", { name: /Save anchors/ })[0]);

    expect(await screen.findByText(/Couldn't save the anchors/)).toBeInTheDocument();
    expect(box.value).toBe("kept");
  });
});

describe("the card layout mirrors the prototype", () => {
  it("groups the role cards by owner role with its tier pill", async () => {
    mockFetch("vc");
    mount("vc");
    await screen.findByText("Configurable parameter anchors");
    // VC owners are Investment Associate / Partner / IC Member (spec §6.2).
    const block = screen.getByRole("region", { name: "Configurable parameter anchors" });
    const cards = within(block).getAllByText(/Role param \d\.\d/);
    expect(cards).toHaveLength(9);
    const first = cards[0].closest("div")!;
    expect(within(first).getByText("AI+")).toBeInTheDocument();
  });
});
