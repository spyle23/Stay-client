"use client";

import { useQuery } from "@tanstack/react-query";
import {
  createPaymentIntent,
  paymentKeys,
  type PaymentIntentResult,
} from "@/services/payment.service";

/**
 * Obtention du PaymentIntent de la réservation (story 3.1, FR-12).
 *
 * ## Pourquoi une requête et non une mutation, alors que l'appel est un `POST`
 *
 * L'appel a bien des effets serveur (gel du balayeur, émission d'un PaymentIntent), mais il est
 * **idempotent par construction** : le PMS réutilise l'intent existant de la réservation et refuse
 * d'en créer un second (garde « déjà réglé »). « Obtenir l'intent de cette réservation » est donc
 * une lecture au sens du cache, et c'est ce qui compte ici.
 *
 * Le modèle mutation a été essayé et **abandonné après un défaut trouvé en e2e** : React Query
 * n'appelle les callbacks de `mutate()` que si l'observateur est encore monté, et le double-montage
 * de StrictMode suffisait à ce que la requête parte sur un observateur pendant que l'écran en
 * écoutait un autre — l'utilisateur restait bloqué sur un squelette alors que la réponse était
 * arrivée. Une requête, elle, est **dédoublonnée par sa clé** : deux montages successifs partagent
 * le même appel en vol et le même résultat.
 *
 * Les réglages traduisent la même idée : un intent obtenu reste valable pour toute la durée du
 * tunnel, et rien ne doit le redemander tout seul.
 */
export function usePaymentIntent(reservationId: string | null, enabled = true) {
  return useQuery<PaymentIntentResult>({
    queryKey: paymentKeys.intent(reservationId ?? "none"),
    queryFn: () => createPaymentIntent(reservationId as string),
    enabled: enabled && Boolean(reservationId),

    // Jamais périmé : redemander un intent ferait travailler le PMS et Stripe pour un
    // `clientSecret` que nous détenons déjà et qui reste valide.
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,

    // Aucun rejeu automatique : un refus (« déjà réglé », montant divergent) est déterministe, et
    // une panne doit rendre la main à l'utilisateur plutôt que de marteler le service de paiement.
    retry: false,
  });
}
