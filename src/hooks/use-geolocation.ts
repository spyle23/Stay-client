"use client";

import { useCallback, useState } from "react";

import {
  requestCurrentPosition,
  type GeolocationFailureReason,
  type GeolocationResult,
} from "@/lib/geolocation";

export type GeolocationStatus = "idle" | "prompting" | "success" | "error";

export interface UseGeolocation {
  status: GeolocationStatus;
  latitude: number | null;
  longitude: number | null;
  error: GeolocationFailureReason | null;
  /** Déclenche la demande de position (sur action utilisateur). Renvoie le résultat pour un
   *  usage immédiat par l'appelant (navigation sans attendre un re-render). */
  request: () => Promise<GeolocationResult>;
  reset: () => void;
}

/**
 * Hook de géolocalisation (FR-2). L'état est piloté par l'action utilisateur (`request`),
 * jamais par un `useEffect` de montage — conforme aux règles ESLint Next 16 du projet.
 */
export function useGeolocation(): UseGeolocation {
  const [status, setStatus] = useState<GeolocationStatus>("idle");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [error, setError] = useState<GeolocationFailureReason | null>(null);

  const request = useCallback(async (): Promise<GeolocationResult> => {
    setStatus("prompting");
    setError(null);
    const result = await requestCurrentPosition();
    if (result.ok) {
      setCoords({ lat: result.latitude, lng: result.longitude });
      setStatus("success");
    } else {
      setError(result.reason);
      setStatus("error");
    }
    return result;
  }, []);

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
    setCoords(null);
  }, []);

  return {
    status,
    latitude: coords?.lat ?? null,
    longitude: coords?.lng ?? null,
    error,
    request,
    reset,
  };
}
