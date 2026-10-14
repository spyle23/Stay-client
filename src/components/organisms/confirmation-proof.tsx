"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import {
  CircleCheckIcon,
  DownloadIcon,
  LoaderCircleIcon,
  MailIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useConfirmationPdf,
  useConfirmationQr,
  useObjectUrlSource,
} from "@/hooks/use-confirmation-documents";
import { localeNames } from "@/i18n/config";
import { isCurrencyExponentReliable } from "@/lib/currency";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import type { ConfirmationProofResult } from "@/services/payment.service";

/**
 * `ConfirmationProof` du design system (story 3.2, C8 / AC-7, AC-9, AC-11) — la preuve immédiate.
 *
 * - badge « Confirmée » : texte **et** icône, jamais la couleur seule ;
 * - Code de réservation sélectionnable (`<output>` + `select-all`) ;
 * - QR chargé par `fetch` + URL objet (origines distinctes), alternative textuelle qui décrit son
 *   USAGE, jamais « QR code » ;
 * - bouton PDF qui annonce son état de génération ;
 * - récapitulatif relu du serveur ; le total affiché est le montant **capturé** ;
 * - CTA « mes réservations » vers `/account` (l'espace complet arrive en Epic 4 : aucune route
 *   inventée, aucun lien mort).
 *
 * ⚠️ AC-9 : l'e-mail est « en route », jamais « reçu », et tant que D10 n'est pas livrée l'écran ne
 * promet pas qu'il sera rédigé dans la langue choisie.
 */
export function ConfirmationProof({
  proof,
}: {
  proof: ConfirmationProofResult;
}) {
  const t = useTranslations("booking.confirmation");
  const tb = useTranslations("booking");
  const locale = useLocale();
  const titleRef = useRef<HTMLHeadingElement | null>(null);

  // AC-11 : le focus va au titre dès que la preuve s'affiche (annonce + point d'entrée clavier).
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // Le montant qui a réellement changé de main ; à défaut (chemin idempotent), le total relu, que le
  // PMS garantit égal au capturé.
  const paid = proof.capturedAmount ?? proof.total;
  const amountReliable = isCurrencyExponentReliable(proof.currency);

  return (
    <section
      className="flex flex-col gap-6 rounded-xl bg-card p-5 ring-1 ring-border sm:p-6"
      data-testid="confirmation-proof"
      data-status={proof.status}
    >
      <div className="flex flex-col gap-2">
        <span
          className="inline-flex w-fit items-center gap-1.5 rounded-full bg-success-soft px-3 py-1 text-small font-semibold text-success"
          data-testid="confirmation-badge"
        >
          <CircleCheckIcon aria-hidden="true" className="size-4" />
          {t("badge")}
        </span>
        <h1
          ref={titleRef}
          tabIndex={-1}
          className="text-h1 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="confirmation-title"
        >
          {t("title")}
        </h1>
        <p className="text-body text-muted-foreground">{t("subtitle")}</p>
        {/* Région d'annonce permanente : l'arrivée sur la preuve est lue par le lecteur d'écran. */}
        <p role="status" aria-live="polite" className="sr-only">
          {t("announce")}
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <span
          className="text-small text-muted-foreground"
          id="confirmation-code-label"
        >
          {t("codeLabel")}
        </span>
        <output
          aria-labelledby="confirmation-code-label"
          className="w-fit select-all rounded-lg bg-muted px-3 py-2 font-mono text-h3 tracking-wide text-foreground"
          data-testid="confirmation-code"
        >
          {proof.reservationCode}
        </output>
        <span className="text-caption text-muted-foreground">
          {t("codeHelp")}
        </span>
      </div>

      <div className="grid gap-6 md:grid-cols-[auto_1fr]">
        <ConfirmationQr reservationId={proof.reservationId} />

        <div className="flex flex-col gap-3">
          <h2 className="text-h3 text-foreground">{t("summaryTitle")}</h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            <SummaryItem
              label={t("hotelLabel")}
              value={proof.hotelName ?? tb("hotelUnnamed")}
            />
            <SummaryItem
              label={t("roomLabel")}
              value={
                proof.roomNumber
                  ? t("roomValue", {
                      category: proof.roomCategory ?? tb("roomDefault"),
                      number: proof.roomNumber,
                    })
                  : (proof.roomCategory ?? tb("roomDefault"))
              }
            />
            <SummaryItem
              label={t("checkInLabel")}
              value={safeDate(proof.checkInDate, locale)}
            />
            <SummaryItem
              label={t("checkOutLabel")}
              value={safeDate(proof.checkOutDate, locale)}
            />
            <SummaryItem
              label={t("nightsLabel")}
              value={tb("nightsValue", { count: proof.nights })}
            />
            <SummaryItem
              label={t("guestsLabel")}
              value={tb("guestsValue", { count: proof.guests })}
            />
            <SummaryItem
              label={t("totalPaidLabel")}
              value={
                amountReliable
                  ? formatCurrency(paid, proof.currency, locale)
                  : tb("amountUnreliable", { currency: proof.currency })
              }
              testId="confirmation-total"
              emphasis
            />
          </dl>
        </div>
      </div>

      <div
        className="flex flex-col gap-1 rounded-lg bg-muted p-3 text-small text-foreground"
        data-testid="confirmation-email"
      >
        <p className="flex items-start gap-2">
          <MailIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {t("emailOnItsWay")}
        </p>
        {proof.communicationLocaleState === "hotel_default_fallback" &&
        proof.communicationLocale !== null ? (
          <p
            className="text-muted-foreground"
            data-testid="confirmation-email-language-fallback"
          >
            {t("emailLanguageFallback", {
              language: localeNames[proof.communicationLocale],
            })}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <PdfDownload
          reservationId={proof.reservationId}
          reservationCode={proof.reservationCode}
        />
        <Link
          href="/account"
          className={cn(
            buttonVariants({ variant: "outline" }),
            "min-h-(--tap-min)",
          )}
          data-testid="confirmation-account-cta"
        >
          {t("accountCta")}
        </Link>
      </div>
    </section>
  );
}

function SummaryItem({
  label,
  value,
  testId,
  emphasis = false,
}: {
  label: string;
  value: string;
  testId?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <dt className="text-small text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "text-body text-foreground",
          emphasis && "font-semibold tabular-nums",
        )}
        data-testid={testId}
      >
        {value}
      </dd>
    </div>
  );
}

function ConfirmationQr({ reservationId }: { reservationId: string }) {
  const t = useTranslations("booking.confirmation");
  const qr = useConfirmationQr(reservationId);
  const imageRef = useObjectUrlSource(qr.blob);

  return (
    <figure
      className="flex flex-col items-center gap-2"
      data-testid="confirmation-qr"
    >
      <figcaption className="text-small font-medium text-foreground">
        {t("qrTitle")}
      </figcaption>
      {qr.status === "ready" ? (
        // Image d'origine `blob:` produite localement : `next/image` n'a rien à optimiser ici.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={imageRef}
          alt={t("qrAlt")}
          width={176}
          height={176}
          className="size-44 rounded-lg bg-white p-2 ring-1 ring-border"
          data-testid="confirmation-qr-image"
        />
      ) : qr.status === "error" ? (
        <div
          className="flex size-44 flex-col items-center justify-center gap-2 rounded-lg bg-muted p-3 text-center text-small text-foreground"
          data-testid="confirmation-qr-error"
        >
          <p>{t("qrError")}</p>
          <Button
            type="button"
            variant="outline"
            onClick={qr.retry}
            className="min-h-(--tap-min)"
          >
            {t("qrRetry")}
          </Button>
        </div>
      ) : (
        <div aria-busy="true" data-testid="confirmation-qr-loading">
          <Skeleton className="size-44 rounded-lg" />
          <span className="sr-only">{t("qrLoading")}</span>
        </div>
      )}
    </figure>
  );
}

function PdfDownload({
  reservationId,
  reservationCode,
}: {
  reservationId: string;
  reservationCode: string;
}) {
  const t = useTranslations("booking.confirmation");
  const pdf = useConfirmationPdf(reservationId);
  const generating = pdf.status === "generating";
  const fileName = `${/^[A-Za-z0-9-]+$/.test(reservationCode) ? reservationCode : "reservation"}.pdf`;

  return (
    <div className="flex flex-col gap-1">
      {/* `aria-disabled` et non `disabled` : le bouton reste focalisable pendant la génération, et
          `disabled:opacity-50` ferait tomber son contraste sous AA (leçon 3.1). */}
      <Button
        type="button"
        onClick={() => {
          if (!generating) {
            pdf.download(fileName);
          }
        }}
        aria-disabled={generating}
        aria-busy={generating}
        aria-describedby="confirmation-pdf-status"
        className={cn("min-h-(--tap-min)", generating && "cursor-progress")}
        data-testid="confirmation-pdf"
        data-state={pdf.status}
      >
        {generating ? (
          <LoaderCircleIcon
            aria-hidden="true"
            className="size-4 animate-spin"
          />
        ) : (
          <DownloadIcon aria-hidden="true" className="size-4" />
        )}
        {generating ? t("pdfGenerating") : t("pdfButton")}
      </Button>
      <p
        id="confirmation-pdf-status"
        role="status"
        aria-live="polite"
        className={cn(
          "text-caption",
          pdf.status === "error" ? "text-destructive" : "text-muted-foreground",
        )}
        data-testid="confirmation-pdf-status"
      >
        {pdf.status === "generating"
          ? t("pdfGenerating")
          : pdf.status === "ready"
            ? t("pdfReady")
            : pdf.status === "error"
              ? t("pdfError")
              : ""}
      </p>
    </div>
  );
}

/** Date-only rendue sans jamais lever : une valeur illisible s'affiche telle quelle (leçon 2.4). */
function safeDate(value: string, locale: string): string {
  return Number.isNaN(new Date(value).getTime())
    ? value
    : formatDate(value, locale);
}
