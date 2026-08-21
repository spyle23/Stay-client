"use client";

import { useQuery } from "@tanstack/react-query";
import {
  fetchUpsellServices,
  upsellKeys,
  type UpsellCatalogResult,
} from "@/services/booking.service";
import type { ParsedBookingParams } from "@/lib/validations/booking";

/**
 * Fraîcheur du catalogue d'upsell.
 *
 * Un catalogue de services bouge à l'échelle de la journée (l'hôtelier active/désactive une
 * prestation), pas de la seconde. Le tenir 5 min évite de re-solliciter le PMS partagé à chaque
 * re-rendu de l'étape paiement, sans jamais faire vieillir l'information au point de proposer une
 * prestation retirée : le refus faisant foi vient de toute façon de la création (le BFF re-tarife
 * le panier au catalogue serveur).
 */
const UPSELL_STALE_MS = 300_000;

/**
 * Catalogue d'upsell du séjour (story 2.6, FR-11).
 *
 * ⚠️ **Aucun `retry` automatique.** Une panne du catalogue est déjà traduite par le BFF en réponse
 * *dégradée* (`degraded: true`, liste vide) et non en erreur : l'écran tait la section et le tunnel
 * reste ouvert. Retenter en boucle ferait porter à un PMS déjà en difficulté la charge d'une
 * section purement optionnelle.
 */
export function useUpsellServices(params: ParsedBookingParams | null) {
  return useQuery<UpsellCatalogResult>({
    queryKey: params === null ? upsellKeys.all : upsellKeys.forStay(params),
    queryFn: () => fetchUpsellServices(params as ParsedBookingParams),
    enabled: params !== null,
    staleTime: UPSELL_STALE_MS,
    retry: 0,
  });
}
