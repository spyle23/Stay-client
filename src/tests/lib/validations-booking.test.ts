import { describe, expect, it } from "vitest";

import {
  bookingContextQuery,
  parseBookingParams,
  parseGuid,
} from "@/lib/validations/booking";
import { MAX_STAY_NIGHTS } from "@/lib/validations/search";

const HOTEL_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const ROOM_ID = "22222222-2222-2222-2222-222222222222";

/** Date-only UTC décalée de `days` jours (les dates passées sont rejetées). */
function isoDatePlus(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const validParams = {
  hotelId: HOTEL_ID,
  roomId: ROOM_ID,
  checkInDate: isoDatePlus(30),
  checkOutDate: isoDatePlus(32),
  guests: "2",
  currency: "EUR",
};

/** Retire des query-params (simule une URL incomplète) sans variable inutilisée. */
function omit<T extends Record<string, string>>(
  source: T,
  ...keys: (keyof T)[]
): Record<string, string> {
  const copy: Record<string, string> = { ...source };
  for (const key of keys) {
    delete copy[key as string];
  }
  return copy;
}

describe("parseGuid", () => {
  it("normalise un GUID en minuscules", () => {
    expect(parseGuid(HOTEL_ID.toUpperCase())).toBe(HOTEL_ID);
  });

  it("rejette tout ce qui n’est pas un GUID (l’id est interpolé côté BFF dans un chemin PMS)", () => {
    expect(parseGuid("../Reservations")).toBeNull();
    expect(parseGuid("")).toBeNull();
    expect(parseGuid(undefined)).toBeNull();
    expect(parseGuid(`${HOTEL_ID}x`)).toBeNull();
  });
});

describe("parseBookingParams", () => {
  it("accepte un contexte de tunnel complet", () => {
    const parsed = parseBookingParams(validParams);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.hotelId).toBe(HOTEL_ID);
    expect(parsed.value.roomId).toBe(ROOM_ID);
    expect(parsed.value.guests).toBe(2);
    expect(parsed.value.currency).toBe("EUR");
  });

  it("retombe sur la devise par défaut si celle de l’URL est inconnue", () => {
    const parsed = parseBookingParams({ ...validParams, currency: "XYZ" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.currency).toBe("EUR");
  });

  it("prend 1 voyageur par défaut quand le paramètre est absent", () => {
    const parsed = parseBookingParams(omit(validParams, "guests"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.guests).toBe(1);
  });

  it("refuse un identifiant de chambre ou d’hôtel non-GUID", () => {
    expect(parseBookingParams({ ...validParams, roomId: "abc" })).toMatchObject(
      {
        ok: false,
        errors: ["roomRequired"],
      },
    );
    expect(
      parseBookingParams({ ...validParams, hotelId: "../Hotels" }),
    ).toMatchObject({ ok: false, errors: ["roomRequired"] });
  });

  /** Contrairement à la page hôtel (repli prix/nuit), un devis sans dates n’a aucun sens. */
  it("refuse un tunnel sans dates", () => {
    const parsed = parseBookingParams(
      omit(validParams, "checkInDate", "checkOutDate"),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors).toContain("datesRequired");
  });

  it("refuse une date d’arrivée passée", () => {
    const parsed = parseBookingParams({
      ...validParams,
      checkInDate: isoDatePlus(-2),
      checkOutDate: isoDatePlus(2),
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors).toContain("checkInPast");
  });

  it("refuse un départ antérieur ou égal à l’arrivée", () => {
    const parsed = parseBookingParams({
      ...validParams,
      checkOutDate: validParams.checkInDate,
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors).toContain("checkOutBeforeCheckIn");
  });

  it("refuse un nombre de voyageurs hors bornes (URL éditée à la main)", () => {
    expect(parseBookingParams({ ...validParams, guests: "99" })).toMatchObject({
      ok: false,
    });
    expect(parseBookingParams({ ...validParams, guests: "0" })).toMatchObject({
      ok: false,
    });
  });

  it("prend la première occurrence d’un paramètre répété", () => {
    const parsed = parseBookingParams({
      ...validParams,
      roomId: [ROOM_ID, "autre"],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.roomId).toBe(ROOM_ID);
  });
});

/**
 * Décision de revue 2.2 : la borne de durée est **mirroir** de `BOOKING_MAX_STAY_NIGHTS` côté BFF.
 * La vérifier côté front évite un aller-retour voué au 400, et donne à l'utilisateur la vraie
 * raison — que le code HTTP seul ne porte pas.
 */
describe("parseBookingParams — borne de durée de séjour", () => {
  it("accepte un séjour exactement sur la borne (pas d’off-by-one)", () => {
    const parsed = parseBookingParams({
      ...validParams,
      checkInDate: isoDatePlus(10),
      checkOutDate: isoDatePlus(10 + MAX_STAY_NIGHTS),
    });
    expect(parsed.ok).toBe(true);
  });

  it("rejette un séjour au-delà de la borne, sans appel BFF", () => {
    const parsed = parseBookingParams({
      ...validParams,
      checkInDate: isoDatePlus(10),
      checkOutDate: isoDatePlus(10 + MAX_STAY_NIGHTS + 1),
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors).toContain("stayTooLong");
  });

  it("n’ajoute pas « trop long » à des dates déjà inversées (une seule cause à la fois)", () => {
    const parsed = parseBookingParams({
      ...validParams,
      checkInDate: isoDatePlus(40),
      checkOutDate: isoDatePlus(10),
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors).toContain("checkOutBeforeCheckIn");
    expect(parsed.errors).not.toContain("stayTooLong");
  });
});

describe("bookingContextQuery", () => {
  it("sérialise l’intégralité du contexte (devise comprise — l’URL ne perd rien)", () => {
    const parsed = parseBookingParams(validParams);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const qs = new URLSearchParams(bookingContextQuery(parsed.value));
    expect(qs.get("hotelId")).toBe(HOTEL_ID);
    expect(qs.get("roomId")).toBe(ROOM_ID);
    expect(qs.get("checkInDate")).toBe(validParams.checkInDate);
    expect(qs.get("checkOutDate")).toBe(validParams.checkOutDate);
    expect(qs.get("guests")).toBe("2");
    expect(qs.get("currency")).toBe("EUR");
  });
});
