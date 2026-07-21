import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const GUID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * E2E isolé de la fiche chambre (Story 1.10). La fiche est **SSR** (fetch côté serveur) :
 * `page.route` (navigateur) ne peut donc PAS mocker sa donnée — le happy-path riche (contenu/axe
 * avec données réelles + navigation carte→fiche) est couvert par le **smoke** contre le vrai stack
 * (`e2e/smoke/room.smoke.spec.ts`). Ici : le **404** (roomId/slug sans GUID, résolu **sans** appel
 * BFF via `notFound()`) et l'**accessibilité** de cette page (clair + sombre).
 */
test.describe("Fiche chambre — 404 (isolé, sans backend)", () => {
  test("un roomId sans GUID rend la 404 chambre (résolu sans appel BFF)", async ({
    page,
  }) => {
    await page.goto(`/hotels/hotel-${GUID}/rooms/pas-un-guid`);
    await expect(page.getByTestId("room-not-found")).toBeVisible();
    await expect(page.getByTestId("room-detail")).toHaveCount(0);
    await expect(page.getByTestId("room-degraded")).toHaveCount(0);
  });

  test("un slug hôtel sans GUID rend la 404 chambre", async ({ page }) => {
    await page.goto(`/hotels/pas-de-guid/rooms/${GUID}`);
    await expect(page.getByTestId("room-not-found")).toBeVisible();
  });

  test("axe : page 404 chambre sans violation, clair + sombre", async ({
    page,
  }) => {
    await page.goto(`/hotels/hotel-${GUID}/rooms/pas-un-guid`);
    await expect(page.getByTestId("room-not-found")).toBeVisible();

    const light = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(light.violations).toEqual([]);

    await page.getByTestId("theme-toggle").click();
    await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);

    const dark = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(dark.violations).toEqual([]);
  });
});
