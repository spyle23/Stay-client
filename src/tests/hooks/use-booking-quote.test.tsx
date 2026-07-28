import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useBookingQuote } from "@/hooks/use-booking-quote";
import type { ParsedBookingParams } from "@/lib/validations/booking";
import { bookingKeys } from "@/services/booking.service";

const HOTEL_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const ROOM_ID = "22222222-2222-2222-2222-222222222222";

const params: ParsedBookingParams = {
  hotelId: HOTEL_ID,
  roomId: ROOM_ID,
  checkInDate: "2999-07-05",
  checkOutDate: "2999-07-07",
  guests: 2,
  currency: "EUR",
};

const QUOTE = { total: 16800, currency: "EUR", nights: 2 };

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe("useBookingQuote", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("écrit le devis sous une clé portant tout le contexte de séjour", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ success: true, data: QUOTE })),
    );
    const { queryClient, wrapper } = makeWrapper();

    const { result } = renderHook(() => useBookingQuote(params), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(bookingKeys.quote(params))).toMatchObject({
      total: 16800,
    });
  });

  /**
   * La devise de travail ne fait PAS partie de la clé : elle ne change ni le devis, ni la devise
   * de l'hôtel. L'inclure provoquerait un re-fetch inutile à chaque bascule EUR/USD.
   */
  it("ne re-demande pas de devis quand seule la devise de travail change", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: QUOTE }));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result, rerender } = renderHook(
      ({ p }: { p: ParsedBookingParams }) => useBookingQuote(p),
      { wrapper, initialProps: { p: params } },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ p: { ...params, currency: "USD" } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /** AC-2 : le récapitulatif précédent reste affiché pendant le recalcul (pas d'écran vide). */
  it("conserve le devis précédent pendant un recalcul (keepPreviousData)", async () => {
    let resolveSecond: ((value: unknown) => void) | undefined;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ success: true, data: QUOTE }))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result, rerender } = renderHook(
      ({ p }: { p: ParsedBookingParams }) => useBookingQuote(p),
      { wrapper, initialProps: { p: params } },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ p: { ...params, guests: 3 } });

    await waitFor(() => expect(result.current.isPlaceholderData).toBe(true));
    // Données toujours présentes malgré le changement de clé → aucun flash d'écran vide.
    expect(result.current.data).toMatchObject({ total: 16800 });

    resolveSecond?.(jsonResponse({ success: true, data: QUOTE }));
  });

  /**
   * Revue 2.2 — invariant AC-8 : la garde d'URL invalide vit dans le **Server Component**
   * (`(tunnel)/booking/recap/page.tsx` ne monte l'île cliente que si `parseBookingParams` a
   * réussi), pas dans un `enabled`. On documente donc ici ce que le hook garantit réellement :
   * appelé avec des params valides, il émet exactement UN appel, vers le seul endpoint du BFF,
   * sans paramètre parasite (`forbidNonWhitelisted` rejetterait tout extra en 400 — bug 1.7).
   * La preuve de bout en bout « aucun appel BFF sur URL invalide » est l'e2e `booking-recap`.
   */
  it("n’émet qu’un seul appel, sans paramètre non déclaré au DTO du BFF", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: QUOTE }));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useBookingQuote(params), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(
      String(fetchMock.mock.calls[0]?.[0]),
      "http://localhost",
    );
    expect(url.pathname).toMatch(/\/booking\/quote$/);
    expect([...url.searchParams.keys()].sort()).toEqual([
      "checkInDate",
      "checkOutDate",
      "guests",
      "hotelId",
      "roomId",
    ]);
    // La devise de travail segmente l'affichage navigateur, elle n'est JAMAIS envoyée au BFF.
    expect(url.searchParams.get("currency")).toBeNull();
  });
});
