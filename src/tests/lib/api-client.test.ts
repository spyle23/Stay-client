import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  api,
  apiRequest,
  ApiClientError,
  API_BASE_URL,
} from "@/lib/api-client";

/**
 * Client HTTP front → BFF. Version dépouillée de toute garde JWT navigateur :
 * on vérifie l'envoi du cookie de session opaque (`credentials: "include"`),
 * le désenveloppage ApiResponse/ApiListResponse, et l'absence de logique de jeton.
 */
describe("api-client (front → BFF)", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("ApiClientError", () => {
    it("porte message, status et errors", () => {
      const err = new ApiClientError("Validation", 422, {
        email: ["invalide"],
      });
      expect(err.message).toBe("Validation");
      expect(err.status).toBe(422);
      expect(err.name).toBe("ApiClientError");
      expect(err.errors).toEqual({ email: ["invalide"] });
    });
  });

  describe("désenveloppage & requêtes", () => {
    it("GET désenveloppe ApiResponse<T> → data et envoie le cookie de session", async () => {
      const data = { id: "h1", name: "Hôtel Test" };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, data, errors: null }),
      });

      const result = await api.get<typeof data>("/hotels/h1");

      expect(result).toEqual(data);
      expect(mockFetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/hotels/h1`,
        expect.objectContaining({
          method: "GET",
          credentials: "include",
        }),
      );
    });

    it("POST envoie le corps JSON et renvoie data", async () => {
      const body = { hotelId: "h1" };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ success: true, data: { id: "r1" } }),
      });

      const result = await api.post<{ id: string }>("/reservations", body);

      expect(result).toEqual({ id: "r1" });
      expect(mockFetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/reservations`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(body),
          credentials: "include",
        }),
      );
    });

    it("204 No Content → undefined", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });
      const result = await api.delete("/reservations/r1");
      expect(result).toBeUndefined();
    });

    it("renvoie le JSON brut si l'enveloppe est absente", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ pong: true }),
      });
      const result = await apiRequest<{ pong: boolean }>("/health");
      expect(result).toEqual({ pong: true });
    });

    it("corps 2xx vide (205 / pas de corps) → undefined, pas de SyntaxError", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 205,
        json: () =>
          Promise.reject(new SyntaxError("Unexpected end of JSON input")),
      });
      const result = await apiRequest("/logout");
      expect(result).toBeUndefined();
    });

    it("GET n'envoie pas de Content-Type (pas de préflight inutile)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, data: {} }),
      });
      await api.get("/hotels/h1");
      const init = mockFetch.mock.calls[0][1] as RequestInit;
      expect(init.headers).not.toHaveProperty("Content-Type");
    });
  });

  describe("erreurs", () => {
    it("lève ApiClientError sur réponse non-ok (400)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () =>
          Promise.resolve({ success: false, errors: ["Requête invalide"] }),
      });

      await expect(api.get("/hotels")).rejects.toThrow(ApiClientError);
    });

    it("mappe les erreurs de validation (objet) dans ApiClientError.errors", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: () =>
          Promise.resolve({ success: false, errors: { email: ["invalide"] } }),
      });

      await expect(api.post("/auth/register", {})).rejects.toMatchObject({
        status: 422,
        errors: { email: ["invalide"] },
      });
    });

    it("401 → ApiClientError « Session expirée » (refresh géré par le BFF, story 2.1)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () =>
          Promise.resolve({ success: false, errors: ["Token expired"] }),
      });

      await expect(api.get("/account/reservations")).rejects.toThrow(
        "Session expirée",
      );
      // Un seul appel : aucun refresh navigateur (contrairement au client de Stay).
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("listes paginées", () => {
    it("getList mappe ApiListResponse<T> → PaginatedResponse<T>", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            success: true,
            data: [{ id: "h1" }, { id: "h2" }],
            pagination: {
              page: 2,
              pageSize: 10,
              totalCount: 22,
              totalPages: 3,
              hasPreviousPage: true,
              hasNextPage: true,
            },
          }),
      });

      const result = await api.getList<{ id: string }>("/hotels");

      expect(result.items).toHaveLength(2);
      expect(result.page).toBe(2);
      expect(result.totalCount).toBe(22);
      expect(result.hasNextPage).toBe(true);
      expect(result.hasPreviousPage).toBe(true);
    });

    it("corps vide (204/liste sans corps) → liste vide, pas d'erreur", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: () =>
          Promise.reject(new SyntaxError("Unexpected end of JSON input")),
      });

      const result = await api.getList<{ id: string }>("/hotels");
      expect(result.items).toEqual([]);
      expect(result.totalCount).toBe(0);
    });
  });
});
