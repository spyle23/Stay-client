import type { Page, Route } from "@playwright/test";

/**
 * Helper d'interception réseau pour les e2e **isolés** (Story 1.6 — 1ᵉʳ parcours câblé côté
 * client). Le front appelle le BFF (`/api/v1/search/hotels`) côté navigateur : `page.route`
 * intercepte cet appel et renvoie une réponse contrôlée, sans BFF/PMS réel.
 */
export interface MockHotel {
  hotelId: string;
  name: string | null;
  city: string | null;
  country: string | null;
  category: string | null;
  currency: string;
  fromPricePerNight: number;
  fromTotalPrice: number;
  nights: number;
  availableRoomCount: number;
  thumbnailUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  distanceKm: number | null;
}

export function sampleHotel(overrides: Partial<MockHotel> = {}): MockHotel {
  return {
    hotelId: "h1",
    name: "Hôtel Échantillon",
    city: "Antananarivo",
    country: "Madagascar",
    category: "4-star",
    currency: "EUR",
    fromPricePerNight: 12000,
    fromTotalPrice: 36000,
    nights: 3,
    availableRoomCount: 2,
    thumbnailUrl: null,
    latitude: null,
    longitude: null,
    distanceKm: null,
    ...overrides,
  };
}

export interface MockSearchOptions {
  hotels?: MockHotel[];
  status?: number;
  body?: unknown;
}

const SEARCH_ROUTE = "**/api/v1/search/hotels**";

export async function mockHotelSearch(
  page: Page,
  options: MockSearchOptions = {},
): Promise<void> {
  await page.route(SEARCH_ROUTE, async (route: Route) => {
    if (options.status && options.status >= 400) {
      await route.fulfill({
        status: options.status,
        contentType: "application/json",
        body: JSON.stringify(
          options.body ?? { success: false, message: "Erreur" },
        ),
      });
      return;
    }
    const hotels = options.hotels ?? [];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: hotels,
        pagination: {
          page: 1,
          pageSize: 12,
          totalCount: hotels.length,
          totalPages: 1,
          hasPreviousPage: false,
          hasNextPage: false,
        },
      }),
    });
  });
}
