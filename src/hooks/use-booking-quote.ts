"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ParsedBookingParams } from "@/lib/validations/booking";
import { bookingKeys, fetchBookingQuote } from "@/services/booking.service";

/**
 * Hook du devis de réservation (story 2.2, FR-7). Le fetch s'exécute côté navigateur
 * → interceptable en e2e isolé (`page.route`) et re-jouable à chaque modification de dates
 * ou de voyageurs (AC-2). La page récapitulatif reste un Server Component (coquille SSR).
 *
 * `placeholderData: keepPreviousData` : lors d'un recalcul (nouvelle clé de query), le
 * récapitulatif précédent reste affiché — l'état « recalcul en cours » est signalé par
 * `isPlaceholderData` plutôt que par un écran vide (UX-DR-7.5 : jamais de blocage total).
 * L'appelant neutralise le CTA le temps du recalcul : le devis affiché décrit alors le séjour
 * *précédent*, alors que l'URL porte déjà le nouveau.
 *
 * La disponibilité est re-composée par le BFF à chaque devis, mais elle peut provenir de son
 * cache `catalog` (TTL court, Décision 2 de la story) : l'écran ne prétend donc pas à une
 * fraîcheur à la seconde — la vérité définitive est la création atomique de la story 2.4.
 *
 * ⚠️ La garde d'URL invalide ne vit **pas** ici : le Server Component `(tunnel)/booking/recap`
 * ne monte l'île cliente que si `parseBookingParams` a réussi, et `ParsedBookingParams` rend un
 * appel invalide inexprimable. Aucun `enabled` n'est donc nécessaire — l'invariant « aucun appel
 * BFF sur URL invalide » (AC-8) est prouvé de bout en bout par l'e2e `booking-recap.spec.ts`.
 */
export function useBookingQuote(params: ParsedBookingParams) {
  return useQuery({
    queryKey: bookingKeys.quote(params),
    queryFn: () => fetchBookingQuote(params),
    placeholderData: keepPreviousData,
    // Le prix et la disponibilité sont des données « à la porte du paiement » : on ne les garde
    // pas fraîches indéfiniment côté client (le BFF, lui, a son propre cache court).
    staleTime: 30_000,
    // Pas de `retry` ici : la règle « ne jamais rejouer un 4xx » est portée par `QueryProvider`
    // pour **toutes** les lectures (un refus de saisie n'est pas plus rejouable ailleurs), et la
    // poser au niveau de la query écraserait le `retry: false` des harnais de test.
  });
}
