import { ExternalLinkIcon, MapPinIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { HotelDetailResult } from "@/services/catalog.service";

/**
 * Localisation de la fiche hôtel (FR-5). **MVP (Décision 6)** : adresse + **lien carte externe**
 * accessible (nouvel onglet, `rel="noopener noreferrer"`), **sans embed ni tuiles tierces** (évite
 * le consentement RGPD, Epic 5 — NFR-5). Si coordonnées absentes → adresse seule, sans lien mort.
 */
export function HotelLocation({ hotel }: { hotel: HotelDetailResult }) {
  const t = useTranslations("hotel");
  const parts = [
    hotel.address,
    hotel.postalCode,
    hotel.city,
    hotel.country,
  ].filter((part): part is string => Boolean(part && part.trim()));
  const hasCoords = hotel.latitude !== null && hotel.longitude !== null;
  const mapUrl = hasCoords
    ? `https://www.openstreetmap.org/?mlat=${hotel.latitude}&mlon=${hotel.longitude}#map=16/${hotel.latitude}/${hotel.longitude}`
    : null;

  return (
    <section
      aria-labelledby="hotel-location-title"
      data-testid="hotel-location"
      className="flex flex-col gap-2"
    >
      <h2 id="hotel-location-title" className="text-h3 text-foreground">
        {t("locationTitle")}
      </h2>
      {parts.length > 0 ? (
        <p className="inline-flex items-start gap-1.5 text-body text-muted-foreground">
          <MapPinIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{parts.join(", ")}</span>
        </p>
      ) : (
        <p className="text-body text-muted-foreground">
          {t("locationUnknown")}
        </p>
      )}
      {mapUrl ? (
        <a
          href={mapUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="hotel-map-link"
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "inline-flex w-fit min-h-(--tap-min) items-center gap-1.5",
          )}
        >
          <ExternalLinkIcon className="size-4" aria-hidden="true" />
          {t("viewOnMap")}
        </a>
      ) : null}
    </section>
  );
}
