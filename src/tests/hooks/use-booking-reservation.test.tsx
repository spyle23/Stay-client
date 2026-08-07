import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";

import { shouldRetryRead } from "@/components/providers/query-provider";
import {
  useBookingReservation,
  useCreateReservation,
} from "@/hooks/use-booking-reservation";
import type { ParsedBookingParams } from "@/lib/validations/booking";
import { reservationKeys } from "@/services/booking.service";

const HOTEL_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const ROOM_ID = "22222222-2222-4222-8222-222222222222";
/**
 * ⚠️ Porte volontairement des **lettres hexadécimales** : un GUID tout en chiffres rendrait
 * `toUpperCase()` sans effet, et les tests de casse ci-dessous ne prouveraient rien.
 */
const RESERVATION_ID = "33333333-abcd-4ef1-8abc-333333333333";

const params: ParsedBookingParams = {
  hotelId: HOTEL_ID,
  roomId: ROOM_ID,
  checkInDate: "2999-07-05",
  checkOutDate: "2999-07-07",
  guests: 2,
  currency: "EUR",
};

const reservation = {
  reservationId: RESERVATION_ID,
  reservationCode: "RES-29990705-A1B2C",
  status: "Pending",
  hotelId: HOTEL_ID,
  hotelName: "Hôtel Colline",
  roomId: ROOM_ID,
  roomNumber: "204",
  roomCategory: "Double Confort",
  checkInDate: "2999-07-05",
  checkOutDate: "2999-07-07",
  nights: 2,
  guests: 2,
  currency: "EUR",
  pricePerNight: 8400,
  total: 16_800,
  holdExpiresAt: "2999-07-05T10:15:00.000Z",
  created: true,
};

/**
 * Harnais aligné sur les **défauts de production** (`QueryProvider`), et non sur des surcharges de
 * test.
 *
 * Le harnais précédent imposait `queries: { retry: false }` **et** `mutations: { retry: false }` :
 * la garantie « aucun rejeu d'une création échouée » y était vraie par construction — supprimer
 * `retry: 0` du hook aurait laissé le test au vert. Reproduire la configuration réelle est la
 * seule façon de tester ce que le voyageur exécute vraiment (`refetchOnWindowFocus: false` global
 * compris — c'est précisément lui que la relecture de réservation doit surcharger).
 */
function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetryRead,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: 0 },
    },
  });
}

/**
 * Client **hostile** : il rejouerait volontiers une mutation échouée.
 *
 * C'est le seul montage qui prouve quelque chose sur le `retry: 0` du hook — sous un client qui
 * n'a de toute façon aucune intention de rejouer (défaut React Query comme défaut de production),
 * l'assertion ne testerait que React Query.
 */
function makeRetryHungryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: 3, retryDelay: 0 },
    },
  });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

function stubFetch(response: () => unknown) {
  const fetchMock = vi.fn(() => Promise.resolve(response()));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const ok = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  // `setFocused` pose une surcharge **globale** au gestionnaire de focus : la laisser en place
  // contaminerait les fichiers de test suivants.
  focusManager.setFocused(undefined);
});

describe("useCreateReservation", () => {
  it("place la réservation créée dans le cache, sans aller-retour supplémentaire", async () => {
    const fetchMock = stubFetch(() =>
      ok({ success: true, data: reservation }, 201),
    );
    const client = makeClient();

    const { result } = renderHook(() => useCreateReservation(), {
      wrapper: wrapperFor(client),
    });

    await result.current.mutateAsync({
      params,
      expected: { total: 16_800, currency: "EUR" },
    });

    await waitFor(() =>
      expect(
        client.getQueryData(reservationKeys.byId(RESERVATION_ID)),
      ).toMatchObject({ reservationId: RESERVATION_ID }),
    );
    // Le corps de la réponse EST l'état à jour : aucune relecture n'est déclenchée.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ne rejoue jamais une création échouée (écriture non idempotente côté PMS)", async () => {
    const fetchMock = stubFetch(() =>
      ok(
        {
          success: false,
          message: "x",
          errors: { reason: ["room-unavailable"] },
        },
        409,
      ),
    );
    // Client qui rejouerait 3 fois : seul le `retry: 0` du hook peut l'en empêcher.
    const client = makeRetryHungryClient();

    const { result } = renderHook(() => useCreateReservation(), {
      wrapper: wrapperFor(client),
    });

    await expect(
      result.current.mutateAsync({
        params,
        expected: { total: 16_800, currency: "EUR" },
      }),
    ).rejects.toBeDefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /**
   * Le PMS est libre de sérialiser ses GUID en majuscules ; `parseGuid` (`validations/booking.ts`)
   * met, lui, le `reservationId` de l'URL en **minuscules**. Poser la donnée sous une clé et la
   * relire sous une autre remplacerait par un squelette le panneau qui vient de s'afficher.
   */
  it("pose la réservation sous une clé insensible à la casse du GUID", async () => {
    const fetchMock = stubFetch(() =>
      ok(
        {
          success: true,
          data: {
            ...reservation,
            reservationId: RESERVATION_ID.toUpperCase(),
          },
        },
        201,
      ),
    );
    const client = makeClient();

    const { result } = renderHook(() => useCreateReservation(), {
      wrapper: wrapperFor(client),
    });
    await result.current.mutateAsync({
      params,
      expected: { total: 16_800, currency: "EUR" },
    });

    // Clé **de l'URL** (minuscules) : c'est celle que `useBookingReservation` interrogera.
    await waitFor(() =>
      expect(
        client.getQueryData(reservationKeys.byId(RESERVATION_ID)),
      ).toBeDefined(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("useBookingReservation", () => {
  it("n'émet aucune requête tant qu'aucune réservation n'est portée par l'URL", () => {
    const fetchMock = stubFetch(() => ok({ success: true, data: reservation }));

    renderHook(() => useBookingReservation(null), {
      wrapper: wrapperFor(makeClient()),
    });

    // Avant création, il n'y a rien à lire : une requête serait un 400 garanti.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("relit la réservation dès qu'un identifiant est présent", async () => {
    const fetchMock = stubFetch(() =>
      ok({ success: true, data: { ...reservation, created: false } }),
    );

    const { result } = renderHook(() => useBookingReservation(RESERVATION_ID), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.created).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /** Reprise immédiate : la lecture consomme ce que la création vient de poser, GUID normalisé. */
  it("sert la réservation créée sans nouvel aller-retour, même si le PMS a répondu en majuscules", async () => {
    const fetchMock = stubFetch(() =>
      ok(
        {
          success: true,
          data: {
            ...reservation,
            reservationId: RESERVATION_ID.toUpperCase(),
          },
        },
        201,
      ),
    );
    const client = makeClient();

    const creation = renderHook(() => useCreateReservation(), {
      wrapper: wrapperFor(client),
    });
    await creation.result.current.mutateAsync({
      params,
      expected: { total: 16_800, currency: "EUR" },
    });

    const read = renderHook(() => useBookingReservation(RESERVATION_ID), {
      wrapper: wrapperFor(client),
    });

    // Dès le premier rendu : pas de squelette, pas de second appel au BFF.
    expect(read.result.current.data).toBeDefined();
    expect(read.result.current.isPending).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /**
   * ⚠️ Régression réelle : `staleTime` ne déclenche **aucun** refetch, `refetchOnWindowFocus` est
   * à `false` pour toutes les lectures (`query-provider.tsx`) et rien n'invalide cette clé. Sans
   * revalidation, l'état lu au premier rendu restait affiché pour toute la visite — et l'écran
   * pouvait proposer de payer une chambre déjà remise à la vente par le balayeur de holds.
   */
  it("revalide périodiquement tant que la réservation peut encore bouger", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = stubFetch(() =>
      ok({ success: true, data: { ...reservation, created: false } }),
    );

    const { result } = renderHook(() => useBookingReservation(RESERVATION_ID), {
      wrapper: wrapperFor(makeClient()),
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(31_000);

    await waitFor(() =>
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
  });

  it("cesse de sonder une réservation figée (annulée : plus rien à apprendre)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = stubFetch(() =>
      ok({
        success: true,
        data: { ...reservation, status: "Cancelled", holdExpiresAt: null },
      }),
    );

    const { result } = renderHook(() => useBookingReservation(RESERVATION_ID), {
      wrapper: wrapperFor(makeClient()),
    });
    await waitFor(() => expect(result.current.data).toBeDefined());

    await vi.advanceTimersByTimeAsync(120_000);

    // Marteler le PMS partagé pour un statut définitif serait du bruit pur.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("relit au retour d'onglet une fois la donnée périmée (surcharge du défaut global)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = stubFetch(() =>
      ok({ success: true, data: { ...reservation, created: false } }),
    );

    const { result } = renderHook(() => useBookingReservation(RESERVATION_ID), {
      wrapper: wrapperFor(makeClient()),
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Onglet quitté puis repris APRÈS la fraîcheur (15 s), mais avant le sondage (30 s) : le
    // refetch observé ne peut venir que du retour de focus.
    focusManager.setFocused(false);
    await vi.advanceTimersByTimeAsync(16_000);
    focusManager.setFocused(true);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
