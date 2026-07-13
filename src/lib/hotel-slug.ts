// Slug d'URL de la page hôtel (story 1.9, Décision 1). L'architecture place la route en
// `(public)/hotels/[slug]` ; le PMS n'a PAS de champ `slug` (D4 non livré) → l'hôtel est identifié
// par le **GUID en fin de slug**, le texte n'étant que cosmétique (SEO). Forme : `{nom-slugifié}-{guid}`.
// La forme canonique préfixée-ville + redirection 301 est différée (D4 / passe SEO Epic 6).

/** GUID (hex, 8-4-4-4-12) ancré en fin de chaîne — l'identifiant réel de l'hôtel. */
const TRAILING_GUID =
  /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Slugifie un nom d'hôtel : sans accents, minuscules, alphanumérique tiret-séparé. */
export function slugifyName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // diacritiques
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Construit le slug `{nom-slugifié}-{guid}` (repli sur le GUID seul si le nom est vide). */
export function buildHotelSlug(
  name: string | null | undefined,
  id: string,
): string {
  const base = name ? slugifyName(name) : "";
  return base ? `${base}-${id}` : id;
}

/**
 * Extrait le GUID de l'hôtel depuis le slug (le segment est résolu par ce GUID de fin, pas par le
 * texte). Renvoie le GUID **en minuscules**, ou `null` si le slug n'en contient pas (→ 404).
 */
export function extractHotelId(slug: string): string | null {
  const match = TRAILING_GUID.exec(slug);
  return match ? match[1].toLowerCase() : null;
}
