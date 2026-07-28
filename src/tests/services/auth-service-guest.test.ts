import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "@/lib/api-client";
import {
  AUTH_ENDPOINTS,
  isEmailConflict,
  provisionGuest,
} from "@/services/auth.service";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

const GUEST = {
  email: "invite@example.com",
  firstName: "Hery",
  lastName: "Rakoto",
  phone: "+261340000000",
};

const SESSION = {
  authenticated: true,
  user: {
    userId: "u-9",
    email: "invite@example.com",
    firstName: "Hery",
    lastName: "Rakoto",
  },
};

describe("auth.service — Checkout invité (story 2.3)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("poste exactement les 4 champs déclarés au DTO du BFF", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: SESSION }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(provisionGuest(GUEST)).resolves.toEqual(SESSION);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(AUTH_ENDPOINTS.guest);
    expect(init.method).toBe("POST");
    // Le cookie de session doit partir : c'est lui qui rend la route idempotente côté BFF.
    expect(init.credentials).toBe("include");
    // `forbidNonWhitelisted` côté BFF : tout champ supplémentaire ferait un 400.
    expect(JSON.parse(init.body as string)).toEqual(GUEST);
  });

  it("ne transporte jamais de mot de passe (il est généré côté serveur)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: SESSION }));
    vi.stubGlobal("fetch", fetchMock);

    await provisionGuest(GUEST);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body as string).not.toMatch(/password/i);
  });

  it("propage une ApiClientError 409 en cas de collision d’email", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ success: false, message: "conflit" }, 409),
        ),
    );

    await expect(provisionGuest(GUEST)).rejects.toBeInstanceOf(ApiClientError);
    await expect(provisionGuest(GUEST)).rejects.toMatchObject({ status: 409 });
  });

  it("isEmailConflict ne reconnaît QUE le 409", () => {
    expect(isEmailConflict(new ApiClientError("x", 409))).toBe(true);
    expect(isEmailConflict(new ApiClientError("x", 400))).toBe(false);
    expect(isEmailConflict(new ApiClientError("x", 503))).toBe(false);
    expect(isEmailConflict(new Error("boom"))).toBe(false);
  });
});
