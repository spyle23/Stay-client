import { describe, it, expect } from "vitest";

import { buildHotelSlug, extractHotelId, slugifyName } from "@/lib/hotel-slug";

const GUID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

// Story 1.9 (Décision 1) : slug `{nom-slugifié}-{guid}`, hôtel résolu par le GUID de fin.
describe("hotel-slug", () => {
  it("slugifie un nom (accents, espaces, ponctuation)", () => {
    expect(slugifyName("Hôtel de la Paix")).toBe("hotel-de-la-paix");
    expect(slugifyName("L'Éléphant Bleu !")).toBe("l-elephant-bleu");
    expect(slugifyName("  Grand   Hôtel  ")).toBe("grand-hotel");
  });

  it("construit `{nom}-{guid}` et retombe sur le GUID seul si le nom est vide/absent", () => {
    expect(buildHotelSlug("Hôtel de la Paix", GUID)).toBe(
      `hotel-de-la-paix-${GUID}`,
    );
    expect(buildHotelSlug(null, GUID)).toBe(GUID);
    expect(buildHotelSlug("", GUID)).toBe(GUID);
  });

  it("extrait le GUID de fin (insensible à la casse), sinon null", () => {
    expect(extractHotelId(`hotel-de-la-paix-${GUID}`)).toBe(GUID);
    expect(extractHotelId(GUID)).toBe(GUID);
    expect(extractHotelId(`X-${GUID.toUpperCase()}`)).toBe(GUID); // minusculé
    expect(extractHotelId("aucun-guid-ici")).toBeNull();
    expect(extractHotelId("")).toBeNull();
  });

  it("round-trip : extractHotelId(buildHotelSlug(name, id)) === id", () => {
    const slug = buildHotelSlug("Résidence des 4-Vents", GUID);
    expect(extractHotelId(slug)).toBe(GUID);
  });
});
