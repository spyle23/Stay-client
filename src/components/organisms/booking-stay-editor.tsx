"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { DateRange } from "react-day-picker";

import {
  DateRangePicker,
  dateToIsoDateOnly,
} from "@/components/molecules/date-range-picker";
import { GuestSelector } from "@/components/molecules/guest-selector";
import { Button } from "@/components/ui/button";
import { MAX_STAY_NIGHTS, validateDatesGuests } from "@/lib/validations/search";
import type {
  BookingValidationError,
  ParsedBookingParams,
} from "@/lib/validations/booking";
import { buildRecapUrl } from "@/services/booking.service";

/** `AAAA-MM-JJ` → `Date` locale (le picker raisonne en jours calendaires locaux). */
function isoToDate(iso: string): Date | undefined {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) {
    return undefined;
  }
  return new Date(year, month - 1, day);
}

/**
 * Édition du séjour depuis le récapitulatif (AC-2, FR-7).
 *
 * Modifier les dates ou les voyageurs **réécrit l'URL** (`router.replace`, contexte complet
 * préservé) : le devis est alors re-demandé au BFF avant toute création, et le nouveau total est
 * annoncé par la région `aria-live` du `BookingSummary` (UX-DR-5.7). `replace` plutôt que `push` :
 * ajuster un séjour n'est pas une étape de navigation — le retour arrière doit ramener à la fiche
 * chambre, pas dérouler chaque essai de dates (UX-DR-4.4, retour non destructif).
 *
 * Validation **client avant navigation** (règles partagées avec la recherche) : une saisie
 * invalide ne déclenche aucun appel BFF.
 */
export function BookingStayEditor({ params }: { params: ParsedBookingParams }) {
  const t = useTranslations("booking");
  const router = useRouter();
  const errorId = useId();

  const [range, setRange] = useState<DateRange | undefined>({
    from: isoToDate(params.checkInDate),
    to: isoToDate(params.checkOutDate),
  });
  const [guests, setGuests] = useState(params.guests);
  const [errors, setErrors] = useState<BookingValidationError[]>([]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const checkInDate = range?.from ? dateToIsoDateOnly(range.from) : null;
    const checkOutDate = range?.to ? dateToIsoDateOnly(range.to) : null;

    const found = validateDatesGuests({ checkInDate, checkOutDate, guests });
    setErrors(found);
    if (found.length > 0 || checkInDate === null || checkOutDate === null) {
      return; // rejet client — aucun appel BFF
    }

    router.replace(
      buildRecapUrl({ ...params, checkInDate, checkOutDate, guests }),
      { scroll: false },
    );
  }

  const has = (code: BookingValidationError) => errors.includes(code);
  const dateInvalid =
    has("datesRequired") ||
    has("checkInPast") ||
    has("checkOutBeforeCheckIn") ||
    has("stayTooLong");

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      data-testid="booking-stay-editor"
      className="flex w-full flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-border"
    >
      <h2 className="text-h3 text-foreground">{t("editTitle")}</h2>

      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <div className="flex flex-1 flex-col gap-1">
          <span className="text-small font-medium text-foreground">
            {t("editDatesLabel")}
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
            {t("editGuestsLabel")}
          </span>
          <GuestSelector
            value={guests}
            onChange={setGuests}
            invalid={has("guestsMin") || has("guestsMax")}
            describedBy={
              has("guestsMin") || has("guestsMax") ? errorId : undefined
            }
          />
        </div>

        <Button
          type="submit"
          variant="outline"
          className="min-h-(--tap-min)"
          data-testid="booking-stay-submit"
        >
          {t("editSubmit")}
        </Button>
      </div>

      {errors.length > 0 ? (
        <div
          id={errorId}
          role="alert"
          data-testid="booking-stay-errors"
          className="text-small text-destructive"
        >
          <ul className="flex flex-col gap-0.5">
            {errors.map((code) => (
              <li key={code}>
                {t(`errors.${code}`, { max: MAX_STAY_NIGHTS })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </form>
  );
}
