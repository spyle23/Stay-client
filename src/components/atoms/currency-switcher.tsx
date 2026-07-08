"use client";

import { useTranslations } from "next-intl";
import { CheckIcon, ChevronDownIcon, CoinsIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCurrency } from "@/hooks/use-currency";
import { cn } from "@/lib/utils";
import { currencies, currencySymbols, type Currency } from "@/lib/currency";

/**
 * Bascule de devise de travail (EUR/USD). Met à jour le contexte (et son cookie)
 * SANS rechargement : la devise segmente les résultats vers une seule devise,
 * sans aucune conversion ni comparaison inter-devises (FR-20, UX-DR-8.2, AR-12).
 * N'altère jamais la devise d'un hôtel ni la devise de paiement (AC3).
 */
export function CurrencySwitcher() {
  const { currency, setCurrency } = useCurrency();
  const t = useTranslations("currencySwitcher");

  function selectCurrency(next: Currency) {
    if (next === currency) return;
    setCurrency(next);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex min-h-(--tap-min) items-center gap-1.5 rounded-full border border-border bg-card px-3 text-small font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:bg-muted disabled:pointer-events-none disabled:opacity-50"
        aria-label={`${t("label")} : ${currency} ${currencySymbols[currency]}`}
        data-testid="currency-switcher"
      >
        <CoinsIcon className="size-4" aria-hidden="true" />
        <span className="tabular-nums">
          {currency} {currencySymbols[currency]}
        </span>
        <ChevronDownIcon
          className="size-4 text-muted-foreground"
          aria-hidden="true"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {currencies.map((cur) => (
          <DropdownMenuItem
            key={cur}
            onClick={() => selectCurrency(cur)}
            className={cn(cur === currency && "font-semibold")}
            data-testid={`currency-option-${cur}`}
          >
            <span className="tabular-nums">
              {cur} {currencySymbols[cur]}
            </span>
            {cur === currency && (
              <CheckIcon className="ml-auto size-4" aria-hidden="true" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
