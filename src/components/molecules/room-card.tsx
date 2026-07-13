"use client";

import { UsersIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { PriceTag } from "@/components/atoms/price-tag";
import { TrustBadge } from "@/components/atoms/trust-badge";
import { Button } from "@/components/ui/button";
import type { HotelRoomResult } from "@/services/catalog.service";

/** Nombre max d'équipements affichés sur une carte. */
const MAX_AMENITIES = 6;

/**
 * Équipements de chambre (texte libre CSV du PMS) → tokens nettoyés et **dé-dupliqués**.
 *
 * ⚠️ On ne scinde **pas** sur `/` : « 24/7 room service » deviendrait deux badges « 24 » et
 * « 7 room service ». La dé-duplication évite en outre des clés React en collision sur un CSV
 * comportant un doublon (« Wifi, Wifi »).
 */
export function parseAmenities(raw: string | null): string[] {
  if (!raw) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,;]/)) {
    const token = part.trim();
    if (token.length === 0) {
      continue;
    }
    const key = token.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(token);
    if (out.length === MAX_AMENITIES) {
      break;
    }
  }
  return out;
}

/**
 * Chambre réservable sur la fiche hôtel (UX-DR-2.3) : capacité, équipements, prix (total du séjour
 * si dates, sinon prix/nuit — devise de l'Hôtel), badge d'annulation. **Repli D2** (AC-6) : le badge
 * « Annulation gratuite » est **générique** (la politique ferme par hôtel n'est pas exposée). **Pas
 * de lien mort** (AC-12/Décision 7) : le CTA « Réserver » (fiche chambre = story 1.10) est rendu
 * **désactivé** (« bientôt disponible ») tant que 1.10 n'est pas livrée.
 */
export function RoomCard({ room }: { room: HotelRoomResult }) {
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
        <TrustBadge variant="free" label={t("freeCancellation")} />
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
        <Button
          type="button"
          disabled
          aria-disabled="true"
          className="min-h-(--tap-min) w-full sm:w-auto"
          data-testid="room-card-cta"
        >
          {t("bookSoon")}
        </Button>
      </div>
    </article>
  );
}
