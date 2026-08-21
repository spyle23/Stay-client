import { describe, expect, it } from "vitest";

import { ApiClientError } from "@/lib/api-client";
import {
  PAYMENT_ENDPOINTS,
  paymentFailureReason,
  paymentKeys,
  RETRYABLE_PAYMENT_REASONS,
} from "@/services/payment.service";

/**
 * Story 3.1 — frontière paiement côté navigateur.
 *
 * L'enjeu de ces tests n'est pas la traduction en elle-même : c'est que chaque échec conduise à la
 * BONNE issue à l'écran. Confondre « déjà autorisé » avec « réessayez » proposerait au voyageur de
 * payer une seconde fois.
 */
describe("payment.service", () => {
  describe("paymentFailureReason", () => {
    it("lit le motif machine dans errors.reason, pas dans le message", () => {
      const error = new ApiClientError("Peu importe ce texte", 409, {
        reason: ["already-authorized"],
      });

      expect(paymentFailureReason(error)).toBe("already-authorized");
    });

    it.each([
      "amount-mismatch",
      "currency-unsupported",
      "reservation-not-found",
      "reservation-not-pending",
      "not-owner",
      "session-invalid",
      "rejected",
    ] as const)("reconnaît le motif %s", (reason) => {
      const error = new ApiClientError("…", 400, { reason: [reason] });

      expect(paymentFailureReason(error)).toBe(reason);
    });

    it("classe un 503 sans motif en indisponibilité — le seul cas où réessayer a un sens", () => {
      expect(paymentFailureReason(new ApiClientError("…", 503))).toBe(
        "unavailable",
      );
    });

    it("classe un 401 sans motif en session-invalid", () => {
      expect(paymentFailureReason(new ApiClientError("…", 401))).toBe(
        "session-invalid",
      );
    });

    it("ne devine jamais : un motif inconnu reste unknown", () => {
      const error = new ApiClientError("…", 400, { reason: ["cheese"] });

      expect(paymentFailureReason(error)).toBe("unknown");
    });

    it("traite une erreur non-API comme unknown", () => {
      expect(paymentFailureReason(new Error("réseau coupé"))).toBe("unknown");
      expect(paymentFailureReason(undefined)).toBe("unknown");
    });
  });

  describe("RETRYABLE_PAYMENT_REASONS", () => {
    it("n'offre jamais « Réessayer » sur un refus déterministe", () => {
      // Rejouer à l'identique échouerait toujours : proposer un bouton serait un cul-de-sac
      // (défaut corrigé en story 2.4).
      for (const reason of [
        "already-authorized",
        "amount-mismatch",
        "currency-unsupported",
        "reservation-not-pending",
        "not-owner",
        "session-invalid",
      ] as const) {
        expect(RETRYABLE_PAYMENT_REASONS.has(reason)).toBe(false);
      }
    });

    it("offre « Réessayer » sur une indisponibilité", () => {
      expect(RETRYABLE_PAYMENT_REASONS.has("unavailable")).toBe(true);
    });
  });

  describe("endpoints et clés", () => {
    it("échappe l'identifiant dans le chemin", () => {
      expect(PAYMENT_ENDPOINTS.intent("a b/c")).toBe(
        "/payment/reservations/a%20b%2Fc/intent",
      );
    });

    it("indexe le cache d'intent insensiblement à la casse du GUID", () => {
      // Le GUID vient tantôt du PMS (casse d'origine), tantôt de l'URL (déjà minuscule) — même
      // classe de dette que la clé de réservation refermée en 2.4.
      expect(paymentKeys.intent("AB-CD")).toEqual(paymentKeys.intent("ab-cd"));
    });
  });
});
