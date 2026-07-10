import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { mockHotelSearch, sampleHotel } from "./helpers/mock-api";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** Date-only `AAAA-MM-JJ` dans le futur. */
function futureDate(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const CHECK_IN = futureDate(30);
const CHECK_OUT = futureDate(33);

function nearbyUrl(overrides: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    mode: "nearby",
    latitude: "-18.879",
    longitude: "47.508",
    checkInDate: CHECK_IN,
    checkOutDate: CHECK_OUT,
    guests: "2",
    currency: "EUR",
    ...overrides,
  });
  return `/search?${params.toString()}`;
}

// E2E isolé (Story 1.7) : recherche « à proximité » contre un BFF mocké (page.route) + géoloc
// fournie par le contexte Playwright.
test.describe("Recherche à proximité (isolé, BFF mocké)", () => {
  test("mode nearby : cartes avec distance + en-tête « à proximité »", async ({
    page,
  }) => {
    // Le BFF renvoie déjà trié par distance croissante (le front préserve l'ordre).
    await mockHotelSearch(page, {
      hotels: [
        sampleHotel({ hotelId: "near", name: "Hôtel Proche", distanceKm: 0.5 }),
        sampleHotel({ hotelId: "far", name: "Hôtel Loin", distanceKm: 4.2 }),
      ],
    });
    await page.goto(nearbyUrl());

    await expect(
      page.getByRole("heading", { name: /à proximité/i }),
    ).toBeVisible();
    const cards = page.getByTestId("hotel-card");
    await expect(cards).toHaveCount(2);
    // Distance affichée sur chaque carte.
    await expect(page.getByTestId("hotel-card-distance").first()).toBeVisible();
    // Ordre préservé : le plus proche en premier.
    await expect(cards.first()).toContainText("Hôtel Proche");
  });

  test("état vide proximité : propose d'élargir la zone/les dates", async ({
    page,
  }) => {
    await mockHotelSearch(page, { hotels: [] });
    await page.goto(nearbyUrl());
    await expect(page.getByTestId("results-empty")).toBeVisible();
    await expect(page.getByTestId("results-empty")).toContainText(/proximité/i);
  });

  test("le bouton « Autour de moi » est présent et un-tap sur l'accueil", async ({
    page,
  }) => {
    await page.goto("/");
    const nearMe = page.getByTestId("search-near-me");
    await expect(nearMe).toBeVisible();
    // Un tap sans dates → validation bloque (aucune navigation).
    await nearMe.click();
    await expect(page.getByTestId("search-errors")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/");
  });

  test("« Autour de moi » depuis la barre collante des résultats (raffinement)", async ({
    page,
  }) => {
    await mockHotelSearch(page, {
      hotels: [sampleHotel({ hotelId: "n1", name: "Hôtel Un", distanceKm: 1 })],
    });
    await page.goto(nearbyUrl());
    // La barre collante porte le déclencheur (dates pré-remplies depuis l'URL) → pas d'impasse.
    await expect(page.getByTestId("search-near-me")).toBeVisible();
  });

  test("axe : résultats de proximité sans violation (clair puis sombre)", async ({
    page,
  }) => {
    await mockHotelSearch(page, {
      hotels: [
        sampleHotel({ hotelId: "n1", name: "Premier", distanceKm: 1.1 }),
        sampleHotel({ hotelId: "n2", name: "Second", distanceKm: 2.3 }),
      ],
    });
    await page.goto(nearbyUrl());
    await expect(page.getByTestId("hotel-card").first()).toBeVisible();

    const light = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(light.violations).toEqual([]);

    await page.getByTestId("theme-toggle").click();
    await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);

    const dark = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(dark.violations).toEqual([]);
  });
});

// Refus de géolocalisation (permission NON accordée → getCurrentPosition = PERMISSION_DENIED).
test.describe("Refus de géoloc (repli)", () => {
  test.use({ permissions: [] });

  test("clic « Autour de moi » refusé → message explicatif + repli (pas de blocage)", async ({
    page,
  }) => {
    // Page de résultats proximité : la barre collante a le déclencheur ET les dates pré-remplies
    // (depuis l'URL) → on peut exercer le refus sans piloter le calendrier.
    await mockHotelSearch(page, {
      hotels: [sampleHotel({ hotelId: "x", name: "Hôtel X", distanceKm: 1 })],
    });
    await page.goto(nearbyUrl());
    await expect(page.getByTestId("hotel-card")).toBeVisible();

    await page.getByTestId("search-near-me").click();

    // Message explicatif affiché, et on reste sur la page (repli, aucun blocage).
    await expect(page.getByTestId("geolocation-error")).toBeVisible();
    await expect(page.getByTestId("hotel-card")).toBeVisible();
  });
});
