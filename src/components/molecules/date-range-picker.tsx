"use client";

import { useState } from "react";
import { enUS, fr } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { DateRange } from "react-day-picker";

import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils";

/** Date locale (jour choisi au calendrier) → `AAAA-MM-JJ`, sans décalage de fuseau. */
export function dateToIsoDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Sélecteur de plage de dates (UX-DR-2.9) : `Calendar` `mode="range"` dans un `Popover`,
 * clavier + focus-trap + Esc (primitives base-ui). Les dates passées sont désactivées.
 */
export function DateRangePicker({
  value,
  onChange,
  invalid = false,
  describedBy,
}: {
  value: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const locale = useLocale();
  const t = useTranslations("search");
  const [open, setOpen] = useState(false);

  // « Aujourd'hui » ancré sur la date calendaire UTC (comme `todayUtcMidnight` de la validation)
  // pour que le picker n'offre jamais un jour que le validateur rejetterait (fuseaux à offset < 0).
  const now = new Date();
  const today = new Date(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const calendarLocale = locale === "en" ? enUS : fr;

  const label =
    value?.from && value.to
      ? `${formatDate(dateToIsoDateOnly(value.from), locale)} – ${formatDate(
          dateToIsoDateOnly(value.to),
          locale,
        )}`
      : t("datesPlaceholder");

  function handleSelect(range: DateRange | undefined) {
    onChange(range);
    if (range?.from && range.to) {
      setOpen(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        data-testid="date-range-trigger"
        aria-label={t("datesLabel")}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={cn(
          "inline-flex min-h-(--tap-min) w-full items-center gap-2 rounded-lg border border-input bg-transparent px-3 text-left text-body text-foreground outline-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
          !value?.from && "text-muted-foreground",
        )}
      >
        <CalendarIcon className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="range"
          numberOfMonths={1}
          selected={value}
          onSelect={handleSelect}
          disabled={{ before: today }}
          locale={calendarLocale}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
