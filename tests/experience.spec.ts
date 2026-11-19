import { expect, test, type Page } from "@playwright/test";

async function ready(page: Page) {
  await page.goto("/");
  await expect(page.locator(".tcg")).toHaveAttribute("data-ready", "true");
}

async function choose(page: Page) {
  await page.locator(".tcg").press("Enter");
  await expect(page.locator(".tcg")).toHaveAttribute("data-phase", "selected");
  await expect(page.getByRole("button", { name: "Tear open this pack" })).toBeFocused();
}

async function swipe(page: Page, fraction: number) {
  const box = (await page.getByRole("button", { name: "Tear open this pack" }).boundingBox())!;
  await page.mouse.move(box.x + box.width * .06, box.y + 26);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * fraction, box.y + 26, { steps: 16 });
  await page.mouse.up();
}

async function hidden(page: Page, value: boolean) {
  await page.evaluate(hidden => {
    Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: hidden ? "hidden" : "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  }, value);
}

test("carousel, interrupted rip, reveal, tilt, outside reset and repeated keyboard opening", async ({ page }, testInfo) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (new URL(request.url()).origin !== "http://127.0.0.1:4173") external.push(request.url()); });
  await ready(page);
  await expect(page.locator(".tcg")).not.toHaveAttribute("data-fallback");
  await page.locator(".tcg").press("ArrowRight");
  await expect(page.locator(".tcg")).toHaveAttribute("data-active-pack", "2");
  await page.locator(".tcg").press("Shift+ArrowRight");
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-carousel.png` });
  // Native pointer selection after turning the front pack.
  const canvas = page.locator(".tcg-scene canvas");
  const box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: box.width * .5, y: box.height * .35 } });
  await expect(page.locator(".tcg")).toHaveAttribute("data-phase", "selected");
  await expect(page.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
  await swipe(page, .3);
  await expect(page.locator(".tcg")).toHaveAttribute("data-phase", "selected");
  await expect(page.locator(".tcg-tear-label")).toBeVisible();
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-selected.png` });
  await swipe(page, .94);
  await expect(page.locator(".tcg")).toHaveAttribute("data-phase", "revealed");
  await expect(page.getByAltText("Grey mystery card with a question mark")).toBeVisible();
  await expect(page.locator(".reveal-card img")).toHaveCount(1);
  await page.locator(".reveal-card").hover({ position: { x: 30, y: 30 } });
  await expect(page.locator(".reveal-card__face")).toHaveAttribute("style", /--tilt-x:/);
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-reveal.png` });
  await page.locator(".reveal-card").click();
  await expect(page.locator(".tcg")).toHaveAttribute("data-phase", "revealed");
  await page.getByRole("button", { name: "Open another pack", exact: true }).click({ position: { x: 15, y: 150 } });
  await expect(page.locator(".tcg")).toHaveAttribute("data-phase", "browsing");
  await expect(page.locator(".tcg")).toBeFocused();
  for (let cycle = 0; cycle < 3; cycle++) {
    await choose(page);
    await page.getByRole("button", { name: "Tear open this pack" }).press("Enter");
    await expect(page.locator(".tcg")).toHaveAttribute("data-phase", "revealed");
    await page.keyboard.press("Escape");
    await expect(page.locator(".tcg")).toBeFocused();
  }
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
});

test("reveal preserves foreground timing and pauses in a background tab", async ({ page }) => {
  await ready(page);
  await choose(page);
  await page.evaluate(() => {
    const times: Record<string, number> = {};
    Object.assign(window, { revealTimes: times });
    new MutationObserver(() => {
      const phase = document.querySelector(".tcg")?.getAttribute("data-phase");
      if (phase && !(phase in times)) times[phase] = performance.now();
      if (document.querySelector(".pack-spotlight[data-started]") && !times.intro) times.intro = performance.now();
    }).observe(document.querySelector(".tcg")!, { subtree: true, attributes: true });
  });
  await page.getByRole("button", { name: "Tear open this pack" }).press("Enter");
  await hidden(page, true);
  await page.waitForTimeout(850);
  await expect(page.locator(".tcg")).not.toHaveAttribute("data-phase", "revealed");
  await hidden(page, false);
  await expect(page.locator(".tcg")).toHaveAttribute("data-phase", "revealed");
  const times = await page.evaluate(() => (window as unknown as { revealTimes: Record<string, number> }).revealTimes);
  expect(times.revealed - times["rip-delay"]).toBeGreaterThanOrEqual(1450);
  expect(times.revealed - times.intro).toBeGreaterThanOrEqual(480);
  await page.keyboard.press("Escape");
  await choose(page);
  await page.evaluate(() => {
    const times = (window as unknown as { revealTimes: Record<string, number> }).revealTimes;
    for (const key of Object.keys(times)) delete times[key];
  });
  await page.getByRole("button", { name: "Tear open this pack" }).press("Enter");
  await expect(page.locator(".tcg")).toHaveAttribute("data-phase", "revealed");
  const normal = await page.evaluate(() => (window as unknown as { revealTimes: Record<string, number> }).revealTimes);
  expect(normal.rays - normal["rip-delay"]).toBeGreaterThanOrEqual(180);
  expect(normal.revealed - normal.intro).toBeGreaterThanOrEqual(480);
});

test("WebGL fallback remains keyboard and pointer usable", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, context: string, ...args: unknown[]) {
      if (context === "webgl" || context === "webgl2" || context === "experimental-webgl") return null;
      return Reflect.apply(getContext, this, [context, ...args]);
    } as typeof getContext;
  });
  await ready(page);
  await expect(page.locator(".tcg")).toHaveAttribute("data-fallback", "true");
  await expect(page.locator(".tcg-flat-pack")).toHaveCount(5);
  await page.locator(".tcg").press("ArrowLeft");
  await expect(page.locator(".tcg")).toHaveAttribute("data-active-pack", "5");
  await page.locator(".tcg-flat-pack[data-active]").click();
  await expect(page.locator(".tcg")).toHaveAttribute("data-phase", "selected");
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-fallback.png` });
  await swipe(page, .94);
  await expect(page.locator(".tcg")).toHaveAttribute("data-phase", "revealed");
  await page.keyboard.press("Escape");
  await choose(page);
  await page.getByRole("button", { name: "Tear open this pack" }).press("Enter");
  await expect(page.locator(".reveal-card img")).toBeVisible();
});

test("a missing card image can be retried without leaving the demo", async ({ page }) => {
  await page.route("**/card.svg", route => route.fulfill({ status: 404, body: "" }));
  await ready(page);
  await choose(page);
  await page.getByRole("button", { name: "Tear open this pack" }).press("Enter");
  await expect(page.getByRole("alert")).toContainText("The card couldn’t load.");
  await page.unroute("**/card.svg");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(".tcg")).toHaveAttribute("data-phase", "revealed");
  await expect(page.locator(".reveal-card img")).toBeVisible();
});
