import { StrictMode, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ApiClientError } from "@/lib/api-client";

const confirmReservation = vi.fn();
vi.mock("@/services/payment.service", async () => {
  const actual = await vi.importActual<
    typeof import("@/services/payment.service")
  >("@/services/payment.service");
  return { ...actual, confirmReservation };
});

const { useConfirmReservation } =
  await import("@/hooks/use-confirm-reservation");

const RESERVATION_ID = "33333333-3333-4333-8333-333333333333";
const PROOF = { reservationId: RESERVATION_ID, reservationCode: "RES-1" };

function wrapper(strict: boolean) {
  const client = new QueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    const tree = (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return strict ? <StrictMode>{tree}</StrictMode> : tree;
  };
}

/**
 * Story 3.2 (C4 / AC-10) — la mutation de confirmation.
 *
 * Le piège de la 3.1 : sous StrictMode, l'observateur d'une mutation se détache de l'appel en vol
 * et l'écran reste « en cours ». Ces tests vérifient l'appel unique ET l'arrivée du résultat.
 */
describe("useConfirmReservation", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("StrictMode : un seul appel, et le résultat atteint bien l'écran", async () => {
    confirmReservation.mockResolvedValue(PROOF);

    const { result } = renderHook(() => useConfirmReservation(RESERVATION_ID), {
      wrapper: wrapper(true),
    });

    expect(result.current.status).toBe("confirming");
    await waitFor(() => expect(result.current.status).toBe("confirmed"));
    expect(result.current.proof).toEqual(PROOF);
    expect(confirmReservation).toHaveBeenCalledTimes(1);
    expect(confirmReservation).toHaveBeenCalledWith(RESERVATION_ID);
  });

  it("un re-rendu ne relance pas la confirmation", async () => {
    confirmReservation.mockResolvedValue(PROOF);
    const { result, rerender } = renderHook(
      () => useConfirmReservation(RESERVATION_ID),
      { wrapper: wrapper(false) },
    );
    await waitFor(() => expect(result.current.status).toBe("confirmed"));

    rerender();
    rerender();

    expect(confirmReservation).toHaveBeenCalledTimes(1);
  });

  it("refus déterministe : échec immédiat, aucun nouvel essai automatique", async () => {
    confirmReservation.mockRejectedValue(
      new ApiClientError("…", 409, { reason: ["amount-mismatch"] }),
    );
    const { result } = renderHook(() => useConfirmReservation(RESERVATION_ID), {
      wrapper: wrapper(false),
    });

    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(confirmReservation).toHaveBeenCalledTimes(1);
  });

  it("panne : un seul nouvel essai automatique, différé, avant d'abandonner", async () => {
    confirmReservation
      .mockRejectedValueOnce(new ApiClientError("…", 503))
      .mockResolvedValueOnce(PROOF);
    const { result } = renderHook(() => useConfirmReservation(RESERVATION_ID), {
      wrapper: wrapper(false),
    });

    await waitFor(() => expect(result.current.status).toBe("confirmed"), {
      timeout: 4_000,
    });
    expect(confirmReservation).toHaveBeenCalledTimes(2);
  });

  it("#183 : paiement en cours de vérification → un nouvel essai automatique, différé", async () => {
    confirmReservation
      .mockRejectedValueOnce(
        new ApiClientError("…", 503, {
          reason: ["payment-verification-pending"],
        }),
      )
      .mockResolvedValueOnce(PROOF);
    const { result } = renderHook(() => useConfirmReservation(RESERVATION_ID), {
      wrapper: wrapper(false),
    });

    await waitFor(() => expect(result.current.status).toBe("confirmed"), {
      timeout: 4_000,
    });
    expect(confirmReservation).toHaveBeenCalledTimes(2);
  });

  it("retry() relance explicitement la confirmation", async () => {
    confirmReservation
      .mockRejectedValueOnce(
        new ApiClientError("…", 502, { reason: ["capture-failed"] }),
      )
      .mockResolvedValueOnce(PROOF);
    const { result } = renderHook(() => useConfirmReservation(RESERVATION_ID), {
      wrapper: wrapper(false),
    });
    await waitFor(() => expect(result.current.status).toBe("failed"));

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.status).toBe("confirmed"));
    expect(confirmReservation).toHaveBeenCalledTimes(2);
  });
});
