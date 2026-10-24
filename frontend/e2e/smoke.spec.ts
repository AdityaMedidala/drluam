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
  // Both x-axes sit above the fold at 1440x900.
  for (const axis of await page.locator(".recharts-xAxis").all()) {
    const box = await axis.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(900);
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
