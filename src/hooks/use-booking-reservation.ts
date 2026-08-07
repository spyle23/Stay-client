"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BookingPreferences,
  ParsedBookingParams,
} from "@/lib/validations/booking";
import {
  createReservation,
  fetchReservation,
  reservationKeys,
  type BookingReservationResult,
  type ExpectedPrice,
} from "@/services/booking.service";

/**
 * Période de revalidation de la réservation ouverte à l'écran.
 *
 * Bornée volontairement : un hold réel dure quelques minutes (plafonné à 1 h côté BFF), et l'écran
 * doit apprendre son expiration — ou une annulation en back-office — **avant** de proposer de payer
 * une chambre déjà remise à la vente. Plus court martèlerait le BFF (et donc le PMS partagé) pendant
 * toute la lecture de la page ; plus long laisserait la fenêtre de mensonge ouverte trop longtemps.
 */
const RESERVATION_REVALIDATE_MS = 30_000;

/**
 * Statuts qui peuvent **encore bouger** côté serveur.
 *
 * `Pending` (le balayeur de holds ou une réceptionniste peut la trancher) et `Unknown` (le BFF n'a
 * pas su lire l'état : relire est la seule issue). Une réservation `Cancelled`, `Confirmed`,
 * `CheckedIn`/`CheckedOut` ou `NoShow` est figée pour ce tunnel : continuer à la sonder n'apprendrait
 * plus rien et ferait du bruit sur le PMS.
 */
const MOVING_STATUSES: ReadonlySet<string> = new Set(["Pending", "Unknown"]);

/**
 * Clé de cache d'une réservation, **insensible à la casse du GUID**.
 *
 * La création reçoit l'identifiant tel que le PMS l'a sérialisé, tandis que la relecture part du
 * `reservationId` de l'URL, déjà **mis en minuscules** par `parseGuid` (`lib/validations/booking.ts`).
 * Poser la donnée sous une clé et la lire sous une autre est inoffensif tant que .NET sérialise en
 * minuscules — mais au premier GUID majuscule, le cache serait vide et le panneau qui vient de
 * s'afficher retomberait sur un squelette de chargement. Même classe de dette que la « comparaison
 * de GUID sensible à la casse » différée en story 1.10 : on la referme ici, des deux côtés.
 */
function reservationCacheKey(reservationId: string) {
  return reservationKeys.byId(reservationId.toLowerCase());
}

/**
 * Création et relecture de la Réservation `Pending` (story 2.4 — FR-9 / UX-DR-4.7).
 *
 * La création est **toujours** déclenchée par une action explicite du voyageur : jamais au montage,
 * jamais en effet. Créer à l'affichage transformerait chaque rafraîchissement en `Pending`
 * supplémentaire — donc en chambre gelée — exactement ce que FR-9/NFR-7 cherchent à empêcher.
 */
export function useCreateReservation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      params,
      expected,
      preferences,
    }: {
      params: ParsedBookingParams;
      expected: ExpectedPrice;
      /** Demandes spéciales + langue de communication (story 2.5) — facultatives. */
      preferences?: BookingPreferences;
    }) => createReservation(params, expected, preferences),
    // Aucun rejeu automatique : l'écriture n'est pas idempotente côté PMS et le BFF porte déjà
    // sa propre idempotence. Un retry du client ne ferait qu'ajouter de la contention sur le
    // verrou de séjour — le voyageur, lui, garde la main.
    retry: 0,
    onSuccess: (reservation: BookingReservationResult) => {
      // Le corps de la réponse EST l'état à jour : on le pose directement, ce qui évite un
      // aller-retour et un état « chargement » transitoire juste après la création.
      queryClient.setQueryData(
        reservationCacheKey(reservation.reservationId),
        reservation,
      );
    },
  });
}

/**
 * Relit la réservation portée par l'URL — c'est ce qui rend la reprise possible après un
 * rafraîchissement ou un retour arrière, **sans** jamais recréer.
 *
 * Désactivée tant qu'aucun `reservationId` n'est présent : avant création, il n'y a rien à lire.
 *
 * ⚠️ Cette query est **revalidée**, contrairement à toutes les autres lectures du front. Un
 * `staleTime` ne déclenche aucun refetch par lui-même, `refetchOnWindowFocus` est à `false` pour
 * tout le monde (`query-provider.tsx`) et rien n'invalide cette clé : sans ce qui suit, l'état lu
 * au premier rendu resterait affiché pour toute la durée de la visite. Combiné à un minuteur local
 * ancré sur l'horloge du navigateur, l'écran pourrait proposer de payer une chambre que le balayeur
 * de holds a déjà remise à la vente, ou qu'une réceptionniste vient d'annuler dans le back-office.
 */
export function useBookingReservation(reservationId: string | null) {
  return useQuery({
    queryKey: reservationCacheKey(reservationId ?? ""),
    queryFn: () => fetchReservation(reservationId as string),
    enabled: reservationId !== null,
    // Le statut et l'échéance du hold évoluent côté serveur (balayeur, confirmation) : on ne les
    // garde pas frais indéfiniment, sans pour autant marteler le BFF pendant la saisie.
    staleTime: 15_000,
    // Retour d'onglet : c'est le moment exact où le voyageur revient payer, et celui où l'écart
    // entre l'état affiché et l'état réel est le plus large. Surcharge assumée du défaut global.
    refetchOnWindowFocus: true,
    // Sondage borné, arrêté dès que la réservation est figée ou que la lecture échoue (inutile de
    // marteler un BFF déjà en panne : l'écran d'erreur offre un « Réessayer » explicite).
    refetchInterval: (query) => {
      if (query.state.status === "error") {
        return false;
      }
      const data = query.state.data;
      if (data !== undefined && !MOVING_STATUSES.has(data.status)) {
        return false;
      }
      return RESERVATION_REVALIDATE_MS;
    },
    // Jamais en arrière-plan : un onglet oublié n'a aucune raison de tenir une conversation avec
    // le PMS partagé. Le retour de focus déclenche déjà la relecture qui compte.
    refetchIntervalInBackground: false,
  });
}
