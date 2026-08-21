"use client";

import { useId } from "react";
import { useLocale, useTranslations } from "next-intl";

import { cn, formatCurrency } from "@/lib/utils";
import type {
  UpsellSelection,
  UpsellServiceResult,
} from "@/services/booking.service";

/** Quantité maximale par service — miroir de la borne du DTO BFF (`@Max(99)`). */
export const UPSELL_MAX_QUANTITY = 99;

/**
 * Ajout de services au moment de la réservation (story 2.6, FR-11).
 *
 * ## Où et pourquoi ici
 *
 * Ce bloc vit dans le panneau de création de `/booking/payment`, à côté des préférences (story
 * 2.5) : le panier doit partir dans le **même** `POST` que la création, pour que le PMS écrive la
 * chambre et ses services atomiquement (dépendance D6). Une fois la `Pending` créée, l'écran
 * repasse le panier en lecture seule — sa modification passe alors par un appel dédié, et devient
 * impossible dès qu'un paiement est engagé.
 *
 * ## Règles produit non négociables
 *
 * - **Opt-in strict** (UX-DR-9.7) : rien n'est jamais pré-coché. Une case cochée par défaut est un
 *   dark pattern, et l'inverse d'un consentement.
 * - **Aucune fausse rareté** (UX-DR-9.5) : pas de « plus que 2 ! ». La disponibilité réelle est
 *   tranchée par le PMS à la création, et l'annoncer ici serait au mieux périmé, au pire faux.
 * - **Anti drip-pricing** (UX-DR-9.2) : chaque ajout met le total à jour immédiatement, et ce
 *   total est celui qui sera débité.
 * - **Jamais ce qui est déjà inclus** (AC-2) : le filtrage est fait côté BFF, pas ici — une seule
 *   vérité.
 *
 * ## Composant contrôlé
 *
 * La sélection est **levée** dans `booking-payment.tsx`, comme les préférences : c'est ce qui la
 * fait survivre à un échec de création (`price-changed`, 503) sans re-sélection.
 */
export function ServiceUpsell({
  services,
  selection,
  onChange,
  currency,
  disabled = false,
}: {
  services: readonly UpsellServiceResult[];
  selection: UpsellSelection;
  onChange: (next: UpsellSelection) => void;
  /** Devise de l'Hôtel — jamais celle du visiteur, jamais convertie. */
  currency: string;
  disabled?: boolean;
}) {
  const t = useTranslations("booking.upsell");
  const locale = useLocale();
  const headingId = useId();

  if (services.length === 0) {
    return null;
  }

  const subtotal = services.reduce((sum, service) => {
    const quantity = selection[service.serviceId] ?? 0;
    return quantity > 0 ? sum + service.unitPrice * quantity : sum;
  }, 0);

  function setQuantity(serviceId: string, quantity: number): void {
    const next = { ...selection };
    if (quantity <= 0) {
      delete next[serviceId];
    } else {
      next[serviceId] = Math.min(quantity, UPSELL_MAX_QUANTITY);
    }
    onChange(next);
  }

  return (
    <section
      aria-labelledby={headingId}
      data-testid="service-upsell"
      className="rounded-lg border border-border p-4"
    >
      <h3 id={headingId} className="text-base font-medium text-foreground">
        {t("title")}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>

      <ul className="mt-4 space-y-3">
        {services.map((service) => {
          const quantity = selection[service.serviceId] ?? 0;
          const checked = quantity > 0;

          return (
            <ServiceRow
              key={service.serviceId}
              service={service}
              quantity={quantity}
              checked={checked}
              currency={currency}
              locale={locale}
              disabled={disabled}
              onToggle={(next) => setQuantity(service.serviceId, next ? 1 : 0)}
              onQuantityChange={(next) => setQuantity(service.serviceId, next)}
            />
          );
        })}
      </ul>

      {/*
        Le total de la sélection est annoncé en `polite` : il change à chaque case cochée, et
        `assertive` interromprait le lecteur d'écran à chaque clic. Rendu même à zéro pour que la
        région existe **avant** la première mise à jour — une région créée en même temps que son
        contenu n'est pas annoncée par tous les lecteurs.
      */}
      <p
        aria-live="polite"
        data-testid="upsell-subtotal"
        className={cn(
          "mt-4 text-sm font-medium",
          subtotal > 0 ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {subtotal > 0
          ? t("subtotal", {
              amount: formatCurrency(subtotal, currency, locale),
            })
          : t("subtotalEmpty")}
      </p>
    </section>
  );
}

function ServiceRow({
  service,
  quantity,
  checked,
  currency,
  locale,
  disabled,
  onToggle,
  onQuantityChange,
}: {
  service: UpsellServiceResult;
  quantity: number;
  checked: boolean;
  currency: string;
  locale: string;
  disabled: boolean;
  onToggle: (next: boolean) => void;
  onQuantityChange: (next: number) => void;
}) {
  const t = useTranslations("booking.upsell");
  const checkboxId = useId();
  const quantityId = useId();
  const descriptionId = useId();

  return (
    <li className="flex flex-wrap items-start gap-3">
      <input
        id={checkboxId}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        // Jamais `defaultChecked` : l'opt-in strict interdit qu'un service soit sélectionné sans
        // une action du voyageur (UX-DR-9.7).
        onChange={(event) => onToggle(event.target.checked)}
        aria-describedby={service.description ? descriptionId : undefined}
        data-testid={`upsell-toggle-${service.serviceId}`}
        className="mt-1 size-4 shrink-0 rounded border-input accent-primary disabled:cursor-not-allowed disabled:opacity-50"
      />

      <div className="min-w-0 flex-1">
        <label
          htmlFor={checkboxId}
          className={cn(
            "block text-sm font-medium text-foreground",
            disabled && "opacity-70",
          )}
        >
          {service.name}
        </label>

        <p className="text-sm text-muted-foreground">
          {service.unit
            ? t("unitPriceWithUnit", {
                amount: formatCurrency(service.unitPrice, currency, locale),
                // Texte libre côté PMS : affiché tel quel, jamais interprété comme une règle de
                // calcul (le total ne multiplie que par la quantité choisie).
                unit: service.unit,
              })
            : t("unitPrice", {
                amount: formatCurrency(service.unitPrice, currency, locale),
              })}
        </p>

        {service.description ? (
          <p
            id={descriptionId}
            className="mt-0.5 text-sm text-muted-foreground"
          >
            {service.description}
          </p>
        ) : null}
      </div>

      {checked ? (
        <div className="flex items-center gap-2">
          <label htmlFor={quantityId} className="text-sm text-muted-foreground">
            {t("quantityLabel")}
          </label>
          <input
            id={quantityId}
            type="number"
            inputMode="numeric"
            min={1}
            max={UPSELL_MAX_QUANTITY}
            value={quantity}
            disabled={disabled}
            onChange={(event) => {
              const parsed = Number.parseInt(event.target.value, 10);
              // Une saisie vide ou non numérique ne doit pas retirer le service en silence :
              // on retombe sur 1, la quantité minimale d'un service sélectionné.
              onQuantityChange(Number.isNaN(parsed) ? 1 : parsed);
            }}
            data-testid={`upsell-quantity-${service.serviceId}`}
            className="h-9 w-16 rounded-md border border-input bg-background px-2 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
      ) : null}
    </li>
  );
}
