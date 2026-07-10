"use client";

import { useQuery } from "@tanstack/react-query";
import {
  fetchHotelSearch,
  searchKeys,
  type SearchHotelsParams,
} from "@/services/search.service";

/**
 * Hook de recherche multi-hôtels (React Query). Le fetch s'exécute côté navigateur
 * → interceptable en e2e isolé (`page.route`), et affiche des skeletons pendant le
 * chargement (AC-4). La page de résultats reste un Server Component (coquille SSR).
 */
export function useHotelSearch(params: SearchHotelsParams) {
  return useQuery({
    queryKey: searchKeys.hotels(params),
    queryFn: () => fetchHotelSearch(params),
  });
}
