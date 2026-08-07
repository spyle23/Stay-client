"use client";

import { useId, useState } from "react";
import { ChevronDownIcon, CircleAlertIcon, InfoIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { PriceTag } from "@/components/atoms/price-tag";
import { CancellationPolicyDisclosure } from "@/components/molecules/cancellation-policy-disclosure";
import { DependencyFallback } from "@/components/molecules/dependency-fallback";
import { RemoteImage } from "@/components/atoms/remote-image";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import {
  isOverCapacity,
  type BookingQuoteResult,
} from "@/services/booking.service";

/**
 * Récapitulatif **persistant** du tunnel (UX-DR-2.5, FR-7).
 *
 * Contenu : hôtel, chambre, dates, nuits, voyageurs, ventilation, état de taxe, **total** et
 * devise, plus la `CancellationPolicyDisclosure` — le tout **avant paiement** (UX-DR-9.3).
 *
 * Responsive (UX-DR-6.4) : panneau **collant** en 2 colonnes ≥ lg ; **barre collante repliée**
 * dépliable en dessous (bornée à 70 % de la hauteur d'écran pour ne jamais masquer le contenu).
 * Le total est rendu par `PriceTag`, dont le montant vit dans une région `aria-live="polite"` :
 * chaque recalcul de dates/voyageurs est **annoncé** (UX-DR-5.7).
 *
 * **Trois zones, et l'ordre compte** (revue 2.2) : la barre repliée (total), le détail dépliable
 * (hôtel, séjour, ventilation, taxe, total), puis un bloc **toujours visible** portant l'état de
 * disponibilité et la politique d'annulation. Ce dernier ne peut pas vivre dans le panneau
 * repliable : AC-3 exige la politique lisible **sans interaction** avant paiement, et l'avis de
 * disponibilité dégradée n'est affiché nulle part ailleurs — replié, il n'aurait jamais été vu.
 *
 * **Anti drip-pricing** (UX-DR-9.2) : le total affiché ici est celui qui sera débité. Aucun poste
 * n'apparaît plus loin dans le tunnel — la taxe reste un **état** explicite tant que D7 n'est pas
 * livré, jamais une ligne chiffrée inventée.
 */
export function BookingSummary({
  quote,
  recalculating = false,
}: {
  quote: BookingQuoteResult;
  recalculating?: boolean;
}) {
  const t = useTranslations("booking");
  const locale = useLocale();
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);

  const nightsLabel = t("nightsValue", { count: quote.nights });
  const perNight = formatCurrency(quote.pricePerNight, quote.currency, locale);

  return (
    <aside
      role="complementary"
      aria-label={t("summaryLabel")}
      data-testid="booking-summary"
      // Collant dans les deux dispositions (AC-11) : en bas de l'écran sous `lg` (le récapitulatif
      // est alors sous la colonne principale, donc sous le CTA), en haut de colonne au-delà.
      // `max-h`/`overflow-y-auto` : une barre collante ne doit jamais confisquer tout le viewport.
      className="sticky bottom-0 z-20 flex max-h-(--sticky-bar-max-h) w-full flex-col overflow-y-auto rounded-xl bg-card ring-1 ring-border lg:bottom-auto lg:top-6 lg:h-fit lg:max-h-none lg:overflow-hidden"
    >
      {/* Barre repliée mobile : total toujours visible, détail à un tap (UX-DR-6.1). */}
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        aria-controls={panelId}
        data-testid="booking-summary-toggle"
        className="flex min-h-(--tap-min) items-center justify-between gap-3 border-b border-border px-4 py-3 text-left lg:hidden"
      >
        <span className="flex flex-col">
          <span className="text-caption text-muted-foreground">
            {recalculating
              ? t("recalculating")
              : t("totalNights", { nights: nightsLabel })}
          </span>
          <span className="text-h3 font-semibold tabular-nums text-foreground">
            {recalculating
              ? "—"
              : formatCurrency(quote.total, quote.currency, locale)}
          </span>
        </span>
        <span className="inline-flex items-center gap-1 text-small font-medium text-primary">
          {t("detail")}
          <ChevronDownIcon
            className={cn(
              "size-4 transition-transform",
              expanded && "rotate-180",
            )}
            aria-hidden="true"
          />
        </span>
      </button>

      {/* Pendant un recalcul, le détail affiché est celui du séjour PRÉCÉDENT (`keepPreviousData`) :
          il est marqué périmé plutôt que présenté comme courant — sans quoi la ventilation et les
          dates contrediraient silencieusement l'éditeur de séjour.

          ⚠️ L'état périmé est porté par `aria-busy`, le libellé « recalcul » de l'en-tête et le
          `loading` du total — **jamais par une atténuation d'opacité**. Une `opacity-60` sur ce
          bloc fait tomber `text-muted-foreground` à **2.46:1** sur fond clair (AA exige 4.5:1) :
          `axe` l'a relevé sur 11 nœuds (`aside`, `dt`, `span`) dès que l'état a enfin été audité,
          en thème clair **comme** sombre. Atténuer du texte pour signifier « périmé » est
          précisément l'anti-patron qui casse le contraste — revue de code 2.4. */}
      <div
        id={panelId}
        data-testid="booking-summary-panel"
        aria-busy={recalculating}
        className={cn("flex-col", expanded ? "flex" : "hidden lg:flex")}
      >
        <header className="flex gap-3 border-b border-border p-4">
          {/* Vignette décorative (`alt=""`) : toute l'information est portée par le texte à côté.
              `RemoteImage` gère lui-même le repli placeholder (src absent ou chargement en échec). */}
          <RemoteImage
            src={quote.roomImageUrl}
            alt=""
            sizes="56px"
            className="size-14 shrink-0 rounded-lg"
          />
          <div className="flex min-w-0 flex-col">
            {/* Logo de l'Hôtel (AC-1) — décoratif : le nom juste à côté porte l'information.
                Absent pour un établissement qui n'en publie pas : le nom suffit alors. */}
            <div className="flex items-center gap-1.5">
              {quote.hotelLogoUrl ? (
                <span data-testid="booking-hotel-logo" className="contents">
                  <RemoteImage
                    src={quote.hotelLogoUrl}
                    alt=""
                    sizes="20px"
                    className="size-5 shrink-0 rounded"
                  />
                </span>
              ) : null}
              <span className="truncate text-body font-semibold text-foreground">
                {quote.hotelName ?? t("hotelUnnamed")}
              </span>
            </div>
            {quote.hotelCity ? (
              <span className="text-small text-muted-foreground">
                {quote.hotelCity}
              </span>
            ) : null}
          </div>
        </header>

        <dl className="flex flex-col gap-2 border-b border-border p-4 text-small">
          <SummaryRow
            label={t("roomLabel")}
            value={quote.roomCategory ?? t("roomDefault")}
            testId="booking-room"
          />
          {/* N° de chambre et capacité sont énumérés par AC-1 : le PMS les fournit, le contrat les
              transporte — ne pas les rendre reviendrait à les perdre en route. */}
          {quote.roomNumber ? (
            <SummaryRow
              label={t("roomNumberLabel")}
              value={quote.roomNumber}
              testId="booking-room-number"
            />
          ) : null}
          {quote.roomCapacity !== null ? (
            <SummaryRow
              label={t("roomCapacityLabel")}
              value={t("roomCapacityValue", { count: quote.roomCapacity })}
              testId="booking-room-capacity"
            />
          ) : null}
          <SummaryRow
            label={t("checkInLabel")}
            value={formatDate(quote.checkInDate, locale)}
            testId="booking-check-in"
          />
          <SummaryRow
            label={t("checkOutLabel")}
            value={formatDate(quote.checkOutDate, locale)}
            testId="booking-check-out"
          />
          <SummaryRow
            label={t("guestsLabel")}
            value={t("guestsValue", { count: quote.guests })}
            testId="booking-guests"
          />
        </dl>

        <div className="flex flex-col gap-2 p-4 text-small tabular-nums">
          <div className="flex justify-between gap-3">
            <span
              className="text-muted-foreground"
              data-testid="booking-breakdown"
            >
              {t("breakdownRoom", { price: perNight, nights: nightsLabel })}
            </span>
            <span className="text-foreground">
              {formatCurrency(quote.roomTotal, quote.currency, locale)}
            </span>
          </div>
          {/* D7 non livré : état explicite, jamais un montant de taxe inventé (FR-24, AR-22). */}
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">{t("taxLabel")}</span>
            <span
              className="text-muted-foreground"
              data-testid="booking-tax-state"
            >
              {t("taxIncludedUndetailed")}
            </span>
          </div>
        </div>

        <div className="flex items-baseline justify-between gap-3 border-t border-border bg-muted/40 p-4">
          <span className="text-body font-semibold text-foreground">
            {t("totalLabel", { currency: quote.currency })}
          </span>
          <PriceTag
            amount={quote.total}
            currency={quote.currency}
            size="md"
            loading={recalculating}
            className="items-end"
            data-testid="booking-total"
          />
        </div>
      </div>

      {/* Bloc TOUJOURS visible — hors du panneau repliable (AC-3, AC-7) : la politique
          d'annulation doit être lisible sans interaction avant paiement, et l'avis de
          disponibilité n'existe nulle part ailleurs dans l'écran. */}
      <div
        data-testid="booking-summary-essentials"
        className="flex flex-col gap-3 border-t border-border p-4"
      >
        {/* Ordre CRITIQUE : le dépassement de capacité d'abord — c'est la seule cause que le devis
            connaît avec certitude, et elle est déjà expliquée en pleine page (`BookingRecap`) ;
            répéter ici « plus disponible » ajouterait une cause vague à côté de la vraie. Puis la
            dégradation (règle héritée de 1.10) : une panne du cross-check ne doit JAMAIS
            s'afficher « indisponible ». L'indisponibilité réelle vient en dernier. */}
        {isOverCapacity(quote) ? null : quote.availabilityDegraded ? (
          <p
            role="status"
            data-testid="booking-availability-degraded"
            className="inline-flex items-start gap-2 text-caption text-muted-foreground"
          >
            <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>{t("availabilityToConfirm")}</span>
          </p>
        ) : !quote.available ? (
          <p
            role="status"
            data-testid="booking-unavailable-notice"
            className="inline-flex items-start gap-2 rounded-lg bg-warning-soft p-3 text-small text-warning"
          >
            <CircleAlertIcon
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            <span>{t("unavailableNotice")}</span>
          </p>
        ) : null}

        <CancellationPolicyDisclosure policy={quote.cancellationPolicy} />

        {/* Rappel anti drip-pricing : ce total est le montant qui sera débité. */}
        <DependencyFallback dependency="D7" data-testid="booking-price-promise">
          <span>{t("pricePromise")}</span>
        </DependencyFallback>
      </div>
    </aside>
  );
}

function SummaryRow({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId: string;
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}
