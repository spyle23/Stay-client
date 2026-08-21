"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";

import { DependencyFallback } from "@/components/molecules/dependency-fallback";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { localeNames, locales, type Locale } from "@/i18n/config";
import { cn } from "@/lib/utils";
import {
  specialRequestsLength,
  SPECIAL_REQUESTS_MAX_LENGTH,
  type BookingPreferences,
  type BookingPreferencesError,
} from "@/lib/validations/booking";

/**
 * Demandes spéciales & langue de communication (story 2.5, FR-10) — **facultatives**.
 *
 * ## Où et pourquoi ici
 *
 * Ce bloc vit dans le panneau de création de `/booking/payment`, juste au-dessus du CTA : les deux
 * champs doivent partir dans le **même** `POST` que la création. Le PMS n'expose aucune route de
 * mise à jour au rôle `Customer` — une fois la `Pending` créée, ces valeurs sont **définitives**
 * (l'écran les repasse alors en lecture seule). Les capter plus tôt aurait imposé de les faire
 * transiter par l'URL, ce qui est exclu : une demande spéciale est un texte libre pouvant contenir
 * des données de santé ou d'accessibilité, et une URL est partagée, historisée et journalisée.
 *
 * ## Composant contrôlé
 *
 * L'état est **levé** dans `booking-payment.tsx`. C'est ce qui fait survivre la saisie à un échec
 * de création (`price-changed`, 503, refus métier) : le voyageur re-confirme sans re-saisir
 * (UX-DR-4.4, UX-DR-4.7).
 *
 * ## Sélecteur natif, et c'est délibéré
 *
 * `components/ui/select.tsx` (base-ui) existe mais n'est **rendu nulle part** dans le dépôt.
 * L'inaugurer ici — écran le plus critique du tunnel, avec portail, `axe` en clair et sombre, et
 * pilotage Playwright — ajouterait un risque d'intégration pour un choix binaire. Le `<select>`
 * natif est labellisable, navigable au clavier par construction et sans portail. Il consomme les
 * mêmes tokens que `Input`, donc rien ne détonne visuellement.
 */
export function BookingPreferences({
  value,
  onChange,
  disabled = false,
  error = null,
}: {
  value: BookingPreferences;
  onChange: (next: BookingPreferences) => void;
  disabled?: boolean;
  /**
   * Erreur remontée par la **soumission**, ou `null`.
   *
   * Type restreint à l'union des codes réels : la valeur part directement dans `t(…)`, et une
   * chaîne qui ne serait pas une clé i18n ferait rendre un substitut d'erreur next-intl à
   * l'étape la plus critique du tunnel.
   */
  error?: BookingPreferencesError | null;
}) {
  const t = useTranslations("booking");

  const requestsId = useId();
  const requestsHelpId = useId();
  const requestsCounterId = useId();
  const requestsErrorId = useId();
  const localeId = useId();
  const localeHelpId = useId();
  const sectionTitleId = useId();

  // Mesurée **exactement** comme le fera le BFF (normalisation complète, pas un simple `trim`) :
  // sans cela, un texte porteur de caractères invisibles affichait « 1002 / 1000 » et était refusé
  // localement alors que le BFF aurait mesuré 1000 et accepté (revue 2ᵉ passe, F5).
  const used = specialRequestsLength(value.specialRequests);
  const overLimit = used > SPECIAL_REQUESTS_MAX_LENGTH;

  /**
   * Message affiché — dès le **dépassement**, sans attendre la soumission.
   *
   * ⚠️ Deux défauts que cela corrige, et non un seul :
   * 1. `aria-invalid` était posé sur le champ dès `overLimit`, mais le message n'apparaissait qu'à
   *    la soumission : le lecteur d'écran annonçait « invalide » **sans cause associée**.
   * 2. Entre le franchissement et le clic, le seul signal visuel était le compteur passant au
   *    rouge — information portée par la **seule couleur** (UX-DR-5.3).
   *
   * ⚠️ L'erreur de soumission ne survit **pas** à une saisie qui la rend caduque (revue 2ᵉ passe,
   * F4). Elle primait auparavant sans condition : après un refus à 1001 caractères, effacer
   * jusqu'à 10 laissait le champ marqué invalide avec « ne peuvent pas dépasser 1000 caractères »
   * pendant que le compteur affichait « 10 / 1000 ». L'invariant « jamais d'`aria-invalid` sans
   * cause » tenait, mais la cause affichée était fausse.
   */
  const shownError: BookingPreferencesError | null = overLimit
    ? "specialRequestsTooLong"
    : (error ?? null);

  return (
    <section
      className="flex flex-col gap-4 rounded-lg bg-muted/40 p-4"
      aria-labelledby={sectionTitleId}
      data-testid="booking-preferences"
    >
      <div className="flex flex-col gap-1">
        <h3
          id={sectionTitleId}
          className="text-body font-medium text-foreground"
        >
          {t("preferencesTitle")}
        </h3>
        <p className="text-small text-muted-foreground">
          {t("preferencesIntro")}
        </p>
      </div>

      <Field>
        <FieldLabel htmlFor={requestsId}>
          {t("specialRequestsLabel")}
        </FieldLabel>
        <Textarea
          id={requestsId}
          value={value.specialRequests}
          onChange={(event) =>
            onChange({ ...value, specialRequests: event.target.value })
          }
          disabled={disabled}
          placeholder={t("specialRequestsPlaceholder")}
          aria-invalid={shownError !== null ? true : undefined}
          // L'aide et le compteur restent associés même en erreur : c'est l'aide qui explique la
          // portée réelle du champ, et le compteur qui dit où l'on en est. Le message d'erreur les
          // rejoint dès qu'il existe — `aria-invalid` et sa cause sont désormais indissociables.
          aria-describedby={cn(
            requestsHelpId,
            requestsCounterId,
            shownError !== null ? requestsErrorId : "",
          ).trim()}
          data-testid="special-requests-input"
        />
        {/* Honnêteté produit (UX-DR-9.5) : une demande spéciale n'est pas une réservation de
            service. Ne rien promettre que l'hôtel ne s'engage à tenir. */}
        <FieldDescription id={requestsHelpId}>
          {t("specialRequestsHelp")}
        </FieldDescription>
        {/* ⚠️ PAS de `aria-live` : annoncer le compteur à chaque frappe rendrait le champ
            inutilisable au lecteur d'écran. Seul le franchissement de la borne est annoncé —
            par le message d'erreur, qui porte `role="alert"` via `FieldError`. */}
        <FieldDescription
          id={requestsCounterId}
          className={cn("tabular-nums", overLimit && "text-destructive")}
          data-testid="special-requests-counter"
        >
          {t("specialRequestsCounter", {
            count: used,
            max: SPECIAL_REQUESTS_MAX_LENGTH,
          })}
        </FieldDescription>
        {shownError !== null && (
          <FieldError id={requestsErrorId} data-testid="special-requests-error">
            {t(shownError, { max: SPECIAL_REQUESTS_MAX_LENGTH })}
          </FieldError>
        )}
      </Field>

      <Field>
        <FieldLabel htmlFor={localeId}>
          {t("communicationLocaleLabel")}
        </FieldLabel>
        <select
          id={localeId}
          value={value.communicationLocale}
          onChange={(event) =>
            onChange({
              ...value,
              communicationLocale: event.target.value as Locale,
              // Le choix devient **explicite** : à partir d'ici il part au BFF, et il n'est plus
              // réaligné sur la langue d'interface (revue 2ᵉ passe, F6).
              localeTouched: true,
            })
          }
          disabled={disabled}
          aria-describedby={localeHelpId}
          className="min-h-(--tap-min) w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30"
          data-testid="communication-locale-select"
        >
          {locales.map((locale) => (
            <option key={locale} value={locale}>
              {localeNames[locale]}
            </option>
          ))}
        </select>
        {/* ⚠️ D10 — le PMS ne porte AUCUN champ de langue sur la réservation : son moteur d'emails
            résout la langue depuis les réglages de l'hôtel. Tant que la dépendance n'est pas
            livrée, on énonce ce qui se passera réellement — jamais « vous recevrez votre
            confirmation en anglais » (même faute que le « Confirmation envoyée » de la 2.3).
            Le jour où D10 arrive, ce bloc disparaît et `communicationLocaleState` bascule. */}
        <DependencyFallback
          dependency="D10"
          data-testid="communication-locale-fallback"
        >
          <p id={localeHelpId}>{t("communicationLocaleHelp")}</p>
        </DependencyFallback>
      </Field>
    </section>
  );
}
