import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { BookingSteps } from "@/components/molecules/booking-steps";
import { BookingPayment } from "@/components/organisms/booking-payment";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { parseBookingParams, parseGuid } from "@/lib/validations/booking";
import { MAX_STAY_NIGHTS } from "@/lib/validations/search";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("booking");
  return {
    title: t("paymentTitle"),
    robots: { index: false, follow: false },
  };
}

/**
 * Création de la Réservation `Pending` — **étape 3 du tunnel** (story 2.4, FR-9).
 *
 * Coquille **SSR** (Server Component) : elle valide les query-params côté serveur et ne monte
 * l'île cliente que si le contexte de séjour est exploitable — une URL invalide rend un état
 * explicite **sans aucun appel réseau**, comme `recap/` et `identify/`.
 *
 * `reservationId` (posé après création) est validé **GUID** ici : une valeur libre partirait
 * telle quelle dans un chemin du BFF. Une valeur non conforme est simplement ignorée — l'écran
 * repart alors sur la création, plutôt que d'afficher une erreur pour une URL bricolée.
 *
 * Route **publique** au sens du routage : la garde vit côté BFF (la création exige une session).
 * Poser une garde de route ici forcerait l'identification avant même d'avoir vu l'écran, ce que
 * le tunnel s'interdit (UX-DR-9.6) — c'est pourquoi le matcher de `src/proxy.ts` reste limité à
 * `/account/:path*`.
 *
 * `BookingSteps` conserve `current="identify"` : le design fusionne « Vos infos & paiement » en
 * une seule étape ; introduire une 4ᵉ puce contredirait le fil affiché depuis la story 2.2.
 */
export default async function BookingPaymentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const t = await getTranslations("booking");
  const parsed = parseBookingParams(sp);
  const rawReservationId = Array.isArray(sp.reservationId)
    ? sp.reservationId[0]
    : sp.reservationId;
  const reservationId = parseGuid(rawReservationId);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6">
      <BookingSteps current="identify" />

      {parsed.ok ? (
        <BookingPayment params={parsed.value} reservationId={reservationId} />
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
