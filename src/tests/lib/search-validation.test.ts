import { describe, expect, it } from "vitest";

import {
  parseDateOnlyUtc,
  parseSearchParams,
  validateCoords,
  validateSearchInput,
} from "@/lib/validations/search";

describe("validateSearchInput", () => {
  const validFuture = {
    destination: "Antananarivo",
    checkInDate: "2999-01-02",
    checkOutDate: "2999-01-05",
    guests: 2,
  };

  it("accepte une saisie valide (aucune erreur)", () => {
    expect(validateSearchInput(validFuture)).toEqual([]);
  });

  it("rejette une destination vide", () => {
    expect(
      validateSearchInput({ ...validFuture, destination: "  " }),
    ).toContain("destinationRequired");
  });

  it("rejette une arrivée dans le passé", () => {
    expect(
      validateSearchInput({ ...validFuture, checkInDate: "2000-01-01" }),
    ).toContain("checkInPast");
  });

  it("rejette un départ ≤ arrivée", () => {
    expect(
      validateSearchInput({
        ...validFuture,
        checkInDate: "2999-01-05",
        checkOutDate: "2999-01-02",
      }),
    ).toContain("checkOutBeforeCheckIn");
  });

  it("rejette des voyageurs ≤ 0", () => {
    expect(validateSearchInput({ ...validFuture, guests: 0 })).toContain(
      "guestsMin",
    );
  });

  it("rejette un nombre de voyageurs au-dessus du maximum (30)", () => {
    expect(validateSearchInput({ ...validFuture, guests: 99 })).toContain(
      "guestsMax",
    );
  });

  it("rejette des dates manquantes", () => {
    expect(
      validateSearchInput({
        ...validFuture,
        checkInDate: null,
        checkOutDate: null,
      }),
    ).toContain("datesRequired");
  });
});

describe("parseDateOnlyUtc", () => {
  it("parse une date valide", () => {
    expect(parseDateOnlyUtc("2026-08-01")).toBe(Date.UTC(2026, 7, 1));
  });
  it("rejette une date calendaire invalide", () => {
    expect(parseDateOnlyUtc("2026-02-30")).toBeNull();
  });
  it("rejette un format non ISO", () => {
    expect(parseDateOnlyUtc("01/08/2026")).toBeNull();
  });
});

describe("parseSearchParams", () => {
  it("parse et valide des query-params corrects (devise incluse)", () => {
    const result = parseSearchParams({
      destination: "Paris",
      checkInDate: "2999-01-02",
      checkOutDate: "2999-01-04",
      guests: "3",
      currency: "USD",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.guests).toBe(3);
      expect(result.value.currency).toBe("USD");
    }
  });

  it("retombe sur la devise par défaut si absente/invalide", () => {
    const result = parseSearchParams({
      destination: "Paris",
      checkInDate: "2999-01-02",
      checkOutDate: "2999-01-04",
      guests: "2",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.currency).toBe("EUR");
    }
  });

  it("échoue sur une saisie invalide (aucun fetch déclenché en amont)", () => {
    const result = parseSearchParams({
      destination: "",
      guests: "0",
    });
    expect(result.ok).toBe(false);
  });

  it("parse un mode proximité valide (lat/long, sans destination)", () => {
    const result = parseSearchParams({
      mode: "nearby",
      latitude: "-18.9",
      longitude: "47.5",
      checkInDate: "2999-01-02",
      checkOutDate: "2999-01-04",
      guests: "2",
      currency: "EUR",
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.value.mode === "nearby") {
      expect(result.value.latitude).toBe(-18.9);
      expect(result.value.longitude).toBe(47.5);
      expect(result.value.guests).toBe(2);
    }
  });

  it("rejette un mode proximité avec latitude hors bornes", () => {
    const result = parseSearchParams({
      mode: "nearby",
      latitude: "200",
      longitude: "47.5",
      checkInDate: "2999-01-02",
      checkOutDate: "2999-01-04",
      guests: "2",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain("coordsInvalid");
    }
  });

  it("rejette un mode proximité sans coordonnées", () => {
    const result = parseSearchParams({
      mode: "nearby",
      checkInDate: "2999-01-02",
      checkOutDate: "2999-01-04",
      guests: "2",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain("coordsRequired");
    }
  });

  it("rejette une coordonnée vide (Number('')===0 ne doit pas devenir une position valide)", () => {
    const result = parseSearchParams({
      mode: "nearby",
      latitude: "",
      longitude: "",
      checkInDate: "2999-01-02",
      checkOutDate: "2999-01-04",
      guests: "2",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain("coordsRequired");
    }
  });
});

describe("validateCoords", () => {
  it("accepte des coordonnées valides", () => {
    expect(validateCoords(-18.9, 47.5)).toEqual([]);
  });
  it("coordsRequired si non numérique", () => {
    expect(validateCoords(NaN, 47.5)).toEqual(["coordsRequired"]);
  });
  it("coordsInvalid si hors bornes", () => {
    expect(validateCoords(91, 200)).toEqual(["coordsInvalid"]);
  });
});
