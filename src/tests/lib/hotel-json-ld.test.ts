import { describe, expect, it } from "vitest";

import { buildJsonLd, serializeJsonLd } from "@/lib/hotel-json-ld";
import type { HotelDetailResult } from "@/services/catalog.service";

function hotel(overrides: Partial<HotelDetailResult> = {}): HotelDetailResult {
  return {
    id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    name: "Hôtel de la Paix",
    category: "4-star",
    description: "Au cœur de la ville.",
    address: "1 rue de la Paix",
    city: "Antananarivo",
    country: "Madagascar",
    postalCode: "101",
    latitude: -18.9,
    longitude: 47.5,
    phone: null,
    email: null,
    currency: "EUR",
    locale: "fr-FR",
    logoUrl: null,
    roomCount: 1,
    gallery: [],
    rooms: [],
    stayNights: null,
    roomsUnavailable: false,
    ...overrides,
  };
}

describe("hotel JSON-LD", () => {
  it("produit un schema.org Hotel avec adresse et géolocalisation", () => {
    const jsonLd = buildJsonLd(hotel());
    expect(jsonLd["@type"]).toBe("Hotel");
    expect(jsonLd.name).toBe("Hôtel de la Paix");
    expect(jsonLd.address).toMatchObject({
      "@type": "PostalAddress",
      addressLocality: "Antananarivo",
    });
    expect(jsonLd.geo).toMatchObject({ latitude: -18.9, longitude: 47.5 });
  });

  it("omet la géolocalisation quand les coordonnées sont absentes", () => {
    const jsonLd = buildJsonLd(hotel({ latitude: null, longitude: null }));
    expect(jsonLd.geo).toBeUndefined();
  });

  /** `priceRange` doit utiliser l'exposant RÉEL de la devise (MGA = 0 décimale). */
  it("calcule priceRange selon l'exposant de la devise (pas un ÷100 en dur)", () => {
    const rooms = [
      {
        id: "r1",
        hotelId: "h",
        number: null,
        category: null,
        capacity: 2,
        amenities: null,
        floor: null,
        pricePerNight: 12000,
        totalPrice: null,
        currency: "MGA",
        nights: null,
      },
    ];
    const jsonLd = buildJsonLd(hotel({ currency: "MGA", rooms }));
    // 12000 unités mineures MGA = 12000 ariary (exposant 0) — surtout pas 120.
    expect(jsonLd.priceRange).toBe("12000–12000 MGA");

    const eur = buildJsonLd(
      hotel({
        currency: "EUR",
        rooms: [{ ...rooms[0], currency: "EUR" }],
      }),
    );
    expect(eur.priceRange).toBe("120–120 EUR");
  });
});

describe("serializeJsonLd (injection sûre)", () => {
  /**
   * `JSON.stringify` n'échappe PAS `<` : une description contenant `</script>` sortirait du bloc
   * JSON-LD et le HTML suivant serait exécuté (XSS stockée sur une page publique).
   */
  it("échappe « < » pour empêcher une sortie du <script> (XSS stockée)", () => {
    const payload = hotel({
      description: "</script><img src=x onerror=alert(1)>",
    });
    const html = serializeJsonLd(buildJsonLd(payload));

    expect(html).not.toContain("</script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("\\u003c");
    // Le contenu reste du JSON valide et fidèle une fois désérialisé.
    const parsed = JSON.parse(html) as { description: string };
    expect(parsed.description).toBe("</script><img src=x onerror=alert(1)>");
  });

  it("échappe les séparateurs de ligne U+2028/U+2029 (invalides en littéral JS)", () => {
    const LS = String.fromCharCode(0x2028);
    const PS = String.fromCharCode(0x2029);
    const html = serializeJsonLd(
      buildJsonLd(hotel({ description: `a${LS}b${PS}c` })),
    );
    expect(html).not.toContain(LS);
    expect(html).not.toContain(PS);
    expect(html).toContain("\\u2028");
    expect(html).toContain("\\u2029");
  });
});
