import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { BookingSteps } from "@/components/molecules/booking-steps";
import { BookingRecap } from "@/components/organisms/booking-recap";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { parseBookingParams } from "@/lib/validations/booking";
import { MAX_STAY_NIGHTS } from "@/lib/validations/search";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("booking");
  return {
    title: t("metaTitle"),
    // Le tunnel n'a rien à faire dans un index de moteur de recherche : il n'existe que dans le
    // contexte d'un séjour choisi (et les pages publiques hôtel/chambre portent déjà le SEO).
    robots: { index: false, follow: false },
  };
}

/**
 * Récapitulatif de réservation — **étape 1 du tunnel** (story 2.2, FR-7).
 *
 * Coquille **SSR** (Server Component) : valide les query-params côté serveur ; si invalides, elle
 * rend un état de saisie invalide **sans aucun fetch** et avec une porte de sortie (UX-DR-4.5).
 * C'est **ici** que vit la garde d'AC-8 : l'île cliente n'est montée que si le parse a réussi, donc
 * aucun appel BFF ne peut partir d'une URL invalide. Sinon, `BookingRecap` demande le devis au BFF
 * et pilote le recalcul.
 *
 * Tout le contexte (hôtel, chambre, dates, voyageurs, devise) vit dans l'**URL** : partageable,
 * rechargeable, retour arrière non destructif (UX-DR-4.7). Aucun état de tunnel serveur avant la
 * story 2.4 (création `Pending` + Hold de checkout).
 */
export default async function BookingRecapPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const t = await getTranslations("booking");
  const parsed = parseBookingParams(sp);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6">
      <BookingSteps current="stay" />
      <h1 className="text-h1 text-foreground">{t("recapTitle")}</h1>

      {parsed.ok ? (
        <BookingRecap params={parsed.value} />
      ) : (
        <div
          role="alert"
          data-testid="booking-invalid"
          className="flex flex-col items-center gap-3 rounded-xl bg-card p-8 text-center ring-1 ring-border"
        >
          <p className="text-h3 text-foreground">{t("invalidTitle")}</p>
          <p className="max-w-md text-body text-muted-foreground">
            {t("invalidBody")}
          </p>
          <ul className="flex flex-col gap-0.5 text-small text-muted-foreground">
            {parsed.errors.map((code) => (
              <li key={code}>
                {t(`errors.${code}`, { max: MAX_STAY_NIGHTS })}
              </li>
            ))}
          </ul>
          <Link
            href="/"
            className={cn(
              buttonVariants({ variant: "outline" }),
              "min-h-(--tap-min)",
            )}
            data-testid="booking-invalid-cta"
          >
            {t("invalidCta")}
          </Link>
        </div>
      )}
    </main>
  );
}
