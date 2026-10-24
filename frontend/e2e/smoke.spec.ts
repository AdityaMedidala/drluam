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
  await expect(page.getByRole("heading", { name: /below NESO forecast/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /across 11 runs/ })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Forecast exceeded outturn on most January days" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Headline numbers" })).toContainText("84%");
  await expect(page.locator(".three .tile")).toHaveCount(3);
  await expect(page.getByRole("group", { name: "Headline numbers" })).not.toContainText("~");
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
