"use client";

import { useState } from "react";
import Link from "next/link";
import { SearchXIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  HotelCard,
  type HotelCardDensity,
} from "@/components/molecules/hotel-card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useHotelSearch } from "@/hooks/use-hotel-search";
import { ApiClientError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import {
  isNearbyParams,
  type SearchHotelsParams,
} from "@/services/search.service";

const SKELETON_COUNT = 6;

/**
 * Île client des résultats : fetch React Query côté navigateur (interceptable en e2e isolé,
 * skeletons pendant le chargement — AC-4). États : chargement / dégradation PMS (503) /
 * erreur / vide (« élargir dates/zone » + sortie) / succès (grille 1→2→3, bascule densité).
 */
export function SearchResults({ params }: { params: SearchHotelsParams }) {
  const t = useTranslations("results");
  const [density, setDensity] = useState<HotelCardDensity>("comfortable");
  const query = useHotelSearch(params);
  const nearby = isNearbyParams(params);

  const gridClass = cn(
    "grid gap-4",
    density === "comfortable"
      ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
      : "grid-cols-1 lg:grid-cols-2",
  );

  if (query.isPending) {
    return (
      <div
        data-testid="results-loading"
        aria-busy="true"
        aria-live="polite"
        aria-label={t("loading")}
        className={gridClass}
      >
        {Array.from({ length: SKELETON_COUNT }).map((_, index) => (
          <HotelCardSkeleton key={`skeleton-${index}`} />
        ))}
      </div>
    );
  }

  if (query.isError) {
    const degraded =
      query.error instanceof ApiClientError && query.error.status >= 500;
    return (
      <div
        role="alert"
        data-testid={degraded ? "results-degraded" : "results-error"}
        className="flex flex-col items-center gap-3 rounded-xl bg-card p-8 text-center ring-1 ring-border"
      >
        <p className="text-h3 text-foreground">
          {degraded ? t("degradedTitle") : t("errorTitle")}
        </p>
        <p className="max-w-md text-body text-muted-foreground">
          {degraded ? t("degradedBody") : t("errorBody")}
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => void query.refetch()}
          data-testid="results-retry"
        >
          {t("retry")}
        </Button>
      </div>
    );
  }

  const { items, totalCount } = query.data;

  if (items.length === 0) {
    return (
      <div
        data-testid="results-empty"
        className="flex flex-col items-center gap-3 rounded-xl bg-card p-8 text-center ring-1 ring-border"
      >
        <SearchXIcon
          className="size-8 text-muted-foreground"
          aria-hidden="true"
        />
        <p className="text-h3 text-foreground">
          {nearby ? t("emptyNearbyTitle") : t("emptyTitle")}
        </p>
        <p className="max-w-md text-body text-muted-foreground">
          {nearby ? t("emptyNearbyBody") : t("emptyBody")}
        </p>
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          {t("emptyCta")}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p
          aria-live="polite"
          data-testid="results-count"
          className="text-body font-medium text-foreground"
        >
          {t("resultsCount", { count: totalCount })}
        </p>
        <div
          className="flex items-center gap-1"
          role="group"
          aria-label={t("densityLabel")}
        >
          <Button
            type="button"
            size="sm"
            variant={density === "comfortable" ? "default" : "ghost"}
            onClick={() => setDensity("comfortable")}
            data-testid="density-comfortable"
          >
            {t("densityComfortable")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={density === "compact" ? "default" : "ghost"}
            onClick={() => setDensity("compact")}
            data-testid="density-compact"
          >
            {t("densityCompact")}
          </Button>
        </div>
      </div>

      <div data-testid="results-grid" className={gridClass}>
        {items.map((hotel) => (
          <HotelCard key={hotel.hotelId} hotel={hotel} density={density} />
        ))}
      </div>
    </div>
  );
}

function HotelCardSkeleton() {
  return (
    <div
      data-testid="hotel-card-skeleton"
      className="flex flex-col gap-2 overflow-hidden rounded-xl bg-card p-4 ring-1 ring-border"
    >
      <Skeleton className="aspect-[4/3] w-full" />
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-6 w-1/3" />
    </div>
  );
}
