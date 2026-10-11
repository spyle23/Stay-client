import { EventEmitter } from "node:events";
import type { Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import {
  ABORTED,
  ignoredRequestFailure,
  isRouterPrefetch,
  originOf,
  watchForFailures,
} from "../../../e2e/smoke/helpers/network-probe";

/**
 * #125 — sonde réseau partagée du smoke cliente (`e2e/smoke/helpers/network-probe.ts`).
 * AC-1 : préchargement RSC annulé ignoré, tout autre échec compté ; AC-3 : Stripe.js interrompu ignoré.
 * #148 : un fetch RSC de navigation n'est ignoré que si sa réponse a été reçue (fin d'une réponse lue
 * en flux, signalée `net::ERR_ABORTED` par Chromium) ; abandonné sans réponse, il est compté (#77).
 */
const FRONT = "http://localhost:3003";
const RSC = `${FRONT}/hotels/hotel-le-parisien-1a2b?checkInDate=2026-11-08&_rsc=6grVij_EUBxTWnLP`;
const INTENT = /\/payment\/reservations\/[^/]+\/intent$/;

describe("ignoredRequestFailure", () => {
  it("AC-1 : ignore un préchargement RSC du front annulé", () => {
    expect(
      ignoredRequestFailure({
        url: RSC,
        errorText: ABORTED,
        frontOrigin: FRONT,
        prefetch: true,
      }),
    ).toBe("rsc-prefetch");
  });

  it("#148 : ignore le fetch RSC d'une navigation dont la réponse a été reçue (lecture en flux)", () => {
    expect(
      ignoredRequestFailure({
        url: RSC,
        errorText: ABORTED,
        frontOrigin: FRONT,
        responded: true,
      }),
    ).toBe("rsc-streamed");
  });

  it("#148 / #77 : compte le fetch RSC d'une navigation abandonné sans réponse", () => {
    expect(
      ignoredRequestFailure({
        url: RSC,
        errorText: ABORTED,
        frontOrigin: FRONT,
      }),
    ).toBeNull();
    expect(
      ignoredRequestFailure({
        url: RSC,
        errorText: ABORTED,
        frontOrigin: FRONT,
        prefetch: false,
        responded: false,
      }),
    ).toBeNull();
  });

  it.each([
    ["autre code d'erreur", RSC, "net::ERR_CONNECTION_REFUSED", FRONT],
    [
      "BFF annulé",
      "http://localhost:4000/api/v1/booking/quote",
      ABORTED,
      FRONT,
    ],
    [
      "PMS annulé",
      "http://localhost:5231/api/v1/hotels?_rsc=1",
      ABORTED,
      FRONT,
    ],
    [
      "ressource du front",
      `${FRONT}/_next/static/chunks/app.js`,
      ABORTED,
      FRONT,
    ],
    [
      "préchargement d'une autre origine",
      RSC,
      ABORTED,
      "http://localhost:3001",
    ],
    ["origine du front inconnue", RSC, ABORTED, null],
    ["`_rsc` hors paramètre de requête", `${FRONT}/_rsc/page`, ABORTED, FRONT],
  ])(
    "AC-1 : compte toujours un échec — %s",
    (_label, url, errorText, frontOrigin) => {
      expect(ignoredRequestFailure({ url, errorText, frontOrigin })).toBeNull();
    },
  );

  it("AC-3 : ignore le chargement interrompu de Stripe.js et de hCaptcha", () => {
    for (const url of [
      "https://js.stripe.com/dahlia/stripe.js",
      "https://newassets.hcaptcha.com/captcha/v1/abc/hcaptcha.js",
    ]) {
      expect(
        ignoredRequestFailure({ url, errorText: ABORTED, frontOrigin: FRONT }),
      ).toBe("external-host");
    }
  });

  it("#146 : ignore la télémétrie de Stripe.js (m.stripe.network) interrompue en quittant la page", () => {
    expect(
      ignoredRequestFailure({
        url: "https://m.stripe.network/out-4.5.45.js",
        errorText: ABORTED,
        frontOrigin: FRONT,
      }),
    ).toBe("external-host");
    expect(
      ignoredRequestFailure({
        url: "https://m.stripe.network.example.org/out.js",
        errorText: ABORTED,
        frontOrigin: FRONT,
      }),
    ).toBeNull();
  });

  it("AC-3 : Stripe en vraie panne (autre code) ou faux sous-domaine restent comptés", () => {
    expect(
      ignoredRequestFailure({
        url: "https://js.stripe.com/dahlia/stripe.js",
        errorText: "net::ERR_NAME_NOT_RESOLVED",
        frontOrigin: FRONT,
      }),
    ).toBeNull();
    expect(
      ignoredRequestFailure({
        url: "https://evil-js.stripe.com.example.org/x.js",
        errorText: ABORTED,
        frontOrigin: FRONT,
      }),
    ).toBeNull();
  });

  it("chemin déclaré par la spec : abandon ignoré seulement sur ce chemin", () => {
    const url = "http://localhost:4000/api/v1/payment/reservations/r-1/intent";
    expect(
      ignoredRequestFailure({
        url,
        errorText: ABORTED,
        frontOrigin: FRONT,
        abortablePaths: [INTENT],
      }),
    ).toBe("aborted-path");
    expect(
      ignoredRequestFailure({ url, errorText: ABORTED, frontOrigin: FRONT }),
    ).toBeNull();
  });

  it("URL illisible : comptée", () => {
    expect(
      ignoredRequestFailure({
        url: "pas une url",
        errorText: ABORTED,
        frontOrigin: FRONT,
      }),
    ).toBeNull();
  });
});

describe("isRouterPrefetch", () => {
  it("reconnaît les préchargements du routeur Next.js, pas une navigation", () => {
    expect(isRouterPrefetch({ "next-router-prefetch": "1" })).toBe(true);
    expect(isRouterPrefetch({ "next-router-segment-prefetch": "/_tree" })).toBe(
      true,
    );
    expect(isRouterPrefetch({ rsc: "1" })).toBe(false);
    expect(isRouterPrefetch({})).toBe(false);
  });

  it("un préchargement ou une réponse reçue n'innocentent qu'une requête RSC du front", () => {
    expect(
      ignoredRequestFailure({
        url: "http://localhost:4000/api/v1/booking/quote",
        errorText: ABORTED,
        frontOrigin: FRONT,
        prefetch: true,
        responded: true,
      }),
    ).toBeNull();
    expect(
      ignoredRequestFailure({
        url: RSC,
        errorText: "net::ERR_FAILED",
        frontOrigin: FRONT,
        prefetch: true,
        responded: true,
      }),
    ).toBeNull();
  });
});

describe("originOf", () => {
  it("rend l'origine d'une page, null pour about:blank", () => {
    expect(originOf(`${FRONT}/search?x=1`)).toBe(FRONT);
    expect(originOf("about:blank")).toBeNull();
    expect(originOf("")).toBeNull();
  });
});

/** Laisse se terminer les écouteurs asynchrones de la sonde (lecture de la réponse). */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Page factice : juste les événements et l'URL lus par la sonde. */
function fakePage(url = `${FRONT}/search`) {
  const emitter = new EventEmitter();
  const page = Object.assign(emitter, { url: () => url }) as unknown as Page;
  const failed = (
    u: string,
    errorText: string,
    {
      headers = {},
      responded = false,
    }: { headers?: Record<string, string>; responded?: boolean } = {},
  ) =>
    emitter.emit("requestfailed", {
      url: () => u,
      method: () => "GET",
      failure: () => ({ errorText }),
      headers: () => headers,
      response: async () => (responded ? { status: () => 200 } : null),
    });
  const response = (u: string, status: number) =>
    emitter.emit("response", {
      url: () => u,
      status: () => status,
      request: () => ({ method: () => "POST" }),
    });
  const consoleError = (text: string) =>
    emitter.emit("console", { type: () => "error", text: () => text });
  return { page, failed, response, consoleError, emitter };
}

describe("watchForFailures", () => {
  it("AC-1/AC-3 : n'enregistre ni le préchargement RSC ni Stripe.js annulés", async () => {
    const { page, failed } = fakePage();
    const failures = watchForFailures(page);
    failed(RSC, ABORTED, { headers: { "next-router-prefetch": "1" } });
    failed("https://js.stripe.com/dahlia/stripe.js", ABORTED);
    await flush();
    expect(failures).toEqual([]);
  });

  it("#148 : fetch RSC de navigation lu en flux (réponse reçue) ignoré, abandonné sans réponse compté", async () => {
    const { page, failed } = fakePage();
    const failures = watchForFailures(page);
    failed(RSC, ABORTED, { responded: true });
    failed(RSC, ABORTED);
    await flush();
    expect(failures).toEqual([`requestfailed: GET ${RSC} — ${ABORTED}`]);
  });

  it("AC-1 : enregistre un appel BFF interrompu et un préchargement en vraie erreur", async () => {
    const { page, failed } = fakePage();
    const failures = watchForFailures(page);
    failed("http://localhost:4000/api/v1/booking/quote", ABORTED);
    failed(RSC, "net::ERR_FAILED", {
      headers: { "next-router-prefetch": "1" },
    });
    await flush();
    expect(failures).toEqual([
      `requestfailed: GET http://localhost:4000/api/v1/booking/quote — ${ABORTED}`,
      `requestfailed: GET ${RSC} — net::ERR_FAILED`,
    ]);
  });

  it("statut attendu filtré (réponse et console), tout autre compté", () => {
    const { page, response, consoleError, emitter } = fakePage();
    const failures = watchForFailures(page, { expected: [409] });
    response("http://localhost:4000/api/v1/auth/guest", 409);
    consoleError(
      "Failed to load resource: the server responded with a status of 409 ()",
    );
    response("http://localhost:4000/api/v1/auth/guest", 500);
    response("https://js.stripe.com/v3/m", 500);
    emitter.emit("pageerror", new Error("boom"));
    expect(failures).toEqual([
      "http 500: POST http://localhost:4000/api/v1/auth/guest",
      "pageerror: boom",
    ]);
  });

  it("chemins déclarés transmis à la règle", () => {
    const { page, failed } = fakePage();
    const failures = watchForFailures(page, { abortablePaths: [INTENT] });
    failed(
      "http://localhost:4000/api/v1/payment/reservations/r-1/intent",
      ABORTED,
    );
    expect(failures).toEqual([]);
  });
});
