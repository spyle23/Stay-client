import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { BookingSteps } from "@/components/molecules/booking-steps";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { parseBookingParams } from "@/lib/validations/booking";
import { buildIdentifyUrl } from "@/services/booking.service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("booking");
  return {
    title: t("paymentTitle"),
    robots: { index: false, follow: false },
  };
}

/**
 * Étape 3 du tunnel — **création de la réservation `Pending` et paiement**. Le contenu réel est
 * le périmètre des stories **2.4** (création atomique + Hold de checkout) et **3.1** (Stripe
 * Payment Element, 3-D Secure, capture manuelle).
 *
 * Cette page existe dès la story 2.3 pour une raison précise : le CTA de l'étape d'identification
 * ne doit pas être un **lien mort** (défaut relevé en revue de la story 1.10, repris en 2.2 pour
 * `/booking/identify`). Elle se borne à accuser réception du contexte du séjour et à offrir un
 * retour non destructif — aucune logique, aucun appel réseau.
 *
 * Volontairement **non gardée** : la garde de session arrive avec la création de réservation
 * (2.4), qui est la première écriture réellement authentifiée du tunnel.
 */
export default async function BookingPaymentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const t = await getTranslations("booking");
  const parsed = parseBookingParams(sp);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6">
      <BookingSteps current="identify" />
      <div
        data-testid="booking-payment-placeholder"
        className="flex flex-col items-center gap-3 rounded-xl bg-card p-8 text-center ring-1 ring-border"
      >
        <p className="text-h3 text-foreground">{t("paymentTitle")}</p>
        <p className="max-w-md text-body text-muted-foreground">
          {t("paymentPlaceholder")}
        </p>
        <Link
          href={parsed.ok ? buildIdentifyUrl(parsed.value) : "/"}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "min-h-(--tap-min)",
          )}
          data-testid="booking-payment-back"
        >
          {parsed.ok ? t("backToIdentify") : t("invalidCta")}
        </Link>
      </div>
    </main>
  );
}
