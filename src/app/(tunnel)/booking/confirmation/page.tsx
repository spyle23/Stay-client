import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { BookingSteps } from "@/components/molecules/booking-steps";
import { BookingConfirmation } from "@/components/organisms/booking-confirmation";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { parseBookingParams, parseGuid } from "@/lib/validations/booking";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("booking.confirmation");
  return {
    title: t("metaTitle"),
    robots: { index: false, follow: false },
  };
}

/**
 * Confirmation ferme post-paiement — **dernière étape du tunnel** (story 3.2, C6 / D-4).
 *
 * Coquille **SSR** sur le patron de `payment/page.tsx` : validation des query-params côté serveur,
 * `reservationId` validé **GUID**. Sans identifiant exploitable, un état explicite et une sortie,
 * **aucun appel réseau**.
 *
 * Page **dédiée**, pas un état du formulaire de paiement : le rechargement d'une carte déjà retenue
 * est le chemin NOMINAL en production, et le retour 3-DS par `return_url` doit converger vers le
 * même endroit. « Garantir que cette réservation est confirmée, puis montrer la preuve » est
 * naturellement rejouable — la confirmation est idempotente du BFF au PMS.
 *
 * Le contexte de séjour (facultatif) ne sert qu'à proposer le retour au récapitulatif sur un échec.
 * `BookingSteps` a déjà l'étape `confirmation` : aucune 4ᵉ puce.
 */
export default async function BookingConfirmationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const t = await getTranslations("booking.confirmation");
  const rawReservationId = Array.isArray(sp.reservationId)
    ? sp.reservationId[0]
    : sp.reservationId;
  const reservationId = parseGuid(rawReservationId);
  const parsed = parseBookingParams(sp);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-6">
      <BookingSteps current="confirmation" />

      {reservationId ? (
        <BookingConfirmation
          reservationId={reservationId}
          context={parsed.ok ? parsed.value : null}
        />
      ) : (
        <div
          role="alert"
          data-testid="confirmation-invalid"
          className="flex flex-col items-center gap-3 rounded-xl bg-card p-8 text-center ring-1 ring-border"
        >
          <h1 className="text-h2 text-foreground">{t("invalidTitle")}</h1>
          <p className="max-w-md text-body text-muted-foreground">
            {t("invalidBody")}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Link
              href="/account"
              className={cn(
                buttonVariants({ variant: "outline" }),
                "min-h-(--tap-min)",
              )}
            >
              {t("accountCta")}
            </Link>
            <Link
              href="/"
              className={cn(
                buttonVariants({ variant: "outline" }),
                "min-h-(--tap-min)",
              )}
              data-testid="confirmation-invalid-home"
            >
              {t("homeCta")}
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}
