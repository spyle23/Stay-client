import { describe, expect, it } from "vitest";

import { deriveFacets } from "@/lib/search-facets";
import type { HotelAvailabilityResult } from "@/services/search.service";

function hotel(
  overrides: Partial<HotelAvailabilityResult>,
): HotelAvailabilityResult {
  return {
    hotelId: "h",
    name: "H",
    city: "V",
    country: "P",
    category: null,
    currency: "EUR",
    fromPricePerNight: 10000,
    fromTotalPrice: 20000,
    nights: 2,
    availableRoomCount: 1,
    thumbnailUrl: null,
    latitude: null,
    longitude: null,
    distanceKm: null,
    amenities: [],
    ...overrides,
  };
}

describe("deriveFacets", () => {
  it("dérive catégories distinctes (dé-dupliquées par forme normalisée) et triées", () => {
    const facets = deriveFacets([
      hotel({ category: "Boutique" }),
      hotel({ category: "4-star" }),
      hotel({ category: "boutique" }), // doublon normalisé
      hotel({ category: null }),
    ]);
    expect(facets.categories).toEqual(["4-star", "Boutique"]);
  });

  it("dérive l'union des équipements (dé-dupliquée)", () => {
    const facets = deriveFacets([
      hotel({ amenities: ["WiFi", "Parking"] }),
      hotel({ amenities: ["wifi", "Piscine"] }),
    ]);
    expect(facets.amenities).toEqual(["Parking", "Piscine", "WiFi"]);
  });

  it("dérive les bornes de prix (total du séjour), null si vide", () => {
    const facets = deriveFacets([
      hotel({ fromTotalPrice: 8000 }),
      hotel({ fromTotalPrice: 30000 }),
    ]);
    expect(facets.priceBounds).toEqual({ min: 8000, max: 30000 });
    expect(deriveFacets([]).priceBounds).toBeNull();
  });
});
