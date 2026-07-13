import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { mockHotelSearch, sampleHotel } from "./helpers/mock-api";

const GUID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

function futureDate(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function searchUrl(): string {
  const params = new URLSearchParams({
    destination: "Antananarivo",
    checkInDate: futureDate(30),
    checkOutDate: futureDate(33),
    guests: "2",
    currency: "EUR",
  });
  return `/search?${params.toString()}`;
}

/**
 * E2E isolé de la fiche hôtel (Story 1.9). La fiche est **SSR** (fetch côté serveur) : `page.route`
 * (navigateur) ne peut donc PAS mocker sa donnée — le happy-path riche (galerie/chambres/axe avec
 * données) est couvert par le **smoke** contre le vrai stack (`e2e/smoke/hotel.smoke.spec.ts`).
 * Ici : la **navigation** carte→fiche (AC-12), le **404** sur slug sans GUID (AC-9, sans fetch), et
 * l'**accessibilité** de la carte devenue lien sur la page de résultats (clair + sombre).
 */
test.describe("Fiche hôtel — navigation & 404 (isolé, BFF mocké)", () => {
  test("la carte hôtel est un lien qui navigue vers /hotels/{slug} (dates préservées)", async ({
    page,
  }) => {
    await mockHotelSearch(page, {
      hotels: [sampleHotel({ hotelId: GUID, name: "Premier" })],
    });
    await page.goto(searchUrl());

    const card = page.getByTestId("hotel-card").first();
    await expect(card).toBeVisible();
    const href = await card.getAttribute("href");
    expect(href).toContain("/hotels/");
    expect(href).toContain(GUID);
    expect(href).toContain("guests=2");

    await card.click();
    await expect(page).toHaveURL(new RegExp(`/hotels/.*${GUID}`));
  });

  test("un slug sans GUID rend la page 404 localisée (résolu sans appel au BFF)", async ({
    page,
  }) => {
    // `notFound()` court-circuite avant tout fetch : ni fiche hôtel, ni état dégradé (fetch).
    // NB : le statut HTTP 404 n'est posé qu'en production ; en dev, on vérifie le contenu rendu.
    await page.goto("/hotels/pas-de-guid-ici");
    await expect(page.getByTestId("hotel-not-found")).toBeVisible();
    await expect(page.getByTestId("hotel-detail")).toHaveCount(0);
    await expect(page.getByTestId("hotel-degraded")).toHaveCount(0);
  });

  test("axe : page de résultats (carte devenue lien) sans violation, clair + sombre", async ({
    page,
  }) => {
    await mockHotelSearch(page, {
      hotels: [
        sampleHotel({ hotelId: GUID, name: "Premier" }),
        sampleHotel({
          hotelId: "22222222-2222-2222-2222-222222222222",
          name: "Second",
        }),
      ],
    });
    await page.goto(searchUrl());
    await expect(page.getByTestId("hotel-card").first()).toBeVisible();

    const light = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(light.violations).toEqual([]);

    await page.getByTestId("theme-toggle").click();
    await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);

    const dark = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(dark.violations).toEqual([]);
  });
});
