"use client";

import {
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { MapPinIcon, SearchIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { DateRange } from "react-day-picker";

import {
  DateRangePicker,
  dateToIsoDateOnly,
} from "@/components/molecules/date-range-picker";
import { GuestSelector } from "@/components/molecules/guest-selector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCurrency } from "@/hooks/use-currency";
import { useGeolocation } from "@/hooks/use-geolocation";
import type { GeolocationFailureReason } from "@/lib/geolocation";
import {
  validateDatesGuests,
  validateSearchInput,
  type SearchValidationError,
} from "@/lib/validations/search";

export interface SearchBarDefaults {
  destination?: string;
  checkInDate?: string;
  checkOutDate?: string;
  guests?: number;
}

/** Échec de géoloc → clé de message i18n (namespace `search.errors`). */
const GEO_ERROR_KEY: Record<GeolocationFailureReason, string> = {
  denied: "geolocationDenied",
  unavailable: "geolocationUnavailable",
  timeout: "geolocationTimeout",
  unsupported: "geolocationUnsupported",
  insecure: "geolocationUnsupported",
};

function isoToDate(iso?: string): Date | undefined {
  if (!iso) {
    return undefined;
  }
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) {
    return undefined;
  }
  return new Date(year, month - 1, day);
}

/**
 * Barre de recherche (UX-DR-2.1) : destination + plage de dates + voyageurs + Rechercher, plus
 * un déclencheur « Autour de moi » (géoloc, FR-2) quand `geolocationEnabled` (hero ET sticky —
 * la variante sticky permet de relancer une recherche proximité depuis les résultats). Validation client AVANT
 * navigation → une saisie invalide n'entraîne **aucun appel BFF/PMS** (AC-2). Recherche valide →
 * navigation URL `/search?…` (partageable, rechargeable — AC-8). Lit la devise de travail active.
 *
 * Variantes `hero` (accueil) et `sticky` (en-tête des résultats, valeurs pré-remplies).
 */
export function SearchBar({
  variant = "hero",
  defaults,
  geolocationEnabled = false,
}: {
  variant?: "hero" | "sticky";
  defaults?: SearchBarDefaults;
  geolocationEnabled?: boolean;
}) {
  const t = useTranslations("search");
  const router = useRouter();
  const { currency } = useCurrency();
  const geo = useGeolocation();
  const errorId = useId();
  const destinationRef = useRef<HTMLInputElement>(null);

  const [destination, setDestination] = useState(defaults?.destination ?? "");
  const [range, setRange] = useState<DateRange | undefined>(
    defaults?.checkInDate
      ? {
          from: isoToDate(defaults.checkInDate),
          to: isoToDate(defaults.checkOutDate),
        }
      : undefined,
  );
  const [guests, setGuests] = useState(defaults?.guests ?? 2);
  const [errors, setErrors] = useState<SearchValidationError[]>([]);
  const [geoError, setGeoError] = useState<GeolocationFailureReason | null>(
    null,
  );

  function currentDates(): {
    checkInDate: string | null;
    checkOutDate: string | null;
  } {
    return {
      checkInDate: range?.from ? dateToIsoDateOnly(range.from) : null,
      checkOutDate: range?.to ? dateToIsoDateOnly(range.to) : null,
    };
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { checkInDate, checkOutDate } = currentDates();

    const found = validateSearchInput({
      destination,
      checkInDate,
      checkOutDate,
      guests,
    });
    setErrors(found);
    setGeoError(null);
    if (found.length > 0 || checkInDate === null || checkOutDate === null) {
      return; // rejet client — aucun appel BFF/PMS
    }

    const params = new URLSearchParams({
      destination: destination.trim(),
      checkInDate,
      checkOutDate,
      guests: String(guests),
      currency,
    });
    router.push(`/search?${params.toString()}`);
  }

  // « Autour de moi » : valide dates+voyageurs (PAS la destination), déclenche la géoloc, puis
  // navigue en mode proximité. Échec → message explicatif + repli sur la recherche texte (focus
  // du champ destination), sans blocage (AC-2, FR-2).
  async function handleNearMe() {
    // Garde de ré-entrance : un 2ᵉ tap avant le re-render (le `disabled` DOM ne s'applique
    // qu'après) ne doit pas déclencher une 2ᵉ demande de position / navigation.
    if (geo.status === "prompting") {
      return;
    }
    const { checkInDate, checkOutDate } = currentDates();
    const found = validateDatesGuests({ checkInDate, checkOutDate, guests });
    setErrors(found);
    setGeoError(null);
    if (found.length > 0 || checkInDate === null || checkOutDate === null) {
      return;
    }

    const result = await geo.request();
    if (!result.ok) {
      setGeoError(result.reason);
      destinationRef.current?.focus(); // repli : recherche texte utilisable
      return;
    }

    const params = new URLSearchParams({
      mode: "nearby",
      latitude: String(result.latitude),
      longitude: String(result.longitude),
      checkInDate,
      checkOutDate,
      guests: String(guests),
      currency,
    });
    router.push(`/search?${params.toString()}`);
  }

  const has = (code: SearchValidationError) => errors.includes(code);
  const dateInvalid =
    has("datesRequired") || has("checkInPast") || has("checkOutBeforeCheckIn");
  // Disponible sur les DEUX variantes (hero + sticky) quand activé : permet de raffiner/relancer
  // une recherche proximité depuis la page de résultats (les dates y sont pré-remplies).
  const showNearMe = geolocationEnabled;
  const locating = geo.status === "prompting";

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      data-testid="search-bar"
      data-variant={variant}
      className="flex w-full flex-col gap-3 rounded-xl bg-card p-3 shadow-elevated ring-1 ring-border"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-small font-medium text-foreground">
            {t("destinationLabel")}
          </span>
          <Input
            ref={destinationRef}
            value={destination}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setDestination(event.target.value)
            }
            placeholder={t("destinationPlaceholder")}
            aria-invalid={has("destinationRequired") || undefined}
            aria-describedby={has("destinationRequired") ? errorId : undefined}
            data-testid="search-destination"
            className="min-h-(--tap-min)"
          />
        </label>

        <div className="flex flex-1 flex-col gap-1">
          <span className="text-small font-medium text-foreground">
            {t("datesLabel")}
          </span>
          <DateRangePicker
            value={range}
            onChange={setRange}
            invalid={dateInvalid}
            describedBy={dateInvalid ? errorId : undefined}
          />
        </div>

        <div className="flex flex-col gap-1 md:w-48">
          <span className="text-small font-medium text-foreground">
            {t("guestsLabel")}
          </span>
          <GuestSelector
            value={guests}
            onChange={setGuests}
            invalid={has("guestsMin")}
            describedBy={has("guestsMin") ? errorId : undefined}
          />
        </div>

        <Button
          type="submit"
          size="lg"
          data-testid="search-submit"
          className="min-h-(--tap-min)"
        >
          <SearchIcon className="size-4" aria-hidden="true" />
          <span>{t("submit")}</span>
        </Button>
      </div>

      {showNearMe ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => void handleNearMe()}
            disabled={locating}
            aria-busy={locating || undefined}
            data-testid="search-near-me"
            className="inline-flex min-h-(--tap-min) items-center gap-2 rounded-full bg-primary-soft px-4 py-2 text-small font-medium text-foreground transition-colors hover:bg-primary-soft/70 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
          >
            <MapPinIcon
              className="size-4 shrink-0 text-primary"
              aria-hidden="true"
            />
            <span>{locating ? t("nearMeLoading") : t("nearMe")}</span>
          </button>
        </div>
      ) : null}

      {geoError ? (
        <p
          role="status"
          data-testid="geolocation-error"
          className="text-center text-small text-muted-foreground"
        >
          {t(`errors.${GEO_ERROR_KEY[geoError]}`)}
        </p>
      ) : null}

      {errors.length > 0 ? (
        <div
          id={errorId}
          role="alert"
          data-testid="search-errors"
          className="text-small text-destructive"
        >
          <ul className="flex flex-col gap-0.5">
            {errors.map((code) => (
              <li key={code}>{t(`errors.${code}`)}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </form>
  );
}
