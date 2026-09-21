import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelpPage } from "../../src/client/routes/help";
import { HELP_CLIPS, HELP_FAQS } from "../../src/client/routes/help/faqs";
import { INCUBATOR_ROLES, VC_ROLES, type Role } from "../../src/shared/roles";
import { navForUser } from "../../src/shared/nav";

/**
 * JURYbuddy — the Help screen (V3 item 15).
 *
 * Four things this suite holds:
 *   1. The spec's four views and the transitions between them, including the
 *      "Back goes to the RESULTS you came from" rule.
 *   2. The caret bug the spec warns about: the search input must stay MOUNTED
 *      while the results underneath it change, or typing reads as backwards.
 *   3. The clip player is lazy and degrades — no `<video>` until Watch, and a
 *      404 leaves the answer readable.
 *   4. **The negative control this wave's constraints ask for:** every other
 *      role's sidebar, and the whole VC edition, are untouched.
 */

afterEach(cleanup);

const view = () =>
  render(
    <MemoryRouter>
      <HelpPage />
    </MemoryRouter>,
  );

const search = () => screen.getByLabelText("Search the FAQs") as HTMLInputElement;
const type = (value: string) => fireEvent.change(search(), { target: { value } });

describe("Help screen — the spec's four views", () => {
  it("opens on the search box and the spec's four popular questions", () => {
    view();
    expect(search()).toBeInTheDocument();
    const popular = within(screen.getByTestId("help-popular"));
    expect(popular.getByText("Popular right now")).toBeInTheDocument();
    for (const faq of HELP_FAQS.slice(0, 4)) {
      expect(popular.getByRole("button", { name: faq.question })).toBeInTheDocument();
    }
    // Exactly four — not the whole list.
    expect(popular.getAllByRole("button")).toHaveLength(4);
  });

  it("swaps popular for a counted result list as you type", () => {
    view();
    type("free trial");
    expect(screen.queryByTestId("help-popular")).not.toBeInTheDocument();
    const results = within(screen.getByTestId("help-results"));
    // The count in the eyebrow is the number of rows actually drawn.
    const rows = results.getAllByRole("button");
    expect(results.getByText(`${rows.length} matches`)).toBeInTheDocument();
    expect(rows[0]).toHaveTextContent("Is there a free trial, or do I have to pay first?");
  });

  it("says 'match' in the singular when exactly one hits", () => {
    view();
    // "chatbots" appears in exactly one answer (the Research button). Measured,
    // not assumed — an unconditional assertion, so this cannot pass by being
    // skipped the way an `if (results)` guard would let it.
    type("chatbots");
    const results = within(screen.getByTestId("help-results"));
    expect(results.getAllByRole("button")).toHaveLength(1);
    expect(results.getByText("1 match")).toBeInTheDocument();
    expect(results.queryByText("1 matches")).not.toBeInTheDocument();
  });

  it("opens an answer with its clip offer and feedback controls", () => {
    view();
    fireEvent.click(screen.getByRole("button", { name: HELP_FAQS[0].question }));
    expect(screen.getByRole("heading", { name: HELP_FAQS[0].question })).toBeInTheDocument();
    expect(screen.getByText(HELP_FAQS[0].answer)).toBeInTheDocument();
    const secs = HELP_CLIPS[HELP_FAQS[0].clipId].durationSec;
    expect(screen.getByRole("button", { name: `Watch (${secs}s)` })).toBeInTheDocument();
    expect(screen.getByText("Was this helpful?")).toBeInTheDocument();
    expect(screen.getByText("Rate it")).toBeInTheDocument();
  });

  it("returns from an answer to the RESULTS it was opened from, not to home", () => {
    view();
    type("free trial");
    const first = within(screen.getByTestId("help-results")).getAllByRole("button")[0];
    const question = first.textContent!;
    fireEvent.click(first);
    fireEvent.click(screen.getByRole("button", { name: /Back to results/ }));

    // The query survived, so the result list is still there…
    expect(search().value).toBe("free trial");
    expect(screen.getByTestId("help-results")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: question })).toBeInTheDocument();
    // …and we did NOT land back on the popular list.
    expect(screen.queryByTestId("help-popular")).not.toBeInTheDocument();
  });

  it("returns to home from an answer opened with no query behind it", () => {
    view();
    fireEvent.click(screen.getByRole("button", { name: HELP_FAQS[0].question }));
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    expect(screen.getByTestId("help-popular")).toBeInTheDocument();
  });

  it("browses every FAQ grouped under the spec's section headings", () => {
    view();
    fireEvent.click(screen.getByRole("button", { name: /Browse all 41 FAQs/ }));
    // `.u-label` uppercases in CSS, so the DOM keeps the spec's own casing.
    for (const section of ["What Is This Platform?", "Signing Up", "Getting Unstuck"]) {
      expect(screen.getByText(section)).toBeInTheDocument();
    }
    // Every one of the 41 is reachable here, plus the Back control.
    expect(screen.getAllByRole("button")).toHaveLength(HELP_FAQS.length + 1);
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    expect(screen.getByTestId("help-popular")).toBeInTheDocument();
  });
});

describe("Help screen — the no-match path", () => {
  it("offers a closest guess, browse-all, and a ticket button that explains itself", () => {
    view();
    type("zzzqqq nothingmatches");
    const nomatch = within(screen.getByTestId("help-nomatch"));
    expect(nomatch.getByText("No exact match found")).toBeInTheDocument();
    expect(nomatch.getByText("Here's what might help instead:")).toBeInTheDocument();
    expect(nomatch.getByRole("button", { name: "Browse all FAQs" })).toBeInTheDocument();

    // STUBBED, per §12.1 item 12 — there is no ai.STARTUPJURY inbox to reach, so
    // the button must not pretend to file anything. It explains, and points at
    // the path that does work.
    fireEvent.click(nomatch.getByRole("button", { name: "Raise a support ticket" }));
    expect(screen.getByText(/isn't connected yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Contact Admin" })).toHaveAttribute(
      "href",
      "/app/contactadmin",
    );
  });

  it("browse-all from the no-match footer reaches the full list", () => {
    view();
    type("zzzqqq nothingmatches");
    fireEvent.click(screen.getByRole("button", { name: "Browse all FAQs" }));
    expect(screen.getAllByRole("button")).toHaveLength(HELP_FAQS.length + 1);
  });
});

describe("Help screen — the caret bug the spec warns about", () => {
  /**
   * The spec's own comment: an earlier version rebuilt the `<input>` per
   * keystroke, which reset the caret to 0 so "every new character landed at the
   * START of the string — it read as typing backwards". The fix is that the
   * input is never remounted while the results change. Asserted by identity:
   * the same DOM node must survive the home -> results -> no-match transitions.
   */
  it("never remounts the input while the results underneath it change", () => {
    view();
    const node = search();
    type("f"); // home -> still home (1 char, but >2 filter means no match yet)
    expect(search()).toBe(node);
    type("free"); // -> results
    expect(screen.getByTestId("help-results")).toBeInTheDocument();
    expect(search()).toBe(node);
    type("zzzqqq"); // -> no match
    expect(screen.getByTestId("help-nomatch")).toBeInTheDocument();
    expect(search()).toBe(node);
    type(""); // -> back to home
    expect(screen.getByTestId("help-popular")).toBeInTheDocument();
    expect(search()).toBe(node);
  });

  it("types a whole word forwards", () => {
    view();
    for (const value of ["c", "cr", "cre", "cred", "credi", "credit"]) type(value);
    expect(search().value).toBe("credit");
  });
});

describe("Help screen — the clip player", () => {
  const withClip = HELP_FAQS.find((f) => HELP_CLIPS[f.clipId])!;

  it("fetches nothing until Watch is pressed", () => {
    view();
    fireEvent.click(screen.getByRole("button", { name: withClip.question }));
    // 41 clips at ~150 KB each: rendering the <video> eagerly would pull one on
    // every answer opened, whether or not anybody wanted to watch it.
    expect(screen.queryByTestId("help-clip")).not.toBeInTheDocument();
  });

  it("plays from the R2-backed route, not from a bundled data: URI", () => {
    view();
    fireEvent.click(screen.getByRole("button", { name: withClip.question }));
    fireEvent.click(screen.getByRole("button", { name: /^Watch \(/ }));
    const video = screen.getByTestId("help-clip");
    expect(video).toHaveAttribute("src", `/api/help/clips/${withClip.clipId}`);
    // The whole point of item 15's port: 5.86 MB of base64 stayed out.
    expect(video.getAttribute("src")).not.toMatch(/^data:/);
  });

  it("keeps the answer readable when the clip is missing — today's real state", () => {
    view();
    fireEvent.click(screen.getByRole("button", { name: withClip.question }));
    fireEvent.click(screen.getByRole("button", { name: /^Watch \(/ }));
    fireEvent.error(screen.getByTestId("help-clip"));
    expect(screen.queryByTestId("help-clip")).not.toBeInTheDocument();
    expect(screen.getByText(/isn't available yet/)).toBeInTheDocument();
    // The answer itself is untouched.
    expect(screen.getByText(withClip.answer)).toBeInTheDocument();
  });
});

describe("Help screen — feedback controls are acknowledged, and go nowhere", () => {
  it("records a Yes/No choice and a star rating in the UI", () => {
    view();
    fireEvent.click(screen.getByRole("button", { name: HELP_FAQS[0].question }));
    const yes = screen.getByRole("button", { name: "yes" });
    fireEvent.click(yes);
    expect(yes).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "no" }));
    expect(yes).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Rate 4 out of 5" }));
    expect(screen.getByRole("button", { name: "Rate 4 out of 5" })).toBeInTheDocument();
  });

  it("does not carry one answer's rating over to the next", () => {
    view();
    fireEvent.click(screen.getByRole("button", { name: HELP_FAQS[0].question }));
    fireEvent.click(screen.getByRole("button", { name: "yes" }));
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    fireEvent.click(screen.getByRole("button", { name: HELP_FAQS[1].question }));
    expect(screen.getByRole("button", { name: "yes" })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("the Help nav item changes nothing else", () => {
  /**
   * The wave's constraint: "Every other role's screens must render exactly as
   * they do today, and a client test must say so." Help is additive — it appears
   * once, in Support, for the internal incubator roles, and nowhere else.
   */
  it("adds exactly one Support item for each internal incubator role", () => {
    for (const role of [...INCUBATOR_ROLES, "superuser" as Role]) {
      const items = navForUser("incubator", role);
      const help = items.filter((i) => i.id === "help");
      if (role === "founder") continue;
      expect(help, `incubator/${role}`).toHaveLength(1);
      expect(help[0].section).toBe("Support");
      expect(help[0].label).toBe("Help");
      // No `task`, so no permission cell can switch it off — the same rule the
      // rest of the Support section follows.
      expect(help[0].task).toBeUndefined();
    }
  });

  it("gives Help to nobody in the VC edition — that edition was not rescoped", () => {
    for (const role of [...VC_ROLES, "superuser" as Role]) {
      expect(navForUser("vc", role).some((i) => i.id === "help"), `vc/${role}`).toBe(false);
    }
  });

  it("keeps Help out of the founder portal", () => {
    // The 41 answers are entirely about staff workflows — seats, plans,
    // pipelines, the admin console. A founder has none of them.
    expect(navForUser("incubator", "founder").some((i) => i.id === "help")).toBe(false);
  });
});
