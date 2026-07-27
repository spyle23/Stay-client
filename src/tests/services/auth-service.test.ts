import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "@/lib/api-client";
import {
  ANONYMOUS_SESSION,
  AUTH_ENDPOINTS,
  authKeys,
  fetchSession,
  login,
  logout,
} from "@/services/auth.service";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

const SESSION = {
  authenticated: true,
  user: {
    userId: "u-1",
    email: "voyageur@example.com",
    firstName: "Rakoto",
    lastName: null,
  },
};

describe("auth.service", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("cible le BFF sur des chemins relatifs (jamais le PMS)", () => {
    // `API_BASE_URL` porte déjà `/api/v1` : un chemin absolu PMS serait une fuite de frontière.
    for (const endpoint of Object.values(AUTH_ENDPOINTS)) {
      expect(endpoint.startsWith("/auth/")).toBe(true);
      expect(endpoint).not.toContain("/api/v1");
    }
    expect(authKeys.session).toEqual(["auth", "session"]);
  });

  it("fetchSession désenveloppe ApiResponse et envoie le cookie (credentials: include)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: SESSION }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchSession()).resolves.toEqual(SESSION);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(AUTH_ENDPOINTS.session);
    expect(init.credentials).toBe("include");
    expect(init.method).toBe("GET");
  });

  it("login poste les identifiants et renvoie l’état de session", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: SESSION }));
    vi.stubGlobal("fetch", fetchMock);

    const state = await login({
      email: "voyageur@example.com",
      password: "secret123",
    });

    expect(state).toEqual(SESSION);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(AUTH_ENDPOINTS.login);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body as string)).toEqual({
      email: "voyageur@example.com",
      password: "secret123",
    });
  });

  it("login propage une ApiClientError sur identifiants invalides", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { success: false, message: "Invalid email or password." },
            400,
          ),
        ),
    );

    await expect(
      login({ email: "voyageur@example.com", password: "mauvais" }),
    ).rejects.toBeInstanceOf(ApiClientError);
  });

  it("logout traite un 401 comme un succès (session déjà éteinte)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ success: false }, 401)),
    );

    await expect(logout()).resolves.toBeUndefined();
  });

  it("logout propage une vraie panne (503)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ success: false }, 503)),
    );

    await expect(logout()).rejects.toBeInstanceOf(ApiClientError);
  });

  it("expose un état anonyme constant", () => {
    expect(ANONYMOUS_SESSION).toEqual({ authenticated: false, user: null });
  });
});
