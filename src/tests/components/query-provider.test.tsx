import { describe, expect, it } from "vitest";

import { shouldRetryRead } from "@/components/providers/query-provider";
import { ApiClientError } from "@/lib/api-client";

/**
 * Politique de rejeu des lectures (revue 2.2).
 *
 * Le défaut historique (`retry: 1`, aveugle au statut) rejouait un refus définitif : un 404 sur
 * une chambre supprimée, ou un 400 sur un séjour hors bornes, repartait une seconde fois pour
 * échouer à l'identique — en retardant l'affichage de l'état utile et en consommant des appels
 * PMS. Seules les pannes méritent une seconde chance.
 */
describe("shouldRetryRead", () => {
  it("ne rejoue jamais un refus définitif du BFF (4xx)", () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(shouldRetryRead(0, new ApiClientError("nope", status))).toBe(
        false,
      );
    }
  });

  it("offre une seconde chance à une panne (5xx), puis abandonne", () => {
    const error = new ApiClientError("panne", 503);
    expect(shouldRetryRead(0, error)).toBe(true);
    expect(shouldRetryRead(1, error)).toBe(false);
  });

  it("offre une seconde chance à une coupure réseau (erreur non typée)", () => {
    expect(shouldRetryRead(0, new TypeError("Failed to fetch"))).toBe(true);
    expect(shouldRetryRead(1, new TypeError("Failed to fetch"))).toBe(false);
  });
});
