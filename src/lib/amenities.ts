/** Nombre max d'équipements affichés sur une surface (carte ou fiche). */
const MAX_AMENITIES = 6;

/**
 * Équipements de chambre (texte libre CSV du PMS) → tokens nettoyés et **dé-dupliqués**.
 *
 * ⚠️ On ne scinde **pas** sur `/` : « 24/7 room service » deviendrait deux badges « 24 » et
 * « 7 room service ». La dé-duplication évite en outre des clés React en collision sur un CSV
 * comportant un doublon (« Wifi, Wifi »).
 *
 * ⚠️ Ce module est **volontairement neutre** (pas de `"use client"`) : il est consommé par la
 * `RoomCard` (composant **client**) ET par la fiche `RoomDetail` (composant **serveur**). Défini
 * dans un module `"use client"`, il deviendrait une référence client que le serveur **ne peut pas
 * invoquer** (« Attempted to call parseAmenities() from the server »).
 */
export function parseAmenities(raw: string | null): string[] {
  if (!raw) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,;]/)) {
    const token = part.trim();
    if (token.length === 0) {
      continue;
    }
    const key = token.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(token);
    if (out.length === MAX_AMENITIES) {
      break;
    }
  }
  return out;
}
