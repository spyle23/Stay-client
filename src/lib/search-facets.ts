import type { HotelAvailabilityResult } from "@/services/search.service";
import { normalizeToken } from "@/lib/validations/search";

/**
 * Facettes de filtrage dérivées du jeu de résultats **non filtré** (Décision 3, story 1.8) :
 * options proposées aux contrôles catégorie/équipements + bornes de prix suggérées. Dérivées côté
 * front car le filtrage est fait au BFF (une réponse filtrée ne suffirait pas à peupler les options).
 */
export interface SearchFacets {
  /** Catégories d'hôtel distinctes (formes d'affichage, dé-dupliquées par forme normalisée). */
  categories: string[];
  /** Équipements distincts (union des chambres disponibles). */
  amenities: string[];
  /** Bornes de prix (cents, total du séjour) du jeu non filtré, ou `null` si vide. */
  priceBounds: { min: number; max: number } | null;
}

/** Dé-duplique une liste de libellés par forme normalisée en conservant la 1ʳᵉ forme d'affichage. */
function uniqueByNormalized(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const key = normalizeToken(trimmed);
    if (key.length === 0 || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/** Construit les facettes à partir des résultats non filtrés. */
export function deriveFacets(items: HotelAvailabilityResult[]): SearchFacets {
  const categories = uniqueByNormalized(
    items
      .map((item) => item.category)
      .filter((c): c is string => typeof c === "string" && c.trim().length > 0),
  ).sort((a, b) => a.localeCompare(b));

  const amenities = uniqueByNormalized(
    items.flatMap((item) => item.amenities ?? []),
  ).sort((a, b) => a.localeCompare(b));

  let priceBounds: SearchFacets["priceBounds"] = null;
  if (items.length > 0) {
    const prices = items.map((item) => item.fromTotalPrice);
    priceBounds = { min: Math.min(...prices), max: Math.max(...prices) };
  }

  return { categories, amenities, priceBounds };
}
