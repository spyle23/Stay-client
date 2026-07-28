"use client";

import Link from "next/link";
import { UsersIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { PriceTag } from "@/components/atoms/price-tag";
import { buttonVariants } from "@/components/ui/button";
import { parseAmenities } from "@/lib/amenities";
import { cn } from "@/lib/utils";
import {
  buildRoomPageUrl,
  type HotelRoomResult,
  type StayContext,
} from "@/services/catalog.service";

/**
 * Chambre réservable sur la fiche hôtel (UX-DR-2.3) : capacité, équipements, prix (total du séjour
 * si dates, sinon prix/nuit — devise de l'Hôtel), disponibilité réelle.
 *
 * **Aucune promesse d'annulation ici** (story 2.2, AC-6) : le PMS n'expose aucune politique par
 * hôtel (D2 non livré), donc un badge « Annulation gratuite » serait une affirmation sans donnée.
 * La seule information d'annulation du parcours est la `CancellationPolicyDisclosure` du
 * récapitulatif, avant paiement — en repli explicite tant que D2 n'est pas livré.
 *
 * Le CTA « Réserver » est un **lien** vers la fiche chambre `/hotels/{slug}/rooms/{roomId}` (story
 * 1.10), en conservant le contexte de séjour (dates/voyageurs/devise). Les chambres listées ici
 * étant déjà filtrées « disponibles » par le BFF, le lien est toujours valide (**pas de lien mort**,
 * AC-12/Décision 7).
 */
export function RoomCard({
  room,
  hotelId,
  hotelName,
  context = {},
}: {
  room: HotelRoomResult;
  /**
   * GUID de l'hôtel **garanti valide** (résolu par la page). Préféré à `room.hotelId`, que le BFF
   * coerce en `''` si le PMS l'omet — un slug sans GUID de fin produirait un lien mort (404).
   */
  hotelId?: string;
  hotelName?: string | null;
  context?: StayContext;
}) {
  const t = useTranslations("hotel");
  const amenities = parseAmenities(room.amenities);
  const hasTotal = room.totalPrice !== null && room.nights !== null;
  const title = room.category ?? t("roomDefault");

  return (
    <article
      data-testid="room-card"
      data-room-id={room.id}
      className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-border sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex flex-col gap-2">
        <h3 className="text-h3 text-foreground">{title}</h3>
        <p className="inline-flex flex-wrap items-center gap-x-1 text-small text-muted-foreground">
          {/* Capacité inconnue → ligne masquée (jamais « 0 voyageur » sur une chambre réservable). */}
          {room.capacity !== null ? (
            <>
              <UsersIcon className="size-3.5 shrink-0" aria-hidden="true" />
              <span>{t("capacity", { count: room.capacity })}</span>
            </>
          ) : null}
          {room.number ? (
            <span>
              {room.capacity !== null ? "· " : ""}
              {t("roomNumber", { number: room.number })}
            </span>
          ) : null}
        </p>
        {amenities.length > 0 ? (
          <ul
            className="flex flex-wrap gap-1.5"
            aria-label={t("amenitiesLabel")}
          >
            {amenities.map((amenity) => (
              <li
                key={amenity}
                className="rounded-md bg-muted px-2 py-0.5 text-caption text-muted-foreground"
              >
                {amenity}
              </li>
            ))}
          </ul>
        ) : null}
        {/* Aucun badge « annulation gratuite » : le PMS n'expose aucune politique par hôtel
            (dépendance D2). Les conditions d'annulation sont présentées **avant paiement** par
            `CancellationPolicyDisclosure` dans le tunnel (story 2.2, FR-7/FR-22) — annoncer une
            gratuité sans donnée serait une promesse fausse (UX-DR-9.5). */}
      </div>

      <div className="flex flex-col items-start gap-2 sm:items-end">
        <PriceTag
          amount={hasTotal ? (room.totalPrice as number) : room.pricePerNight}
          currency={room.currency}
          size="md"
          caption={
            hasTotal
              ? t("totalForNights", { nights: room.nights as number })
              : t("perNight")
          }
          data-testid="room-card-price"
        />
        <Link
          href={buildRoomPageUrl(
            hotelId ?? room.hotelId,
            room.id,
            hotelName ?? null,
            context,
          )}
          className={cn(buttonVariants(), "min-h-(--tap-min) w-full sm:w-auto")}
          data-testid="room-card-cta"
        >
          {t("bookNow")}
        </Link>
      </div>
    </article>
  );
}
