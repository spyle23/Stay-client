import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

// E2E (Story 1.5) : bascule langue (fr/en) sans perte de contexte + bascule
// devise de travail (EUR/USD) segmentée et persistée, header accessible (axe
// clair ET sombre). Tourne isolément contre le dev server (port 3000).
test.describe("i18n & sélecteurs langue/devise", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("locale-switcher")).toBeVisible();
  });

  test("bascule fr → en sans changer d'URL et met à jour <html lang>", async ({
    page,
  }) => {
    const html = page.locator("html");
    await expect(html).toHaveAttribute("lang", "fr");
    await expect(page.getByTestId("home-subtitle")).toHaveText(/disponibles/i);

    await page.getByTestId("locale-switcher").click();
    await page.getByTestId("locale-option-en").click();

    await expect(html).toHaveAttribute("lang", "en");
    await expect(page.getByTestId("home-subtitle")).toHaveText(/available/i);
    // Contexte de navigation préservé : même URL (aucun préfixe /en).
    expect(new URL(page.url()).pathname).toBe("/");
  });

  test("bascule EUR → USD et persiste au rechargement (segmentation)", async ({
    page,
  }) => {
    await expect(page.getByTestId("currency-switcher")).toContainText("EUR");

    await page.getByTestId("currency-switcher").click();
    await page.getByTestId("currency-option-USD").click();
    await expect(page.getByTestId("currency-switcher")).toContainText("USD");

    await page.reload();
    await expect(page.getByTestId("currency-switcher")).toContainText("USD");
  });

  test("changer la langue n'altère pas la devise de travail", async ({
    page,
  }) => {
    await page.getByTestId("currency-switcher").click();
    await page.getByTestId("currency-option-USD").click();
    await expect(page.getByTestId("currency-switcher")).toContainText("USD");

    await page.getByTestId("locale-switcher").click();
    await page.getByTestId("locale-option-en").click();

    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByTestId("currency-switcher")).toContainText("USD");
  });

  test("axe : header + accueil sans violation (clair puis sombre)", async ({
    page,
  }) => {
    const light = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(light.violations).toEqual([]);

    await page.getByTestId("theme-toggle").click();
    await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);

    const dark = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(dark.violations).toEqual([]);
  });
});
