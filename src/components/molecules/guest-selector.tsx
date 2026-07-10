"use client";

import { useState } from "react";
import { MinusIcon, PlusIcon, UsersIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { MAX_GUESTS, MIN_GUESTS } from "@/lib/validations/search";

/**
 * Sélecteur de voyageurs (UX-DR-2.10) : incrément/décrément accessibles clavier dans un
 * `Popover`. Bornes [1, 30] ; le compteur est annoncé (`aria-live`). Cibles ≥ 44 px.
 */
export function GuestSelector({
  value,
  onChange,
  invalid = false,
  describedBy,
}: {
  value: number;
  onChange: (guests: number) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const t = useTranslations("search");
  const [open, setOpen] = useState(false);

  const decrease = () => onChange(Math.max(MIN_GUESTS, value - 1));
  const increase = () => onChange(Math.min(MAX_GUESTS, value + 1));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        data-testid="guest-selector-trigger"
        aria-label={t("guestsLabel")}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="inline-flex min-h-(--tap-min) w-full items-center gap-2 rounded-lg border border-input bg-transparent px-3 text-left text-body text-foreground outline-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20"
      >
        <UsersIcon className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{t("guestsCount", { count: value })}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <div className="flex items-center justify-between gap-3">
          <span className="text-body text-foreground">{t("guestsLabel")}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={decrease}
              disabled={value <= MIN_GUESTS}
              aria-label={t("decreaseGuests")}
              data-testid="guest-decrease"
              className={cn(
                "inline-flex size-(--tap-min) items-center justify-center rounded-full border border-input text-foreground outline-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
              )}
            >
              <MinusIcon className="size-4" aria-hidden="true" />
            </button>
            <span
              aria-live="polite"
              data-testid="guest-count"
              className="w-6 text-center text-body font-medium tabular-nums text-foreground"
            >
              {value}
            </span>
            <button
              type="button"
              onClick={increase}
              disabled={value >= MAX_GUESTS}
              aria-label={t("increaseGuests")}
              data-testid="guest-increase"
              className="inline-flex size-(--tap-min) items-center justify-center rounded-full border border-input text-foreground outline-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
            >
              <PlusIcon className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
