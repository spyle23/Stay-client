"use client";

import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";

import {
  confirmationDocumentKeys,
  fetchConfirmationPdf,
  fetchConfirmationQr,
} from "@/services/booking.service";

/**
 * Documents de la preuve de confirmation (story 3.2, C5 / AC-8).
 *
 * Les deux passent par `fetch` + cookie de session puis une **URL objet** : le front (:3001) et le
 * BFF (:4000) sont d'origines différentes, et un `<img src>` direct partirait sans la session.
 * Chaque URL objet est **révoquée** au démontage (fuite mémoire sinon).
 *
 * - le QR est chargé au montage ;
 * - le PDF l'est **à la demande** : le générer à chaque affichage ferait travailler le PMS pour rien.
 *
 * `staleTime: Infinity`, `retry: false` : un document ne change pas, et un échec rend la main
 * (bouton « Réessayer ») plutôt que de marteler le PMS.
 */

export type QrStatus = "loading" | "ready" | "error";

export function useConfirmationQr(reservationId: string): {
  status: QrStatus;
  /** Image PNG lue au BFF ; à afficher par `useObjectUrlSource` (URL objet révoquée au démontage). */
  blob: Blob | null;
  retry: () => void;
} {
  const query = useQuery({
    queryKey: confirmationDocumentKeys.qr(reservationId),
    queryFn: () => fetchConfirmationQr(reservationId),
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const blob = query.data?.blob ?? null;
  const { refetch } = query;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  if (query.isError) {
    return { status: "error", blob: null, retry };
  }
  return { status: blob ? "ready" : "loading", blob, retry };
}

export type PdfStatus = "idle" | "generating" | "ready" | "error";

export function useConfirmationPdf(reservationId: string): {
  status: PdfStatus;
  /** Lance la génération si besoin, puis le téléchargement sous `fileName`. */
  download: (fileName: string) => void;
} {
  const [requested, setRequested] = useState(false);
  const pendingFileName = useRef<string | null>(null);
  const objectUrl = useRef<string | null>(null);

  const query = useQuery({
    queryKey: confirmationDocumentKeys.pdf(reservationId),
    queryFn: () => fetchConfirmationPdf(reservationId),
    enabled: requested,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const save = useCallback((blob: Blob, fileName: string) => {
    if (objectUrl.current) {
      URL.revokeObjectURL(objectUrl.current);
    }
    const url = URL.createObjectURL(blob);
    objectUrl.current = url;
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }, []);

  // Le document arrive après le clic : le téléchargement demandé part à ce moment-là.
  useEffect(() => {
    if (query.data && pendingFileName.current) {
      save(query.data.blob, pendingFileName.current);
      pendingFileName.current = null;
    }
  }, [query.data, save]);

  useEffect(
    () => () => {
      if (objectUrl.current) {
        URL.revokeObjectURL(objectUrl.current);
        objectUrl.current = null;
      }
    },
    [],
  );

  const { refetch } = query;
  const download = useCallback(
    (fileName: string) => {
      if (query.data) {
        save(query.data.blob, fileName);
        return;
      }
      pendingFileName.current = fileName;
      if (!requested) {
        setRequested(true);
      } else {
        void refetch();
      }
    },
    [query.data, requested, refetch, save],
  );

  const status: PdfStatus = query.isFetching
    ? "generating"
    : query.isError
      ? "error"
      : query.data
        ? "ready"
        : "idle";

  return { status, download };
}

/**
 * Pose une URL objet du blob comme `src` de l'image référencée, et la **révoque** quand le blob
 * change ou au démontage.
 *
 * L'URL est créée dans l'effet, jamais pendant le rendu : sous StrictMode, le démontage simulé
 * révoque l'URL et le remontage en crée une neuve — une URL mémorisée au rendu resterait révoquée,
 * et l'image cassée.
 */
export function useObjectUrlSource(
  blob: Blob | null,
): RefObject<HTMLImageElement | null> {
  const ref = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const image = ref.current;
    if (!blob || !image) {
      return;
    }
    const url = URL.createObjectURL(blob);
    image.src = url;
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [blob]);

  return ref;
}
