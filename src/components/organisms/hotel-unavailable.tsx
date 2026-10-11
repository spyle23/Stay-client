import Link from "next/link";
import { useTranslations } from "next-intl";

import { buttonVariants } from "@/components/ui/button";

/**
 * État dégradé de la fiche hôtel (`(public)/hotels/[slug]`) : PMS ou BFF momentanément injoignable.
 * La page est servie en 200 avec cet état ; il offre une **sortie** vers l'accueil
 * (spyle23/hotelerie#148, AC-2) au lieu d'une impasse.
 */
export function HotelUnavailable() {
  const t = useTranslations("hotel");
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6">
      <div
        role="alert"
        data-testid="hotel-degraded"
        className="flex flex-col items-center gap-3 rounded-xl bg-card p-8 text-center ring-1 ring-border"
      >
        <p className="text-h3 text-foreground">{t("errorTitle")}</p>
        <p className="max-w-md text-body text-muted-foreground">
          {t("errorBody")}
        </p>
        <Link
          href="/"
          data-testid="hotel-degraded-cta"
          className={buttonVariants({ variant: "outline" })}
        >
          {t("errorCta")}
        </Link>
      </div>
    </main>
  );
}
