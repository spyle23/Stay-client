import { StarIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { RoomCard } from "@/components/molecules/room-card";
import { HotelGallery } from "@/components/organisms/hotel-gallery";
import { HotelLocation } from "@/components/organisms/hotel-location";
import type { HotelDetailResult } from "@/services/catalog.service";

/**
 * Fiche hôtel publique (UX-DR-3.3). Rendu **SSR** (Server Component async) assemblant identité,
 * galerie, description, liste de chambres et localisation. La surface porte **`data-hotel-theme`**
 * (AC-5) : le mécanisme d'accent hôtel est en place ; la couleur par hôtel retombe sur l'accent
 * neutre par défaut tant que le PMS ne l'expose pas publiquement (Décision 5).
 *
 * États chambres : dégradation PMS (`roomsUnavailable`) ≠ « aucune chambre » ≠ liste. Sans dates
 * en contexte, une invitation à choisir des dates accompagne les prix par nuit (Décision 4).
 */
export function HotelDetail({ hotel }: { hotel: HotelDetailResult }) {
  const t = useTranslations("hotel");
  const name = hotel.name ?? t("unnamed");
  const locationLine = [hotel.city, hotel.country]
    .filter((part) => Boolean(part && part.trim()))
    .join(", ");
  // Contexte de séjour porté par le DTO (et non déduit de `rooms[0]`) : sans dates ET sans chambre,
  // l'utilisateur doit apprendre qu'il n'a saisi aucune date — pas croire que l'hôtel est complet.
  const noDates = hotel.stayNights === null;

  return (
    <article
      data-hotel-theme
      data-testid="hotel-detail"
      data-hotel-id={hotel.id}
      className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-6"
    >
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h1 className="text-h1 text-foreground">{name}</h1>
          {hotel.category ? (
            <span
              data-testid="hotel-category"
              className="inline-flex items-center gap-1 rounded-md bg-primary-soft px-2 py-1 text-caption font-medium text-foreground"
            >
              <StarIcon className="size-4 text-primary" aria-hidden="true" />
              {hotel.category}
            </span>
          ) : null}
        </div>
        {locationLine ? (
          <p className="text-body text-muted-foreground">{locationLine}</p>
        ) : null}
      </header>

      <HotelGallery images={hotel.gallery} hotelName={name} />

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-8">
          {hotel.description ? (
            <section
              aria-labelledby="hotel-about-title"
              className="flex flex-col gap-2"
            >
              <h2 id="hotel-about-title" className="text-h3 text-foreground">
                {t("aboutTitle")}
              </h2>
              <p className="max-w-prose text-body text-muted-foreground">
                {hotel.description}
              </p>
            </section>
          ) : null}

          <section
            aria-labelledby="hotel-rooms-title"
            className="flex flex-col gap-3"
          >
            <h2 id="hotel-rooms-title" className="text-h3 text-foreground">
              {t("roomsTitle")}
            </h2>

            {hotel.roomsUnavailable ? (
              <p
                role="status"
                data-testid="rooms-degraded"
                className="rounded-xl bg-card p-6 text-body text-muted-foreground ring-1 ring-border"
              >
                {t("roomsUnavailable")}
              </p>
            ) : hotel.rooms.length === 0 ? (
              <p
                data-testid="rooms-empty"
                className="rounded-xl bg-card p-6 text-body text-muted-foreground ring-1 ring-border"
              >
                {/* Sans dates, ne PAS dire « aucune chambre pour ces dates » : l'utilisateur
                    n'en a saisi aucune et conclurait à tort que l'hôtel est complet. */}
                {noDates ? t("noRoomsNoDates") : t("noRooms")}
              </p>
            ) : (
              <>
                {noDates ? (
                  <p
                    data-testid="rooms-select-dates"
                    className="text-small text-muted-foreground"
                  >
                    {t("selectDates")}
                  </p>
                ) : null}
                <ul className="flex flex-col gap-3">
                  {hotel.rooms.map((room) => (
                    <li key={room.id}>
                      <RoomCard room={room} />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>

        <aside className="flex flex-col gap-6 lg:sticky lg:top-6 lg:h-fit">
          <HotelLocation hotel={hotel} />
        </aside>
      </div>
    </article>
  );
}
