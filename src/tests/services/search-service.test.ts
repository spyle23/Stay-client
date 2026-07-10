import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchHotelSearch,
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
});
