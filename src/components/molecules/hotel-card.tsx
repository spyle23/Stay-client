"use client";

import { useState } from "react";
import Image from "next/image";
import { Building2Icon, MapPinIcon, StarIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { PriceTag } from "@/components/atoms/price-tag";
import { TrustBadge } from "@/components/atoms/trust-badge";
import { cn } from "@/lib/utils";
import type { HotelAvailabilityResult } from "@/services/search.service";

export type HotelCardDensity = "comfortable" | "compact";

/**
 * Carte d'un hôtel **réellement disponible** dans la grille de résultats (UX-DR-2.2).
 * Expose nom, ville, note de catégorie (texte libre PMS), photo (`logoUrl` ou placeholder)
 * et prix « à partir de » (total du séjour, une seule devise). Deux densités (confort/dense).
 *
 * Présentation seule en 1.6 : la navigation vers la fiche hôtel arrive en story 1.9
 * (route `(public)/hotels/[…]` non encore livrée) — pas de lien mort ici.
 */
export function HotelCard({
  hotel,
  density = "comfortable",
}: {
  hotel: HotelAvailabilityResult;
  density?: HotelCardDensity;
}) {
  const t = useTranslations("results");
  const locale = useLocale();
  const compact = density === "compact";
  const name = hotel.name ?? t("unnamedHotel");
  // Distance affichée uniquement en mode proximité (FR-2). Formatée 1 décimale, locale-aware.
  // Garde `Number.isFinite` (pas seulement `!== null`) : un item de cache destination antérieur
  // (sans le champ) donnerait `undefined`, et `Intl.format(undefined)` rendrait « NaN ».
  const distanceLabel =
    typeof hotel.distanceKm === "number" && Number.isFinite(hotel.distanceKm)
      ? new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
          hotel.distanceKm,
        )
      : null;

  return (
    <article
      data-testid="hotel-card"
      data-hotel-id={hotel.hotelId}
      data-density={density}
      className={cn(
        "group/hotel-card flex overflow-hidden rounded-xl bg-card text-card-foreground shadow-soft ring-1 ring-border transition-shadow hover:shadow-elevated",
        compact ? "flex-row" : "flex-col",
      )}
    >
      <HotelThumbnail
        src={hotel.thumbnailUrl}
        alt={name}
        className={compact ? "w-40 shrink-0" : "w-full"}
      />

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <h3 className="text-h3 text-foreground">{name}</h3>
            <p className="inline-flex flex-wrap items-center gap-x-1 text-small text-muted-foreground">
              <MapPinIcon className="size-3.5 shrink-0" aria-hidden="true" />
              <span>{hotel.city ?? t("unknownCity")}</span>
              {distanceLabel !== null ? (
                <span data-testid="hotel-card-distance">
                  {"· "}
                  {t("distanceKm", { km: distanceLabel })}
                </span>
              ) : null}
            </p>
          </div>
          {hotel.category ? (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary-soft px-2 py-0.5 text-caption font-medium text-foreground"
              data-testid="hotel-card-category"
            >
              <StarIcon
                className="size-3.5 shrink-0 text-primary"
                aria-hidden="true"
              />
              <span>{hotel.category}</span>
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <TrustBadge variant="avail" label={t("badgeAvailable")} />
          <TrustBadge variant="free" label={t("badgeFreeCancellation")} />
        </div>

        <div className="mt-auto flex flex-col gap-0.5 pt-2">
          <span className="text-caption text-muted-foreground">
            {t("fromLabel")}
          </span>
          <PriceTag
            amount={hotel.fromTotalPrice}
            currency={hotel.currency}
            size="sm"
            caption={t("totalForNights", { nights: hotel.nights })}
            data-testid="hotel-card-price"
          />
        </div>
      </div>
    </article>
  );
}

function HotelThumbnail({
  src,
  alt,
  className,
}: {
  src: string | null;
  alt: string;
  className?: string;
}) {
  // Repli placeholder si l'URL est absente OU si le chargement échoue (URL cassée/relative).
  const [errored, setErrored] = useState(false);
  return (
    <div
      className={cn(
        "relative aspect-[4/3] overflow-hidden bg-muted",
        className,
      )}
    >
      {src !== null && !errored ? (
        // `unoptimized` : les logos d'hôtels proviennent d'hôtes arbitraires (PMS `/files`)
        // → pas de config `remotePatterns` requise, pas d'avertissement de loader. La passe
        // d'optimisation/CDN (NFR-13) est traitée en Epic 6.
        <Image
          src={src}
          alt={alt}
          fill
          unoptimized
          sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
          className="object-cover"
          onError={() => setErrored(true)}
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center text-muted-foreground"
          aria-hidden="true"
        >
          <Building2Icon className="size-8" />
        </div>
      )}
    </div>
  );
}
