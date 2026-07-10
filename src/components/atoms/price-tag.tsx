"use client";

import { useLocale, useTranslations } from "next-intl";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils";

type PriceTagSize = "sm" | "md" | "lg";

const amountSizeClass: Record<PriceTagSize, string> = {
  sm: "text-h3",
  md: "text-h2",
  lg: "text-display",
};

/**
 * Affiche un montant (total du séjour) dans **une seule devise** (UX-DR-2.4). Montant reçu
 * en **cents entiers** ; jamais de rouge promo. `aria-live="polite"` : tout recalcul est
 * annoncé (UX-DR-5.7). Le libellé pilote la locale de formatage (pas la devise).
 */
export function PriceTag({
  amount,
  currency,
  size = "sm",
  caption,
  loading = false,
  className,
  "data-testid": dataTestId,
}: {
  amount: number;
  currency: string;
  size?: PriceTagSize;
  caption?: string;
  loading?: boolean;
  className?: string;
  "data-testid"?: string;
}) {
  const locale = useLocale();
  const t = useTranslations("results");

  if (loading) {
    return (
      <div className={cn("flex flex-col gap-1", className)}>
        <Skeleton
          className="h-6 w-24"
          aria-busy="true"
          aria-label={t("priceCalculating")}
        />
      </div>
    );
  }

  return (
    <div
      className={cn("flex flex-col gap-0.5", className)}
      data-testid={dataTestId}
    >
      <span
        aria-live="polite"
        className={cn(
          "font-semibold tabular-nums text-foreground",
          amountSizeClass[size],
        )}
      >
        {formatCurrency(amount, currency, locale)}
      </span>
      {caption ? (
        <span className="text-caption text-muted-foreground">{caption}</span>
      ) : null}
    </div>
  );
}
