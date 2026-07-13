"use client";

import { useMemo } from "react";

import { useHotelSearch } from "@/hooks/use-hotel-search";
import { deriveFacets, type SearchFacets } from "@/lib/search-facets";
import {
  baseSearchParams,
  type SearchHotelsParams,
} from "@/services/search.service";

/**
 * Facettes de filtrage (catégories, équipements, bornes de prix) dérivées du jeu **non filtré**
 * du contexte de recherche courant (story 1.8, Décision 3). Réutilise `useHotelSearch` avec des
 * params **sans filtres** : quand aucun filtre n'est actif, la clé coïncide avec celle de la vue
 * affichée (une seule requête) ; sinon la facette est mise en cache et ne rétrécit pas quand un
 * filtre est appliqué. Fonctionne au rechargement d'une URL filtrée (l'ensemble non filtré est
 * re-fetché).
 */
export function useSearchFacets(params: SearchHotelsParams): SearchFacets {
  const base = useMemo(() => baseSearchParams(params), [params]);
  const query = useHotelSearch(base);
  return useMemo(() => deriveFacets(query.data?.items ?? []), [query.data]);
}
