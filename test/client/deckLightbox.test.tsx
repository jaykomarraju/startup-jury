import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { DeckPdfViewer } from "../../src/client/components/DeckPdfViewer";

/**
 * The deck lightbox — the surface a presenter stands in front of.
 *
 * MEASURED at 393x659 before this (docs/plan_pilot_gcw.md §11 left it open
 * because nobody had rendered the fix): the prev/next chevrons were in-flow
 * siblings of a `max-w-full` slide, so the row's content came to 445px in a
 * 393px viewport and the two buttons centred at **x=-16 and x=409** — 4px of
 * each on screen. Tapping the dark surround did not close the lightbox either,
 * because the body row is `flex-1` and swallowed the tap with
 * `stopPropagation()` before the backdrop's own handler saw it.
 *
 * Both are fixed here, and the second one is fixed ONLY under a finger: a
 * stray MOUSE click in the dark surround at 1440px must not close the slide
 * mid-presentation, which is the objection that held the change back. The fork
 * is `(pointer: coarse)` — see `useCoarsePointer` in PanelFrame.tsx.
 */

const PAGE_DATA = "data:image/png;base64,AAAA";

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 3,
      getPage: () =>
        Promise.resolve({
          getViewport: () => ({ width: 100, height: 140 }),
          render: () => ({ promise: Promise.resolve() }),
        }),
    }),
  }),
}));

const realMatchMedia = window.matchMedia;
const realGetContext = HTMLCanvasElement.prototype.getContext;
const realToDataURL = HTMLCanvasElement.prototype.toDataURL;

/**
 * jsdom ships no 2d context, and `DeckPdfViewer` throws without one
 * ("no 2d context" → the error state, and then there are no slides to open).
 * It never calls a method on the context — the mocked `page.render()` above
 * takes it and ignores it — so an empty object is the whole requirement.
 *
 * `defineProperty` rather than an assignment with a cast: `getContext` is an
 * overloaded signature returning a full `CanvasRenderingContext2D`, and
 * satisfying the type would mean writing 70 properties this test does not use.
 */
function stubCanvas() {
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => ({}),
  });
  HTMLCanvasElement.prototype.toDataURL = () => PAGE_DATA;
}

function withPointer(coarse: boolean) {
  window.matchMedia = ((query: string) => ({
    media: query,
    matches: coarse && query === "(pointer: coarse)",
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

async function openSlide(coarse: boolean) {
  withPointer(coarse);
  render(<DeckPdfViewer deckId="d_one" />);
  // The strip's thumbnails are named by their `title` ("Click to enlarge"),
  // not by the slide, so the slide number comes from the image inside.
  await waitFor(() => expect(screen.getAllByAltText("Slide 1")).toHaveLength(1));
  fireEvent.click(screen.getByAltText("Slide 1").closest("button")!);
  return screen.getByRole("dialog", { name: "Slide 1 of 3" });
}

/** The lightbox's dark ground: the two elements whose own click is a dismiss. */
function surround(dialog: HTMLElement): HTMLElement[] {
  return [dialog, dialog.querySelector(".flex-1") as HTMLElement];
}

beforeEach(() => {
  stubCanvas();
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(new ArrayBuffer(8), { status: 200 }),
  ) as typeof fetch;
});

afterEach(() => {
  window.matchMedia = realMatchMedia;
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: realGetContext,
  });
  HTMLCanvasElement.prototype.toDataURL = realToDataURL;
  vi.restoreAllMocks();
});

describe("the deck lightbox", () => {
  it("takes the chevrons out of the flow below sm, so both are on a 393px screen", async () => {
    const dialog = await openSlide(true);
    for (const name of ["Previous slide", "Next slide"]) {
      const btn = screen.getByRole("button", { name });
      expect(dialog).toContainElement(btn);
      // In flow at `sm` and above — the desktop layout is untouched — and
      // absolutely positioned over the slide's own edge below it.
      expect(btn.className, name).toContain("max-sm:absolute");
      expect(btn.className, name).toMatch(/max-sm:(left|right)-2/);
      // 44px under a finger: `p-2.5` around a 24px glyph.
      expect(btn.className, name).toContain("max-sm:p-2.5");
    }
  });

  it("pages forward and back from those chevrons", async () => {
    await openSlide(true);
    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(screen.getByRole("dialog", { name: "Slide 2 of 3" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous slide" }));
    expect(screen.getByRole("dialog", { name: "Slide 1 of 3" })).toBeInTheDocument();
  });

  it("closes on a tap in the dark surround when the pointer is a finger", async () => {
    const dialog = await openSlide(true);
    // The body row, not the backdrop: it is `flex-1`, so on a phone it IS the
    // surround, and it is where the tap actually lands.
    fireEvent.click(surround(dialog)[1]);
    expect(screen.queryByRole("dialog", { name: /^Slide/ })).toBeNull();
  });

  it("does NOT close on a stray click in the dark surround under a mouse", async () => {
    const dialog = await openSlide(false);
    for (const el of surround(dialog)) fireEvent.click(el);
    expect(screen.getByRole("dialog", { name: "Slide 1 of 3" })).toBeInTheDocument();
    // The X and Escape are what close it there, and both still do.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: /^Slide/ })).toBeNull();
  });

  it("never closes from the slide itself, at either pointer", async () => {
    for (const coarse of [true, false]) {
      const dialog = await openSlide(coarse);
      // The enlarged slide, not the strip thumbnail of the same name.
      fireEvent.click(dialog.querySelector("img")!);
      expect(screen.getByRole("dialog", { name: "Slide 1 of 3" })).toBeInTheDocument();
      fireEvent.click(dialog.querySelector("header, .flex.items-center.justify-between")!);
      expect(screen.getByRole("dialog", { name: "Slide 1 of 3" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(screen.queryByRole("dialog", { name: /^Slide/ })).toBeNull();
    }
  });

  it("sits above the JURYbuddy launcher, which is fixed at z-[1000]", async () => {
    const dialog = await openSlide(true);
    expect(dialog.className).toContain("z-[1100]");
  });
});
