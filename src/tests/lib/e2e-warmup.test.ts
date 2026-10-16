// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  WARMUP_DYNAMIC_SEGMENT,
  WARMUP_NOT_FOUND_ROUTE,
  e2eWarmupEnabled,
  listAppRoutes,
  warmupCookie,
  warmupE2EServer,
  warmupRoutes,
} from "../../../e2e/warmup";

/**
 * spyle23/hotelerie#198 (suite de #190) — préchauffage du serveur des e2e isolés.
 *
 * Sous webpack (`dev:e2e`, #190), `next dev` compile chaque route à sa première requête : à 3-4
 * workers, un test qui naviguait vers une route froide (`/booking/payment`, `/booking/recap`)
 * dépassait son délai (`booking-identify.spec.ts:156`), ou la page était rechargée pendant un audit
 * axe (`nearby.spec.ts:90`, « Execution context was destroyed »). Le global setup demande donc une
 * fois chaque route avant le premier test.
 */

describe("listAppRoutes", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function page(rel: string) {
    const file = path.join(dir!, rel, "page.tsx");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "export default function Page() { return null; }");
  }

  it("associe chaque page.tsx à son URL : groupes retirés, segments dynamiques remplis", () => {
    dir = mkdtempSync(path.join(tmpdir(), "stay-client-warmup-"));
    page("(public)");
    page("(public)/hotels/[slug]");
    page("(public)/hotels/[slug]/rooms/[roomId]");
    page("(tunnel)/booking/payment");
    page("(compte)/account");
    page("_private/hidden");
    writeFileSync(path.join(dir, "layout.tsx"), "");
    writeFileSync(
      path.join(dir, "(public)", "hotels", "[slug]", "loading.tsx"),
      "",
    );

    expect(listAppRoutes(dir)).toEqual([
      "/",
      "/account",
      "/booking/payment",
      `/hotels/${WARMUP_DYNAMIC_SEGMENT}`,
      `/hotels/${WARMUP_DYNAMIC_SEGMENT}/rooms/${WARMUP_DYNAMIC_SEGMENT}`,
    ]);
  });

  it("liste les vraies routes de l'application, tunnel de réservation compris", () => {
    const routes = listAppRoutes(path.resolve(__dirname, "../../app"));

    for (const route of [
      "/",
      "/search",
      "/login",
      "/account",
      "/booking",
      "/booking/identify",
      "/booking/payment",
      "/booking/recap",
      "/booking/confirmation",
      `/hotels/${WARMUP_DYNAMIC_SEGMENT}`,
      `/hotels/${WARMUP_DYNAMIC_SEGMENT}/rooms/${WARMUP_DYNAMIC_SEGMENT}`,
    ]) {
      expect(routes).toContain(route);
    }
    expect(routes.every((route) => !/[()[\]]/.test(route))).toBe(true);
  });
});

describe("warmupRoutes", () => {
  it("ajoute une route inconnue : la page 404 est compilée elle aussi", () => {
    const routes = warmupRoutes(path.resolve(__dirname, "../../app"));

    expect(routes).toContain("/booking/payment");
    expect(routes.at(-1)).toBe(WARMUP_NOT_FOUND_ROUTE);
    expect(new Set(routes).size).toBe(routes.length);
  });
});

describe("warmupCookie", () => {
  it("présente un cookie de session aux routes gardées par le proxy (sinon /login serait compilé)", () => {
    expect(warmupCookie("/account")).toMatch(/^stay_sid=/);
    expect(warmupCookie("/account/reservations")).toMatch(/^stay_sid=/);
  });

  it("aucun cookie ailleurs", () => {
    expect(warmupCookie("/")).toBeUndefined();
    expect(warmupCookie("/login")).toBeUndefined();
    expect(warmupCookie("/booking/payment")).toBeUndefined();
    expect(warmupCookie("/accounting")).toBeUndefined();
  });
});

describe("e2eWarmupEnabled", () => {
  it("actif par défaut, désactivé par E2E_WARMUP=0", () => {
    expect(e2eWarmupEnabled({})).toBe(true);
    expect(e2eWarmupEnabled({ E2E_WARMUP: "1" })).toBe(true);
    expect(e2eWarmupEnabled({ E2E_WARMUP: " 0 " })).toBe(false);
  });
});

describe("warmupE2EServer", () => {
  it("demande chaque route une fois, avec son cookie, sans suivre les redirections", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));

    const result = await warmupE2EServer({
      baseURL: "http://localhost:3298",
      routes: ["/login", "/account", "/booking/recap"],
      fetch: fetchMock,
      concurrency: 2,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([url]) => url).sort()).toEqual([
      "http://localhost:3298/account",
      "http://localhost:3298/booking/recap",
      "http://localhost:3298/login",
    ]);
    for (const [url, init] of calls) {
      expect(init.redirect).toBe("manual");
      expect(init.signal).toBeInstanceOf(AbortSignal);
      const cookie = new Headers(init.headers).get("cookie");
      if (url.endsWith("/account")) expect(cookie).toMatch(/stay_sid=/);
      else expect(cookie).toBeNull();
    }
    expect(result.routes).toBe(3);
    expect(result.failed).toEqual([]);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("n'échoue jamais : une route en erreur est signalée, les autres préchauffées", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/booking/payment")) throw new Error("socket hang up");
      return new Response("", { status: 500 });
    });

    const result = await warmupE2EServer({
      baseURL: "http://localhost:3000",
      routes: ["/booking/payment", "/search"],
      fetch: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.failed).toEqual(["/booking/payment"]);
  });

  it("une requête qui ne répond pas est abandonnée à son délai, sans bloquer la suite", async () => {
    const fetchMock = vi.fn(
      (url: string, init: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          if (!url.endsWith("/stuck")) {
            resolve(new Response("", { status: 200 }));
            return;
          }
          init.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );

    const result = await warmupE2EServer({
      baseURL: "http://localhost:3000",
      routes: ["/stuck", "/search"],
      fetch: fetchMock,
      requestTimeoutMs: 20,
    });

    expect(result.failed).toEqual(["/stuck"]);
  });

  it("ne demande que les documents, jamais les scripts /_next/ qu'ils chargent (mesuré, #198)", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          '<script src="/_next/static/chunks/main-app.js" async></script>',
          { headers: { "content-type": "text/html" } },
        ),
    );

    await warmupE2EServer({
      baseURL: "http://localhost:3000",
      routes: ["/", "/search"],
      fetch: fetchMock,
    });

    const calls = fetchMock.mock.calls as unknown as [string][];
    expect(calls.map(([url]) => new URL(url).pathname).sort()).toEqual([
      "/",
      "/search",
    ]);
  });

  it("garde au plus `concurrency` requêtes en vol", async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchMock = vi.fn(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return new Response("", { status: 200 });
    });

    await warmupE2EServer({
      baseURL: "http://localhost:3000",
      routes: ["/a", "/b", "/c", "/d", "/e"],
      fetch: fetchMock,
      concurrency: 2,
    });

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(peak).toBe(2);
  });
});
