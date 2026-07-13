"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ArrowDownWideNarrowIcon,
  ArrowUpNarrowWideIcon,
  MapPinIcon,
  RotateCcwIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { minorUnitExponent } from "@/lib/currency";
import type { SearchFacets } from "@/lib/search-facets";
import { cn } from "@/lib/utils";
import { normalizeToken, type SortOption } from "@/lib/validations/search";
import {
  hasActiveFilters,
  isNearbyParams,
  type SearchHotelsParams,
} from "@/services/search.service";

/** Clés de tri affichées (défaut inclus : `relevance` en destination, `distance` en proximité). */
type SortKey = "relevance" | "distance" | SortOption;

/** Champs de filtre pilotés par la toolbar (effacés par « Réinitialiser »). */
const FILTER_KEYS = [
  "minPrice",
  "maxPrice",
  "minCapacity",
  "category",
  "amenities",
] as const;

/** Cible tactile ≥ 44 px (UX-DR-1.10 / AC-10) — token du design-system. */
const TAP = "min-h-(--tap-min)";

/** Applique une mutation à une copie de la query et pousse la nouvelle URL. */
type Mutator = (apply: (usp: URLSearchParams) => void) => void;

/**
 * Barre d'outils des résultats (FR-3, story 1.8) : tri (prix ↑/↓, distance en proximité) + filtres
 * (fourchette de prix, capacité, catégorie d'hôtel, équipements de chambre). **Tout l'état vit dans
 * l'URL** (partageable/rechargeable, AC-3).
 *
 * Écriture : chaque contrôle lit la query **live** (`window.location.search`, pas le prop `params`
 * qui n'est rafraîchi qu'après la navigation RSC async) et pousse une nouvelle URL avec
 * `scroll:false` (accumulation correcte de changements rapprochés + position de scroll préservée).
 * Lecture/affichage : depuis `params` (dérivés côté SSR, source d'affichage fiable).
 * Options catégorie/équipements = **facettes** (jeu non filtré). Inline desktop, `Sheet` mobile.
 */
export function ResultsToolbar({
  params,
  facets,
}: {
  params: SearchHotelsParams;
  facets: SearchFacets;
}) {
  const t = useTranslations("filters");
  const router = useRouter();
  const nearby = isNearbyParams(params);

  const mutate: Mutator = (apply) => {
    const search = typeof window !== "undefined" ? window.location.search : "";
    const path =
      typeof window !== "undefined" ? window.location.pathname : "/search";
    const usp = new URLSearchParams(search);
    apply(usp);
    router.push(`${path}?${usp.toString()}`, { scroll: false });
  };

  const activeCount =
    [params.minPrice, params.maxPrice, params.minCapacity].filter(
      (v) => v !== undefined,
    ).length +
    (params.category?.length ? 1 : 0) +
    (params.amenities?.length ? 1 : 0);

  return (
    <div className="flex flex-col gap-3" data-testid="results-toolbar">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <SortChips params={params} nearby={nearby} mutate={mutate} />

        {/* Mobile : les filtres sont regroupés dans un Sheet (AC-9). */}
        <div className="lg:hidden">
          <Sheet>
            <SheetTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  className={TAP}
                  data-testid="filters-open"
                />
              }
            >
              <SlidersHorizontalIcon className="size-4" aria-hidden="true" />
              {t("open")}
              {activeCount > 0 ? (
                <Badge
                  variant="secondary"
                  aria-label={t("activeCount", { count: activeCount })}
                  data-testid="filters-active-count"
                >
                  {activeCount}
                </Badge>
              ) : null}
            </SheetTrigger>
            <SheetContent
              side="bottom"
              className="max-h-svh overflow-y-auto"
              aria-label={t("title")}
            >
              <SheetHeader>
                <SheetTitle>{t("title")}</SheetTitle>
              </SheetHeader>
              <div className="px-4 pb-6">
                <FilterControls
                  params={params}
                  facets={facets}
                  mutate={mutate}
                  idPrefix="m-"
                />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Desktop : filtres inline. */}
      <div
        className="hidden flex-wrap items-end gap-x-6 gap-y-3 lg:flex"
        data-testid="filters-inline"
      >
        <FilterControls
          params={params}
          facets={facets}
          mutate={mutate}
          idPrefix=""
        />
      </div>
    </div>
  );
}

/** Chips de tri — options conditionnelles au mode (distance uniquement en proximité). */
function SortChips({
  params,
  nearby,
  mutate,
}: {
  params: SearchHotelsParams;
  nearby: boolean;
  mutate: Mutator;
}) {
  const t = useTranslations("filters");
  const keys: SortKey[] = nearby
    ? ["distance", "price_asc", "price_desc"]
    : ["relevance", "price_asc", "price_desc"];
  // Un `sort` invalide pour ce mode (ex. `sort=distance` sur une URL destination) retombe sur le
  // défaut du mode → le chip par défaut est surligné (pas « aucun chip actif »).
  const validSort =
    params.sort !== undefined && keys.includes(params.sort)
      ? params.sort
      : undefined;
  const effective: SortKey = validSort ?? (nearby ? "distance" : "relevance");

  const icon: Record<SortKey, React.ReactNode> = {
    relevance: <SparklesIcon className="size-3.5" aria-hidden="true" />,
    distance: <MapPinIcon className="size-3.5" aria-hidden="true" />,
    price_asc: (
      <ArrowUpNarrowWideIcon className="size-3.5" aria-hidden="true" />
    ),
    price_desc: (
      <ArrowDownWideNarrowIcon className="size-3.5" aria-hidden="true" />
    ),
  };

  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      role="group"
      aria-label={t("sort")}
    >
      <span className="text-small font-medium text-muted-foreground">
        {t("sort")}
      </span>
      {keys.map((key) => {
        const active = effective === key;
        // `relevance`/`distance` sont les défauts du mode → `sort` absent de l'URL.
        const sortValue =
          key === "price_asc" || key === "price_desc" ? key : undefined;
        return (
          <Button
            key={key}
            type="button"
            size="sm"
            variant={active ? "default" : "outline"}
            className={TAP}
            aria-pressed={active}
            data-testid={`sort-${key}`}
            onClick={() =>
              mutate((usp) => {
                if (sortValue) {
                  usp.set("sort", sortValue);
                } else {
                  usp.delete("sort");
                }
              })
            }
          >
            {icon[key]}
            {t(`sort_${key}`)}
          </Button>
        );
      })}
    </div>
  );
}

/** Cluster de contrôles de filtre (prix, capacité, catégorie, équipements, réinitialisation). */
function FilterControls({
  params,
  facets,
  mutate,
  idPrefix,
}: {
  params: SearchHotelsParams;
  facets: SearchFacets;
  mutate: Mutator;
  idPrefix: string;
}) {
  const t = useTranslations("filters");
  const factor = 10 ** minorUnitExponent(params.currency);

  function setOrDelete(usp: URLSearchParams, key: string, value?: number) {
    if (value === undefined) {
      usp.delete(key);
    } else {
      usp.set(key, String(value));
    }
  }

  function commitPrice(which: "minPrice" | "maxPrice", raw: string) {
    const trimmed = raw.trim();
    const cents =
      trimmed === "" ? undefined : Math.round(Number(trimmed) * factor);
    const valid = cents === undefined || (Number.isFinite(cents) && cents >= 0);
    const next = valid ? cents : undefined;
    if (next === params[which]) {
      return; // pas de navigation redondante
    }
    mutate((usp) => setOrDelete(usp, which, next));
  }

  function commitCapacity(raw: string) {
    const trimmed = raw.trim();
    const n = trimmed === "" ? undefined : Number(trimmed);
    // Bornée [1, 30] comme le parse/BFF : une saisie > 30 est ramenée à 30 (feedback visible)
    // plutôt que d'écrire un param mort que le round-trip effacerait.
    const next =
      n !== undefined && Number.isInteger(n)
        ? Math.min(30, Math.max(1, n))
        : undefined;
    if (next === params.minCapacity) {
      return;
    }
    mutate((usp) => setOrDelete(usp, "minCapacity", next));
  }

  function toggleToken(field: "category" | "amenities", value: string) {
    mutate((usp) => {
      const current = usp.getAll(field);
      const norm = normalizeToken(value);
      const exists = current.some((v) => normalizeToken(v) === norm);
      usp.delete(field);
      const next = exists
        ? current.filter((v) => normalizeToken(v) !== norm)
        : [...current, value];
      next.forEach((v) => usp.append(field, v));
    });
  }

  const priceToMajor = (cents: number | undefined) =>
    cents !== undefined ? String(cents / factor) : "";

  const categorySelected = params.category ?? [];
  const amenitiesSelected = params.amenities ?? [];

  return (
    <>
      {/* Fourchette de prix (total du séjour, devise de travail). */}
      <fieldset className="flex flex-col gap-1">
        <legend className="text-small font-medium text-foreground">
          {t("price")}
        </legend>
        <div className="flex items-center gap-2">
          <Input
            key={`${idPrefix}min-${params.minPrice ?? ""}`}
            type="number"
            inputMode="numeric"
            min={0}
            className={cn("w-24 tabular-nums", TAP)}
            defaultValue={priceToMajor(params.minPrice)}
            aria-label={t("priceMin")}
            placeholder={t("priceMin")}
            data-testid={`${idPrefix}filter-price-min`}
            onBlur={(e) => commitPrice("minPrice", e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                commitPrice("minPrice", e.currentTarget.value);
              }
            }}
          />
          <span aria-hidden="true" className="text-muted-foreground">
            –
          </span>
          <Input
            key={`${idPrefix}max-${params.maxPrice ?? ""}`}
            type="number"
            inputMode="numeric"
            min={0}
            className={cn("w-24 tabular-nums", TAP)}
            defaultValue={priceToMajor(params.maxPrice)}
            aria-label={t("priceMax")}
            placeholder={t("priceMax")}
            data-testid={`${idPrefix}filter-price-max`}
            onBlur={(e) => commitPrice("maxPrice", e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                commitPrice("maxPrice", e.currentTarget.value);
              }
            }}
          />
        </div>
      </fieldset>

      {/* Capacité minimale. */}
      <fieldset className="flex flex-col gap-1">
        <legend className="text-small font-medium text-foreground">
          {t("capacity")}
        </legend>
        <Input
          key={`${idPrefix}cap-${params.minCapacity ?? ""}`}
          type="number"
          inputMode="numeric"
          min={1}
          max={30}
          className={cn("w-20 tabular-nums", TAP)}
          defaultValue={params.minCapacity ?? ""}
          aria-label={t("capacity")}
          data-testid={`${idPrefix}filter-capacity`}
          onBlur={(e) => commitCapacity(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commitCapacity(e.currentTarget.value);
            }
          }}
        />
      </fieldset>

      {/* Catégorie d'hôtel — visible s'il y a des facettes OU une sélection active (chip orphelin). */}
      {facets.categories.length > 0 || categorySelected.length > 0 ? (
        <TokenChips
          field="category"
          label={t("category")}
          values={facets.categories}
          selected={categorySelected}
          idPrefix={idPrefix}
          onToggle={toggleToken}
        />
      ) : null}

      {/* Équipements — masqué si aucune facette ET aucune sélection (repli D9, AC-5). */}
      {facets.amenities.length > 0 || amenitiesSelected.length > 0 ? (
        <TokenChips
          field="amenities"
          label={t("amenities")}
          values={facets.amenities}
          selected={amenitiesSelected}
          idPrefix={idPrefix}
          onToggle={toggleToken}
        />
      ) : null}

      {hasActiveFilters(params) ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn("self-end", TAP)}
          data-testid={`${idPrefix}filters-reset`}
          onClick={() =>
            mutate((usp) => FILTER_KEYS.forEach((k) => usp.delete(k)))
          }
        >
          <RotateCcwIcon className="size-4" aria-hidden="true" />
          {t("reset")}
        </Button>
      ) : null}
    </>
  );
}

/**
 * Groupe de chips à bascule (catégorie/équipements). Rend l'**union** des facettes et des valeurs
 * sélectionnées : une valeur active absente des facettes (URL partagée après changement d'inventaire,
 * ou facette en cours de chargement) reste **visible et désélectionnable** individuellement (AC-1).
 */
function TokenChips({
  field,
  label,
  values,
  selected,
  idPrefix,
  onToggle,
}: {
  field: "category" | "amenities";
  label: string;
  values: string[];
  selected: string[];
  idPrefix: string;
  onToggle: (field: "category" | "amenities", value: string) => void;
}) {
  const valuesNorm = new Set(values.map(normalizeToken));
  const orphans = selected.filter((s) => !valuesNorm.has(normalizeToken(s)));
  const display = [...values, ...orphans];
  const selectedNorm = new Set(selected.map(normalizeToken));

  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-small font-medium text-foreground">
        {label}
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {display.map((value) => {
          const active = selectedNorm.has(normalizeToken(value));
          return (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={active ? "default" : "outline"}
              className={cn(TAP, active && "font-semibold")}
              aria-pressed={active}
              data-testid={`${idPrefix}filter-${field}-${normalizeToken(value)}`}
              onClick={() => onToggle(field, value)}
            >
              {value}
            </Button>
          );
        })}
      </div>
    </fieldset>
  );
}
