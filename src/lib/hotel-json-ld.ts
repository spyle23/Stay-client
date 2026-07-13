import { minorUnitExponent } from "@/lib/currency";
import type { HotelDetailResult } from "@/services/catalog.service";

/**
 * Données structurées schema.org `Hotel` (NFR-3) — indexabilité + partage de la fiche hôtel.
 * Module isolé de la page pour être **testable** sans dépendances serveur Next.
 */
export function buildJsonLd(hotel: HotelDetailResult): Record<string, unknown> {
  const prices = hotel.rooms
    .map((room) => room.pricePerNight)
    .filter((price) => price > 0);
  const currency = hotel.currency;
  // L'exposant dépend de la devise (MGA/JPY = 0, EUR = 2, KWD = 3) — un ÷100 en dur publierait un
  // `priceRange` faux d'un facteur 100 dans des données structurées **indexées**.
  const toMajor = (minor: number) => minor / 10 ** minorUnitExponent(currency);

  return {
    "@context": "https://schema.org",
    "@type": "Hotel",
    name: hotel.name ?? undefined,
    description: hotel.description ?? undefined,
    image: hotel.gallery.map((image) => image.url),
    address: {
      "@type": "PostalAddress",
      streetAddress: hotel.address ?? undefined,
      addressLocality: hotel.city ?? undefined,
      postalCode: hotel.postalCode ?? undefined,
      addressCountry: hotel.country ?? undefined,
    },
    ...(hotel.latitude !== null && hotel.longitude !== null
      ? {
          geo: {
            "@type": "GeoCoordinates",
            latitude: hotel.latitude,
            longitude: hotel.longitude,
          },
        }
      : {}),
    ...(prices.length > 0
      ? {
          priceRange: `${toMajor(Math.min(...prices))}–${toMajor(
            Math.max(...prices),
          )} ${currency}`,
        }
      : {}),
  };
}

/**
 * Sérialise le JSON-LD pour une injection **sûre** dans un `<script>`.
 *
 * ⚠️ `JSON.stringify` **n'échappe pas `<`** : le nom ou la description d'un hôtel (texte libre saisi
 * au back-office, hors du contrôle de ce code) contenant `</script>` fermerait la balise et le HTML
 * suivant serait **exécuté** — XSS stockée sur une page publique. On échappe donc `<`, ainsi que les
 * séparateurs de ligne U+2028/U+2029 (valides en JSON mais **invalides** en littéral JS).
 */
export function serializeJsonLd(jsonLd: Record<string, unknown>): string {
  return JSON.stringify(jsonLd)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
