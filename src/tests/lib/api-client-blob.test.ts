import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { API_BASE_URL, ApiClientError, apiRequestBlob } from "@/lib/api-client";

/**
 * Story 3.2 (C1) — lecture d'un document binaire au BFF.
 *
 * Le front (:3001) et le BFF (:4000) sont d'origines différentes : un `<img src>` direct partirait
 * sans le cookie de session. Les documents passent donc par `fetch` + `credentials: "include"`.
 */
describe("apiRequestBlob", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renvoie le blob et son type, en envoyant le cookie de session", async () => {
    const blob = new Blob(["%PDF-1.7"], { type: "application/pdf" });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ "Content-Type": "application/pdf" }),
      blob: () => Promise.resolve(blob),
    });

    const result = await apiRequestBlob(
      "/booking/reservations/r1/confirmation-pdf",
    );

    expect(result.blob).toBe(blob);
    expect(result.contentType).toBe("application/pdf");
    expect(mockFetch).toHaveBeenCalledWith(
      `${API_BASE_URL}/booking/reservations/r1/confirmation-pdf`,
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
  });

  it("401 : session expirée, jamais un blob", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: new Headers(),
      json: () => Promise.resolve({ success: false, message: "x" }),
    });

    const error = await apiRequestBlob("/x").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).status).toBe(401);
  });

  it("erreur JSON du BFF (404) : ApiClientError lisible avec son motif, jamais un « PDF corrompu »", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: new Headers({ "Content-Type": "application/json" }),
      json: () =>
        Promise.resolve({
          success: false,
          message: "Document de confirmation introuvable.",
          errors: { reason: ["document-not-found"] },
        }),
    });

    const error = (await apiRequestBlob("/x").catch(
      (e: unknown) => e,
    )) as ApiClientError;

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error.status).toBe(404);
    expect(error.errors).toEqual({ reason: ["document-not-found"] });
  });

  it("type absent : repli sur le type porté par le blob", async () => {
    const blob = new Blob([new Uint8Array([0x89, 0x50])], {
      type: "image/png",
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      blob: () => Promise.resolve(blob),
    });

    const result = await apiRequestBlob("/x");

    expect(result.contentType).toBe("image/png");
  });
});
