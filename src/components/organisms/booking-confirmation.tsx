"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { ConfirmationProof } from "@/components/organisms/confirmation-proof";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfirmReservation } from "@/hooks/use-confirm-reservation";
import { cn } from "@/lib/utils";
import type { ParsedBookingParams } from "@/lib/validations/booking";
import {
  buildConfirmationUrl,
  buildRecapUrl,
} from "@/services/booking.service";
import { buildHotelPageUrl } from "@/services/catalog.service";
import {
  confirmDebitStatement,
  confirmFailureDebit,
  confirmFailureReason,
  RETRYABLE_CONFIRM_REASONS,
  type ConfirmDebitStatement,
  type ConfirmDebitStatus,
  type ConfirmFailureReason,
} from "@/services/payment.service";

/**
 * Clé i18n de l'énoncé de débit (#4, AC-8) : jamais « aucun débit » quand de l'argent a bougé, ni
 * quand rien ne l'établit (`unknown`).
 */
const DEBIT_MESSAGE: Record<ConfirmDebitStatement, string> = {
  none: "noDebitKept",
  refunded: "refundIssued",
  captured: "debitCaptured",
  held: "debitHeld",
  unknown: "debitUnknown",
};

/** Motifs dont l'issue est l'hôtel (autres chambres), pas le récapitulatif de la chambre prise. */
const TO_ALTERNATIVES: ReadonlySet<ConfirmFailureReason> =
  new Set<ConfirmFailureReason>(["room-unavailable"]);

/**
 * Île cliente de la page de confirmation (story 3.2, C7 / AC-1, AC-6, AC-10, AC-11).
 *
 * Déclenche la confirmation **une fois par montage** (`useConfirmReservation`), puis rend l'un des
 * trois états : `confirming`, `confirmed` (la preuve) ou `failed`.
 *
 * ⚠️ Un échec n'est **jamais un cul-de-sac** : motif humain, statut de débit explicite (#4 : aucun
 * débit, remboursement, retenue, encaissement, ou « non encore vérifié », jamais déduit d'une
 * absence d'information), puis une issue — « Réessayer » pour les seuls motifs rejouables (`unavailable`,
 * `unknown`, `capture-failed`, `payment-verification-pending`), sinon une sortie (récapitulatif,
 * reconnexion ou accueil).
 */
export function BookingConfirmation({
  reservationId,
  context,
}: {
  reservationId: string;
  /** Contexte de séjour porté par l'URL, s'il est exploitable (sortie vers le récapitulatif). */
  context: ParsedBookingParams | null;
}) {
  const state = useConfirmReservation(reservationId);

  if (state.status === "confirmed" && state.proof) {
    return <ConfirmationProof proof={state.proof} />;
  }

  if (state.status === "failed") {
    return (
      <ConfirmationFailure
        reason={confirmFailureReason(state.error)}
        debit={confirmFailureDebit(state.error)}
        reservationId={reservationId}
        context={context}
        onRetry={state.retry}
      />
    );
  }

  return <ConfirmationPending />;
}

function ConfirmationPending() {
  const t = useTranslations("booking.confirmation");

  return (
    <section
      className="flex flex-col gap-4 rounded-xl bg-card p-5 ring-1 ring-border"
      aria-busy="true"
      data-testid="confirmation-pending"
    >
      <h1 className="text-h1 text-foreground">{t("confirmingTitle")}</h1>
      <p
        role="status"
        aria-live="polite"
        className="text-body text-muted-foreground"
      >
        {t("confirmingBody")}
      </p>
      <Skeleton className="h-10 w-56" />
      <Skeleton className="h-44 w-full" />
    </section>
  );
}

function ConfirmationFailure({
  reason,
  debit,
  reservationId,
  context,
  onRetry,
}: {
  reason: ConfirmFailureReason;
  /**
   * Statut de débit établi par le BFF (#4) ; `null` : « aucun débit » seulement pour un motif qui le
   * prouve, sinon énoncé « non établi ».
   */
  debit: ConfirmDebitStatus | null;
  reservationId: string;
  context: ParsedBookingParams | null;
  onRetry: () => void;
}) {
  const t = useTranslations("booking.confirmation");
  const titleRef = useRef<HTMLHeadingElement | null>(null);

  // Le motif change le contenu : le focus suit, pour qu'au clavier l'issue ne se découvre pas en
  // explorant la page.
  useEffect(() => {
    titleRef.current?.focus();
  }, [reason]);

  const retryable = RETRYABLE_CONFIRM_REASONS.has(reason);
  // Retour ici après reconnexion : la confirmation se rejoue (idempotente) et rend la preuve.
  const here = buildConfirmationUrl(reservationId, context ?? undefined);
  // #4 AC-7 : la chambre est prise ; l'issue est l'hôtel, pour les mêmes dates et voyageurs.
  const toAlternatives = TO_ALTERNATIVES.has(reason);
  const alternativesUrl =
    toAlternatives && context
      ? buildHotelPageUrl(context.hotelId, null, {
          checkInDate: context.checkInDate,
          checkOutDate: context.checkOutDate,
          guests: context.guests,
          currency: context.currency,
        })
      : null;
  const debitStatus = confirmDebitStatement(reason, debit);
  // #184 AC-2 : débit non établi sur un motif rejouable (panne, capture non aboutie, vérification
  // en cours) : dire que réessayer est sûr (confirmation idempotente au BFF et au PMS), plutôt que
  // renvoyer le voyageur vers ses réservations.
  const retrySafe = debitStatus === "unknown" && retryable;

  return (
    <section
      role="alert"
      className="flex flex-col items-start gap-3 rounded-xl bg-warning-soft p-5 text-warning"
      data-testid="confirmation-failed"
      data-reason={reason}
    >
      <h1
        ref={titleRef}
        tabIndex={-1}
        className="text-h2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t(`errors.${reason}.title`)}
      </h1>
      <p className="text-body">{t(`errors.${reason}.body`)}</p>
      <p
        className="text-small font-medium"
        data-testid={
          debitStatus === "none"
            ? "confirmation-no-debit"
            : `confirmation-debit-${debitStatus}`
        }
        data-debit={debitStatus}
        data-retry-safe={retrySafe ? "true" : undefined}
      >
        {t(retrySafe ? "debitUnknownRetrySafe" : DEBIT_MESSAGE[debitStatus])}
      </p>

      <div className="flex flex-wrap gap-2">
        {alternativesUrl ? (
          <Link
            href={alternativesUrl}
            className={cn(buttonVariants(), "min-h-(--tap-min)")}
            data-testid="confirmation-alternatives"
          >
            {t("alternativesCta")}
          </Link>
        ) : null}

        {retryable ? (
          <Button
            type="button"
            variant="outline"
            onClick={onRetry}
            className="min-h-(--tap-min)"
            data-testid="confirmation-retry"
          >
            {t("retry")}
          </Button>
        ) : null}

        {reason === "session-invalid" ? (
          <Link
            href={`/login?next=${encodeURIComponent(here)}`}
            className={cn(
              buttonVariants({ variant: "outline" }),
              "min-h-(--tap-min)",
            )}
            data-testid="confirmation-login"
          >
            {t("loginCta")}
          </Link>
        ) : null}

        {!retryable && !toAlternatives && context ? (
          <Link
            href={buildRecapUrl(context)}
            className={cn(
              buttonVariants({ variant: "outline" }),
              "min-h-(--tap-min)",
            )}
            data-testid="confirmation-recap"
          >
            {t("recapCta")}
          </Link>
        ) : null}

        <Link
          href="/"
          className={cn(
            buttonVariants({ variant: "outline" }),
            "min-h-(--tap-min)",
          )}
          data-testid="confirmation-home"
        >
          {t("homeCta")}
        </Link>
      </div>
    </section>
  );
}
