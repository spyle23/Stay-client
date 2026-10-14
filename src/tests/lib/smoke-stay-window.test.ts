import { describe, expect, it } from "vitest";

import {
  CACHE_TTL_SECONDS,
  CYCLE_SECONDS,
  PAID_FIRST_DAY,
  PAID_SLOT_BAND_DAYS,
  STAY_NIGHTS,
  STAY_SLOTS,
  paidStayOffset,
  uniqueStayOffset,
} from "../../../e2e/smoke/helpers/stay-window";

/**
 * #146 — fenêtres de séjour du smoke de réservation (`e2e/smoke/helpers/stay-window.ts`).
 *
 * Le smoke réserve de vraies chambres (une seule par hôtel dans le jeu de référence), et le BFF
 * met en cache la recherche et la fiche hôtel (45 s et 60 s par défaut). Deux passages qui visent
 * le même séjour dans ce délai voient la chambre « disponible » dans le cache, et le second se fait
 * refuser la réservation (AC-1), ou ouvre une fiche sans chambre.
 */

/** Deux séjours de `STAY_NIGHTS` nuits se chevauchent-ils (règle stricte du PMS) ? */
function overlaps(a: number, b: number): boolean {
  return a < b + STAY_NIGHTS && b < a + STAY_NIGHTS;
}

/** Chevauchements dans une liste de décalages (tri, puis voisins : linéaire). */
function collisions(offsets: Array<{ offset: number; label: string }>) {
  const sorted = [...offsets].sort((x, y) => x.offset - y.offset);
  const found: string[] = [];
  for (let i = 1; i < sorted.length; i++) {
    if (overlaps(sorted[i - 1].offset, sorted[i].offset)) {
      found.push(
        `${sorted[i - 1].label} (J+${sorted[i - 1].offset}) / ${sorted[i].label} (J+${sorted[i].offset})`,
      );
    }
  }
  return found;
}

/** Un instant fixe, au début d'une minute, pour des calculs reproductibles. */
const T0 = Date.UTC(2026, 9, 11, 12, 0, 0);

describe("uniqueStayOffset", () => {
  it("AC-1 : trois passages du même test dans la même minute (--repeat-each 3) obtiennent des séjours disjoints", () => {
    // Un passage du test « divergence » dure environ 6 s.
    const passes = [0, 6_300, 12_600].map((dt) => ({
      offset: uniqueStayOffset(2, T0 + dt),
      label: `+${dt} ms`,
    }));
    expect(collisions(passes)).toEqual([]);
  });

  it("AC-1 : deux smoke-baseline successifs dans la même minute obtiennent des séjours disjoints", () => {
    const passes = [1_000, 59_000].map((dt) => ({
      offset: uniqueStayOffset(2, T0 + dt),
      label: `+${dt} ms`,
    }));
    expect(collisions(passes)).toEqual([]);
  });

  it("sur tout un cycle, aucun séjour ne recoupe un autre, tous scénarios confondus (passages séparés d'au moins 1 s)", () => {
    const all: Array<{ offset: number; label: string }> = [];
    for (let slot = 0; slot < STAY_SLOTS; slot++) {
      for (let s = 0; s < CYCLE_SECONDS; s++) {
        all.push({
          offset: uniqueStayOffset(slot, T0 + s * 1_000 + 999),
          label: `slot ${slot} à ${s} s`,
        });
      }
    }
    expect(collisions(all)).toEqual([]);
  });

  it("une fenêtre ne revient qu'après un cycle, plus long que les caches du BFF", () => {
    expect(CYCLE_SECONDS).toBeGreaterThan(CACHE_TTL_SECONDS);
    expect(uniqueStayOffset(2, T0 + CYCLE_SECONDS * 1_000)).toBe(
      uniqueStayOffset(2, T0),
    );
  });

  it("reste après les séjours fixes des autres specs (J+30 à J+33) et avant la bande payante", () => {
    for (let slot = 0; slot < STAY_SLOTS; slot++) {
      for (let s = 0; s < CYCLE_SECONDS; s++) {
        const offset = uniqueStayOffset(slot, T0 + s * 1_000);
        expect(offset).toBeGreaterThan(33);
        expect(offset + STAY_NIGHTS).toBeLessThanOrEqual(PAID_FIRST_DAY);
      }
    }
  });

  it("refuse un scénario hors des bandes prévues", () => {
    expect(() => uniqueStayOffset(STAY_SLOTS, T0)).toThrow(RangeError);
    expect(() => uniqueStayOffset(-1, T0)).toThrow(RangeError);
    expect(() => uniqueStayOffset(1.5, T0)).toThrow(RangeError);
  });
});

describe("paidStayOffset", () => {
  it("chaque scénario payant a sa bande, disjointe de l'autre et des scénarios non payants", () => {
    const low = (slot: number) => paidStayOffset(slot, () => 0);
    const high = (slot: number) => paidStayOffset(slot, () => 0.999_999);
    expect(low(0)).toBe(PAID_FIRST_DAY);
    expect(high(0) + STAY_NIGHTS).toBeLessThanOrEqual(low(1));
    expect(low(1) - low(0)).toBe(PAID_SLOT_BAND_DAYS);
    // Slot 2 : réconciliation (#5), disjoint du rechargement.
    expect(high(1) + STAY_NIGHTS).toBeLessThanOrEqual(low(2));
  });
});
