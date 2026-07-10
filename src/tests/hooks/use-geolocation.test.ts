import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { useGeolocation } from "@/hooks/use-geolocation";
import { requestCurrentPosition } from "@/lib/geolocation";

vi.mock("@/lib/geolocation", () => ({
  requestCurrentPosition: vi.fn(),
}));

const mockedRequest = vi.mocked(requestCurrentPosition);

describe("useGeolocation", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("démarre en idle", () => {
    const { result } = renderHook(() => useGeolocation());
    expect(result.current.status).toBe("idle");
    expect(result.current.latitude).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("succès → status success + coordonnées exposées", async () => {
    mockedRequest.mockResolvedValue({
      ok: true,
      latitude: -18.9,
      longitude: 47.5,
    });
    const { result } = renderHook(() => useGeolocation());

    await act(async () => {
      const res = await result.current.request();
      expect(res).toEqual({ ok: true, latitude: -18.9, longitude: 47.5 });
    });

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.latitude).toBe(-18.9);
    expect(result.current.longitude).toBe(47.5);
    expect(result.current.error).toBeNull();
  });

  it("échec → status error + raison exposée", async () => {
    mockedRequest.mockResolvedValue({ ok: false, reason: "denied" });
    const { result } = renderHook(() => useGeolocation());

    await act(async () => {
      await result.current.request();
    });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("denied");
    expect(result.current.latitude).toBeNull();
  });
});
