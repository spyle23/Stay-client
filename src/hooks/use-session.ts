"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ANONYMOUS_SESSION,
  authKeys,
  fetchSession,
  login,
  logout,
  provisionGuest,
  type GuestCheckoutInput,
  type LoginCredentials,
  type SessionState,
} from "@/services/auth.service";

/**
 * Session côté navigateur (story 2.1). Seule source de vérité de « suis-je connecté ? » côté
 * front : elle interroge le BFF, qui lit son snapshot Redis. Aucun JWT n'est décodé ici (NFR-8).
 *
 * La garde `proxy.ts` ne teste que la **présence** du cookie ; la validité réelle est tranchée
 * par le BFF — donc toute page protégée doit consommer ce hook et réagir à `authenticated:false`.
 */
export function useSession() {
  return useQuery({
    queryKey: authKeys.session,
    queryFn: fetchSession,
    // Court : la session peut expirer/être révoquée côté serveur entre deux navigations.
    staleTime: 30_000,
    // Une panne du BFF ne doit pas boucler ; l'appelant distingue `isError` de « anonyme ».
    retry: 1,
    // Surcharge le défaut global (`false`) : une session déconnectée dans un AUTRE onglet doit
    // être détectée au retour de focus, sinon cet onglet affiche un espace client mort pendant
    // toute la fraîcheur du cache puis boucle sur la garde `proxy.ts`.
    refetchOnWindowFocus: true,
  });
}

/** `true` uniquement si le BFF a confirmé une session (erreur/chargement ⇒ non authentifié). */
export function useIsAuthenticated(): boolean {
  const { data } = useSession();
  return data?.authenticated ?? false;
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (credentials: LoginCredentials) => login(credentials),
    onSuccess: (state: SessionState) => {
      // Le corps de la réponse EST le nouvel état : on évite un aller-retour supplémentaire.
      queryClient.setQueryData(authKeys.session, state);
    },
  });
}

/**
 * Checkout invité (story 2.3 — FR-8). Même contrat que `useLogin` : le BFF renvoie l'état de
 * session, on le pose directement dans le cache — pas d'invalidation (qui déclencherait un
 * aller-retour superflu et pourrait afficher un état « anonyme » transitoire dans le tunnel).
 */
export function useGuestCheckout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: GuestCheckoutInput) => provisionGuest(input),
    onSuccess: (state: SessionState) => {
      queryClient.setQueryData(authKeys.session, state);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => logout(),
    onSuccess: () => {
      // Purge INTÉGRALE du cache : sur un poste partagé (hôtel, borne), le compte suivant ne
      // doit voir aucune donnée du précédent. Les caches du compte (réservations, factures —
      // Epic 4) survivraient à une simple invalidation de la clé de session.
      queryClient.clear();
      // Repose l'état anonyme APRÈS la purge, sinon `clear()` l'effacerait aussitôt.
      queryClient.setQueryData(authKeys.session, ANONYMOUS_SESSION);
    },
  });
}
