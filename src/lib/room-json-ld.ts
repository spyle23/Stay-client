import { minorUnitExponent } from "@/lib/currency";
import type { RoomDetailResult } from "@/services/catalog.service";

/**
 * Données structurées schema.org `HotelRoom` (NFR-3) — indexabilité + partage de la fiche chambre.
 * Module isolé de la page pour être **testable** sans dépendances serveur Next.
 *
 * ⚠️ Le rendu passe **obligatoirement** par `serializeJsonLd` (cf. `lib/hotel-json-ld.ts`) qui
 * échappe `<` et U+2028/9 : un `</script>` dans une description de chambre (texte libre back-office)
 * fermerait sinon la balise → XSS stockée sur une page publique.
 */
export function buildRoomJsonLd(
  room: RoomDetailResult,
): Record<string, unknown> {
  const currency = room.currency;
  // L'exposant dépend de la devise (MGA/JPY = 0, EUR = 2, KWD = 3) — un ÷100 en dur publierait un
  // prix faux d'un facteur 100 dans des données structurées **indexées**.
  const toMajor = (minor: number) => minor / 10 ** minorUnitExponent(currency);

  return {
    "@context": "https://schema.org",
    "@type": "HotelRoom",
    name: room.category ?? undefined,
    description: room.description ?? undefined,
    image: room.images.map((image) => image.url),
    ...(room.capacity !== null
      ? {
          occupancy: {
            "@type": "QuantitativeValue",
            maxValue: room.capacity,
          },
        }
      : {}),
    ...(room.pricePerNight > 0
      ? {
          offers: {
            "@type": "Offer",
            price: toMajor(room.pricePerNight),
            priceCurrency: currency,
            // Dispo **indéterminée** (panne du cross-check daté) → n'asserter AUCUN statut de stock :
            // publier InStock/OutOfStock depuis une donnée dégradée mentirait aux moteurs (page indexée).
            ...(room.availabilityDegraded
              ? {}
              : {
                  availability: room.available
                    ? "https://schema.org/InStock"
                    : "https://schema.org/OutOfStock",
                }),
          },
        }
      : {}),
  };
}
