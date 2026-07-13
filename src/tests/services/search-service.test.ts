import { afterEach, describe, expect, it, vi } from "vitest";

import {
  baseSearchParams,
  buildResultsUrl,
  fetchHotelSearch,
  hasActiveFilters,
  searchKeys,
  type SearchHotelsParams,
} from "@/services/search.service";

const params: SearchHotelsParams = {
  destination: "Paris",
  checkInDate: "2999-01-02",
  checkOutDate: "2999-01-04",
  guests: 2,
  currency: "EUR",
};

describe("search.service", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("appelle le BFF avec les bons query-params et désenveloppe la liste", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: [{ hotelId: "h1", fromTotalPrice: 24000 }],
          pagination: {
            page: 1,
            pageSize: 12,
            totalCount: 1,
            totalPages: 1,
            hasPreviousPage: false,
            hasNextPage: false,
          },
        }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchHotelSearch(params);

    expect(result.items).toHaveLength(1);
    expect(result.totalCount).toBe(1);
    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).toContain("/search/hotels?");
    expect(url).toContain("destination=Paris");
    expect(url).toContain("checkInDate=2999-01-02");
    expect(url).toContain("guests=2");
    expect(url).toContain("currency=EUR");
    // pageSize par défaut ≥ plafond fan-out → page unique couvrant tous les résultats bornés.
    expect(url).toContain("pageSize=25");
  });

  it("searchKeys.hotels porte le préfixe et les params", () => {
    const key = searchKeys.hotels(params);
    expect(key[0]).toBe("search");
    expect(key[1]).toBe("hotels");
    expect(key[2]).toEqual(params);
  });

  it("mode proximité : route vers /search/hotels/nearby avec lat/long (pas de destination)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: [{ hotelId: "h1", distanceKm: 1.2 }],
          pagination: {
            page: 1,
            pageSize: 25,
            totalCount: 1,
            totalPages: 1,
            hasPreviousPage: false,
            hasNextPage: false,
          },
        }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await fetchHotelSearch({
      mode: "nearby",
      latitude: -18.9,
      longitude: 47.5,
      checkInDate: "2999-01-02",
      checkOutDate: "2999-01-04",
      guests: 2,
      currency: "EUR",
    });

    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).toContain("/search/hotels/nearby?");
    expect(url).toContain("latitude=-18.9");
    expect(url).toContain("longitude=47.5");
    expect(url).not.toContain("destination=");
    // `mode` est un param d'URL FRONT : ne doit PAS être envoyé au BFF (forbidNonWhitelisted → 400).
    expect(url).not.toContain("mode=");
  });

  it("émet les params filtre/tri au BFF (tableaux répétés, sans mode)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: [],
          pagination: {
            page: 1,
            pageSize: 25,
            totalCount: 0,
            totalPages: 0,
            hasPreviousPage: false,
            hasNextPage: false,
          },
        }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await fetchHotelSearch({
      ...params,
      sort: "price_asc",
      minPrice: 15000,
      maxPrice: 40000,
      minCapacity: 4,
      category: ["4-star", "Boutique"],
      amenities: ["WiFi"],
    });

    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).toContain("sort=price_asc");
    expect(url).toContain("minPrice=15000");
    expect(url).toContain("maxPrice=40000");
    expect(url).toContain("minCapacity=4");
    // Tableaux répétés.
    expect(url).toContain("category=4-star");
    expect(url).toContain("category=Boutique");
    expect(url).toContain("amenities=WiFi");
    expect(url).not.toContain("mode=");
  });

  it("buildResultsUrl : URL navigateur reflétant filtres/tri (+ mode=nearby en proximité)", () => {
    const dest = buildResultsUrl({
      ...params,
      sort: "price_desc",
      minPrice: 10000,
      category: ["Boutique"],
    });
    expect(dest).toContain("/search?");
    expect(dest).toContain("destination=Paris");
    expect(dest).toContain("sort=price_desc");
    expect(dest).toContain("minPrice=10000");
    expect(dest).toContain("category=Boutique");
    expect(dest).not.toContain("mode=");

    const nearby = buildResultsUrl({
      mode: "nearby",
      latitude: -18.9,
      longitude: 47.5,
      checkInDate: "2999-01-02",
      checkOutDate: "2999-01-04",
      guests: 2,
      currency: "EUR",
      amenities: ["WiFi"],
    });
    // La page SSR a besoin de `mode=nearby` pour reconstruire la vue proximité au rechargement.
    expect(nearby).toContain("mode=nearby");
    expect(nearby).toContain("amenities=WiFi");
  });

  it("baseSearchParams retire filtres et pagination (source de facettes stable)", () => {
    const stripped = baseSearchParams({
      ...params,
      page: 3,
      sort: "price_asc",
      minPrice: 10000,
      category: ["Boutique"],
      amenities: ["WiFi"],
    });
    expect(stripped).toEqual({
      mode: "destination",
      destination: "Paris",
      checkInDate: "2999-01-02",
      checkOutDate: "2999-01-04",
      guests: 2,
      currency: "EUR",
    });
  });

  it("hasActiveFilters : vrai dès qu'un filtre (hors tri) est actif", () => {
    expect(hasActiveFilters(params)).toBe(false);
    expect(hasActiveFilters({ ...params, sort: "price_asc" })).toBe(false);
    expect(hasActiveFilters({ ...params, minPrice: 10000 })).toBe(true);
    expect(hasActiveFilters({ ...params, category: ["Boutique"] })).toBe(true);
  });
});
