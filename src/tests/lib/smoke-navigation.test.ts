import { EventEmitter } from "node:events";
import type { Page, Request } from "@playwright/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isFrontRscRequest,
  watchRscActivity,
} from "../../../e2e/smoke/helpers/rsc-idle";

/**
 * #125 — synchronisation du smoke avant le clic sur une hotel-card (contournement suivi par #148) :
 * attente du calme des requêtes RSC du front, borne sans échec, puis clic et URL de la fiche.
 */
const FRONT = "http://localhost:3003";
const RSC = `${FRONT}/hotels/hotel-le-parisien-1a2b?_rsc=6grVij_EUBxTWnLP`;

class FakePage extends EventEmitter {
  constructor(private current = `${FRONT}/search?city=Paris`) {
    super();
  }
  url(): string {
    return this.current;
  }
}

const request = (url: string): Request => ({ url: () => url }) as Request;

/** Résultat d'une promesse une fois résolue (`settled`), sans l'attendre. */
function track<T>(promise: Promise<T>): {
  value: T | undefined;
  settled: boolean;
} {
  const box: { value: T | undefined; settled: boolean } = {
    value: undefined,
    settled: false,
  };
  void promise.then((v) => {
    box.value = v;
    box.settled = true;
  });
  return box;
}

describe("isFrontRscRequest", () => {
  it("reconnaît une requête _rsc de l'origine du front", () => {
    expect(isFrontRscRequest(RSC, FRONT)).toBe(true);
  });

  it("ignore une autre origine, une requête sans _rsc, une URL illisible ou une origine inconnue", () => {
    expect(
      isFrontRscRequest("http://localhost:4000/api/v1/x?_rsc=1", FRONT),
    ).toBe(false);
    expect(isFrontRscRequest(`${FRONT}/hotels/x`, FRONT)).toBe(false);
    expect(isFrontRscRequest("pas une url", FRONT)).toBe(false);
    expect(isFrontRscRequest(RSC, null)).toBe(false);
  });
});

describe("watchRscActivity", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rend quiet après la fenêtre de calme quand aucune requête RSC ne part", async () => {
    const page = new FakePage();
    const activity = watchRscActivity(page as unknown as Page);
    const result = track(activity.waitForQuiet({ quietMs: 300 }));

    await vi.advanceTimersByTimeAsync(200);
    expect(result.value).toBeUndefined();
    await vi.advanceTimersByTimeAsync(150);
    expect(result.value).toBe("quiet");
  });

  it("attend la fin des requêtes RSC en cours, puis la fenêtre de calme après la dernière", async () => {
    const page = new FakePage();
    const activity = watchRscActivity(page as unknown as Page);
    const a = request(RSC);
    const b = request(`${RSC}x`);
    page.emit("request", a);
    page.emit("request", b);
    expect(activity.inFlight()).toBe(2);

    const result = track(activity.waitForQuiet({ quietMs: 300 }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(result.value).toBeUndefined();

    page.emit("requestfinished", a);
    page.emit("requestfailed", b); // un préchargement annulé termine aussi la requête
    expect(activity.inFlight()).toBe(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(result.value).toBeUndefined();
    await vi.advanceTimersByTimeAsync(150);
    expect(result.value).toBe("quiet");
  });

  it("relance la fenêtre de calme à la fin d'une requête partie avant l'installation", async () => {
    const page = new FakePage();
    const activity = watchRscActivity(page as unknown as Page);
    const result = track(activity.waitForQuiet({ quietMs: 300 }));

    await vi.advanceTimersByTimeAsync(250);
    page.emit("requestfinished", request(RSC)); // jamais vue partir
    expect(activity.inFlight()).toBe(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(result.value).toBeUndefined();
    await vi.advanceTimersByTimeAsync(150);
    expect(result.value).toBe("quiet");
  });

  it("ne compte ni les appels au BFF, ni les ressources du front, ni une autre origine", async () => {
    const page = new FakePage();
    const activity = watchRscActivity(page as unknown as Page);
    page.emit("request", request("http://localhost:4000/api/v1/hotels"));
    page.emit("request", request(`${FRONT}/_next/static/chunk.js`));
    page.emit("request", request("http://evil.test/page?_rsc=1"));
    expect(activity.inFlight()).toBe(0);

    const result = track(activity.waitForQuiet({ quietMs: 300 }));
    await vi.advanceTimersByTimeAsync(350);
    expect(result.value).toBe("quiet");
  });

  it("rend timeout à la borne, sans échec, si une requête RSC reste en cours", async () => {
    const page = new FakePage();
    const activity = watchRscActivity(page as unknown as Page);
    page.emit("request", request(RSC));

    const result = track(
      activity.waitForQuiet({ quietMs: 300, timeoutMs: 10_000 }),
    );
    await vi.advanceTimersByTimeAsync(9_900);
    expect(result.value).toBeUndefined();
    await vi.advanceTimersByTimeAsync(200);
    expect(result.value).toBe("timeout");
    expect(activity.inFlight()).toBe(1);
  });

  it("applique par défaut 300 ms de calme et 10 s de borne", async () => {
    const page = new FakePage();
    const quiet = watchRscActivity(page as unknown as Page);
    const quietResult = track(quiet.waitForQuiet());
    await vi.advanceTimersByTimeAsync(250);
    expect(quietResult.value).toBeUndefined();
    await vi.advanceTimersByTimeAsync(100);
    expect(quietResult.value).toBe("quiet");

    const busyPage = new FakePage();
    const busy = watchRscActivity(busyPage as unknown as Page);
    busyPage.emit("request", request(RSC));
    const busyResult = track(busy.waitForQuiet());
    await vi.advanceTimersByTimeAsync(9_900);
    expect(busyResult.value).toBeUndefined();
    await vi.advanceTimersByTimeAsync(200);
    expect(busyResult.value).toBe("timeout");
  });

  it("dispose retire ses écouteurs de la page", () => {
    const page = new FakePage();
    const activity = watchRscActivity(page as unknown as Page);
    expect(page.listenerCount("request")).toBe(1);
    activity.dispose();
    expect(page.listenerCount("request")).toBe(0);
    expect(page.listenerCount("requestfinished")).toBe(0);
    expect(page.listenerCount("requestfailed")).toBe(0);
    page.emit("request", request(RSC));
    expect(activity.inFlight()).toBe(0);
  });
});

// --- openHotelCard : ordre visible → calme → clic → URL, sans rechargement ni nouvelle tentative ---

const calls: string[] = [];
const annotations: { type: string; description?: string }[] = [];

vi.mock("@playwright/test", () => ({
  expect: (target: { kind: string }) => ({
    toBeVisible: async (opts: { timeout: number }) => {
      calls.push(`visible:${target.kind}:${opts.timeout}`);
    },
    toHaveURL: async (url: RegExp) => {
      calls.push(`url:${url.source}`);
    },
  }),
  test: { info: () => ({ annotations }) },
}));

describe("openHotelCard", () => {
  beforeEach(() => {
    calls.length = 0;
    annotations.length = 0;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  class CardPage extends FakePage {
    reloads = 0;
    gotos = 0;
    getByTestId(id: string) {
      return {
        nth: (index: number) => ({
          kind: `${id}#${index}`,
          click: async () => {
            calls.push(`click:${id}#${index}`);
          },
        }),
      };
    }
    async reload() {
      this.reloads += 1;
    }
    async goto() {
      this.gotos += 1;
    }
  }

  it("attend la carte, puis le calme des préchargements, clique et exige la fiche", async () => {
    const { openHotelCard } =
      await import("../../../e2e/smoke/helpers/navigation");
    const page = new CardPage();
    const prefetch = request(RSC);

    const done = track(openHotelCard(page as unknown as Page, 2));
    await vi.advanceTimersByTimeAsync(0);
    page.emit("request", prefetch); // préchargement déclenché par l'apparition des cartes
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toEqual(["visible:hotel-card#2:20000"]); // pas de clic tant qu'il court

    page.emit("requestfinished", prefetch);
    await vi.advanceTimersByTimeAsync(400);
    expect(calls).toEqual([
      "visible:hotel-card#2:20000",
      "click:hotel-card#2",
      "url:\\/hotels\\/",
    ]);
    expect(done.settled).toBe(true);
    expect(annotations).toEqual([]);
    expect(page.reloads).toBe(0);
    expect(page.gotos).toBe(0);
    expect(page.listenerCount("request")).toBe(0);
  });

  it("clique quand même à la borne, une seule fois, et le signale en annotation", async () => {
    const { openHotelCard } =
      await import("../../../e2e/smoke/helpers/navigation");
    const page = new CardPage();

    const pending = openHotelCard(page as unknown as Page);
    await vi.advanceTimersByTimeAsync(0);
    page.emit("request", request(RSC)); // ne se termine jamais
    await vi.advanceTimersByTimeAsync(10_200);
    await pending;

    expect(calls).toEqual([
      "visible:hotel-card#0:20000",
      "click:hotel-card#0",
      "url:\\/hotels\\/",
    ]);
    expect(annotations).toHaveLength(1);
    expect(annotations[0].type).toBe("rsc-idle");
    expect(page.reloads).toBe(0);
    expect(page.listenerCount("requestfinished")).toBe(0);
  });
});
