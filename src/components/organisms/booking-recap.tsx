"use client";

import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { BookingStayEditor } from "@/components/organisms/booking-stay-editor";
import { BookingSummary } from "@/components/organisms/booking-summary";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useBookingQuote } from "@/hooks/use-booking-quote";
import { ApiClientError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { ParsedBookingParams } from "@/lib/validations/booking";
import { buildIdentifyUrl, isOverCapacity } from "@/services/booking.service";
import {
  buildHotelPageUrl,
  buildRoomPageUrl,
} from "@/services/catalog.service";

/**
 * Île client du récapitulatif (étape 1 du tunnel, FR-7). Le fetch s'exécute côté navigateur
 * → interceptable en e2e isolé (`page.route`) et re-jouable à chaque modification du séjour.
 *
 * États explicites (UX-DR-3.14) : chargement / chambre introuvable (404) / dégradation PMS (503) /
 * erreur / succès. **Jamais de cul-de-sac** (UX-DR-4.5) : chaque état offre une porte de sortie
 * (retour fiche chambre ou page hôtel).
 */
export function BookingRecap({ params }: { params: ParsedBookingParams }) {
  const t = useTranslations("booking");
  const query = useBookingQuote(params);

  const stayContext = {
    checkInDate: params.checkInDate,
    checkOutDate: params.checkOutDate,
    guests: params.guests,
    currency: params.currency,
  };

  if (query.isPending) {
    return (
      <div
        data-testid="booking-loading"
        aria-busy="true"
        aria-live="polite"
        aria-label={t("loading")}
        className="grid gap-6 lg:grid-cols-[1fr_22rem]"
      >
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (query.isError) {
    const status =
      query.error instanceof ApiClientError ? query.error.status : 0;
    const notFound = status === 404;
    const degraded = status >= 500;
    // Un 4xx qui n'est pas un 404 est une **saisie refusée** (séjour hors bornes, contexte
    // incohérent), pas une panne : la rejouer à l'identique échouera toujours. On masque donc
    // « Réessayer » et on conserve l'éditeur de séjour pour que la correction se fasse sur place
    // — sans quoi l'écran d'erreur serait un cul-de-sac (UX-DR-4.5).
    const invalidStay = status >= 400 && status < 500 && !notFound;
    return (
      <div className="flex flex-col gap-4">
        <div
          role="alert"
          data-testid={
            notFound
              ? "booking-not-found"
              : invalidStay
                ? "booking-stay-rejected"
                : "booking-error"
          }
          className="flex flex-col items-center gap-3 rounded-xl bg-card p-8 text-center ring-1 ring-border"
        >
          <p className="text-h3 text-foreground">
            {notFound
              ? t("notFoundTitle")
              : invalidStay
                ? t("stayRejectedTitle")
                : degraded
                  ? t("degradedTitle")
                  : t("errorTitle")}
          </p>
          <p className="max-w-md text-body text-muted-foreground">
            {notFound
              ? t("notFoundBody")
              : invalidStay
                ? t("stayRejectedBody")
                : degraded
                  ? t("degradedBody")
                  : t("errorBody")}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {!notFound && !invalidStay ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void query.refetch()}
                className="min-h-(--tap-min)"
                data-testid="booking-retry"
              >
                {t("retry")}
              </Button>
            ) : null}
            <Link
              href={buildHotelPageUrl(params.hotelId, null, stayContext)}
              className={cn(
                buttonVariants({ variant: "outline" }),
                "min-h-(--tap-min)",
              )}
              data-testid="booking-error-exit"
            >
              {t("seeOtherRooms")}
            </Link>
          </div>
        </div>

        {invalidStay ? <BookingStayEditor params={params} /> : null}
      </div>
    );
  }

  const quote = query.data;
  // `keepPreviousData` : pendant un recalcul, `quote` décrit encore le séjour PRÉCÉDENT alors que
  // `params` porte déjà le nouveau. Laisser le CTA ouvert ferait entrer à l'étape 2 avec un séjour
  // jamais tarifé ni vérifié en disponibilité — on le neutralise le temps du recalcul.
  const recalculating = query.isPlaceholderData;
  // Une chambre réellement indisponible bloque le passage à l'étape suivante (pas de lien mort
  // vers un tunnel qui échouerait à la création). Une disponibilité **indéterminée** (panne PMS)
  // ne bloque PAS : elle sera tranchée à la création (règle 1.10).
  // Dépassement de capacité : fait **déterministe**, connu du devis lui-même — pas une incertitude
  // PMS. La règle « la dégradation ne bloque jamais » (AC-7) est réservée à l'incertitude ; ici,
  // laisser passer mènerait à une création vouée à l'échec en 2.4, après l'identification.
  const overCapacity = isOverCapacity(quote);
  // Le PMS sort de toute façon la chambre de son set daté quand la capacité est dépassée : sans
  // cette exclusion, l'écran afficherait la cause vague (« elle n'est plus disponible… ou votre
  // nombre de voyageurs ») À CÔTÉ de la cause réelle. Une seule explication, la bonne.
  const unavailable =
    !quote.available && !quote.availabilityDegraded && !overCapacity;
  const blocked = unavailable || overCapacity || recalculating;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-4">
        <Link
          href={buildRoomPageUrl(
            quote.hotelId,
            quote.roomId,
            quote.hotelName,
            stayContext,
          )}
          className={cn(
            buttonVariants({ variant: "link" }),
            "min-h-(--tap-min) items-center gap-1 self-start px-0",
          )}
          data-testid="booking-back-to-room"
        >
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
          {t("backToRoom")}
        </Link>

        <BookingStayEditor params={params} />

        {/* `unavailable` et NON `blocked` : un recalcul en cours neutralise le CTA, mais il
            n'autorise pas à affirmer que la chambre est indisponible (même exigence d'honnêteté
            que l'ordre dégradé/indisponible hérité de 1.10). */}
        {unavailable ? (
          <div
            role="alert"
            data-testid="booking-unavailable"
            className="flex flex-col items-start gap-3 rounded-xl bg-warning-soft p-4 text-warning"
          >
            <p className="text-body font-medium">{t("unavailableTitle")}</p>
            <p className="text-small">{t("unavailableBody")}</p>
            <Link
              href={buildHotelPageUrl(
                quote.hotelId,
                quote.hotelName,
                stayContext,
              )}
              className={cn(
                buttonVariants({ variant: "outline" }),
                "min-h-(--tap-min)",
              )}
              data-testid="booking-unavailable-exit"
            >
              {t("seeOtherRooms")}
            </Link>
          </div>
        ) : null}

        {overCapacity ? (
          <div
            role="alert"
            data-testid="booking-over-capacity"
            className="flex flex-col items-start gap-3 rounded-xl bg-warning-soft p-4 text-warning"
          >
            <p className="text-body font-medium">{t("overCapacityTitle")}</p>
            <p className="text-small">
              {t("overCapacityBody", {
                capacity: quote.roomCapacity ?? 0,
                guests: quote.guests,
              })}
            </p>
            {/* Porte de sortie : ce bloc remplace l'avis générique d'indisponibilité, il doit donc
                en reprendre l'issue — jamais de cul-de-sac (UX-DR-4.5). */}
            <Link
              href={buildHotelPageUrl(
                quote.hotelId,
                quote.hotelName,
                stayContext,
              )}
              className={cn(
                buttonVariants({ variant: "outline" }),
                "min-h-(--tap-min)",
              )}
              data-testid="booking-over-capacity-exit"
            >
              {t("seeOtherRooms")}
            </Link>
          </div>
        ) : null}

        {blocked ? (
          <button
            type="button"
            disabled
            aria-disabled="true"
            data-testid="booking-continue-disabled"
            data-blocked-reason={
              unavailable
                ? "unavailable"
                : overCapacity
                  ? "over-capacity"
                  : "recalculating"
            }
            className={cn(
              buttonVariants({ size: "lg" }),
              "min-h-(--tap-min) w-full lg:w-auto",
            )}
          >
            {t("continueCta")}
          </button>
        ) : (
          <Link
            href={buildIdentifyUrl(params)}
            className={cn(
              buttonVariants({ size: "lg" }),
              "min-h-(--tap-min) w-full lg:w-auto",
            )}
            data-testid="booking-continue"
          >
            {t("continueCta")}
          </Link>
        )}
      </div>

      {/* `isPlaceholderData` (et NON `isFetching`) : le squelette de recalcul ne doit apparaître
          que sur un vrai changement de séjour — un refetch d'arrière-plan (retour d'onglet,
          retry) ne doit pas faire clignoter le total déjà affiché. */}
      <BookingSummary quote={quote} recalculating={recalculating} />
    </div>
  );
}
