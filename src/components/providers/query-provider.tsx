"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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
            retry: 1,
            staleTime: 30_000,
            refetchOnWindowFocus: false,
          },
          mutations: { retry: 0 },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
