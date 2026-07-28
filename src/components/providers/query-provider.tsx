"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ApiClientError } from "@/lib/api-client";

/**
 * Politique de rejeu des lectures : **une** tentative supplémentaire sur une panne, **aucune**
 * sur un 4xx.
 *
 * Un 4xx est un refus définitif du BFF (contexte de séjour rejeté, ressource inexistante,
 * paramètre non déclaré) : le rejouer à l'identique ne peut qu'échouer de la même manière, en
 * retardant l'affichage de l'état utile et en consommant des appels PMS pour rien. Seules les
 * pannes (5xx, réseau, timeout) justifient une seconde chance (revue 2.2).
 */
export function shouldRetryRead(failureCount: number, error: unknown): boolean {
  if (
    error instanceof ApiClientError &&
    error.status >= 400 &&
    error.status < 500
  ) {
    return false;
  }
  return failureCount < 1;
}

/**
 * Provider React Query de l'Application Cliente — établi par la story 1.6 (1ᵉʳ consommateur,
 * réutilisé par 1.7/1.8). Un `QueryClient` créé une seule fois par montage (via `useState`)
 * pour ne pas partager le cache entre rendus/requêtes. Convention de clés : `searchKeys`
 * (voir `src/services/search.service.ts`).
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          // Défauts alignés architecture : 1 retry en lecture, aucun en mutation.
          queries: {
            retry: shouldRetryRead,
            staleTime: 30_000,
            refetchOnWindowFocus: false,
          },
          mutations: { retry: 0 },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
