import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { API_BASE_URL, ApiClientError } from "@/lib/api-client";
import {
  buildConfirmationUrl,
  CONFIRMATION_DOCUMENT_ENDPOINTS,
  fetchConfirmationPdf,
  fetchConfirmationQr,
} from "@/services/booking.service";
import {
  confirmDebitStatement,
  confirmFailureDebit,
  confirmFailureReason,
  confirmReservation,
  type ConfirmDebitStatus,
  PAYMENT_ENDPOINTS,
  paymentKeys,
  RETRYABLE_CONFIRM_REASONS,
  AUTO_RETRY_CONFIRM_REASONS,
  type ConfirmFailureReason,
} from "@/services/payment.service";

const RESERVATION_ID = "33333333-3333-4333-8333-333333333333";

/**
 * Story 3.2 (C2/C3) — frontière de la confirmation côté navigateur.
 *
 * L'enjeu : chaque échec conduit à la BONNE issue. Proposer « Réessayer » sur un refus déterministe
 * (autorisation expirée, montant divergent) serait un cul-de-sac ; ne pas le proposer sur une
 * capture échouée laisserait le voyageur sans moyen d'obtenir sa preuve.
 */
describe("confirmation — services", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("confirmReservation", () => {
    it("POST /payment/reservations/:id/confirm avec le cookie de session", async () => {
      const proof = { reservationId: RESERVATION_ID };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, data: proof }),
      });

      const result = await confirmReservation(RESERVATION_ID);

      expect(result).toEqual(proof);
      expect(mockFetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/payment/reservations/${RESERVATION_ID}/confirm`,
        expect.objectContaining({ method: "POST", credentials: "include" }),
      );
      expect(PAYMENT_ENDPOINTS.confirm(RESERVATION_ID)).toBe(
        `/payment/reservations/${RESERVATION_ID}/confirm`,
      );
      expect(paymentKeys.confirm(RESERVATION_ID.toUpperCase())).toEqual([
        "payment",
        "confirm",
        RESERVATION_ID,
      ]);
    });
  });

  describe("confirmFailureReason", () => {
    it.each<ConfirmFailureReason>([
      "payment-not-authorized",
      "amount-mismatch",
      "capture-failed",
      "authorisation-expired",
      "reservation-not-found",
      "reservation-cancelled",
      "room-unavailable",
      "not-owner",
      "session-invalid",
      "rejected",
    ])("lit le motif %s dans errors.reason", (reason) => {
      expect(
        confirmFailureReason(
          new ApiClientError("texte d'affichage", 409, { reason: [reason] }),
        ),
      ).toBe(reason);
    });

    it("#183 AC-2 : 503 payment-verification-pending → motif distinct, pas unavailable", () => {
      expect(
        confirmFailureReason(
          new ApiClientError("…", 503, {
            reason: ["payment-verification-pending"],
          }),
        ),
      ).toBe("payment-verification-pending");
    });

    it("503 sans motif → unavailable", () => {
      expect(confirmFailureReason(new ApiClientError("…", 503))).toBe(
        "unavailable",
      );
    });

    it("401 sans motif → session-invalid", () => {
      expect(confirmFailureReason(new ApiClientError("…", 401))).toBe(
        "session-invalid",
      );
    });

    it("motif inconnu, 5xx sans motif ou erreur réseau → unknown, jamais deviné", () => {
      expect(
        confirmFailureReason(new ApiClientError("…", 400, { reason: ["x"] })),
      ).toBe("unknown");
      expect(confirmFailureReason(new ApiClientError("…", 500))).toBe(
        "unknown",
      );
      expect(confirmFailureReason(new TypeError("Failed to fetch"))).toBe(
        "unknown",
      );
    });
  });

  describe("confirmFailureDebit (#4, AC-8)", () => {
    it.each<ConfirmDebitStatus>(["none", "refunded", "captured"])(
      "lit le statut de débit %s dans errors.debit",
      (debit) => {
        expect(
          confirmFailureDebit(
            new ApiClientError("…", 409, {
              reason: ["room-unavailable"],
              debit: [debit],
            }),
          ),
        ).toBe(debit);
      },
    );

    it("absent, inconnu ou hors BFF → null, jamais deviné", () => {
      expect(
        confirmFailureDebit(
          new ApiClientError("…", 409, { reason: ["room-unavailable"] }),
        ),
      ).toBeNull();
      expect(
        confirmFailureDebit(new ApiClientError("…", 409, { debit: ["maybe"] })),
      ).toBeNull();
      expect(confirmFailureDebit(new TypeError("Failed to fetch"))).toBeNull();
    });

    it("room-unavailable n’est jamais rejouable (la réservation est annulée)", () => {
      expect(RETRYABLE_CONFIRM_REASONS.has("room-unavailable")).toBe(false);
    });

    it("lit aussi une autorisation encore posée (held) sur un 503 sans motif", () => {
      expect(
        confirmFailureDebit(new ApiClientError("…", 503, { debit: ["held"] })),
      ).toBe("held");
    });
  });

  /**
   * Revue #4, ronde 1 : l'absence d'information n'est JAMAIS « aucun débit ». Seuls les motifs qui
   * l'établissent par construction (rien n'a été ni ne peut être encaissé) gardent cet énoncé.
   */
  describe("confirmDebitStatement (#4, AC-8)", () => {
    it.each<ConfirmDebitStatus>(["none", "refunded", "captured", "held"])(
      "un statut établi par le BFF (%s) fait foi, quel que soit le motif",
      (debit) => {
        expect(confirmDebitStatement("unavailable", debit)).toBe(debit);
        expect(confirmDebitStatement("room-unavailable", debit)).toBe(debit);
        // #184 AC-1 : « aucun débit » sur ces motifs seulement quand le BFF l'établit.
        expect(confirmDebitStatement("amount-mismatch", debit)).toBe(debit);
        expect(confirmDebitStatement("capture-failed", debit)).toBe(debit);
      },
    );

    it.each<ConfirmFailureReason>([
      "payment-not-authorized",
      "authorisation-expired",
    ])(
      "%s sans statut : « aucun débit », établi par le motif lui-même",
      (reason) => {
        expect(confirmDebitStatement(reason, null)).toBe("none");
      },
    );

    it.each<ConfirmFailureReason>([
      // #184 (constat QA #4) : le PMS ne libère rien sur ces motifs ; `amount-mismatch` peut suivre
      // un encaissement d'un autre montant, `capture-failed` une capture restée `processing`.
      "amount-mismatch",
      "capture-failed",
      "unavailable",
      "unknown",
      "room-unavailable",
      "reservation-cancelled",
      "reservation-not-found",
      "not-owner",
      "session-invalid",
      "rejected",
      // #183 : rien n'est établi tant que la vérification est en cours.
      "payment-verification-pending",
    ])(
      "%s sans statut : débit non établi (unknown), jamais « aucun débit »",
      (reason) => {
        expect(confirmDebitStatement(reason, null)).toBe("unknown");
      },
    );
  });

  describe("AUTO_RETRY_CONFIRM_REASONS (#183)", () => {
    it("rejoue seul les pannes et la vérification en cours, jamais capture-failed", () => {
      expect([...AUTO_RETRY_CONFIRM_REASONS].sort()).toEqual([
        "payment-verification-pending",
        "unavailable",
        "unknown",
      ]);
    });
  });

  describe("RETRYABLE_CONFIRM_REASONS", () => {
    it("ne contient QUE unavailable, unknown, capture-failed et payment-verification-pending", () => {
      expect([...RETRYABLE_CONFIRM_REASONS].sort()).toEqual([
        "capture-failed",
        "payment-verification-pending",
        "unavailable",
        "unknown",
      ]);
    });
  });

  describe("documents", () => {
    it.each([
      ["pdf", fetchConfirmationPdf, "application/pdf"],
      ["qr", fetchConfirmationQr, "image/png"],
    ] as const)(
      "%s : GET au BFF avec le cookie, blob rendu",
      async (kind, fetcher, type) => {
        const blob = new Blob(["x"], { type });
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ "Content-Type": type }),
          blob: () => Promise.resolve(blob),
        });

        const result = await fetcher(RESERVATION_ID);

        expect(result.blob).toBe(blob);
        expect(mockFetch).toHaveBeenCalledWith(
          `${API_BASE_URL}${CONFIRMATION_DOCUMENT_ENDPOINTS[kind](RESERVATION_ID)}`,
          expect.objectContaining({ credentials: "include" }),
        );
      },
    );
  });

  describe("buildConfirmationUrl", () => {
    it("pointe vers la page de confirmation avec l’identifiant", () => {
      expect(buildConfirmationUrl(RESERVATION_ID)).toBe(
        `/booking/confirmation?reservationId=${RESERVATION_ID}`,
      );
    });

    it("conserve le contexte de séjour quand il est connu (sortie vers le récapitulatif)", () => {
      const url = buildConfirmationUrl(RESERVATION_ID, {
        hotelId: "h",
        roomId: "r",
        checkInDate: "2026-09-01",
        checkOutDate: "2026-09-03",
        guests: 2,
        currency: "EUR",
      });

      expect(url.startsWith("/booking/confirmation?reservationId=")).toBe(true);
      expect(url).toContain("checkInDate=2026-09-01");
    });
  });
});
