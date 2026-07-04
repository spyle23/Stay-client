import { test, expect } from "@playwright/test";

// Test de fumée e2e du scaffold front (Story 1.1) : la page d'accueil se charge.
test("la page d'accueil se charge", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBeLessThan(400);
  await expect(page.locator("body")).toBeVisible();
});
