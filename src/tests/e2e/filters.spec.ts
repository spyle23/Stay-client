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

const HOTELS = [
  sampleHotel({
    hotelId: "h1",
    name: "Hôtel Colline",
    category: "4-star",
    fromTotalPrice: 24000,
    amenities: ["WiFi", "Parking"],
  }),
  sampleHotel({
    hotelId: "h2",
    name: "Baobab Suites",
    category: "Boutique",
    fromTotalPrice: 42000,
    amenities: ["WiFi"],
  }),
];

// E2E isolé (Story 1.8) : filtres & tri reflétés dans l'URL contre un BFF mocké (page.route).
test.describe("Filtres & tri des résultats (isolé, BFF mocké)", () => {
  test("choisir un tri reflète le param dans l'URL", async ({ page }) => {
    await mockHotelSearch(page, { hotels: HOTELS });
    await page.goto(searchUrl());
    await expect(page.getByTestId("results-toolbar")).toBeVisible();

    await page.getByTestId("sort-price_asc").click();
    await expect(page).toHaveURL(/sort=price_asc/);
    await expect(page.getByTestId("sort-price_asc")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("basculer une catégorie (facette) reflète category= dans l'URL", async ({
    page,
  }) => {
    await mockHotelSearch(page, { hotels: HOTELS });
    await page.goto(searchUrl());

    const chip = page.getByTestId("filter-category-boutique");
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(page).toHaveURL(/category=Boutique/);
  });

  test("recharger une URL filtrée reconstruit l'état (chips actifs)", async ({
    page,
  }) => {
    await mockHotelSearch(page, { hotels: HOTELS });
    await page.goto(searchUrl({ sort: "price_desc", category: "Boutique" }));

    await expect(page.getByTestId("sort-price_desc")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId("filter-category-boutique")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("axe : barre d'outils de filtres sans violation (clair puis sombre)", async ({
    page,
  }) => {
    await mockHotelSearch(page, { hotels: HOTELS });
    await page.goto(searchUrl());
    await expect(page.getByTestId("results-toolbar")).toBeVisible();

    const light = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(light.violations).toEqual([]);

    await page.getByTestId("theme-toggle").click();
    await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);

    const dark = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(dark.violations).toEqual([]);
  });
});
