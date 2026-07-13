import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildHotelPageUrl,
  catalogKeys,
  fetchHotelDetail,
} from "@/services/catalog.service";

const HOTEL_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

function mockHotelResponse() {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        success: true,
        data: {
          id: HOTEL_ID,
          name: "Hôtel Test",
          currency: "EUR",
          gallery: [],
          rooms: [{ id: "r1", pricePerNight: 12000 }],
          roomsUnavailable: false,
        },
      }),
  };
}

describe("catalog.service", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("appelle le BFF /catalog/hotels/:id avec dates+voyageurs et désenveloppe data", async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockHotelResponse());
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchHotelDetail(HOTEL_ID, {
      checkInDate: "2999-01-02",
      checkOutDate: "2999-01-04",
      guests: 2,
    });

    expect(result.id).toBe(HOTEL_ID);
    expect(result.rooms).toHaveLength(1);
    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).toContain(`/catalog/hotels/${HOTEL_ID}?`);
    expect(url).toContain("checkInDate=2999-01-02");
    expect(url).toContain("checkOutDate=2999-01-04");
    expect(url).toContain("guests=2");
  });

  it("sans dates : URL sans query-string (repli prix/nuit)", async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockHotelResponse());
    vi.stubGlobal("fetch", mockFetch);

    await fetchHotelDetail(HOTEL_ID);

    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).toContain(`/catalog/hotels/${HOTEL_ID}`);
    expect(url).not.toContain("?");
  });

  it("n'émet aucun param hors liste (garde whitelist BFF)", async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockHotelResponse());
    vi.stubGlobal("fetch", mockFetch);

    await fetchHotelDetail(HOTEL_ID, {
      checkInDate: "2999-01-02",
      checkOutDate: "2999-01-04",
    });

    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).not.toContain("currency=");
    expect(url).not.toContain("mode=");
  });

  /**
   * L'URL navigateur préserve le contexte de recherche — dates, voyageurs **et devise de travail**
   * (AC-2/AC-12) — même si la devise n'est jamais envoyée au BFF (la fiche affiche la devise de l'hôtel).
   */
  it("buildHotelPageUrl préserve dates, voyageurs et devise dans l'URL", () => {
    const url = buildHotelPageUrl(HOTEL_ID, "Hôtel de la Paix", {
      checkInDate: "2999-01-02",
      checkOutDate: "2999-01-04",
      guests: 2,
      currency: "EUR",
    });
    expect(url).toContain(`/hotels/hotel-de-la-paix-${HOTEL_ID}`);
    expect(url).toContain("checkInDate=2999-01-02");
    expect(url).toContain("guests=2");
    expect(url).toContain("currency=EUR");
  });

  it("catalogKeys.hotel porte le préfixe, l'id et les params", () => {
    const params = { checkInDate: "2999-01-02" };
    const key = catalogKeys.hotel(HOTEL_ID, params);
    expect(key[0]).toBe("catalog");
    expect(key[1]).toBe("hotel");
    expect(key[2]).toBe(HOTEL_ID);
    expect(key[3]).toEqual(params);
  });
});
