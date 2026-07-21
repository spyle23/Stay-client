import { describe, expect, it } from "vitest";

import { serializeJsonLd } from "@/lib/hotel-json-ld";
import { buildRoomJsonLd } from "@/lib/room-json-ld";
import type { RoomDetailResult } from "@/services/catalog.service";

const baseRoom: RoomDetailResult = {
  id: "22222222-2222-2222-2222-222222222222",
  hotelId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  hotelName: "Hôtel de la Paix",
  hotelCity: "Antananarivo",
  number: "101",
  category: "Suite",
  capacity: 2,
  amenities: "Wifi",
  floor: 1,
  description: "Vue sur mer.",
  includedServices: [],
  images: [{ url: "https://img/1.png" }, { url: "https://img/2.png" }],
  pricePerNight: 12000,
  totalPrice: 24000,
  currency: "EUR",
  nights: 2,
  available: true,
  availabilityDegraded: false,
};

describe("buildRoomJsonLd", () => {
  it("émet un HotelRoom avec nom, description, images et occupancy", () => {
    const jsonLd = buildRoomJsonLd(baseRoom);
    expect(jsonLd["@type"]).toBe("HotelRoom");
    expect(jsonLd.name).toBe("Suite");
    expect(jsonLd.description).toBe("Vue sur mer.");
    expect(jsonLd.image).toEqual(["https://img/1.png", "https://img/2.png"]);
    expect(jsonLd.occupancy).toEqual({
      "@type": "QuantitativeValue",
      maxValue: 2,
    });
  });

  it("offre au prix major dérivé de l'exposant réel (EUR ÷100), InStock si disponible", () => {
    const offer = buildRoomJsonLd(baseRoom).offers as Record<string, unknown>;
    expect(offer.price).toBe(120); // 12000 / 10^2
    expect(offer.priceCurrency).toBe("EUR");
    expect(offer.availability).toBe("https://schema.org/InStock");
  });

  it("respecte l'exposant de devise (MGA = ÷1, jamais ÷100 en dur)", () => {
    const offer = buildRoomJsonLd({
      ...baseRoom,
      currency: "MGA",
      pricePerNight: 12000,
    }).offers as Record<string, unknown>;
    expect(offer.price).toBe(12000); // MGA : 0 décimale
  });

  it("marque OutOfStock une chambre indisponible", () => {
    const offer = buildRoomJsonLd({ ...baseRoom, available: false })
      .offers as Record<string, unknown>;
    expect(offer.availability).toBe("https://schema.org/OutOfStock");
  });

  /** Revue : dispo indéterminée (dégradée) → n'asserter AUCUN statut de stock (page indexée). */
  it("n'asserte aucun availability quand la disponibilité est dégradée", () => {
    const offer = buildRoomJsonLd({ ...baseRoom, availabilityDegraded: true })
      .offers as Record<string, unknown>;
    expect(offer.price).toBe(120); // l'offre existe (prix)
    expect(offer.availability).toBeUndefined(); // mais pas de statut de stock
  });

  it("n'émet aucune offre quand le prix est nul", () => {
    const jsonLd = buildRoomJsonLd({ ...baseRoom, pricePerNight: 0 });
    expect(jsonLd.offers).toBeUndefined();
  });

  it("omet occupancy quand la capacité est absente", () => {
    const jsonLd = buildRoomJsonLd({ ...baseRoom, capacity: null });
    expect(jsonLd.occupancy).toBeUndefined();
  });

  /** Anti-XSS : une description avec `</script>` doit être échappée par serializeJsonLd. */
  it("serializeJsonLd échappe une injection </script> depuis une description libre", () => {
    const serialized = serializeJsonLd(
      buildRoomJsonLd({
        ...baseRoom,
        description: "</script><script>alert(1)</script>",
      }),
    );
    expect(serialized).not.toContain("</script>");
    expect(serialized).toContain("\\u003c");
  });
});
