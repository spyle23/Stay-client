import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  useGuestCheckout,
  useLogin,
  useLogout,
  useSession,
} from "@/hooks/use-session";
import { authKeys } from "@/services/auth.service";

const SESSION = {
  authenticated: true,
  user: {
    userId: "u-1",
    email: "voyageur@example.com",
    firstName: "Rakoto",
    lastName: null,
  },
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      // `useSession` impose son propre `retry: 1` ; sans `retryDelay: 0` le backoff par défaut
      // (~1 s) ferait expirer les `waitFor` avant que la query n'atteigne son état d'erreur.
      queries: { retry: false, retryDelay: 0 },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe("use-session", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("useSession expose l’état renvoyé par le BFF", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ success: true, data: SESSION })),
    );
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useSession(), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(SESSION));
  });

  it("useSession signale une panne du BFF via isError (et non « anonyme »)", async () => {
    // Distinction vitale : la page compte ne doit PAS éjecter l'utilisateur sur une panne.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ success: false }, 503)),
    );
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useSession(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it("useLogin alimente le cache de session sans aller-retour supplémentaire", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: SESSION }));
    vi.stubGlobal("fetch", fetchMock);
    const { queryClient, wrapper } = makeWrapper();

    const { result } = renderHook(() => useLogin(), { wrapper });
    result.current.mutate({
      email: "voyageur@example.com",
      password: "secret123",
    });

    await waitFor(() =>
      expect(queryClient.getQueryData(authKeys.session)).toEqual(SESSION),
    );
  });

  it("useGuestCheckout alimente le cache de session (story 2.3)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: SESSION }));
    vi.stubGlobal("fetch", fetchMock);
    const { queryClient, wrapper } = makeWrapper();

    const { result } = renderHook(() => useGuestCheckout(), { wrapper });
    result.current.mutate({
      email: "invite@example.com",
      firstName: "Hery",
      lastName: "Rakoto",
      phone: "+261340000000",
    });

    // Le corps de la réponse EST le nouvel état : il est posé directement dans le cache, sans
    // second aller-retour. C'est CETTE assertion qui porte la garantie.
    await waitFor(() =>
      expect(queryClient.getQueryData(authKeys.session)).toEqual(SESSION),
    );
    // ⚠️ Complément, pas preuve : `renderHook` ne monte aucun observateur de `authKeys.session`,
    // donc une `invalidateQueries` ne déclencherait ici aucun refetch — cette assertion passerait
    // aussi dans le cas qu'elle semble interdire. Elle ne vaut que comme garde anti-appel parasite.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("useLogout purge TOUT le cache puis repose l’état anonyme (poste partagé)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ success: true, data: null })),
    );
    const { queryClient, wrapper } = makeWrapper();
    queryClient.setQueryData(authKeys.session, SESSION);
    // Donnée de compte fictive (ce que produiront les réservations/factures d'Epic 4).
    queryClient.setQueryData(["reservations", "list"], [{ id: "r-1" }]);

    const { result } = renderHook(() => useLogout(), { wrapper });
    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Le compte suivant ne doit rien voir du précédent.
    expect(queryClient.getQueryData(["reservations", "list"])).toBeUndefined();
    // …mais l'état anonyme doit survivre à la purge (il est reposé après `clear()`).
    expect(queryClient.getQueryData(authKeys.session)).toEqual({
      authenticated: false,
      user: null,
    });
  });

  it("useLogout considère un 401 comme un succès (session déjà éteinte)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ success: false }, 401)),
    );
    const { queryClient, wrapper } = makeWrapper();

    const { result } = renderHook(() => useLogout(), { wrapper });
    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(authKeys.session)).toEqual({
      authenticated: false,
      user: null,
    });
  });

  it("useLogout remonte une vraie panne en erreur (l’UI doit pouvoir l’afficher)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ success: false }, 503)),
    );
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useLogout(), { wrapper });
    result.current.mutate();

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
