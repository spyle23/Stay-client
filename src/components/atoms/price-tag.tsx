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
 *
 * ⚠️ La région live est montée dans les **deux** états (chargement et montant). Une région
 * `aria-live` insérée dans le DOM **en même temps** que son contenu n'est pas observée comme une
 * mutation par les lecteurs d'écran : la sortir du rendu pendant le recalcul reviendrait à ne
 * jamais annoncer le nouveau total — précisément le seul moment où l'annonce compte (revue 2.2).
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

  return (
    // Le `data-testid` est posé dans les DEUX états : un repère qui disparaît pendant le
    // recalcul obligerait chaque appelant à tester deux sélecteurs (piège trouvé en 2.2).
    <div
      className={cn("flex flex-col gap-0.5", className)}
      data-testid={dataTestId}
    >
      <div
        aria-live="polite"
        aria-busy={loading}
        className={cn(
          "font-semibold tabular-nums text-foreground",
          amountSizeClass[size],
        )}
      >
        {loading ? (
          <>
            <Skeleton className="h-6 w-24" />
            <span className="sr-only">{t("priceCalculating")}</span>
          </>
        ) : (
          formatCurrency(amount, currency, locale)
        )}
      </div>
      {caption ? (
        <span className="text-caption text-muted-foreground">{caption}</span>
      ) : null}
    </div>
  );
}
