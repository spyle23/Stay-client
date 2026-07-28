import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "@/lib/api-client";
import type { ParsedBookingParams } from "@/lib/validations/booking";
import {
  BOOKING_ENDPOINTS,
  bookingKeys,
  buildIdentifyUrl,
  buildRecapUrl,
  fetchBookingQuote,
} from "@/services/booking.service";

const HOTEL_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const ROOM_ID = "22222222-2222-2222-2222-222222222222";

const params: ParsedBookingParams = {
  hotelId: HOTEL_ID,
  roomId: ROOM_ID,
  checkInDate: "2999-01-02",
  checkOutDate: "2999-01-04",
  guests: 2,
  currency: "EUR",
};

const QUOTE = {
  hotelId: HOTEL_ID,
  roomId: ROOM_ID,
  nights: 2,
  currency: "EUR",
  pricePerNight: 8400,
  roomTotal: 16800,
  total: 16800,
  taxAmount: null,
  taxState: "included_undetailed",
  available: true,
  availabilityDegraded: false,
  cancellationPolicy: {
    source: "fallback",
    refundable: null,
    freeUntil: null,
    terms: null,
  },
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

describe("booking.service", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("cible le BFF sur un chemin relatif (jamais le PMS)", () => {
    // `API_BASE_URL` porte déjà `/api/v1` : un chemin absolu PMS serait une fuite de frontière.
    expect(BOOKING_ENDPOINTS.quote).toBe("/booking/quote");
    expect(BOOKING_ENDPOINTS.quote).not.toContain("/api/v1");
  });

  it("désenveloppe ApiResponse et envoie le cookie de session (credentials: include)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: QUOTE }));
    vi.stubGlobal("fetch", fetchMock);

    const quote = await fetchBookingQuote(params);

    expect(quote.total).toBe(16800);
    expect(quote.cancellationPolicy.source).toBe("fallback");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe("include");
  });

  /**
   * Le `ValidationPipe` global du BFF a `forbidNonWhitelisted` : tout paramètre non déclaré au
   * DTO produit un 400 (bug Phase 3 de la story 1.7). La devise de travail reste dans l'URL
   * navigateur mais ne doit JAMAIS partir vers le BFF.
   */
  it("n’émet que les cinq paramètres déclarés au DTO du BFF (pas de devise)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: QUOTE }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchBookingQuote(params);

    const [url] = fetchMock.mock.calls[0] as [string];
    const query = new URLSearchParams(url.split("?")[1]);
    expect([...query.keys()].sort()).toEqual([
      "checkInDate",
      "checkOutDate",
      "guests",
      "hotelId",
      "roomId",
    ]);
    expect(query.get("guests")).toBe("2");
    expect(query.has("currency")).toBe(false);
  });

  it("propage une ApiClientError typée (404 chambre introuvable)", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { success: false, message: "Chambre introuvable." },
            404,
          ),
        ),
    );

    await expect(fetchBookingQuote(params)).rejects.toBeInstanceOf(
      ApiClientError,
    );
  });

  it("bookingKeys.quote porte le préfixe, les ids et tout le contexte de séjour", () => {
    const key = bookingKeys.quote(params);
    expect(key[0]).toBe("booking");
    expect(key[1]).toBe("quote");
    expect(key).toContain(HOTEL_ID);
    expect(key).toContain(ROOM_ID);
    expect(key).toContain("2999-01-02");
    expect(key).toContain(2);
  });

  it("construit les URLs d’étapes en conservant l’intégralité du contexte", () => {
    for (const url of [buildRecapUrl(params), buildIdentifyUrl(params)]) {
      const query = new URLSearchParams(url.split("?")[1]);
      expect(query.get("hotelId")).toBe(HOTEL_ID);
      expect(query.get("roomId")).toBe(ROOM_ID);
      expect(query.get("checkInDate")).toBe("2999-01-02");
      expect(query.get("checkOutDate")).toBe("2999-01-04");
      expect(query.get("guests")).toBe("2");
      expect(query.get("currency")).toBe("EUR");
    }
    expect(buildRecapUrl(params).startsWith("/booking/recap?")).toBe(true);
    expect(buildIdentifyUrl(params).startsWith("/booking/identify?")).toBe(
      true,
    );
  });
});
