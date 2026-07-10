import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { mockHotelSearch, sampleHotel } from "./helpers/mock-api";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** Date-only `AAAA-MM-JJ` dans le futur (les dates passées seraient rejetées). */
function futureDate(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const CHECK_IN = futureDate(30);
const CHECK_OUT = futureDate(33);

function searchUrl(overrides: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    destination: "Antananarivo",
    checkInDate: CHECK_IN,
    checkOutDate: CHECK_OUT,
    guests: "2",
    currency: "EUR",
    ...overrides,
  });
  return `/search?${params.toString()}`;
}

// E2E isolé (Story 1.6) : parcours recherche → résultats contre un BFF mocké (page.route),
// états vide/dégradé, rejet client sans appel, accessibilité axe (clair + sombre).
test.describe("Recherche multi-hôtels (isolé, BFF mocké)", () => {
  test("affiche les hôtels réellement disponibles renvoyés par le BFF", async ({
    page,
  }) => {
    await mockHotelSearch(page, {
      hotels: [
        sampleHotel({
          hotelId: "h1",
          name: "Hôtel Test",
          city: "Antananarivo",
        }),
      ],
    });
    await page.goto(searchUrl());

    await expect(page.getByTestId("hotel-card")).toBeVisible();
    await expect(page.getByTestId("results-count")).toBeVisible();
    await expect(page.getByText("Hôtel Test")).toBeVisible();
  });

  test("état vide : propose d'élargir les dates/la zone", async ({ page }) => {
    await mockHotelSearch(page, { hotels: [] });
    await page.goto(searchUrl());
    await expect(page.getByTestId("results-empty")).toBeVisible();
  });

  test("état dégradé (distinct de vide) quand le BFF renvoie 503", async ({
    page,
  }) => {
    await mockHotelSearch(page, {
      status: 503,
      body: { success: false, message: "PMS indisponible" },
    });
    await page.goto(searchUrl());
    await expect(page.getByTestId("results-degraded")).toBeVisible();
  });

  test("saisie invalide rejetée sans quitter l'accueil ni appeler le BFF", async ({
    page,
  }) => {
    let called = false;
    await page.route("**/api/v1/search/hotels**", async (route) => {
      called = true;
      await route.fulfill({ status: 200, body: "{}" });
    });

    await page.goto("/");
    await page.getByTestId("search-destination").fill("Paris");
    // Aucune date choisie → validation client doit bloquer.
    await page.getByTestId("search-submit").click();

    await expect(page.getByTestId("search-errors")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/");
    expect(called).toBe(false);
  });

  test("axe : page de résultats sans violation (clair puis sombre)", async ({
    page,
  }) => {
    await mockHotelSearch(page, {
      hotels: [
        sampleHotel({ hotelId: "h1", name: "Premier" }),
        sampleHotel({ hotelId: "h2", name: "Second" }),
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
