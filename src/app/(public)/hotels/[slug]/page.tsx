import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { HotelDetail } from "@/components/organisms/hotel-detail";
import { ApiClientError } from "@/lib/api-client";
import { extractHotelId } from "@/lib/hotel-slug";
import { buildJsonLd, serializeJsonLd } from "@/lib/hotel-json-ld";
import {
  fetchHotelDetail,
  type HotelDetailResult,
} from "@/services/catalog.service";

type SearchParams = Record<string, string | string[] | undefined>;

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
};

type LoadResult =
  { ok: true; hotel: HotelDetailResult } | { ok: false; status: number };

/** Borne haute des voyageurs — **miroir du DTO BFF** (`@Max(30)`). */
const MAX_GUESTS = 30;

function firstStr(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Voyageurs : entier dans `[1, MAX_GUESTS]`, sinon `undefined`.
 *
 * La borne haute est **essentielle** : sans elle, un `?guests=99` (lien partagé, URL éditée) serait
 * transmis au BFF, rejeté en **400**, et la page rendrait l'écran « Hôtel indisponible » pour un
 * hôtel parfaitement disponible. Un contexte de séjour douteux doit **retomber** proprement, jamais
 * casser la page.
 */
function parseGuests(value: string | string[] | undefined): number | undefined {
  const raw = Number(firstStr(value));
  return Number.isInteger(raw) && raw >= 1 && raw <= MAX_GUESTS
    ? raw
    : undefined;
}

/**
 * Chargement SSR **dédupliqué** (React `cache`) : `generateMetadata` et la page partagent un seul
 * appel BFF pour un même (id, dates, voyageurs). Ne lève jamais : un échec renvoie `{ ok:false }`
 * (404 → `notFound()` ; autre → état dégradé) pour que la génération de métadonnées reste robuste.
 */
const loadHotel = cache(
  async (
    id: string,
    checkInDate?: string,
    checkOutDate?: string,
    guests?: number,
  ): Promise<LoadResult> => {
    try {
      const hotel = await fetchHotelDetail(id, {
        checkInDate,
        checkOutDate,
        guests,
      });
      return { ok: true, hotel };
    } catch (err) {
      const status = err instanceof ApiClientError ? err.status : 0;
      // Une page dégradée est servie en 200 : sans log, la panne serait TOTALEMENT silencieuse
      // (aucun 5xx, donc aucun monitoring HTTP ne se déclenche).
      if (status !== 404) {
        console.error(
          `[hotel-page] chargement impossible (hôtel ${id}, statut ${status || "réseau"})`,
          err,
        );
      }
      return { ok: false, status };
    }
  },
);

async function resolveContext(props: Props) {
  const [{ slug }, sp] = await Promise.all([props.params, props.searchParams]);
  const id = extractHotelId(slug);
  return {
    id,
    checkInDate: firstStr(sp.checkInDate),
    checkOutDate: firstStr(sp.checkOutDate),
    guests: parseGuests(sp.guests),
  };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const t = await getTranslations("hotel");
  const { id, checkInDate, checkOutDate, guests } = await resolveContext(props);

  // Page introuvable ou dégradée → ne JAMAIS laisser indexer « service indisponible » à la place
  // de la fiche hôtel (la page est servie en 200).
  const fallback: Metadata = {
    title: t("metaFallbackTitle"),
    robots: { index: false, follow: false },
  };
  if (!id) {
    return fallback;
  }
  const result = await loadHotel(id, checkInDate, checkOutDate, guests);
  if (!result.ok) {
    return fallback;
  }

  const { hotel } = result;
  const name = hotel.name ?? t("unnamed");
  const title = hotel.city ? t("metaTitle", { name, city: hotel.city }) : name;
  const description = hotel.description ?? t("metaDescription", { name });
  const image = hotel.gallery[0]?.url ?? hotel.logoUrl ?? undefined;

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
 * Page hôtel publique `(public)/hotels/[slug]` — **SSR** (FR-5). L'hôtel est résolu par le **GUID
 * de fin** du slug (Décision 1). 404 propre (slug sans GUID / PMS introuvable) ; état dégradé si le
 * PMS est momentanément injoignable. `data-hotel-theme` + galerie + chambres + localisation, indexable.
 */
export default async function HotelPage(props: Props) {
  const t = await getTranslations("hotel");
  const { id, checkInDate, checkOutDate, guests } = await resolveContext(props);
  if (!id) {
    notFound();
  }

  const result = await loadHotel(id, checkInDate, checkOutDate, guests);
  if (!result.ok) {
    if (result.status === 404) {
      notFound();
    }
    return (
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6">
        <div
          role="alert"
          data-testid="hotel-degraded"
          className="flex flex-col items-center gap-3 rounded-xl bg-card p-8 text-center ring-1 ring-border"
        >
          <p className="text-h3 text-foreground">{t("errorTitle")}</p>
          <p className="max-w-md text-body text-muted-foreground">
            {t("errorBody")}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(buildJsonLd(result.hotel)),
        }}
      />
      <HotelDetail hotel={result.hotel} />
    </main>
  );
}
