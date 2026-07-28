"use client";

import Link from "next/link";
import { MapPinIcon, StarIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { PriceTag } from "@/components/atoms/price-tag";
import { RemoteImage } from "@/components/atoms/remote-image";
import { TrustBadge } from "@/components/atoms/trust-badge";
import { cn } from "@/lib/utils";
import type { HotelAvailabilityResult } from "@/services/search.service";

export type HotelCardDensity = "comfortable" | "compact";

/**
 * Carte d'un hôtel **réellement disponible** dans la grille de résultats (UX-DR-2.2).
 * Expose nom, ville, note de catégorie (texte libre PMS), photo (`logoUrl` ou placeholder)
 * et prix « à partir de » (total du séjour, une seule devise). Deux densités (confort/dense).
 *
 * Depuis la story 1.9, la carte est un **lien** vers la fiche hôtel (`href`) : le nom (`h3`)
 * porte le nom accessible du lien (UX-DR-2.2 « carte = lien »). Sans `href`, elle reste un
 * simple `article` (rétro-compatibilité).
 */
export function HotelCard({
  hotel,
  href,
  density = "comfortable",
}: {
  hotel: HotelAvailabilityResult;
  href?: string;
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

  const cardClass = cn(
    "group/hotel-card flex overflow-hidden rounded-xl bg-card text-card-foreground shadow-soft ring-1 ring-border transition-shadow hover:shadow-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    compact ? "flex-row" : "flex-col",
  );

  const inner = (
    <>
      <RemoteImage
        src={hotel.thumbnailUrl}
        alt={name}
        sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
        className={cn("aspect-[4/3]", compact ? "w-40 shrink-0" : "w-full")}
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

        {/* « Disponibilité réelle » est factuel (la liste est availability-first). En revanche,
            aucun badge « annulation gratuite » : le PMS n'expose aucune politique par hôtel
            (dépendance D2) — les conditions sont présentées avant paiement dans le tunnel
            (story 2.2, FR-7/FR-22). Promettre une gratuité sans donnée = dark pattern (UX-DR-9.5). */}
        <div className="flex flex-wrap gap-1.5">
          <TrustBadge variant="avail" label={t("badgeAvailable")} />
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
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        data-testid="hotel-card"
        data-hotel-id={hotel.hotelId}
        data-density={density}
        className={cardClass}
      >
        {inner}
      </Link>
    );
  }

  return (
    <article
      data-testid="hotel-card"
      data-hotel-id={hotel.hotelId}
      data-density={density}
      className={cardClass}
    >
      {inner}
    </article>
  );
}
