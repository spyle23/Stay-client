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
  BFF_RESET_MARGIN_MS,
  delayBeforeNextSubmission,
  delayFromBffQuota,
  parseBffQuota,
  recentSubmissions,
  recordBffQuota,
  resolveGuestQuota,
  submitGuestForm,
} from "../../../e2e/smoke/helpers/guest-quota";

/**
 * Cadence des provisionnements d'invité du smoke (#148) : sous le seuil du BFF (10 par minute et
 * par IP), comptée entre specs et passages ; on attend avant de soumettre, jamais de rejeu.
 */
const QUOTA = { limit: 3, windowMs: 60_000, spare: 1 };

describe("resolveGuestQuota", () => {
  it("8 par 61 s par défaut, sous le seuil du BFF (10 par 60 s), 1 place de réserve", () => {
    expect(resolveGuestQuota({})).toEqual({
      limit: 8,
      windowMs: 61_000,
      spare: 1,
    });
  });

  it("surcharge par l'environnement, valeurs invalides ignorées", () => {
    expect(
      resolveGuestQuota({
        SMOKE_GUEST_LIMIT: "4",
        SMOKE_GUEST_WINDOW_MS: "1000",
        SMOKE_GUEST_SPARE: "0",
      }),
    ).toEqual({ limit: 4, windowMs: 1000, spare: 0 });
    expect(
      resolveGuestQuota({
        SMOKE_GUEST_LIMIT: "0",
        SMOKE_GUEST_WINDOW_MS: "x",
        SMOKE_GUEST_SPARE: "-1",
      }),
    ).toEqual({ limit: 8, windowMs: 61_000, spare: 1 });
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
      SMOKE_BFF_URL: `http://localhost:2/${Math.random()}`,
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
        SMOKE_BFF_URL: `http://localhost:2/${Math.random()}`,
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

/**
 * #154 : le compteur réel est celui du BFF (Redis, fenêtre fixe par IP). L'état local du smoke ignore
 * les provisionnements faits hors de lui (navigation MCP de la Phase 3, passage ciblé, front lancé sur
 * un autre port) : le smoke se cale donc aussi sur les en-têtes `X-RateLimit-*-ip` que le BFF renvoie,
 * sans rien changer à sa limite (AC-2).
 */
describe("parseBffQuota", () => {
  it("lit le reste et l'échéance du compteur par IP (secondes)", () => {
    expect(
      parseBffQuota(
        200,
        {
          "x-ratelimit-limit-ip": "10",
          "x-ratelimit-remaining-ip": "3",
          "x-ratelimit-reset-ip": "42",
          "x-ratelimit-remaining-identity": "4",
        },
        1_000,
      ),
    ).toEqual({ remaining: 3, resetAt: 43_000, observedAt: 1_000 });
  });

  it("un refus métier (409) porte aussi le compteur, déjà incrémenté par la garde", () => {
    expect(
      parseBffQuota(
        409,
        { "x-ratelimit-remaining-ip": "0", "x-ratelimit-reset-ip": "5" },
        0,
      ),
    ).toEqual({ remaining: 0, resetAt: 5_000, observedAt: 0 });
  });

  it("429 : le blocage le plus long (IP ou identité) fixe la reprise", () => {
    expect(
      parseBffQuota(
        429,
        { "retry-after-ip": "60", "retry-after-identity": "12" },
        1_000,
      ),
    ).toEqual({ remaining: 0, resetAt: 61_000, observedAt: 1_000 });
  });

  it("sans en-têtes exploitables, aucune observation", () => {
    expect(parseBffQuota(200, {}, 0)).toBeNull();
    expect(
      parseBffQuota(
        200,
        { "x-ratelimit-remaining-ip": "x", "x-ratelimit-reset-ip": "3" },
        0,
      ),
    ).toBeNull();
    expect(parseBffQuota(429, {}, 0)).toBeNull();
  });
});

describe("delayFromBffQuota", () => {
  const observed = { remaining: 3, resetAt: 60_000, observedAt: 10_000 };

  it("aucune observation, ou fenêtre du BFF échue : aucune attente", () => {
    expect(delayFromBffQuota(null, [], 20_000, QUOTA)).toBe(0);
    expect(delayFromBffQuota(observed, [], 60_000, QUOTA)).toBe(0);
  });

  it("reste au-delà de la réserve : aucune attente", () => {
    expect(delayFromBffQuota(observed, [5_000], 20_000, QUOTA)).toBe(0);
  });

  it("les soumissions postérieures à l'observation entament le reste", () => {
    // 3 restants à 10 s, 2 soumissions depuis : 1 restant = la réserve, on attend l'échéance.
    expect(delayFromBffQuota(observed, [12_000, 15_000], 20_000, QUOTA)).toBe(
      40_000 + BFF_RESET_MARGIN_MS,
    );
  });

  it("réserve nulle : on consomme jusqu'à la dernière place", () => {
    const quota = { ...QUOTA, spare: 0 };
    expect(delayFromBffQuota(observed, [12_000, 15_000], 20_000, quota)).toBe(
      0,
    );
    expect(
      delayFromBffQuota(observed, [12_000, 15_000, 18_000], 20_000, quota),
    ).toBe(40_000 + BFF_RESET_MARGIN_MS);
  });

  it("compteur du BFF épuisé (provisionnements hors smoke) : attente de l'échéance", () => {
    expect(
      delayFromBffQuota(
        { remaining: 0, resetAt: 30_000, observedAt: 10_000 },
        [],
        10_000,
        QUOTA,
      ),
    ).toBe(20_000 + BFF_RESET_MARGIN_MS);
  });
});

function isolatedEnv(extra: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "q-"));
  return {
    SMOKE_WEB_URL: `http://localhost:1/${dir}`,
    SMOKE_BFF_URL: `http://localhost:2/${dir}`,
    ...extra,
  };
}

describe("recordBffQuota + awaitGuestQuota", () => {
  it("un compteur du BFF épuisé fait attendre, même sous le quota local", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    annotations.length = 0;
    try {
      const env = isolatedEnv({ SMOKE_GUEST_LIMIT: "8" });
      recordBffQuota(
        200,
        { "x-ratelimit-remaining-ip": "1", "x-ratelimit-reset-ip": "10" },
        env,
      );
      let done = false;
      const pending = awaitGuestQuota(env).then((waited) => {
        done = true;
        return waited;
      });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(BFF_RESET_MARGIN_MS);
      expect(await pending).toBe(10_000 + BFF_RESET_MARGIN_MS);
      expect(annotations[0].description).toMatch(/BFF/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("l'observation est propre au BFF : un autre port du front la voit", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    try {
      const env = isolatedEnv({ SMOKE_GUEST_SPARE: "0" });
      recordBffQuota(
        200,
        { "x-ratelimit-remaining-ip": "0", "x-ratelimit-reset-ip": "4" },
        env,
      );
      // Autre front (autre port), même BFF : il attend l'échéance relevée par le premier.
      const otherFront = { ...env, SMOKE_WEB_URL: `${env.SMOKE_WEB_URL}-3003` };
      const pending = awaitGuestQuota(otherFront);
      await vi.advanceTimersByTimeAsync(4_000 + BFF_RESET_MARGIN_MS);
      expect(await pending).toBe(4_000 + BFF_RESET_MARGIN_MS);
    } finally {
      vi.useRealTimers();
    }
  });

  it("réponse sans en-têtes : l'observation précédente est conservée", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    try {
      const env = isolatedEnv();
      recordBffQuota(429, { "retry-after-ip": "3" }, env);
      recordBffQuota(200, {}, env);
      const pending = awaitGuestQuota(env);
      await vi.advanceTimersByTimeAsync(3_000 + BFF_RESET_MARGIN_MS);
      expect(await pending).toBe(3_000 + BFF_RESET_MARGIN_MS);
    } finally {
      vi.useRealTimers();
    }
  });
});

type FakeResponse = {
  url: () => string;
  status: () => number;
  headers: () => Record<string, string>;
  request: () => { method: () => string };
};

describe("submitGuestForm", () => {
  it("attend le quota, soumet, puis relève le compteur de la réponse du BFF", async () => {
    const env = isolatedEnv({ SMOKE_GUEST_SPARE: "0" });
    const clicks: string[] = [];
    let predicate: ((r: FakeResponse) => boolean) | undefined;
    const response: FakeResponse = {
      url: () => "http://localhost:4000/api/v1/auth/guest",
      status: () => 200,
      headers: () => ({
        "x-ratelimit-remaining-ip": "0",
        "x-ratelimit-reset-ip": "50",
      }),
      request: () => ({ method: () => "POST" }),
    };
    const page = {
      waitForResponse: (p: (r: FakeResponse) => boolean) => {
        predicate = p;
        return Promise.resolve(response);
      },
      getByTestId: (id: string) => ({
        click: async () => {
          clicks.push(id);
        },
      }),
    };

    await submitGuestForm(page as never, env);

    expect(clicks).toEqual(["guest-submit"]);
    expect(predicate?.(response)).toBe(true);
    expect(
      predicate?.({ ...response, request: () => ({ method: () => "GET" }) }),
    ).toBe(false);
    expect(
      predicate?.({
        ...response,
        url: () => "http://localhost:4000/api/v1/auth/session",
      }),
    ).toBe(false);

    // Le compteur relevé (0 restant, échéance à 50 s) fait attendre la soumission suivante.
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    try {
      let done = false;
      const next = awaitGuestQuota(env).then(() => {
        done = true;
      });
      await vi.advanceTimersByTimeAsync(45_000);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(10_000);
      await next;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sans réponse du BFF (formulaire refusé côté front), rien n'est relevé ni levé", async () => {
    const env = isolatedEnv();
    const page = {
      waitForResponse: () => Promise.reject(new Error("Timeout")),
      getByTestId: () => ({ click: async () => undefined }),
    };
    await expect(submitGuestForm(page as never, env)).resolves.toBeNull();
  });
});
