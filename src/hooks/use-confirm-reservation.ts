"use client";

import { useCallback, useEffect, useRef } from "react";
import { useMutation, useMutationState } from "@tanstack/react-query";

import {
  confirmFailureReason,
  confirmReservation,
  paymentKeys,
  type ConfirmationProofResult,
} from "@/services/payment.service";

/** Délai avant l'unique nouvel essai automatique (ms). */
const RETRY_DELAY_MS = 1_500;

export type ConfirmStatus = "confirming" | "confirmed" | "failed";

export interface ConfirmReservationState {
  status: ConfirmStatus;
  proof: ConfirmationProofResult | null;
  error: unknown;
  /** Relance manuelle (« Réessayer ») — réservée aux motifs rejouables. */
  retry: () => void;
}

/**
 * Confirmation ferme de la réservation (story 3.2, C4 / AC-10).
 *
 * ## Une mutation, déclenchée UNE fois par montage
 *
 * C'est une écriture (capture + `Pending → Confirmed` côté PMS) : une **mutation**, et non une
 * requête comme l'intent de la 3.1. Elle part d'un `useEffect`, gardée par une `useRef` : le double
 * montage de StrictMode rejoue l'effet, la référence, elle, survit — un seul appel part.
 *
 * ## L'état se lit dans le cache des mutations, pas dans l'observateur
 *
 * Piège de la 3.1 : au démontage simulé de StrictMode, l'observateur de `useMutation` se détache de
 * la mutation en vol et ne s'y rattache jamais — l'écran restait sur « en cours » alors que la
 * réponse était arrivée. L'état est donc lu par `useMutationState` (clé de mutation), qui suit le
 * cache lui-même, quel que soit l'observateur qui a lancé l'appel.
 *
 * Un nouvel essai automatique, différé, sur une panne seulement (`unavailable`, `unknown`) : l'appel
 * est idempotent par contrat. Un refus déterministe ne se rejoue pas.
 */
export function useConfirmReservation(
  reservationId: string,
): ConfirmReservationState {
  const mutationKey = paymentKeys.confirm(reservationId);

  const { mutate } = useMutation<ConfirmationProofResult, unknown, string>({
    mutationKey,
    mutationFn: (id) => confirmReservation(id),
    retry: (failureCount, error) => {
      const reason = confirmFailureReason(error);
      return (
        failureCount < 1 && (reason === "unavailable" || reason === "unknown")
      );
    },
    retryDelay: RETRY_DELAY_MS,
  });

  const states = useMutationState({
    filters: { mutationKey, exact: true },
    select: (mutation) => mutation.state,
  });
  const latest = states.length > 0 ? states[states.length - 1] : undefined;

  const started = useRef(false);
  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;
    mutate(reservationId);
  }, [mutate, reservationId]);

  const retry = useCallback(() => {
    mutate(reservationId);
  }, [mutate, reservationId]);

  if (latest?.status === "success" && latest.data) {
    return {
      status: "confirmed",
      proof: latest.data as ConfirmationProofResult,
      error: null,
      retry,
    };
  }
  if (latest?.status === "error") {
    return { status: "failed", proof: null, error: latest.error, retry };
  }
  // `idle` (avant l'effet) et `pending` : la confirmation est en cours.
  return { status: "confirming", proof: null, error: null, retry };
}
