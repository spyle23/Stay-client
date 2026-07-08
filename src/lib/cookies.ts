// Écriture de cookies de préférence UI côté navigateur (langue, devise de
// travail). Isolé dans un module utilitaire : l'écriture `document.cookie` vit
// hors des composants/hooks (règle react-hooks/immutability de Next 16).

/** Durée de vie standard d'une préférence UI persistée (1 an, en secondes). */
export const PREFERENCE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function setBrowserCookie(
  name: string,
  value: string,
  maxAgeSeconds: number = PREFERENCE_COOKIE_MAX_AGE,
): void {
  // Encodage de la valeur : sûr pour les appelants actuels (enums fr/en, EUR/USD)
  // et robuste si un futur appelant passe une valeur contenant `;`, `=` ou espace.
  document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=${maxAgeSeconds};samesite=lax`;
}
