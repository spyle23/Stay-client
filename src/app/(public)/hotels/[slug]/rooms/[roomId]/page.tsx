import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { RoomDetail } from "@/components/organisms/room-detail";
import { ApiClientError } from "@/lib/api-client";
import { isCurrency } from "@/lib/currency";
import { extractHotelId } from "@/lib/hotel-slug";
import { serializeJsonLd } from "@/lib/hotel-json-ld";
import { buildRoomJsonLd } from "@/lib/room-json-ld";
import {
  fetchRoomDetail,
  type RoomDetailResult,
  type StayContext,
} from "@/services/catalog.service";

type SearchParams = Record<string, string | string[] | undefined>;

type Props = {
  params: Promise<{ slug: string; roomId: string }>;
  searchParams: Promise<SearchParams>;
};

type LoadResult =
  { ok: true; room: RoomDetailResult } | { ok: false; status: number };

/** Borne haute des voyageurs — **miroir du DTO BFF** (`@Max(30)`). */
const MAX_GUESTS = 30;

/** GUID (hex 8-4-4-4-12) complet — le `roomId` de la route est un GUID nu (pas de slug). */
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function firstStr(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Voyageurs : entier dans `[1, MAX_GUESTS]`, sinon `undefined` (repli propre, jamais un 400). */
function parseGuests(value: string | string[] | undefined): number | undefined {
  const raw = Number(firstStr(value));
  return Number.isInteger(raw) && raw >= 1 && raw <= MAX_GUESTS
    ? raw
    : undefined;
}

/** `roomId` valide (GUID) ou `null` → 404 (jamais un 400 BFF présenté comme une page cassée). */
function parseRoomId(value: string): string | null {
  return GUID.test(value) ? value.toLowerCase() : null;
}

/**
 * Chargement SSR **dédupliqué** (React `cache`) : `generateMetadata` et la page partagent un seul
 * appel BFF. Ne lève jamais : un échec renvoie `{ ok:false }` (404 → `notFound()` ; autre → dégradé).
 */
const loadRoom = cache(
  async (
    hotelId: string,
    roomId: string,
    checkInDate?: string,
    checkOutDate?: string,
    guests?: number,
  ): Promise<LoadResult> => {
    try {
      const room = await fetchRoomDetail(hotelId, roomId, {
        checkInDate,
        checkOutDate,
        guests,
      });
      return { ok: true, room };
    } catch (err) {
      const status = err instanceof ApiClientError ? err.status : 0;
      // Page dégradée servie en 200 : sans log, la panne serait totalement silencieuse.
      if (status !== 404) {
        console.error(
          `[room-page] chargement impossible (hôtel ${hotelId}, chambre ${roomId}, statut ${status || "réseau"})`,
          err,
        );
      }
      return { ok: false, status };
    }
  },
);

async function resolveContext(props: Props) {
  const [{ slug, roomId }, sp] = await Promise.all([
    props.params,
    props.searchParams,
  ]);
  const currency = firstStr(sp.currency);
  return {
    hotelId: extractHotelId(slug),
    roomId: parseRoomId(roomId),
    checkInDate: firstStr(sp.checkInDate),
    checkOutDate: firstStr(sp.checkOutDate),
    guests: parseGuests(sp.guests),
    // La devise de travail suit dans l'URL (contexte préservé), jamais envoyée au BFF.
    currency: currency && isCurrency(currency) ? currency : undefined,
  };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const t = await getTranslations("hotel");
  const { hotelId, roomId, checkInDate, checkOutDate, guests } =
    await resolveContext(props);

  // Fiche introuvable/dégradée → ne JAMAIS laisser indexer « indisponible » (page servie en 200).
  const fallback: Metadata = {
    title: t("metaFallbackTitle"),
    robots: { index: false, follow: false },
  };
  if (!hotelId || !roomId) {
    return fallback;
  }
  const result = await loadRoom(
    hotelId,
    roomId,
    checkInDate,
    checkOutDate,
    guests,
  );
  if (!result.ok) {
    return fallback;
  }

  const { room } = result;
  const hotel = room.hotelName ?? t("unnamed");
  const category = room.category ?? t("roomDefault");
  const title = t("roomMetaTitle", { category, hotel });
  const description =
    room.description ?? t("roomMetaDescription", { category, hotel });
  const image = room.images[0]?.url ?? undefined;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images: image ? [{ url: image }] : undefined,
    },
  };
}

/**
 * Fiche chambre publique `(public)/hotels/[slug]/rooms/[roomId]` — **SSR** (FR-6). Route imbriquée
 * sous le slug hôtel (le hotelId compose la fiche + retour non destructif). 404 propre (slug sans
 * GUID / roomId invalide / PMS introuvable) ; état dégradé si le PMS est momentanément injoignable.
 */
export default async function RoomPage(props: Props) {
  const t = await getTranslations("hotel");
  const { hotelId, roomId, checkInDate, checkOutDate, guests, currency } =
    await resolveContext(props);
  if (!hotelId || !roomId) {
    notFound();
  }

  const result = await loadRoom(
    hotelId,
    roomId,
    checkInDate,
    checkOutDate,
    guests,
  );
  if (!result.ok) {
    if (result.status === 404) {
      notFound();
    }
    return (
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6">
        <div
          role="alert"
          data-testid="room-degraded"
          className="flex flex-col items-center gap-3 rounded-xl bg-card p-8 text-center ring-1 ring-border"
        >
          <p className="text-h3 text-foreground">{t("roomErrorTitle")}</p>
          <p className="max-w-md text-body text-muted-foreground">
            {t("roomErrorBody")}
          </p>
        </div>
      </main>
    );
  }

  // Ne transmettre au tunnel/retour QUE les dates **acceptées** par le BFF (`nights` non-null) :
  // un séjour passé/incohérent/hors-borne que le BFF a écarté (repli prix/nuit) ne doit pas fuiter
  // dans le handoff (le tunnel recevrait des dates que le PMS refuse de tarifer).
  const datesAccepted = result.room.nights !== null;
  const context: StayContext = {
    checkInDate: datesAccepted ? checkInDate : undefined,
    checkOutDate: datesAccepted ? checkOutDate : undefined,
    guests,
    currency,
  };

  return (
    <main className="flex flex-1 flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(buildRoomJsonLd(result.room)),
        }}
      />
      <RoomDetail room={result.room} context={context} />
    </main>
  );
}
