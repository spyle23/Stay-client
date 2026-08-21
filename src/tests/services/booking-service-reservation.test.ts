import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "@/lib/api-client";
import { formatCurrency } from "@/lib/utils";
import type { ParsedBookingParams } from "@/lib/validations/booking";
import {
  BOOKING_ENDPOINTS,
  buildPaymentUrl,
  createReservation,
  fetchReservation,
  priceChangeFrom,
  reservationFailureReason,
  reservationKeys,
  type BookingReservationResult,
} from "@/services/booking.service";

const HOTEL_ID = "11111111-1111-4111-8111-111111111111";
const ROOM_ID = "22222222-2222-4222-8222-222222222222";
const RESERVATION_ID = "33333333-3333-4333-8333-333333333333";

const params: ParsedBookingParams = {
  hotelId: HOTEL_ID,
  roomId: ROOM_ID,
  checkInDate: "2099-07-05",
  checkOutDate: "2099-07-07",
  guests: 2,
  currency: "EUR",
};

function reservation(
  overrides: Partial<BookingReservationResult> = {},
): BookingReservationResult {
  return {
    reservationId: RESERVATION_ID,
    reservationCode: "RES-20990705-A1B2C",
    status: "Pending",
    hotelId: HOTEL_ID,
    hotelName: "Hôtel Colline",
    roomId: ROOM_ID,
    roomNumber: "204",
    roomCategory: "Double Confort",
    checkInDate: "2099-07-05",
    checkOutDate: "2099-07-07",
    nights: 2,
    guests: 2,
    currency: "EUR",
    pricePerNight: 8400,
    total: 16_800,
    roomTotal: 16_800,
    servicesTotal: 0,
    services: [],
    holdExpiresAt: "2099-07-05T10:15:00.000Z",
    specialRequests: null,
    communicationLocale: null,
    communicationLocaleState: "hotel_default_fallback",
    created: true,
    ...overrides,
  };
}

function mockFetchOnce(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createReservation", () => {
  it("poste exactement les champs déclarés au DTO du BFF", async () => {
    const fetchMock = mockFetchOnce({ success: true, data: reservation() });

    await createReservation(params, { total: 16_800, currency: "EUR" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(BOOKING_ENDPOINTS.reservations);
    expect(init.method).toBe("POST");
    // ⚠️ `forbidNonWhitelisted` côté BFF : tout champ non déclaré ⇒ 400 (bug Phase 3 de 1.7).
    // La devise de travail de l'URL n'est notamment PAS envoyée.
    expect(JSON.parse(init.body as string)).toEqual({
      hotelId: HOTEL_ID,
      roomId: ROOM_ID,
      checkInDate: "2099-07-05",
      checkOutDate: "2099-07-07",
      guests: 2,
      expectedTotal: 16_800,
      expectedCurrency: "EUR",
    });
  });

  it("joint le cookie de session opaque (custody BFF)", async () => {
    const fetchMock = mockFetchOnce({ success: true, data: reservation() });
    await createReservation(params, { total: 16_800, currency: "EUR" });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe("include");
  });

  // --- Préférences (story 2.5, FR-10) ------------------------------------------------------

  it("joint les préférences quand elles sont fournies", async () => {
    const fetchMock = mockFetchOnce({ success: true, data: reservation() });

    await createReservation(
      params,
      { total: 16_800, currency: "EUR" },
      {
        specialRequests: "Arrivée tardive",
        communicationLocale: "en",
        localeTouched: true,
      },
    );

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toMatchObject({
      specialRequests: "Arrivée tardive",
      communicationLocale: "en",
    });
  });

  it("`trim` la demande spéciale avant de l’envoyer", async () => {
    const fetchMock = mockFetchOnce({ success: true, data: reservation() });
    await createReservation(
      params,
      { total: 16_800, currency: "EUR" },
      {
        specialRequests: "  Vue mer  ",
        communicationLocale: "fr",
        localeTouched: true,
      },
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(
      (JSON.parse(init.body as string) as { specialRequests: string })
        .specialRequests,
    ).toBe("Vue mer");
  });

  it("OMET la clé `specialRequests` quand la saisie est vide", async () => {
    // `""` serait persisté tel quel par le PMS : une demande spéciale vide au lieu d'absente.
    const fetchMock = mockFetchOnce({ success: true, data: reservation() });

    await createReservation(
      params,
      { total: 16_800, currency: "EUR" },
      {
        specialRequests: "   ",
        communicationLocale: "fr",
        localeTouched: true,
      },
    );

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).not.toHaveProperty("specialRequests");
    expect(body.communicationLocale).toBe("fr");
  });

  it("n’émet aucune des deux clés sans préférences (rétro-compatible 2.4)", async () => {
    const fetchMock = mockFetchOnce({ success: true, data: reservation() });
    await createReservation(params, { total: 16_800, currency: "EUR" });
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body).not.toHaveProperty("specialRequests");
    expect(body).not.toHaveProperty("communicationLocale");
  });

  it("expose l’état du repli D10 tel que le BFF le pose", async () => {
    mockFetchOnce({
      success: true,
      data: reservation({
        specialRequests: "Lit bébé",
        communicationLocale: "en",
        communicationLocaleState: "hotel_default_fallback",
      }),
    });

    const created = await createReservation(params, {
      total: 16_800,
      currency: "EUR",
    });

    expect(created.specialRequests).toBe("Lit bébé");
    expect(created.communicationLocale).toBe("en");
    expect(created.communicationLocaleState).toBe("hotel_default_fallback");
  });

  it("désenveloppe `ApiResponse<T>`", async () => {
    mockFetchOnce({ success: true, data: reservation() });
    await expect(
      createReservation(params, { total: 16_800, currency: "EUR" }),
    ).resolves.toMatchObject({ reservationId: RESERVATION_ID, created: true });
  });
});

describe("fetchReservation", () => {
  it("lit la réservation par identifiant", async () => {
    const fetchMock = mockFetchOnce({
      success: true,
      data: reservation({ created: false }),
    });

    await expect(fetchReservation(RESERVATION_ID)).resolves.toMatchObject({
      created: false,
    });
    expect(fetchMock.mock.calls[0][0]).toContain(
      `${BOOKING_ENDPOINTS.reservations}/${RESERVATION_ID}`,
    );
  });

  it("encode l'identifiant dans le chemin", async () => {
    const fetchMock = mockFetchOnce({ success: true, data: reservation() });
    await fetchReservation("a/b");
    expect(fetchMock.mock.calls[0][0]).toContain("a%2Fb");
  });
});

describe("reservationFailureReason", () => {
  it("lit le motif machine posé par le BFF dans `errors.reason`", () => {
    const error = new ApiClientError("conflit", 409, {
      reason: ["room-unavailable"],
    });
    expect(reservationFailureReason(error)).toBe("room-unavailable");
  });

  /**
   * `apiRequest` remplace le corps d'un 401 par une erreur générique : aucun motif ne peut y
   * survivre. Le statut est donc la seule source pour ce cas.
   */
  it("déduit `session-invalid` du statut 401, sans corps", () => {
    expect(
      reservationFailureReason(new ApiClientError("Session expirée", 401)),
    ).toBe("session-invalid");
  });

  it("déduit `rate-limited` du statut 429 (le limiteur ne pose aucun code machine)", () => {
    expect(reservationFailureReason(new ApiClientError("trop", 429))).toBe(
      "rate-limited",
    );
  });

  it("déduit `unavailable` du statut 503 (seul cas où réessayer a du sens)", () => {
    expect(reservationFailureReason(new ApiClientError("panne", 503))).toBe(
      "unavailable",
    );
  });

  /**
   * Le contrat du BFF déclare `400 invalid-dates | rejected`, et `booking-errors.ts` y range
   * **tout 4xx PMS non classé**. Tant que `rejected` manquait aux motifs reconnus, il retombait en
   * `unknown` — l'un des deux seuls motifs à recevoir un bouton « Réessayer », alors qu'un refus
   * déterministe ne peut que se reproduire à l'identique.
   */
  it("reconnaît `rejected`, refus déterministe non qualifié du PMS", () => {
    const error = new ApiClientError("refus", 400, { reason: ["rejected"] });
    expect(reservationFailureReason(error)).toBe("rejected");
  });

  it("ne fait jamais confiance à un motif inconnu", () => {
    const error = new ApiClientError("x", 409, { reason: ["quelque-chose"] });
    expect(reservationFailureReason(error)).toBe("unknown");
  });

  it("classe une erreur non-API en `unknown`", () => {
    expect(reservationFailureReason(new Error("réseau"))).toBe("unknown");
  });

  /** Le statut prime sur le corps : le limiteur peut intercaler un motif métier trompeur. */
  it("garde `rate-limited` même si un motif métier accompagne le 429", () => {
    expect(
      reservationFailureReason(
        new ApiClientError("trop", 429, { reason: ["rejected"] }),
      ),
    ).toBe("rate-limited");
  });
});

describe("priceChangeFrom", () => {
  it("extrait le nouveau total et sa devise", () => {
    const error = new ApiClientError("tarif", 409, {
      reason: ["price-changed"],
      total: ["17000"],
      currency: ["EUR"],
    });
    expect(priceChangeFrom(error)).toEqual({ total: 17_000, currency: "EUR" });
  });

  it("renvoie null si le total est absent ou illisible (aucun montant inventé)", () => {
    expect(
      priceChangeFrom(
        new ApiClientError("x", 409, { reason: ["price-changed"] }),
      ),
    ).toBeNull();
    expect(
      priceChangeFrom(
        new ApiClientError("x", 409, { total: ["abc"], currency: ["EUR"] }),
      ),
    ).toBeNull();
  });

  /**
   * Ce que `Number.isFinite` laissait passer. Chaque cas a une conséquence réelle à l'écran :
   * `formatCurrency` **lève** sur un non-entier (`lib/utils.ts`), aucun error boundary ne couvre
   * l'étape de paiement, et `Number("")` vaut `0` — soit « le total est désormais de 0 € », un
   * montant que le BFF n'a jamais annoncé.
   */
  it.each([
    ["non entier", "170.5"],
    ["hors des entiers sûrs", "1e21"],
    ["négatif", "-1"],
    ["chaîne vide", ""],
    ["espaces seuls", "   "],
    ["Infinity", "Infinity"],
  ])("refuse un total %s (`%s`)", (_label, raw) => {
    expect(
      priceChangeFrom(
        new ApiClientError("x", 409, {
          reason: ["price-changed"],
          total: [raw],
          currency: ["EUR"],
        }),
      ),
    ).toBeNull();
  });

  it("refuse une devise absente ou vide (un montant sans devise n'est pas un montant)", () => {
    expect(
      priceChangeFrom(
        new ApiClientError("x", 409, { total: ["17000"], currency: [""] }),
      ),
    ).toBeNull();
    expect(
      priceChangeFrom(new ApiClientError("x", 409, { total: ["17000"] })),
    ).toBeNull();
  });

  it("accepte un total nul explicite (0 annoncé ≠ 0 fabriqué par une coercition)", () => {
    expect(
      priceChangeFrom(
        new ApiClientError("x", 409, { total: ["0"], currency: ["EUR"] }),
      ),
    ).toEqual({ total: 0, currency: "EUR" });
  });

  /** Tout ce que ce chemin renvoie part droit dans `formatCurrency` : il ne doit jamais lever. */
  it("ne renvoie jamais un total que `formatCurrency` refuserait", () => {
    for (const raw of ["17000", "170.5", "1e21", "", "-1", "abc"]) {
      const change = priceChangeFrom(
        new ApiClientError("x", 409, {
          reason: ["price-changed"],
          total: [raw],
          currency: ["EUR"],
        }),
      );
      if (change !== null) {
        expect(() =>
          formatCurrency(change.total, change.currency, "fr"),
        ).not.toThrow();
      }
    }
  });
});

describe("buildPaymentUrl", () => {
  it("conserve le contexte complet du séjour, devise comprise", () => {
    const url = buildPaymentUrl(params);
    expect(url).toContain("hotelId=" + HOTEL_ID);
    expect(url).toContain("checkInDate=2099-07-05");
    expect(url).toContain("currency=EUR");
    expect(url).not.toContain("reservationId");
  });

  it("ajoute `reservationId` après création (c'est lui qui rend la reprise possible)", () => {
    expect(buildPaymentUrl(params, RESERVATION_ID)).toContain(
      `reservationId=${RESERVATION_ID}`,
    );
  });
});

describe("reservationKeys", () => {
  it("isole le cache par réservation", () => {
    expect(reservationKeys.byId("a")).not.toEqual(reservationKeys.byId("b"));
  });
});
