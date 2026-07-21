import Link from "next/link";
import {
  ArrowLeftIcon,
  CheckIcon,
  CircleAlertIcon,
  InfoIcon,
  LayersIcon,
  UsersIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { PriceTag } from "@/components/atoms/price-tag";
import { TrustBadge } from "@/components/atoms/trust-badge";
import { HotelGallery } from "@/components/organisms/hotel-gallery";
import { buttonVariants } from "@/components/ui/button";
import { parseAmenities } from "@/lib/amenities";
import { cn } from "@/lib/utils";
import {
  buildBookingUrl,
  buildHotelPageUrl,
  type RoomDetailResult,
  type StayContext,
} from "@/services/catalog.service";

/**
 * Fiche chambre publique (UX-DR-3.4, FR-6). Rendu **SSR** (Server Component) assemblant photos,
 * catégorie, capacité, équipements, services inclus, prix (total du séjour si dates, sinon prix/nuit,
 * devise de l'Hôtel) et l'action **Réserver**. La surface porte **`data-hotel-theme`** (AC-7 —
 * accent hôtel neutre par défaut).
 *
 * **Disponibilité** (AC-2, jamais la couleur seule — icône + texte) :
 * - `available` → CTA « Réserver » actif vers le tunnel en conservant hôtel/chambre/dates.
 * - `!available` → bloc « indisponible » + CTA **désactivé** (pas de lien mort).
 * - `availabilityDegraded` (dispo datée indéterminée) → avis discret, jamais « indisponible ».
 *
 * **Replis** : services d'hôtel gated D9 non affichés (seuls les `includedServices` de la chambre,
 * publics) ; annulation = badge **générique** (D2 — politique ferme non exposée).
 */
export function RoomDetail({
  room,
  context,
}: {
  room: RoomDetailResult;
  context: StayContext;
}) {
  const t = useTranslations("hotel");
  const hotelName = room.hotelName ?? t("unnamed");
  const title = room.category ?? t("roomDefault");
  const amenities = parseAmenities(room.amenities);
  const hasTotal = room.totalPrice !== null && room.nights !== null;
  const hasDates = room.nights !== null;

  const galleryImages = room.images.map((image) => ({
    url: image.url,
    roomNumber: room.number,
  }));

  return (
    <article
      data-hotel-theme
      data-testid="room-detail"
      data-room-id={room.id}
      className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6"
    >
      <Link
        href={buildHotelPageUrl(room.hotelId, room.hotelName, context)}
        className={cn(
          buttonVariants({ variant: "link" }),
          "min-h-(--tap-min) items-center gap-1 self-start px-0",
        )}
        data-testid="room-back-to-hotel"
      >
        <ArrowLeftIcon className="size-4" aria-hidden="true" />
        {t("backToHotel")}
      </Link>

      <header className="flex flex-col gap-2">
        <p className="text-small text-muted-foreground">{hotelName}</p>
        <h1 className="text-h1 text-foreground">{title}</h1>
        <p className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-muted-foreground">
          {/* Capacité inconnue → jamais « 0 voyageur ». */}
          {room.capacity !== null ? (
            <span className="inline-flex items-center gap-1">
              <UsersIcon className="size-3.5 shrink-0" aria-hidden="true" />
              {t("capacity", { count: room.capacity })}
            </span>
          ) : null}
          {room.number ? (
            <span>{t("roomNumber", { number: room.number })}</span>
          ) : null}
          {room.floor !== null ? (
            <span className="inline-flex items-center gap-1">
              <LayersIcon className="size-3.5 shrink-0" aria-hidden="true" />
              {t("floor", { floor: room.floor })}
            </span>
          ) : null}
        </p>
      </header>

      <HotelGallery images={galleryImages} hotelName={hotelName} />

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-8">
          {room.description ? (
            <section
              aria-labelledby="room-about-title"
              className="flex flex-col gap-2"
            >
              <h2 id="room-about-title" className="text-h3 text-foreground">
                {t("descriptionLabel")}
              </h2>
              <p className="max-w-prose text-body text-muted-foreground">
                {room.description}
              </p>
            </section>
          ) : null}

          {amenities.length > 0 ? (
            <section
              aria-labelledby="room-amenities-title"
              className="flex flex-col gap-2"
            >
              <h2 id="room-amenities-title" className="text-h3 text-foreground">
                {t("amenitiesLabel")}
              </h2>
              <ul className="flex flex-wrap gap-1.5">
                {amenities.map((amenity) => (
                  <li
                    key={amenity}
                    className="rounded-md bg-muted px-2 py-0.5 text-caption text-muted-foreground"
                  >
                    {amenity}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {room.includedServices.length > 0 ? (
            <section
              aria-labelledby="room-services-title"
              className="flex flex-col gap-2"
            >
              <h2 id="room-services-title" className="text-h3 text-foreground">
                {t("includedServicesLabel")}
              </h2>
              <ul
                className="flex flex-col gap-1.5"
                data-testid="room-included-services"
              >
                {room.includedServices.map((service) => (
                  <li
                    key={service.name}
                    className="inline-flex items-start gap-2 text-body text-muted-foreground"
                  >
                    <CheckIcon
                      className="mt-0.5 size-4 shrink-0 text-success"
                      aria-hidden="true"
                    />
                    <span>
                      {service.name}
                      {service.quantity !== null && service.quantity > 1
                        ? ` ×${service.quantity}`
                        : ""}
                      {service.notes ? ` — ${service.notes}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <aside className="flex flex-col gap-4 rounded-xl bg-card p-5 ring-1 ring-border lg:sticky lg:top-6 lg:h-fit">
          <PriceTag
            amount={hasTotal ? (room.totalPrice as number) : room.pricePerNight}
            currency={room.currency}
            size="lg"
            caption={
              hasTotal
                ? t("totalForNights", { nights: room.nights as number })
                : t("perNight")
            }
            data-testid="room-detail-price"
          />

          <TrustBadge variant="free" label={t("freeCancellation")} />

          {/* Avis de disponibilité — ordre CRITIQUE : `availabilityDegraded` d'abord. Une panne du
              cross-check daté ne doit JAMAIS s'afficher « indisponible pour ces dates » (AC-6) ;
              on montre alors « à confirmer », que la chambre soit statiquement éligible ou non. */}
          {room.availabilityDegraded ? (
            <p
              role="status"
              data-testid="room-availability-degraded"
              className="inline-flex items-start gap-2 text-caption text-muted-foreground"
            >
              <InfoIcon
                className="mt-0.5 size-3.5 shrink-0"
                aria-hidden="true"
              />
              <span>{t("availabilityToConfirm")}</span>
            </p>
          ) : !room.available ? (
            <p
              role="status"
              data-testid="room-unavailable"
              className="inline-flex items-start gap-2 rounded-lg bg-warning-soft p-3 text-small text-warning"
            >
              <CircleAlertIcon
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              <span>
                {hasDates ? t("unavailableForDates") : t("unavailable")}
              </span>
            </p>
          ) : null}

          {room.available ? (
            <Link
              href={buildBookingUrl(room.hotelId, room.id, context)}
              className={cn(buttonVariants(), "min-h-(--tap-min) w-full")}
              data-testid="room-book-cta"
            >
              {t("bookNow")}
            </Link>
          ) : (
            <button
              type="button"
              disabled
              aria-disabled="true"
              className={cn(buttonVariants(), "min-h-(--tap-min) w-full")}
              data-testid="room-book-cta-disabled"
            >
              {t("bookNow")}
            </button>
          )}
        </aside>
      </div>
    </article>
  );
}
