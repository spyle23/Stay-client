import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const annotations: { type: string; description?: string }[] = [];
const timeouts: number[] = [];

vi.mock("@playwright/test", () => ({
  test: {
    info: () => ({
      timeout: 30_000,
      setTimeout: (ms: number) => timeouts.push(ms),
      annotations,
    }),
  },
}));

import {
  awaitGuestQuota,
  delayBeforeNextSubmission,
  recentSubmissions,
  resolveGuestQuota,
} from "../../../e2e/smoke/helpers/guest-quota";

/**
 * Cadence des provisionnements d'invité du smoke (#148) : sous le seuil du BFF (10 par minute et
 * par IP), comptée entre specs et passages ; on attend avant de soumettre, jamais de rejeu.
 */
const QUOTA = { limit: 3, windowMs: 60_000 };

describe("resolveGuestQuota", () => {
  it("8 par 61 s par défaut, sous le seuil du BFF (10 par 60 s)", () => {
    expect(resolveGuestQuota({})).toEqual({ limit: 8, windowMs: 61_000 });
  });

  it("surcharge par l'environnement, valeurs invalides ignorées", () => {
    expect(
      resolveGuestQuota({
        SMOKE_GUEST_LIMIT: "4",
        SMOKE_GUEST_WINDOW_MS: "1000",
      }),
    ).toEqual({ limit: 4, windowMs: 1000 });
    expect(
      resolveGuestQuota({ SMOKE_GUEST_LIMIT: "0", SMOKE_GUEST_WINDOW_MS: "x" }),
    ).toEqual({ limit: 8, windowMs: 61_000 });
  });
});

describe("delayBeforeNextSubmission", () => {
  it("aucune attente sous le quota", () => {
    expect(delayBeforeNextSubmission([], 100_000, QUOTA)).toBe(0);
    expect(delayBeforeNextSubmission([90_000, 95_000], 100_000, QUOTA)).toBe(0);
  });

  it("quota atteint : attend que le plus ancien sorte de la fenêtre", () => {
    // 3 soumissions à 50 s, 60 s, 70 s ; à 100 s, la plus ancienne sort à 110 s.
    expect(
      delayBeforeNextSubmission([60_000, 50_000, 70_000], 100_000, QUOTA),
    ).toBe(10_000);
  });

  it("les soumissions sorties de la fenêtre ne comptent plus", () => {
    expect(
      delayBeforeNextSubmission([10_000, 20_000, 95_000], 100_000, QUOTA),
    ).toBe(0);
    expect(recentSubmissions([10_000, 95_000, 40_001], 100_000, QUOTA)).toEqual(
      [40_001, 95_000],
    );
  });
});

describe("awaitGuestQuota", () => {
  it("enregistre chaque soumission dans un état propre à l'URL du front", async () => {
    const env = {
      SMOKE_WEB_URL: `http://localhost:${Date.now() % 50_000}-${mkdtempSync(join(tmpdir(), "q-"))}`,
      SMOKE_GUEST_LIMIT: "2",
      SMOKE_GUEST_WINDOW_MS: "60000",
    };
    expect(await awaitGuestQuota(env)).toBe(0);
    expect(await awaitGuestQuota(env)).toBe(0);
    expect(timeouts).toEqual([]);
    expect(annotations).toEqual([]);
  });

  it("au-delà du quota, attend en prolongeant le délai du test et le signale", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    try {
      const env = {
        SMOKE_WEB_URL: `http://localhost:1/${Math.random()}`,
        SMOKE_GUEST_LIMIT: "1",
        SMOKE_GUEST_WINDOW_MS: "5000",
      };
      await awaitGuestQuota(env);
      let done = false;
      const second = awaitGuestQuota(env).then((waited) => {
        done = true;
        return waited;
      });
      await vi.advanceTimersByTimeAsync(4_000);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1_100);
      expect(await second).toBe(5_000);
      expect(timeouts).toEqual([35_000]);
      expect(annotations[0].type).toBe("guest-quota");
    } finally {
      vi.useRealTimers();
    }
  });
});
