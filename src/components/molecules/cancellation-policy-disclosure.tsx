"use client";

import { CalendarCheckIcon, CircleAlertIcon, InfoIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { DependencyFallback } from "@/components/molecules/dependency-fallback";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn, formatDateTime } from "@/lib/utils";
import type { CancellationPolicyResult } from "@/services/booking.service";

/**
 * Politique d'annulation lisible **avant paiement** (UX-DR-2.14, UX-DR-9.3, FR-7/FR-22).
 *
 * Deux rendus, un seul contrat :
 * - `source === "hotel"` → politique réelle de l'Hôtel : résumé visible **sans interaction** +
 *   conditions dépliables.
 * - `source === "fallback"` → **D2 non livré** (le PMS n'expose aucune politique par hôtel) :
 *   `DependencyFallback` énonce des conditions génériques honnêtes. On n'affiche alors
 *   **ni échéance, ni taux de remboursement, ni « annulation gratuite »** — annoncer une gratuité
 *   sans donnée serait une promesse fausse (UX-DR-9.5), exactement le dark pattern que le PRD
 *   proscrit.
 *
 * Le jour où D2 est livré, seul le contenu du DTO change : ni ce composant, ni ses appelants.
 */
export function CancellationPolicyDisclosure({
  policy,
}: {
  policy: CancellationPolicyResult;
}) {
  const t = useTranslations("booking");
  const locale = useLocale();

  if (policy.source === "fallback") {
    return (
      <DependencyFallback
        dependency="D2"
        data-testid="cancellation-policy-fallback"
      >
        <span className="font-medium text-foreground">{t("policyTitle")}</span>
        <span>{t("policyFallbackSummary")}</span>
        <span>{t("policyFallbackDetail")}</span>
      </DependencyFallback>
    );
  }

  // Politique réelle : résumé factuel (jamais l'info par la seule couleur — icône + texte).
  //
  // `freeUntil` est un **instant** (ISO 8601 UTC), pas une date-only : le rendre avec `formatDate`
  // effacerait l'heure limite et laisserait croire que toute la journée est acquise. `formatDateTime`
  // conserve l'heure ET renvoie `null` sur une valeur non exploitable — auquel cas on retombe sur
  // l'énoncé de remboursabilité plutôt que de laisser lever un `RangeError` en plein tunnel.
  const freeUntilLabel =
    policy.freeUntil !== null ? formatDateTime(policy.freeUntil, locale) : null;
  const summary =
    freeUntilLabel !== null
      ? t("policyFreeUntil", { date: freeUntilLabel })
      : policy.refundable === true
        ? t("policyRefundable")
        : policy.refundable === false
          ? t("policyNonRefundable")
          : t("policyUnknown");

  // L'habillage suit le **contenu** : une réservation non remboursable est la contrainte la plus
  // forte du parcours — la rendre en vert « succès » avec une icône de validation contredirait le
  // texte juste au-dessus du bouton qui engage le voyageur (UX-DR-9.5, revue 2.2).
  const nonRefundable = freeUntilLabel === null && policy.refundable === false;
  const neutral = freeUntilLabel === null && policy.refundable === null;
  const SummaryIcon = nonRefundable
    ? CircleAlertIcon
    : neutral
      ? InfoIcon
      : CalendarCheckIcon;

  return (
    <div
      data-testid="cancellation-policy"
      data-policy-source={policy.source}
      data-policy-tone={
        nonRefundable ? "restrictive" : neutral ? "neutral" : "favourable"
      }
      className={cn(
        "flex flex-col gap-1 rounded-lg p-3 text-small",
        nonRefundable
          ? "bg-warning-soft text-warning"
          : neutral
            ? "bg-muted text-muted-foreground"
            : "bg-success-soft text-success",
      )}
    >
      <span className="inline-flex items-start gap-2 font-medium">
        <SummaryIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{summary}</span>
      </span>
      {policy.terms ? (
        <Accordion>
          <AccordionItem>
            <AccordionTrigger data-testid="cancellation-policy-details">
              {t("policyDetailsLabel")}
            </AccordionTrigger>
            <AccordionContent>
              <p>{policy.terms}</p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      ) : null}
    </div>
  );
}
