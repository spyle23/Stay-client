import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isGeolocationSupported,
  requestCurrentPosition,
  roundCoordinate,
} from "@/lib/geolocation";

type SuccessCb = (position: GeolocationPosition) => void;
type ErrorCb = (error: GeolocationPositionError) => void;

function stubGeolocation(
  getCurrentPosition: (success: SuccessCb, error?: ErrorCb) => void,
): void {
  Object.defineProperty(navigator, "geolocation", {
    value: { getCurrentPosition },
    configurable: true,
  });
}

function setSecure(value: boolean): void {
  Object.defineProperty(window, "isSecureContext", {
    value,
    configurable: true,
  });
}

describe("roundCoordinate", () => {
  it("arrondit à 3 décimales (~110 m)", () => {
    expect(roundCoordinate(-18.9123456)).toBe(-18.912);
    expect(roundCoordinate(47.500001)).toBe(47.5);
  });
});

describe("requestCurrentPosition", () => {
  beforeEach(() => {
    setSecure(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("succès → coordonnées arrondies", async () => {
    stubGeolocation((success) =>
      success({
        coords: { latitude: -18.98765, longitude: 47.51234 },
      } as GeolocationPosition),
    );

    const result = await requestCurrentPosition();

    expect(result).toEqual({ ok: true, latitude: -18.988, longitude: 47.512 });
  });

  it("refus (PERMISSION_DENIED = 1) → denied", async () => {
    stubGeolocation((_success, error) =>
      error?.({ code: 1 } as GeolocationPositionError),
    );
    expect(await requestCurrentPosition()).toEqual({
      ok: false,
      reason: "denied",
    });
  });

  it("position indisponible (code 2) → unavailable", async () => {
    stubGeolocation((_success, error) =>
      error?.({ code: 2 } as GeolocationPositionError),
    );
    expect(await requestCurrentPosition()).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("timeout (code 3) → timeout", async () => {
    stubGeolocation((_success, error) =>
      error?.({ code: 3 } as GeolocationPositionError),
    );
    expect(await requestCurrentPosition()).toEqual({
      ok: false,
      reason: "timeout",
    });
  });

  it("contexte non sécurisé → insecure (sans appeler l'API)", async () => {
    setSecure(false);
    const spy = vi.fn();
    stubGeolocation(spy);
    expect(await requestCurrentPosition()).toEqual({
      ok: false,
      reason: "insecure",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("API absente → unsupported", async () => {
    Object.defineProperty(navigator, "geolocation", {
      value: undefined,
      configurable: true,
    });
    expect(isGeolocationSupported()).toBe(false);
    expect(await requestCurrentPosition()).toEqual({
      ok: false,
      reason: "unsupported",
    });
  });
});
