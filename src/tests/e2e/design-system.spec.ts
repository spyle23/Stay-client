import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

// E2E (Story 1.4) : la vitrine du design-system est accessible (axe, WCAG 2.1 AA)
// en clair ET sombre, la bascule de thème fonctionne, le focus est atteignable au
// clavier et l'accent hôtel s'applique localement sans teinter le chrome neutre.
test.describe("design-system — thème & accessibilité", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/design-system");
    await expect(
      page.getByRole("heading", { name: "Design System", level: 1 }),
    ).toBeVisible();
  });

  test("axe : aucune violation en thème clair", async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .withTags(WCAG_TAGS)
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test("bascule en thème sombre et reste accessible (axe)", async ({
    page,
  }) => {
    const html = page.locator("html");
    await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);

    await page.getByTestId("theme-toggle").click();
    await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);

    const results = await new AxeBuilder({ page })
      .withTags(WCAG_TAGS)
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test("le CTA primaire est atteignable au clavier (focus)", async ({
    page,
  }) => {
    const cta = page.getByTestId("neutral-primary");
    await cta.focus();
    await expect(cta).toBeFocused();
  });

  test("l'accent hôtel s'applique localement, le chrome reste neutre", async ({
    page,
  }) => {
    const accentBg = await page
      .getByTestId("accent-primary")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    const neutralBg = await page
      .getByTestId("neutral-primary")
      .evaluate((el) => getComputedStyle(el).backgroundColor);

    // Accent injecté (#7c3aed) sur la surface hôtel ; chrome neutre = marque (#0e7c86).
    expect(accentBg).toBe("rgb(124, 58, 237)");
    expect(neutralBg).toBe("rgb(14, 124, 134)");
    expect(accentBg).not.toBe(neutralBg);
  });
});
