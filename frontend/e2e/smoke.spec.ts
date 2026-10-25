import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

async function seriousViolations(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.help}`);
}

test("decision view shows the plan, both charts and no errors", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/?date=2026-01-28&confidence=90&cutoff=09:20");
  await expect(page.getByText("P90 planning volume ·")).toBeVisible();
  await expect(page.locator(".hero")).toContainText("180");
  await expect(page.getByRole("heading", { name: "Hourly wind forecast · GW" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Forecast revisions · GW" })).toBeVisible();
  await expect(page.locator(".recharts-surface")).toHaveCount(2);
  // The menu button exists only below Carbon's large breakpoint.
  await expect(page.getByRole("button", { name: "Open menu" })).toBeHidden();
  // Both x-axes sit above the fold at 1440x900, inside their tile (not clipped by it).
  for (const axis of await page.locator(".recharts-xAxis").all()) {
    const box = await axis.boundingBox();
    const tile = await axis.evaluate((e) => e.closest(".tile")!.getBoundingClientRect().bottom);
    expect(box!.y + box!.height).toBeLessThanOrEqual(Math.min(900, tile));
  }
  expect(await seriousViolations(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test("accuracy view shows the headline numbers and three panels", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/?view=accuracy&cutoff=09:20");
  await expect(page.getByRole("heading", { name: "Daily mean wind, forecast vs outturn · GW" })).toBeVisible();
  await expect(page.locator(".kpis")).toContainText("84% (target 90%)");
  await expect(page.locator(".kpis")).toContainText("2,022 → 1,383 MW");
  await expect(page.locator(".three .tile")).toHaveCount(3);
  await expect(page.locator(".kpis")).not.toContainText("~");
  await expect(page.getByText(/held/i)).toHaveCount(0);
  expect(await seriousViolations(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test("the theme toggle switches to dark and persists", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator(".cds--g100")).toBeVisible();
});

test("the delivery-day picker shows the selected date, including the last day", async ({ page }) => {
  for (const [iso, shown] of [["2026-02-01", "01/02/2026"], ["2026-01-02", "02/01/2026"]]) {
    await page.goto(`/?date=${iso}`);
    await expect(page.locator("#delivery-day")).toHaveValue(shown);
  }
  await page.goto("/");
  await expect(page.locator("#delivery-day")).not.toHaveValue("");
});

test("each chart's toolbar shows its own data table", async ({ page }) => {
  await page.goto("/?date=2026-01-17&confidence=90");
  const main = page.locator(".decision .tile").nth(1);
  const menu = () => main.getByRole("button", { name: "Hourly wind forecast · GW options" });
  await menu().click();
  await page.getByRole("menuitem", { name: "Show as table" }).click();
  await expect(main.locator(".chart-table tbody tr")).toHaveCount(24);
  await expect(main.locator(".chart-table th").first()).toHaveText("Time (UK)");
  await menu().click();
  await page.getByRole("menuitem", { name: "Show as chart" }).click();
  await expect(main.locator(".recharts-surface")).toBeVisible();
  const download = page.waitForEvent("download");
  await menu().click();
  await page.getByRole("menuitem", { name: "Download CSV" }).click();
  expect((await download).suggestedFilename()).toBe("wind-forecast-2026-01-17.csv");
});

test("with no URL parameters the app opens on the representative day, 17 Jan", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#delivery-day")).toHaveValue("17/01/2026");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Day-ahead plan · Sat 17 Jan 2026");
});

test("the Methodology hit-rate line follows the decision time, like the plan panel", async ({ page }) => {
  const hitRate = () => page.locator(".methodology dt", { hasText: /^Hit rate$/ }).locator("xpath=following-sibling::dd[1]");
  await page.goto("/?date=2026-01-17&cutoff=09:20");
  await page.getByRole("button", { name: "Methodology" }).click();
  await expect(hitRate()).toContainText("Backtest from Nov 2025 to Sep 2026");
  await page.goto("/?date=2026-01-17&cutoff=08:00");
  await page.getByRole("button", { name: "Methodology" }).click();
  await expect(hitRate()).toContainText("January 2026 hours at 08:00");
});

test("a mouse click on a header tab leaves no focus ring", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Accuracy" }).click();
  const tab = page.getByRole("link", { name: "Accuracy" });
  await expect(tab).toBeFocused();
  expect(await tab.evaluate((e) => getComputedStyle(e).borderColor)).toBe("rgba(0, 0, 0, 0)");
});

test("the cost block recommends a level, applies it, and keeps the costs in the URL", async ({ page }) => {
  await page.goto("/?date=2026-01-17&cutoff=09:20&confidence=50");
  const block = page.getByRole("region", { name: "Cost-aware exceedance level" });
  const header = block.getByRole("button", { name: /^Level by cost\s*,\s*P80$/ });
  await expect(header).toHaveAttribute("aria-expanded", "false");          // collapsed by default
  await header.click();
  const row = (label: string) => block.locator(".cds--structured-list-row", { hasText: label });
  await expect(row("Short · Long")).toContainText("£100 · £30 per MWh");
  await expect(row("Recommended")).toContainText("P80 (theory P77)");
  await expect(row("11-month backtest").getByRole("img", { name: "matches theory" })).toBeVisible();
  await expect(row("January only")).toContainText("P70, £4.6m less than P80");
  await expect(block).toContainText("P80 would have cost £67.0m less than the NESO forecast in this backtest, at these assumptions.");
  await expect(block.getByText("Cost (£m, GB-wide volume)")).toBeVisible();
  await expect(block.getByText("illustrative")).toHaveCount(1);              // said once, on the assumptions
  // The footnote under the table can be scrolled fully into view inside the panel (not clipped).
  const foot = block.getByText(/hours at 09:20\. Lowest cost highlighted\./);
  await foot.scrollIntoViewIfNeeded();
  const footBox = (await foot.boundingBox())!;
  const tileBottom = await foot.evaluate((e) => e.closest(".tile")!.getBoundingClientRect().bottom);
  expect(footBox.y + footBox.height).toBeLessThanOrEqual(tileBottom);
  await expect(block.locator(".cost-table tbody tr")).toHaveCount(7);
  await expect(block.locator(".cost-table tr.lowest")).toHaveCount(1);
  await block.getByRole("link", { name: "Use P80" }).click();
  await expect(page.getByRole("tab", { name: "P80" })).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/confidence=80/);
  await expect(row("Recommended")).toContainText("Selected");
  await expect(block.getByRole("link", { name: "Use P80" })).toHaveCount(0);

  await block.getByLabel("Short · £/MWh").fill("200");
  await block.getByLabel("Long · £/MWh").fill("20");
  await expect(row("Recommended")).toContainText("P90 or P95 (theory P91)");
  await expect(page).toHaveURL(/short=200/);
  await expect(page).toHaveURL(/long=20/);
  await block.getByLabel("Short · £/MWh").fill("20");
  await block.getByLabel("Long · £/MWh").fill("80");
  await expect(row("Recommended")).toContainText("P50 (theory P20, snapped)");
  await expect(block).toContainText("more than the NESO forecast");     // the comparison keeps its sign
  expect(await seriousViolations(page)).toEqual([]);
});

test("with the cost block collapsed the drift chart gets its height back", async ({ page }) => {
  await page.goto("/?date=2026-01-17&cutoff=09:20");
  await expect(page.locator(".drift-plot .recharts-surface")).toBeVisible();
  const height = (await page.locator(".drift-plot").boundingBox())!.height;
  expect(height).toBeGreaterThanOrEqual(250);
});

test("the model switch serves ML on both views, keeps it in the URL, and disables unsupported combinations", async ({ page }) => {
  await page.goto("/?date=2026-01-17&cutoff=09:20");
  await expect(page.locator("#model")).toContainText("Simple");                      // Simple is the default
  await page.locator("#model").click();
  await page.getByRole("option", { name: "ML (LightGBM + CQR)" }).click();
  await expect(page).toHaveURL(/model=ml/);
  await expect(page.getByRole("region", { name: "Plan" })).toContainText("ML forecast (P50)");
  await expect(page.locator(".hero")).toContainText("153");
  // With ML selected, decision times it wasn't precomputed for are disabled.
  await page.locator("#cutoff").click();
  await expect(page.getByRole("option", { name: "08:00" })).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByRole("option", { name: "09:00" })).not.toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");
  expect(await seriousViolations(page)).toEqual([]);

  await page.getByRole("link", { name: "Accuracy" }).click();
  const compare = page.getByRole("region", { name: "Simple vs ML" });
  const row = (label: string) => compare.locator("tbody tr", { hasText: label });
  await expect(row("MAE")).toContainText("1,383 MW");
  await expect(row("MAE")).toContainText("1,318 MW");
  await expect(row("80% range coverage")).toContainText("69%");
  await expect(row("80% range coverage")).toContainText("77%");
  await expect(row("Cost of the P80 plan")).toContainText("£53.1m");
  expect(await seriousViolations(page)).toEqual([]);
});

test("an ML link at a decision time ML doesn't cover opens on Simple", async ({ page }) => {
  await page.goto("/?date=2026-01-17&cutoff=08:00&model=ml");
  await expect(page.locator("#model")).toContainText("Simple");
  await expect(page).toHaveURL(/model=simple/);
  await page.locator("#model").click();
  await expect(page.getByRole("option", { name: "ML (LightGBM + CQR)" })).toHaveAttribute("aria-disabled", "true");
});
