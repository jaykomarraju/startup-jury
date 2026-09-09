/// <reference lib="dom" />
// `tsconfig.node.json` compiles e2e/ with lib ES2023 and no DOM, because no
// other spec runs code inside the page. This one measures the shell's CSS
// contract with page.evaluate, so it pulls the DOM lib in for itself rather
// than widening a tsconfig it does not own.
import { test, expect, type Page } from "@playwright/test";

/**
 * W1-A — the shell is a fixed frame, but only where it should be.
 *
 * The prototype freezes the document (`body{overflow:hidden}`, `.view{height:100vh}`)
 * so the toolbar and the rail stay put while the data region scrolls. Applying
 * that to `body` unconditionally would also freeze the two standalone public
 * pages (`/login`, `/resubmit/:token`), which are `min-h-screen` and legitimately
 * grow past the viewport — their lower half would become unreachable. So the
 * rule is scoped to `body[data-app-shell]`, which <AppShell> sets while mounted.
 */

const SUPERUSER = "priya.sharma@demo.startupjury.ai";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@firm.com").fill(email);
  await page.locator('input[type="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app/**");
}

test("the signed-in shell never page-scrolls; its content pane scrolls instead", async ({
  page,
}) => {
  await login(page, SUPERUSER);
  await page.goto("/app/alldecks");
  await page.waitForLoadState("networkidle");

  const frozen = await page.evaluate(() => ({
    marked: document.body.dataset.appShell === "1",
    overflow: getComputedStyle(document.body).overflowY,
    docScrolls:
      document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
    paneScrolls: !!document.querySelector("main"),
  }));
  expect(frozen.marked).toBe(true);
  expect(frozen.overflow).toBe("hidden");
  expect(frozen.docScrolls).toBe(false);
  expect(frozen.paneScrolls).toBe(true);

  // The rail and the content pane are separate scroll axes.
  const axes = await page.evaluate(() => {
    const rail = document.querySelector("aside");
    const main = document.querySelector("main");
    return {
      rail: rail ? getComputedStyle(rail).overflowY : null,
      main: main ? getComputedStyle(main).overflowY : null,
    };
  });
  expect(axes.rail).toBe("auto");
  expect(axes.main).toBe("auto");
});

test("a standalone public page still scrolls when it outgrows the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 300 });
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

  const state = await page.evaluate(() => {
    const el = document.documentElement;
    return {
      marked: document.body.dataset.appShell !== undefined,
      overflow: getComputedStyle(document.body).overflowY,
      overflows: el.scrollHeight > el.clientHeight + 1,
    };
  });
  expect(state.marked).toBe(false);
  expect(state.overflow).not.toBe("hidden");
  expect(state.overflows).toBe(true);

  // And it really does scroll — the frozen version silently clipped this.
  const moved = await page.evaluate(() => {
    const el = document.scrollingElement!;
    el.scrollTop = 200;
    return el.scrollTop;
  });
  expect(moved).toBeGreaterThan(0);
});

test("the sidebar collapses to a 52px icon rail between 640px and 900px", async ({ page }) => {
  await login(page, SUPERUSER);
  await page.goto("/app/alldecks");

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator("aside.sj-rail")).toHaveJSProperty("offsetWidth", 190);
  await expect(page.getByRole("link", { name: /All decks/ })).toBeVisible();

  await page.setViewportSize({ width: 820, height: 800 });
  await expect(page.locator("aside.sj-rail")).toHaveJSProperty("offsetWidth", 52);
  // The glyphs stay; the labels and section headers go.
  await expect(page.locator("aside.sj-rail a").first()).toBeVisible();
  await expect(page.locator("aside.sj-rail a span").first()).toBeHidden();

  await page.setViewportSize({ width: 500, height: 800 });
  await expect(page.locator("aside.sj-rail")).toBeHidden();
  await page.getByRole("button", { name: "Open menu" }).click();
  // The drawer has its own header with an explicit close, not just a backdrop.
  await expect(page.getByText("Menu", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close menu" }).click();
  await expect(page.getByText("Menu", { exact: true })).toBeHidden();
});

test("the .tb frame pins its toolbar and footer while only its body scrolls", async ({ page }) => {
  await login(page, SUPERUSER);
  await page.goto("/app/alldecks");
  await page.waitForLoadState("networkidle");

  // No screen has adopted <PanelFrame> yet (that is Waves 7-9), so measure the
  // primitive's CSS contract directly: the same markup PanelFrame emits, dropped
  // into the shell's content pane.
  const geo = await page.evaluate(() => {
    const main = document.querySelector("main")!;
    main.innerHTML = `
      <section class="sj-frame" id="probe">
        <div class="tb"><div><h1 class="tbt">Probe</h1><div class="tbs">sub</div></div>
          <div class="tbr"><button class="tbb pr">Go</button></div></div>
        <div id="probe-body" style="flex:1 1 auto;min-height:0;overflow-y:auto">
          <div style="height:4000px"></div>
        </div>
        <div class="tb-foot"><span>24 decks</span></div>
      </section>`;
    const frame = document.getElementById("probe")!;
    const tb = frame.querySelector(".tb") as HTMLElement;
    const foot = frame.querySelector(".tb-foot") as HTMLElement;
    const body = document.getElementById("probe-body")!;

    const before = { tb: tb.getBoundingClientRect().top, foot: foot.getBoundingClientRect().bottom };
    body.scrollTop = 1500;
    const after = { tb: tb.getBoundingClientRect().top, foot: foot.getBoundingClientRect().bottom };

    return {
      before,
      after,
      scrolled: body.scrollTop,
      // The frame fills the pane exactly, and the pane itself does not scroll.
      fillsPane:
        Math.abs(frame.getBoundingClientRect().height - main.getBoundingClientRect().height) < 1,
      mainScrolls: main.scrollHeight > main.clientHeight + 1,
      toolbarSurface: window.getComputedStyle(tb).backgroundColor,
      primaryButton: window.getComputedStyle(frame.querySelector(".tbb.pr")!).backgroundColor,
    };
  });

  expect(geo.scrolled).toBe(1500); // the body really moved…
  expect(geo.after.tb).toBeCloseTo(geo.before.tb, 0); // …and the toolbar did not
  expect(geo.after.foot).toBeCloseTo(geo.before.foot, 0);
  expect(geo.fillsPane).toBe(true);
  expect(geo.mainScrolls).toBe(false);
  // `.tb` is on --surface (white in light), and the primary action is OLIVE.
  expect(geo.toolbarSurface).toBe("rgb(255, 255, 255)");
  expect(geo.primaryButton).toBe("rgb(107, 132, 84)"); // #6B8454
});
