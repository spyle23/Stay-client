import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { BookingSteps } from "@/components/molecules/booking-steps";
import { BookingIdentify } from "@/components/organisms/booking-identify";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { parseBookingParams, parseGuid } from "@/lib/validations/booking";
import { MAX_STAY_NIGHTS } from "@/lib/validations/search";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("booking");
  return {
    title: t("identifyMetaTitle"),
    robots: { index: false, follow: false },
  };
}

/**
 * Identification invité ou compte — **étape 2 du tunnel** (story 2.3, FR-8).
 *
 * Coquille **SSR** (Server Component) : elle valide les query-params côté serveur et ne monte
 * l'île cliente que si le contexte de séjour est exploitable. C'est ici que vit la garde d'AC-9 —
 * une URL invalide rend un état explicite **sans aucun appel réseau**, comme `recap/page.tsx`.
 *
 * Route **publique** : l'identification est justement ce que cette étape produit. Poser une garde
 * de session ici forcerait l'inscription avant de réserver (UX-DR-9.6) — c'est pourquoi le
 * matcher de `src/proxy.ts` reste limité à `/account/:path*`.
 */
export default async function BookingIdentifyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const t = await getTranslations("booking");
  const parsed = parseBookingParams(sp);

  // Une réservation déjà créée peut ramener le voyageur ici (session expirée en plein tunnel,
  // story 2.4). On la valide en **GUID** comme le fait `payment/page.tsx` — une valeur libre
  // repartirait telle quelle dans l'URL de retour — et on la relaie pour que la reprise relise
  // au lieu de recréer.
  const rawReservationId = Array.isArray(sp.reservationId)
    ? sp.reservationId[0]
    : sp.reservationId;
  const reservationId = parseGuid(rawReservationId);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6">
      <BookingSteps current="identify" />

      {parsed.ok ? (
        <BookingIdentify params={parsed.value} reservationId={reservationId} />
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
