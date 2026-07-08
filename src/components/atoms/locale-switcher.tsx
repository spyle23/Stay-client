"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { CheckIcon, ChevronDownIcon, GlobeIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setBrowserCookie } from "@/lib/cookies";
import { cn } from "@/lib/utils";
import {
  LOCALE_COOKIE,
  localeNames,
  locales,
  type Locale,
} from "@/i18n/config";

/**
 * Bascule de langue (fr/en). Écrit le cookie `NEXT_LOCALE` puis rafraîchit les
 * composants serveur (`router.refresh()`) : l'interface est retraduite et
 * `<html lang>` mis à jour SANS changer d'URL → le contexte de navigation est
 * préservé (FR-20, UX-DR-8.1). Ne touche jamais à la devise (AC3).
 */
export function LocaleSwitcher() {
  const locale = useLocale() as Locale;
  const t = useTranslations("localeSwitcher");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function selectLocale(next: Locale) {
    if (next === locale) return;
    setBrowserCookie(LOCALE_COOKIE, next);
    startTransition(() => router.refresh());
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex min-h-(--tap-min) items-center gap-1.5 rounded-full border border-border bg-card px-3 text-small font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:bg-muted disabled:pointer-events-none disabled:opacity-50"
        aria-label={`${t("label")} : ${localeNames[locale]}`}
        disabled={isPending}
        data-testid="locale-switcher"
      >
        <GlobeIcon className="size-4" aria-hidden="true" />
        <span>{locale.toUpperCase()}</span>
        <ChevronDownIcon
          className="size-4 text-muted-foreground"
          aria-hidden="true"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {locales.map((loc) => (
          <DropdownMenuItem
            key={loc}
            onClick={() => selectLocale(loc)}
            className={cn(loc === locale && "font-semibold")}
            data-testid={`locale-option-${loc}`}
          >
            {localeNames[loc]}
            {loc === locale && (
              <CheckIcon className="ml-auto size-4" aria-hidden="true" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
