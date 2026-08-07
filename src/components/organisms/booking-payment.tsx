"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, LockIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { BookingPreferences as BookingPreferencesForm } from "@/components/molecules/booking-preferences";
import { BookingSummary } from "@/components/organisms/booking-summary";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useBookingReservation,
  useCreateReservation,
} from "@/hooks/use-booking-reservation";
import { useBookingQuote } from "@/hooks/use-booking-quote";
import { useSession } from "@/hooks/use-session";
import { ApiClientError } from "@/lib/api-client";
import { localeNames, type Locale } from "@/i18n/config";
import { cn, formatCurrency } from "@/lib/utils";
import {
  defaultBookingPreferences,
  normalizeSpecialRequests,
  syncPreferencesLocale,
  validateBookingPreferences,
  type BookingPreferences,
  type BookingPreferencesError,
  type ParsedBookingParams,
} from "@/lib/validations/booking";
import {
  buildIdentifyUrl,
  buildPaymentUrl,
  buildRecapUrl,
  isOverCapacity,
  priceChangeFrom,
  reservationFailureReason,
  type BookingReservationResult,
  type ReservationFailureReason,
  type ReservationStatus,
} from "@/services/booking.service";
import { buildHotelPageUrl } from "@/services/catalog.service";

/** Délai maximal d'un `setTimeout` (32 bits signés) — au-delà, il se déclenche immédiatement. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/** Prix **explicitement** opposé au BFF : devis affiché, ou nouveau tarif re-confirmé. */
interface SubmittedPrice {
  total: number;
  currency: string;
}

/**
 * Motifs dont le **rejeu à l'identique** échouerait toujours : le PMS a tranché sur des données
 * qui ne changeront pas d'elles-mêmes. Le CTA de création est neutralisé pour chacun d'eux —
 * laisser un bouton « Réserver cette chambre » actif juste sous le refus, c'est proposer le
 * cul-de-sac que l'absence de « Réessayer » cherchait précisément à éviter (AC-10, AC-11).
 *
 * Comparé par appartenance à un `Set<string>` et non par égalité de littéraux : `rejected` est
 * ajouté au type côté service, et une comparaison de littéral se casserait au moindre décalage
 * de livraison entre le service et cet écran.
 */
const DETERMINISTIC_REASONS: ReadonlySet<string> = new Set([
  "room-unavailable",
  "over-capacity",
  "invalid-dates",
  "room-not-found",
  "session-invalid",
  "rejected",
]);

/**
 * Motifs qui **périment le devis en cache**.
 *
 * `useBookingQuote` garde le devis frais 30 s et ne le rafraîchit pas au retour de focus : sans
 * cette invalidation, l'écran continuerait d'opposer au BFF un total que le PMS vient de
 * désavouer — chaque tentative recréant puis annulant une vraie réservation dans le PMS partagé.
 */
const QUOTE_STALE_REASONS: ReadonlySet<string> = new Set([
  "price-changed",
  "room-unavailable",
  "over-capacity",
]);

/** Motifs dont l'issue est **une autre chambre** du même hôtel. */
const OTHER_ROOMS_REASONS: ReadonlySet<string> = new Set([
  "room-unavailable",
  "over-capacity",
  "room-not-found",
  "rate-limited",
]);

/**
 * Motifs dont l'issue de repli est le récapitulatif.
 *
 * Exclut `invalid-dates` (qui porte son propre lien d'édition du séjour), `session-invalid`
 * (l'issue est l'identification) et les indisponibilités de chambre (l'issue est le catalogue).
 */
const RECAP_EXIT_REASONS: ReadonlySet<string> = new Set([
  "rejected",
  "rate-limited",
  "price-changed",
  "unavailable",
  "unknown",
]);

/** Vue effective du panneau de réservation — dérivée du **statut réel**, jamais du seul hold. */
type ReservationView =
  "payable" | "hold-expired" | "cancelled" | "settled" | "unknown" | "mismatch";

/**
 * Île client de l'**étape 3 du tunnel** — création de la Réservation `Pending` (story 2.4, FR-9).
 *
 * Trois principes qui commandent tout l'écran :
 *
 * 1. **La création est toujours une action explicite** (Décision 8). Créer au montage
 *    transformerait chaque rafraîchissement en `Pending` supplémentaire — donc en chambre
 *    réellement gelée dans le PMS partagé avec le back-office.
 * 2. **Aucun débit n'a lieu ici** (UX-DR-9.9). Une `Pending` n'est pas une réservation confirmée :
 *    l'écran ne parle jamais de confirmation, ni d'email envoyé — cela arrive à la confirmation
 *    (FR-13, Epic 3).
 * 3. **Le hold est une information, pas une pression** (UX-DR-9.5). « Tenue jusqu'à 14 h 32 »,
 *    jamais « plus que 3 minutes ! ». Pas de rouge, pas de clignotement.
 *
 * La reprise (rafraîchissement, retour arrière) passe par `reservationId` dans l'URL : l'écran
 * **relit** la réservation au lieu d'en créer une seconde (UX-DR-4.7). Ce qui est relu est
 * confronté au séjour de l'URL **et** à son statut réel : une réservation annulée en back-office
 * ou portant un autre séjour ne peut pas s'afficher « votre chambre est réservée » (AC-9).
 */
export function BookingPayment({
  params,
  reservationId,
}: {
  params: ParsedBookingParams;
  reservationId: string | null;
}) {
  const t = useTranslations("booking");
  const locale = useLocale();
  const router = useRouter();

  const session = useSession();
  const quoteQuery = useBookingQuote(params);
  const existing = useBookingReservation(reservationId);
  const create = useCreateReservation();

  const [failure, setFailure] = useState<ReservationFailureReason | null>(null);
  const [newPrice, setNewPrice] = useState<SubmittedPrice | null>(null);
  /**
   * Préférences de communication (story 2.5) — état **levé** ici, et non dans le formulaire.
   *
   * C'est ce qui les fait survivre à un échec de création : sur `price-changed`, le panneau
   * d'échec remplace le CTA mais le formulaire reste monté, et la re-confirmation repart avec la
   * saisie intacte (UX-DR-4.4). Initialisées à la langue de l'interface — un défaut évident, pas
   * une case pré-cochée (UX-DR-9.7) : le voyageur peut en changer avant de réserver.
   */
  const [storedPreferences, setPreferences] = useState<BookingPreferences>(() =>
    defaultBookingPreferences(locale),
  );

  /**
   * Préférences **effectives** : la langue non touchée suit la locale d'interface (revue 2ᵉ passe,
   * F14).
   *
   * `LocaleSwitcher` écrit un cookie puis `router.refresh()`, qui **préserve l'état client** : sans
   * ce réalignement, toute l'interface passait en anglais pendant que le sélecteur restait sur
   * « Français » — et c'est cette valeur périmée qui partait au BFF.
   *
   * **Dérivé au rendu, pas synchronisé par un effet.** Un `useEffect` + `setState` produirait un
   * rendu en cascade (que le compilateur React refuse), pour une valeur qui est une pure fonction
   * de l'état et de la locale. `syncPreferencesLocale` renvoie la **même référence** quand rien ne
   * change : aucun rendu supplémentaire, aucune identité instable en dépendance.
   */
  const preferences = syncPreferencesLocale(storedPreferences, locale);
  const [preferencesError, setPreferencesError] =
    useState<BookingPreferencesError | null>(null);

  /**
   * Toute saisie **périme** l'erreur de la soumission précédente (revue 2ᵉ passe, F4).
   *
   * Sans cela, un refus à 1001 caractères survivait à la correction : le champ restait
   * `aria-invalid` avec « ne peuvent pas dépasser 1000 caractères » pendant que le compteur
   * affichait « 10 / 1000 ». L'invariant « jamais d'`aria-invalid` sans cause » tenait, mais la
   * cause était devenue mensongère — et c'est elle que le lecteur d'écran annonce.
   *
   * Le composant re-dérive de lui-même l'erreur de **dépassement** à partir de la valeur : rien
   * n'est perdu tant que la saisie reste fautive.
   */
  const onPreferencesChange = useCallback((next: BookingPreferences) => {
    setPreferences(next);
    setPreferencesError(null);
  }, []);

  const quote = quoteQuery.data;
  const overCapacity = quote ? isOverCapacity(quote) : false;
  const unavailable = quote
    ? !quote.available && !quote.availabilityDegraded && !overCapacity
    : false;
  // ⚠️ **Absence de devis ≠ séjour valide** (règle héritée de 2.3) : sans `quote`, `overCapacity`
  // et `unavailable` valent tous deux `false`. Laisser passer reviendrait à créer une vraie
  // réservation sur un séjour dont on ignore le prix — et donc sans pouvoir opposer au PMS le
  // montant annoncé (AC-2). On bloque tant que le devis n'est pas connu.
  const quoteUnknown = quote === undefined;
  // Un échec neutralise aussi le CTA : sur un refus déterministe le rejeu est condamné, et sur
  // `price-changed` la seule action légitime est la **re-confirmation du nouveau total**.
  const blocked =
    overCapacity || unavailable || quoteUnknown || failure !== null;

  const createdReservation = create.data ?? null;
  const readBack = existing.data ?? null;
  const reservation = readBack ?? createdReservation;

  /**
   * Le BFF a-t-il annoncé un **rejeu idempotent** sur la soumission de cette session ?
   *
   * ⚠️ C'est la **seule** source fiable, et elle vient du POST : la relecture
   * (`GET /booking/reservations/:id`) renvoie toujours `created: false`, y compris pour une
   * réservation que l'on vient de créer. Se fier à `reservation.created` ferait donc réapparaître
   * la notice de divergence quelques centaines de millisecondes après une création parfaitement
   * normale, dès l'arrivée de la relecture.
   */
  const wasReplayed =
    createdReservation !== null && !createdReservation.created;

  // Une réservation **relue** peut décrire un tout autre séjour que celui de l'URL (URL retouchée,
  // retour d'historique) : l'annoncer « réservée » pendant que le récapitulatif chiffre le séjour
  // courant ferait cohabiter deux totaux contradictoires juste avant le paiement.
  const mismatch = readBack !== null && !describesStay(readBack, params);

  const hold = useHoldStatus(reservation);
  const view: ReservationView | null =
    reservation === null
      ? null
      : mismatch
        ? "mismatch"
        : viewForStatus(reservation.status, hold.active);

  const stayContext = {
    checkInDate: params.checkInDate,
    checkOutDate: params.checkOutDate,
    guests: params.guests,
    currency: params.currency,
  };

  // L'identification doit pouvoir **revenir** sur la `Pending` déjà créée : sans son identifiant,
  // elle n'est plus adressable et l'écran reproposerait une création (l'idempotence du BFF étant
  // clée sur l'utilisateur, elle est caduque si la ré-identification produit un autre compte).
  const knownReservationId =
    reservationId ?? createdReservation?.reservationId ?? null;
  const identifyHref = withReservationId(
    buildIdentifyUrl(params),
    knownReservationId,
  );

  const failureId = useId();
  const blockedId = useId();
  const quoteErrorId = useId();
  const quoteLoadingId = useId();

  // Cibles de repli du focus : chaque bascule de panneau démonte l'élément focalisé (CTA neutralisé,
  // panneau remplacé) et le focus retomberait sur `<body>` (patron de `booking-identify.tsx`).
  const createSectionRef = useRef<HTMLElement | null>(null);
  const reservationSectionRef = useRef<HTMLElement | null>(null);
  /** Reprise demandée : le focus ira au panneau de création dès qu'il sera monté (voir `restart`). */
  const wantsCreateFocus = useRef(false);

  // Une navigation peut partir pendant l'appel : après démontage, ni `router.replace` ni
  // `setState` ne doivent plus s'exécuter (patron de la story 2.3).
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refetchQuote = quoteQuery.refetch;

  /**
   * Crée la réservation au montant **explicitement soumis**.
   *
   * `expected` prime sur le devis en cache : c'est ce qui rend la re-confirmation d'un
   * `price-changed` effective. Re-soumettre le total du devis reviendrait à faire recréer par le
   * BFF une `Pending` réelle, à la faire diverger, annuler, et renvoyer un 409 — indéfiniment,
   * avec une ligne `Cancelled` de plus dans le PMS partagé à chaque clic.
   */
  const submit = useCallback(
    async (expected?: SubmittedPrice) => {
      const price =
        expected ??
        (quote ? { total: quote.total, currency: quote.currency } : null);
      if (price === null) {
        return;
      }
      // Refusé **avant** l'appel : le BFF le refuserait de toute façon en 400, mais un aller-retour
      // réseau pour une erreur connaissable localement laisserait le voyageur devant un échec
      // générique au lieu d'un message attaché à son champ (UX-DR-5.9).
      const invalid = validateBookingPreferences(preferences);
      if (invalid.length > 0) {
        setPreferencesError(invalid[0]);
        // ⚠️ Le message est **déjà** affiché (il dérive du dépassement, pas de la soumission) :
        // sans ce déplacement de focus, le clic ne produisait strictement **aucun** changement
        // perceptible — ni annonce `role="alert"`, ni mouvement, ni CTA neutralisé. Le voyageur
        // recliquait dans le vide (revue 2ᵉ passe, F3).
        focusAfterPaint(() =>
          document
            .querySelector<HTMLTextAreaElement>(
              '[data-testid="special-requests-input"]',
            )
            ?.focus(),
        );
        return;
      }
      setPreferencesError(null);
      setFailure(null);
      setNewPrice(null);
      try {
        const created = await create.mutateAsync({
          params,
          expected: price,
          preferences,
        });
        if (!mounted.current) {
          return;
        }
        // `replace` et non `push` : la reprise doit relire, et un retour arrière ne doit pas
        // ramener sur une URL sans réservation qui inviterait à en créer une seconde.
        router.replace(buildPaymentUrl(params, created.reservationId));
        focusAfterPaint(() => reservationSectionRef.current?.focus());
      } catch (error) {
        if (!mounted.current) {
          return;
        }
        const reason = reservationFailureReason(error);
        setFailure(reason);
        setNewPrice(priceChangeFrom(error));
        if (QUOTE_STALE_REASONS.has(reason)) {
          void refetchQuote();
        }
      }
    },
    [create, params, preferences, quote, refetchQuote, router],
  );

  /**
   * Repart d'un écran de création vierge.
   *
   * `create.reset()` est **indispensable** : `router.replace` ne change ici que des query-params,
   * il ne démonte pas l'île cliente. Sans remise à zéro, `create.data` resterait non nul et le
   * même panneau (« chambre libérée », réservation annulée…) se réafficherait indéfiniment.
   */
  const restart = useCallback(() => {
    create.reset();
    setFailure(null);
    setNewPrice(null);
    // L'erreur de validation part ; la **saisie**, non. Repartir d'un formulaire vide punirait un
    // voyageur dont le hold a simplement expiré (UX-DR-4.4 : retour non destructif).
    setPreferencesError(null);
    router.replace(buildPaymentUrl(params));
    // ⚠️ Ne PAS focaliser ici, même en `requestAnimationFrame` : au moment de la reprise, le
    // panneau de création n'est pas encore monté. `create.reset()` est notifié de façon différée
    // par React Query et `router.replace` re-rend le segment — la peinture suivante peut donc
    // arriver AVANT le remontage, `createSectionRef` est alors encore `null` et le focus retombe
    // silencieusement sur `<body>`. On enregistre une **intention**, qu'un effet consomme une fois
    // la cible réellement rendue (revue de code 2.4 : l'assertion e2e échouait, pas le concept).
    wantsCreateFocus.current = true;
  }, [create, params, router]);

  /**
   * Consomme l'intention de focus posée par `restart()`.
   *
   * L'effet ne s'exécute qu'après le rendu où le panneau de création existe : la cible est donc
   * garantie présente, ce qui rend la reprise du focus déterministe en navigateur **et** sous
   * jsdom — contrairement à une course entre `requestAnimationFrame` et le remontage.
   */
  useEffect(() => {
    if (!wantsCreateFocus.current || createSectionRef.current === null) {
      return;
    }
    wantsCreateFocus.current = false;
    createSectionRef.current.focus();
  });

  const pending = create.isPending;
  // Le total du devis n'est plus celui que le BFF acceptera : tant que le nouveau tarif n'est pas
  // confirmé, on n'affiche pas deux montants contradictoires avant paiement.
  const priceChangePending = failure === "price-changed" && newPrice !== null;
  const summaryStale = quoteQuery.isFetching || priceChangePending;

  const ctaDescribedBy =
    [
      failure !== null ? failureId : null,
      overCapacity || unavailable ? blockedId : null,
      quoteQuery.isError ? quoteErrorId : null,
      quoteUnknown && !quoteQuery.isError ? quoteLoadingId : null,
    ]
      .filter((id): id is string => id !== null)
      .join(" ") || undefined;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-4">
        <Link
          href={identifyHref}
          aria-disabled={pending ? true : undefined}
          onClick={(event) => {
            if (pending) {
              event.preventDefault();
            }
          }}
          className={cn(
            buttonVariants({ variant: "link" }),
            "min-h-(--tap-min) items-center gap-1 self-start px-0",
            pending && "pointer-events-none opacity-50",
          )}
          data-testid="payment-back-to-identify"
        >
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
          {t("backToIdentify")}
        </Link>

        {/* Région d'annonce **montée en permanence** : une région `aria-live` démontée puis
            recréée n'annonce rien (leçon de la revue 2.2). Elle porte les changements d'ÉTAT —
            échecs compris — mais jamais le décompte seconde par seconde, qui noierait le lecteur
            d'écran. C'est elle qui annonce les échecs : un `role="alert"` inséré dynamiquement
            avec le panneau ne peut pas en tenir lieu. */}
        <p
          role="status"
          aria-live="polite"
          className="sr-only"
          data-testid="payment-status-announcement"
        >
          {announcementFor(view, failure, t)}
        </p>

        {session.isError ? (
          <ErrorPanel
            testId="payment-session-error"
            title={t("sessionErrorTitle")}
            body={t("sessionErrorBody")}
            action={
              <Button
                type="button"
                variant="outline"
                onClick={() => void session.refetch()}
                className="min-h-(--tap-min)"
                data-testid="payment-session-retry"
              >
                {t("retry")}
              </Button>
            }
          />
        ) : session.isPending ? (
          <Skeleton className="h-56 w-full" data-testid="payment-loading" />
        ) : !session.data?.authenticated ? (
          /* Route non gardée côté navigateur (le tunnel ne force jamais l'inscription) : c'est le
             BFF qui refuse une création anonyme. On explique et on renvoie à l'identification. */
          <ErrorPanel
            testId="payment-must-identify"
            title={t("mustIdentifyTitle")}
            body={t("mustIdentifyBody")}
            action={
              <Link
                href={identifyHref}
                className={cn(
                  buttonVariants({ variant: "outline" }),
                  "min-h-(--tap-min)",
                )}
                data-testid="payment-go-to-identify"
              >
                {t("goToIdentify")}
              </Link>
            }
          />
        ) : existing.isPending && reservationId !== null ? (
          <Skeleton
            className="h-56 w-full"
            data-testid="payment-reservation-loading"
          />
        ) : reservation !== null && view !== null ? (
          view === "mismatch" ? (
            <ReservationMismatchPanel
              reservation={reservation}
              params={params}
              onRestart={restart}
            />
          ) : (
            <ReservationPanel
              reservation={reservation}
              view={view}
              hold={hold}
              locale={locale}
              params={params}
              panelRef={reservationSectionRef}
              refreshing={existing.isFetching}
              onRefresh={() => void existing.refetch()}
              onRestart={restart}
              /*
               * Divergence entre ce qui est **attaché** et ce que le voyageur vient de taper —
               * uniquement sur un **rejeu** (story 2.5, AC-6).
               *
               * ⚠️ Le garde `wasReplayed` n'est pas décoratif. Sans lui, la notice se déclenchait
               * sur une **première création réussie** dès que la saisie contenait une tabulation ou
               * un caractère invisible : le front compare sa saisie brute, le BFF normalise avant
               * d'écrire (tabulation → espace), et les deux chaînes diffèrent alors légitimement.
               * Le voyageur lisait « votre réservation existait déjà » sur une réservation qu'il
               * venait de créer — exactement le genre d'affirmation fausse que AC-4/AC-6 proscrivent.
               *
               * Résiduel assumé : sur un vrai rejeu, deux textes équivalents à la normalisation près
               * déclenchent encore la notice. Elle reste **vraie** dans ce cas (ce sont bien les
               * demandes enregistrées qui font foi), seulement superflue. La corriger imposerait de
               * dupliquer la normalisation du BFF côté front — deux sources de vérité qui
               * divergeraient au premier ajustement.
               */
              communicationLocaleState={reservation.communicationLocaleState}
              typedRequestsDiverge={
                wasReplayed &&
                normalizeSpecialRequests(preferences.specialRequests).length >
                  0 &&
                // Comparée sous la MÊME normalisation que le BFF : sinon deux textes identiques à
                // l'espace près se déclaraient divergents (revue 2ᵉ passe, F5).
                normalizeSpecialRequests(preferences.specialRequests) !==
                  (reservation.specialRequests ?? "")
              }
            />
          )
        ) : existing.isError && reservationId !== null ? (
          <ReservationLoadErrorPanel
            error={existing.error}
            identifyHref={identifyHref}
            params={params}
            refreshing={existing.isFetching}
            onRefresh={() => void existing.refetch()}
            onRestart={restart}
          />
        ) : (
          <section
            ref={createSectionRef}
            tabIndex={-1}
            className="flex flex-col gap-4 rounded-xl bg-card p-5 ring-1 ring-border"
            data-testid="payment-create-panel"
          >
            <div className="flex flex-col gap-1">
              <h2 className="text-h3 text-foreground">{t("createTitle")}</h2>
              <p className="text-small text-muted-foreground">
                {t("createIntro")}
              </p>
            </div>

            {/* Devis en erreur : l'écran doit le DIRE et offrir une issue (UX-DR-4.5). Le CTA est
                neutralisé par `quoteUnknown` — sans explication ni porte de sortie, ce serait un
                cul-de-sac muet à l'étape la plus critique (aligné sur `booking-identify.tsx`). */}
            {quoteQuery.isError ? (
              <div
                id={quoteErrorId}
                role="alert"
                data-testid="payment-quote-error"
                className="flex flex-col items-start gap-3 rounded-lg bg-card p-4 ring-1 ring-border"
              >
                <p className="text-body font-medium text-foreground">
                  {quoteErrorTitle(quoteQuery.error, t)}
                </p>
                <p className="text-small text-muted-foreground">
                  {quoteErrorBody(quoteQuery.error, t)}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {isRetryableQuoteError(quoteQuery.error) ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void refetchQuote()}
                      className="min-h-(--tap-min)"
                      data-testid="payment-quote-retry"
                    >
                      {t("retry")}
                    </Button>
                  ) : null}
                  <Link
                    href={buildRecapUrl(params)}
                    className={cn(
                      buttonVariants({ variant: "outline" }),
                      "min-h-(--tap-min)",
                    )}
                    data-testid="payment-quote-exit"
                  >
                    {t("backToRecap")}
                  </Link>
                </div>
              </div>
            ) : quoteUnknown ? (
              /* Le CTA est neutralisé le temps du calcul : le dire, plutôt qu'un bouton gris
                 inexpliqué (AC-13 — le CTA le référence par `aria-describedby`). */
              <p
                id={quoteLoadingId}
                className="text-small text-muted-foreground"
                data-testid="payment-quote-loading"
              >
                {t("loading")}
              </p>
            ) : null}

            {failure !== null ? (
              <FailurePanel
                id={failureId}
                reason={failure}
                newPrice={newPrice}
                locale={locale}
                params={params}
                stayContext={stayContext}
                hotelId={quote?.hotelId ?? params.hotelId}
                hotelName={quote?.hotelName ?? null}
                identifyHref={identifyHref}
                onRetry={() => void submit()}
                onConfirmNewPrice={() => void submit(newPrice ?? undefined)}
              />
            ) : null}

            {/* Le récapitulatif chiffre encore l'ancien total : le dire ici évite d'afficher deux
                montants contradictoires avant paiement (le nouveau vit dans le panneau d'échec). */}
            {priceChangePending ? (
              <p
                className="text-small text-muted-foreground"
                data-testid="payment-summary-outdated"
              >
                {t("summaryOutdated")}
              </p>
            ) : null}

            {overCapacity || unavailable ? (
              <div
                id={blockedId}
                role="alert"
                data-testid="payment-blocked"
                className="flex flex-col items-start gap-3 rounded-lg bg-warning-soft p-4 text-warning"
              >
                <p className="text-body font-medium">
                  {overCapacity
                    ? t("overCapacityTitle")
                    : t("unavailableTitle")}
                </p>
                <p className="text-small">
                  {overCapacity && quote
                    ? t("overCapacityBody", {
                        capacity: quote.roomCapacity ?? 0,
                        guests: quote.guests,
                      })
                    : t("unavailableBody")}
                </p>
                <Link
                  href={buildHotelPageUrl(
                    params.hotelId,
                    quote?.hotelName ?? null,
                    stayContext,
                  )}
                  className={cn(
                    buttonVariants({ variant: "outline" }),
                    "min-h-(--tap-min)",
                  )}
                  data-testid="payment-blocked-exit"
                >
                  {t("seeOtherRooms")}
                </Link>
              </div>
            ) : null}

            {/* Demandes spéciales & langue (story 2.5, FR-10) — facultatives, jamais bloquantes.
                Elles partent dans le MÊME appel que la création : le PMS n'expose aucune route de
                mise à jour au voyageur, donc « après » n'existe pas. */}
            <BookingPreferencesForm
              value={preferences}
              onChange={onPreferencesChange}
              disabled={pending}
              error={preferencesError}
            />

            {/* Réassurance factuelle : à cette étape, rien n'est débité. Le dire explicitement
                (UX-DR-9.9) — pas comme un argument, comme une information. */}
            <p
              className="flex items-start gap-1.5 text-caption text-muted-foreground"
              data-testid="payment-no-charge-notice"
            >
              <LockIcon
                className="mt-0.5 size-3.5 shrink-0"
                aria-hidden="true"
              />
              {t("noChargeYet")}
            </p>

            {/* `aria-disabled` (et non `disabled`) pendant l'appel : un bouton natif désactivé sort
                du tab order et le focus retombe sur `<body>`. Le blocage réel, lui, reste un
                `disabled` — il n'est pas transitoire. */}
            <Button
              type="button"
              size="lg"
              onClick={() => {
                if (pending) {
                  return;
                }
                void submit();
              }}
              disabled={blocked}
              aria-disabled={pending || blocked ? true : undefined}
              aria-describedby={ctaDescribedBy}
              className={cn(
                "min-h-(--tap-min) w-full lg:w-auto",
                pending && !blocked && "opacity-50",
              )}
              data-testid="payment-create-cta"
            >
              {pending ? t("creating") : t("createCta")}
            </Button>
          </section>
        )}
      </div>

      {/* Le récapitulatif reste **persistant** dans le tunnel (UX-DR-2.5) : en cas d'erreur, on
          l'annonce là où il devrait être plutôt que de laisser la colonne vide. */}
      {quoteQuery.isPending ? (
        <Skeleton
          className="h-80 w-full"
          data-testid="payment-summary-loading"
        />
      ) : quote ? (
        <BookingSummary quote={quote} recalculating={summaryStale} />
      ) : (
        <p
          data-testid="payment-summary-unavailable"
          className="rounded-xl bg-card p-4 text-small text-muted-foreground ring-1 ring-border"
        >
          {t("summaryUnavailable")}
        </p>
      )}
    </div>
  );
}

/**
 * Panneau de la réservation : **statut réel**, échéance du hold, et emplacement du paiement (3.1).
 *
 * Le passage au paiement n'est offert que sur une `Pending` au hold actif. Le PMS est **partagé**
 * avec le back-office : une réservation peut avoir été annulée par une réceptionniste ou déjà
 * confirmée entre deux lectures — l'afficher « en attente de paiement » serait une promesse fausse
 * et, dès la story 3.1, un chemin de double débit (AC-9).
 */
function ReservationPanel({
  reservation,
  view,
  hold,
  locale,
  params,
  panelRef,
  refreshing,
  onRefresh,
  onRestart,
  typedRequestsDiverge,
  communicationLocaleState,
}: {
  reservation: BookingReservationResult;
  view: Exclude<ReservationView, "mismatch">;
  hold: { active: boolean; until: string | null };
  locale: string;
  params: ParsedBookingParams;
  panelRef: React.RefObject<HTMLElement | null>;
  refreshing: boolean;
  onRefresh: () => void;
  onRestart: () => void;
  /** La saisie courante diffère de ce qui est réellement attaché (rejeu idempotent). */
  typedRequestsDiverge: boolean;
  /** Ce que le système fera réellement de la langue choisie — porté par le BFF, jamais déduit. */
  communicationLocaleState: BookingReservationResult["communicationLocaleState"];
}) {
  const t = useTranslations("booking");

  // Bascule du hold pendant que la page est ouverte : l'emplacement du paiement disparaît sous le
  // curseur. Sans cible de repli, le focus retomberait sur `<body>` (patron `focusAfterPaint`).
  const wasPayable = useRef(view === "payable");
  useEffect(() => {
    if (wasPayable.current && view !== "payable") {
      focusAfterPaint(() => panelRef.current?.focus());
    }
    wasPayable.current = view === "payable";
  }, [view, panelRef]);

  const heading = HEADINGS[view];
  // Devise inconnue de l'ICU → exposant d'unités mineures replié sur 2 sans avertir : on refuse
  // d'afficher un montant qui pourrait être faux d'un facteur 10ⁿ (voir `isCurrencyExponentReliable`).
  const totalReliable = isCurrencyExponentReliable(reservation.currency);

  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      className="flex flex-col gap-4 rounded-xl bg-card p-5 ring-1 ring-border"
      data-testid="payment-reservation-panel"
      data-status={reservation.status}
      data-view={view}
    >
      {/* Le titre suit le **statut réel** (`HEADINGS`). Sur une `Pending`, la formulation reste
          **au futur** : la réservation n'est pas confirmée et aucun email n'est parti (défaut
          corrigé en Phase 3 de la story 2.3 — ne pas le réintroduire). */}
      <div className="flex flex-col gap-1">
        <h2 className="text-h3 text-foreground">{t(heading.title)}</h2>
        <p className="text-small text-muted-foreground">{t(heading.body)}</p>
      </div>

      <dl className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <dt className="text-small text-muted-foreground">
            {t("reservationCodeLabel")}
          </dt>
          <dd
            className="text-body font-medium tabular-nums text-foreground"
            data-testid="payment-reservation-code"
          >
            {reservation.reservationCode}
          </dd>
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <dt className="text-small text-muted-foreground">
            {t("reservationTotalLabel")}
          </dt>
          <dd
            className={cn(
              "text-body font-medium tabular-nums",
              totalReliable ? "text-foreground" : "text-muted-foreground",
            )}
            data-testid="payment-reservation-total"
            data-amount-unreliable={totalReliable ? undefined : "true"}
          >
            {totalReliable
              ? formatCurrency(reservation.total, reservation.currency, locale)
              : t("amountUnreliable", { currency: reservation.currency })}
          </dd>
        </div>
      </dl>

      {totalReliable ? null : (
        <p
          className="text-caption text-muted-foreground"
          data-testid="payment-total-unreliable"
        >
          {t("amountUnreliableHelp")}
        </p>
      )}

      {view === "payable" && hold.until !== null ? (
        <p
          className="rounded-lg bg-muted p-3 text-small text-muted-foreground"
          data-testid="payment-hold-active"
        >
          {t("holdUntil", { time: hold.until })}
        </p>
      ) : null}

      {/* ⚠️ Pas sur une réservation morte (revue 2ᵉ passe, F13) : sous « Cette réservation a été
          annulée », « pour les changer, contactez l'hôtel » est une consigne sans objet. Les vues
          `cancelled` et `unknown` sont donc exclues — dans la seconde, on ignore l'état réel, et
          affirmer que des préférences sont attachées serait tout aussi infondé. */}
      {view === "cancelled" || view === "unknown" ? null : (
        <AttachedPreferences
          specialRequests={reservation.specialRequests}
          communicationLocale={reservation.communicationLocale}
          diverged={typedRequestsDiverge}
          communicationLocaleState={communicationLocaleState}
        />
      )}

      {view === "hold-expired" ? (
        <div
          role="alert"
          data-testid="payment-hold-expired"
          className="flex flex-col items-start gap-3 rounded-lg bg-warning-soft p-4 text-warning"
        >
          <p className="text-body font-medium">{t("holdExpiredTitle")}</p>
          <p className="text-small">{t("holdExpiredBody")}</p>
          <Button
            type="button"
            variant="outline"
            onClick={onRestart}
            className="min-h-(--tap-min)"
            data-testid="payment-hold-restart"
          >
            {t("restartCta")}
          </Button>
        </div>
      ) : null}

      {view === "cancelled" ? (
        <div
          role="alert"
          data-testid="payment-reservation-cancelled"
          className="flex flex-col items-start gap-3 rounded-lg bg-warning-soft p-4 text-warning"
        >
          <p className="text-small">{t("reservationCancelledNotice")}</p>
          <Button
            type="button"
            variant="outline"
            onClick={onRestart}
            className="min-h-(--tap-min)"
            data-testid="payment-reservation-cancelled-restart"
          >
            {t("restartCta")}
          </Button>
        </div>
      ) : null}

      {view === "settled" ? (
        <p
          className="rounded-lg bg-muted p-3 text-small text-muted-foreground"
          data-testid="payment-reservation-settled"
        >
          {t("reservationSettledNotice")}
        </p>
      ) : null}

      {/* Statut indéterminé : **jamais** traité comme `Pending`. On ne propose pas de payer une
          réservation dont on ignore l'état — on propose de relire. */}
      {view === "unknown" ? (
        <div
          className="flex flex-col items-start gap-3 rounded-lg bg-muted p-4 text-small text-muted-foreground"
          data-testid="payment-reservation-unknown"
        >
          <p>{t("reservationStatusUnknownNotice")}</p>
          <Button
            type="button"
            variant="outline"
            onClick={onRefresh}
            disabled={refreshing}
            className="min-h-(--tap-min)"
            data-testid="payment-reservation-unknown-retry"
          >
            {t("retry")}
          </Button>
        </div>
      ) : null}

      {/* Emplacement du Payment Element (story 3.1) — réservé à une `Pending` au hold actif.
          Aucune promesse de délai ici : annoncer une date que l'on ne tient pas serait la même
          faute que « confirmation envoyée ». */}
      {view === "payable" ? (
        <div
          className="rounded-lg border border-dashed border-border p-4 text-small text-muted-foreground"
          data-testid="payment-element-placeholder"
        >
          {t("paymentPlaceholder")}
        </div>
      ) : null}

      <Link
        href={buildRecapUrl(params)}
        className={cn(
          buttonVariants({ variant: "link" }),
          "min-h-(--tap-min) self-start px-0",
        )}
        data-testid="payment-back-to-recap"
      >
        {t("backToRecap")}
      </Link>
    </section>
  );
}

/**
 * Préférences **réellement attachées** à la réservation — en lecture seule (story 2.5, AC-5).
 *
 * Aucun bouton « Modifier », et c'est structurel : `RoomReservationsController` n'expose **aucune**
 * route de mise à jour au rôle `Customer` (création, lecture, annulation — rien d'autre). Un champ
 * éditable ici serait un cul-de-sac garanti.
 *
 * ⚠️ « Recommencer » n'est pas non plus un moyen de corriger : il remet l'URL à zéro mais **pas** la
 * mémoire d'idempotence du BFF, clée sur (compte, chambre, dates, voyageurs). Le clic suivant
 * resservirait la même réservation, avec le même texte. Le seul chemin honnête est l'hôtel — c'est
 * ce que dit le message.
 *
 * Le texte est rendu par React (donc échappé) dans un `whitespace-pre-wrap` : les retours à la
 * ligne saisis par le voyageur sont conservés, aucun HTML n'est interprété.
 */
function AttachedPreferences({
  specialRequests,
  communicationLocale,
  diverged,
  communicationLocaleState,
}: {
  specialRequests: string | null;
  communicationLocale: Locale | null;
  diverged: boolean;
  communicationLocaleState: BookingReservationResult["communicationLocaleState"];
}) {
  const t = useTranslations("booking");

  const hasAttached = specialRequests !== null || communicationLocale !== null;

  // ⚠️ La notice de divergence doit rester atteignable **même sans rien d'attaché** (revue 2ᵉ
  // passe, F8). Le `return null` portait auparavant sur les seules valeurs attachées, alors que
  // le cas le plus grave est précisément celui-là : rejeu d'une réservation qui ne porte NI
  // demandes NI langue, pendant que le voyageur vient d'en taper. L'écran ne rendait rien, et il
  // repartait en croyant son texte enregistré.
  if (!hasAttached && !diverged) {
    return null;
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-lg bg-muted/40 p-3"
      data-testid="payment-attached-preferences"
    >
      <p className="text-small font-medium text-foreground">
        {t("preferencesLockedTitle")}
      </p>

      {hasAttached ? (
        <dl className="flex flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <dt className="text-caption text-muted-foreground">
              {t("specialRequestsAttachedLabel")}
            </dt>
            {/* `break-words` : `whitespace-pre-wrap` ne coupe qu'aux blancs. Une URL collée sans
                espace débordait le panneau et faisait défiler l'écran de paiement à l'horizontale
                sur mobile (revue 2ᵉ passe, F12). Le textarea de saisie, lui, est protégé par la
                feuille de style du navigateur — l'anomalie n'apparaissait qu'à la relecture. */}
            <dd
              className="text-small break-words whitespace-pre-wrap text-foreground"
              data-testid="payment-attached-special-requests"
            >
              {specialRequests ?? t("specialRequestsNone")}
            </dd>
          </div>

          {communicationLocale !== null ? (
            <div className="flex flex-col gap-0.5">
              <dt className="text-caption text-muted-foreground">
                {t("communicationLocaleAttachedLabel")}
              </dt>
              {/* ⚠️ La réserve D10 **suit** le choix jusqu'ici (revue 2ᵉ passe, F1). Elle n'existait
                  que dans le formulaire : l'avertissement honnête vivait tant que le choix était
                  réversible et disparaissait à l'instant où il devenait définitif — c'est le seul
                  écran que le voyageur relit après avoir réservé. L'état vient du BFF
                  (`communicationLocaleState`), jamais d'une déduction locale.

                  Rendue **dans le `<dd>`** : une `<dl>` n'admet que `<dt>`/`<dd>` sous ses `<div>`
                  de groupement, et un `<p>` frère cassait la structure (violation `axe`
                  `definition-list`, trouvée en Phase 3). La réserve fait de toute façon partie de
                  la définition — elle dit ce que cette langue produit réellement. */}
              <dd className="flex flex-col gap-0.5">
                <span
                  className="text-small text-foreground"
                  data-testid="payment-attached-locale"
                >
                  {localeNames[communicationLocale]}
                </span>
                {communicationLocaleState === "hotel_default_fallback" ? (
                  <span
                    className="text-caption text-muted-foreground"
                    data-testid="payment-attached-locale-fallback"
                  >
                    {t("communicationLocaleAttachedNotice")}
                  </span>
                ) : null}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {diverged ? (
        <p
          className="text-caption text-muted-foreground"
          data-testid="payment-preferences-diverged"
        >
          {t("preferencesDivergedNotice")}
        </p>
      ) : null}

      {hasAttached ? (
        <p className="text-caption text-muted-foreground">
          {t("preferencesLockedNotice")}
        </p>
      ) : null}
    </div>
  );
}

/** Titre et introduction par vue — le vocabulaire suit le **statut réel**, jamais l'inverse. */
const HEADINGS: Record<
  Exclude<ReservationView, "mismatch">,
  { title: string; body: string }
> = {
  payable: { title: "reservedTitle", body: "reservedIntro" },
  "hold-expired": { title: "reservedTitle", body: "reservedIntro" },
  cancelled: {
    title: "reservationCancelledTitle",
    body: "reservationCancelledBody",
  },
  settled: { title: "reservationSettledTitle", body: "reservationSettledBody" },
  unknown: {
    title: "reservationStatusUnknownTitle",
    body: "reservationStatusUnknownBody",
  },
};

/**
 * La réservation relue décrit **un autre séjour** que celui de l'URL.
 *
 * Cas réels : URL retouchée à la main, retour d'historique après modification du séjour. Afficher
 * « votre chambre est réservée » pendant que le récapitulatif chiffre un autre séjour mettrait
 * deux totaux contradictoires sous les yeux du voyageur juste avant le paiement.
 */
function ReservationMismatchPanel({
  reservation,
  params,
  onRestart,
}: {
  reservation: BookingReservationResult;
  params: ParsedBookingParams;
  onRestart: () => void;
}) {
  const t = useTranslations("booking");

  // Le séjour **de la réservation**, pour pouvoir l'ouvrir tel qu'il est. La devise reste celle
  // de travail (contexte d'affichage) : elle ne décrit pas le séjour et n'est jamais convertie.
  const reservationStay: ParsedBookingParams = {
    hotelId: reservation.hotelId,
    roomId: reservation.roomId,
    checkInDate: dateOnly(reservation.checkInDate),
    checkOutDate: dateOnly(reservation.checkOutDate),
    guests: reservation.guests,
    currency: params.currency,
  };

  return (
    <div
      role="alert"
      data-testid="payment-reservation-mismatch"
      className="flex flex-col items-start gap-3 rounded-xl bg-warning-soft p-4 text-warning"
    >
      <p className="text-body font-medium">{t("reservationMismatchTitle")}</p>
      <p className="text-small">{t("reservationMismatchBody")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={buildPaymentUrl(reservationStay, reservation.reservationId)}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "min-h-(--tap-min)",
          )}
          data-testid="payment-mismatch-open"
        >
          {t("viewExistingReservation")}
        </Link>
        <Button
          type="button"
          variant="outline"
          onClick={onRestart}
          className="min-h-(--tap-min)"
          data-testid="payment-mismatch-restart"
        >
          {t("restartCta")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Échec de **relecture** de la réservation — trois causes, trois issues.
 *
 * Les confondre serait grave : sur une panne transitoire, affirmer que la réservation n'existe pas
 * et inviter à en créer une autre laisserait la `Pending` réelle geler une vraie chambre, et
 * produirait une seconde réservation par-dessus. « Réessayer » n'est offert que sur la panne.
 */
function ReservationLoadErrorPanel({
  error,
  identifyHref,
  params,
  refreshing,
  onRefresh,
  onRestart,
}: {
  error: unknown;
  identifyHref: string;
  params: ParsedBookingParams;
  refreshing: boolean;
  onRefresh: () => void;
  onRestart: () => void;
}) {
  const t = useTranslations("booking");
  const cause = reservationLoadCause(error);

  if (cause === "session") {
    return (
      <ErrorPanel
        testId="payment-reservation-error"
        title={t("reservationLoadSessionTitle")}
        body={t("reservationLoadSessionBody")}
        action={
          <Link
            href={identifyHref}
            className={cn(
              buttonVariants({ variant: "outline" }),
              "min-h-(--tap-min)",
            )}
            data-testid="payment-reservation-identify"
          >
            {t("goToIdentify")}
          </Link>
        }
      />
    );
  }

  if (cause === "outage") {
    return (
      <ErrorPanel
        testId="payment-reservation-error"
        title={t("reservationLoadOutageTitle")}
        body={t("reservationLoadOutageBody")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onRefresh}
              disabled={refreshing}
              className="min-h-(--tap-min)"
              data-testid="payment-reservation-retry"
            >
              {t("retry")}
            </Button>
            <Link
              href={buildRecapUrl(params)}
              className={cn(
                buttonVariants({ variant: "outline" }),
                "min-h-(--tap-min)",
              )}
              data-testid="payment-reservation-recap"
            >
              {t("backToRecap")}
            </Link>
          </div>
        }
      />
    );
  }

  return (
    <ErrorPanel
      testId="payment-reservation-error"
      title={t("reservationLoadErrorTitle")}
      body={t("reservationLoadErrorBody")}
      action={
        /* Un `<Link>` vers la même page ne démonterait pas l'île cliente : c'est un bouton, qui
           remet aussi la mutation à zéro avant de repartir sur une URL sans `reservationId`. */
        <Button
          type="button"
          variant="outline"
          onClick={onRestart}
          className="min-h-(--tap-min)"
          data-testid="payment-reservation-restart"
        >
          {t("restartCta")}
        </Button>
      }
    />
  );
}

/**
 * Suit l'échéance du hold **sans lire l'horloge pendant le rendu**.
 *
 * Le rendu reste une fonction pure de `holdExpiresAt` : le BFF renvoie déjà `null` pour un hold
 * échu, et seul un **minuteur** fait basculer l'écran à l'expiration. Appeler `Date.now()` au
 * rendu produirait une valeur différente au serveur et au navigateur (hydratation) et rendrait
 * le composant non déterministe en test.
 *
 * Le réveil est posé à l'instant **exact** de l'échéance : sans lui, l'écran continuerait à
 * proposer de payer une chambre déjà remise à la vente par le balayeur.
 */
function useHoldStatus(reservation: BookingReservationResult | null): {
  active: boolean;
  until: string | null;
} {
  const locale = useLocale();
  const holdExpiresAt = reservation?.holdExpiresAt ?? null;
  /** Échéance déjà atteinte **pendant que la page est ouverte** (mémorisée par sa valeur). */
  const [expiredHold, setExpiredHold] = useState<string | null>(null);

  useEffect(() => {
    if (holdExpiresAt === null) {
      return;
    }
    const expiry = Date.parse(holdExpiresAt);
    if (!Number.isFinite(expiry)) {
      return;
    }
    // `setTimeout` même pour un délai déjà écoulé : la bascule se fait dans le **callback** du
    // minuteur, jamais synchronement dans le corps de l'effet (cascade de rendus).
    const delay = Math.max(0, expiry - Date.now()) + 100;
    // ⚠️ Piège réel : `setTimeout` stocke son délai sur 32 bits signés — au-delà de ~24,8 jours,
    // il **déborde et se déclenche immédiatement**. Une échéance lointaine ferait donc afficher
    // « chambre libérée » à l'instant même où l'écran s'ouvre. Un hold réel dure quelques minutes
    // (borné à 1 h côté BFF) ; au-delà, on ne programme rien : il n'expirera pas pendant la visite.
    if (delay > MAX_TIMEOUT_MS) {
      return;
    }
    const atExpiry = window.setTimeout(
      () => setExpiredHold(holdExpiresAt),
      delay,
    );
    return () => window.clearTimeout(atExpiry);
  }, [holdExpiresAt]);

  // Une échéance **illisible** est traitée comme absente : `Intl.DateTimeFormat.format` lève un
  // `RangeError` sur une `Invalid Date` (aucun error boundary ne couvre cet écran), et surtout
  // une donnée amont douteuse ne doit jamais valoir « chambre tenue » par défaut.
  const until =
    holdExpiresAt !== null ? formatHoldDeadline(holdExpiresAt, locale) : null;

  return {
    active: until !== null && expiredHold !== holdExpiresAt,
    until,
  };
}

/**
 * Heure d'échéance du hold, **fuseau affiché**.
 *
 * `CancellationPolicyDisclosure` rend son échéance en UTC étiquetée « pour que l'échéance affichée
 * soit celle qui fera foi » (revue 2.2). Une heure locale nue à côté d'elle donnerait deux
 * référentiels indiscernables sur le même écran : le fuseau est donc explicite ici aussi.
 *
 * Renvoie `null` sur une valeur non exploitable — jamais d'exception en plein rendu.
 */
function formatHoldDeadline(iso: string, locale: string): string | null {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(parsed);
  } catch {
    return null;
  }
}

/** Bloc d'échec : un message humain et **une issue adaptée au motif** (UX-DR-4.5). */
function FailurePanel({
  id,
  reason,
  newPrice,
  locale,
  params,
  stayContext,
  hotelId,
  hotelName,
  identifyHref,
  onRetry,
  onConfirmNewPrice,
}: {
  id: string;
  reason: ReservationFailureReason;
  newPrice: SubmittedPrice | null;
  locale: string;
  params: ParsedBookingParams;
  stayContext: {
    checkInDate: string;
    checkOutDate: string;
    guests: number;
    currency: string;
  };
  hotelId: string;
  hotelName: string | null;
  identifyHref: string;
  onRetry: () => void;
  onConfirmNewPrice: () => void;
}) {
  const t = useTranslations("booking");
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Le CTA vient d'être neutralisé et sort du tab order : sans cette bascule, le focus retomberait
  // sur `<body>` et le message ne serait jamais atteint au clavier.
  useEffect(() => {
    focusAfterPaint(() => panelRef.current?.focus());
  }, [reason]);

  // Un nouveau total ne peut être **re-confirmé** que s'il a pu être lu : dans une devise dont
  // l'exposant d'unités mineures n'est pas fiable, l'afficher serait proposer de payer un montant
  // faux d'un facteur 10ⁿ (UX-DR-9.2).
  const confirmable =
    reason === "price-changed" &&
    newPrice !== null &&
    isCurrencyExponentReliable(newPrice.currency);

  const body = confirmable
    ? t("failurePriceChangedBody", {
        total: formatCurrency(newPrice.total, newPrice.currency, locale),
      })
    : t(`failure.${reason}.body`);

  // Rejouable = ni déterministe (le PMS a tranché sur des données inchangées), ni limité en débit,
  // ni un changement de tarif (qui exige une re-confirmation du **nouveau** montant, pas un rejeu).
  const retryable =
    !DETERMINISTIC_REASONS.has(reason) &&
    reason !== "rate-limited" &&
    reason !== "price-changed";

  const showOtherRooms = OTHER_ROOMS_REASONS.has(reason);

  // « Retour au récapitulatif » : issue de repli des motifs qui n'en ont pas d'autre. Sans elle,
  // `rate-limited` laissait une barre d'actions **entièrement vide** sous un message qui invite
  // pourtant à patienter, et `rejected` ne disait pas où aller vérifier son séjour.
  const showBackToRecap = RECAP_EXIT_REASONS.has(reason);

  return (
    <div
      ref={panelRef}
      id={id}
      tabIndex={-1}
      data-testid="payment-failure"
      data-reason={reason}
      className="flex flex-col items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-small text-destructive"
    >
      {/* Pas de `role="alert"` : l'annonce passe par la région `aria-live` **montée en permanence**
          de l'écran. Un `role="alert"` inséré avec son élément n'est pas fiable (revue 2.2), et
          il doublerait l'annonce. */}
      <p className="text-body font-medium">{t(`failure.${reason}.title`)}</p>
      <p>{body}</p>
      <div className="flex flex-wrap items-center gap-2">
        {/* « Réessayer » **uniquement** sur les échecs rejouables. Sur un refus déterministe
            (chambre prise, capacité, dates) ou une limitation de débit, le rejeu à l'identique
            échouerait toujours : le proposer serait un cul-de-sac déguisé (revue 2.2). */}
        {retryable ? (
          <Button
            type="button"
            variant="outline"
            onClick={onRetry}
            className="min-h-(--tap-min)"
            data-testid="payment-failure-retry"
          >
            {t("retry")}
          </Button>
        ) : null}

        {confirmable ? (
          /* Action **primaire** de l'écran tant que le tarif n'est pas re-confirmé : elle soumet
             le NOUVEAU total, jamais celui du devis en cache. */
          <Button
            type="button"
            onClick={onConfirmNewPrice}
            className="min-h-(--tap-min)"
            data-testid="payment-failure-confirm-price"
          >
            {t("confirmNewPrice")}
          </Button>
        ) : null}

        {showOtherRooms ? (
          <Link
            href={buildHotelPageUrl(hotelId, hotelName, stayContext)}
            className={cn(
              buttonVariants({ variant: "outline" }),
              "min-h-(--tap-min)",
            )}
            data-testid="payment-failure-other-rooms"
          >
            {t("seeOtherRooms")}
          </Link>
        ) : null}

        {reason === "invalid-dates" ? (
          <Link
            href={buildRecapUrl(params)}
            className={cn(
              buttonVariants({ variant: "outline" }),
              "min-h-(--tap-min)",
            )}
            data-testid="payment-failure-edit-stay"
          >
            {t("backToRecap")}
          </Link>
        ) : null}

        {showBackToRecap ? (
          <Link
            href={buildRecapUrl(params)}
            className={cn(
              buttonVariants({ variant: "outline" }),
              "min-h-(--tap-min)",
            )}
            data-testid="payment-failure-back-to-recap"
          >
            {t("backToRecap")}
          </Link>
        ) : null}

        {reason === "session-invalid" ? (
          <Link
            href={identifyHref}
            className={cn(
              buttonVariants({ variant: "outline" }),
              "min-h-(--tap-min)",
            )}
            data-testid="payment-failure-identify"
          >
            {t("goToIdentify")}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/** Panneau d'erreur générique — titre, explication, et **toujours** une porte de sortie. */
function ErrorPanel({
  testId,
  title,
  body,
  action,
}: {
  testId: string;
  title: string;
  body: string;
  action: React.ReactNode;
}) {
  return (
    <div
      role="alert"
      data-testid={testId}
      className="flex flex-col items-start gap-3 rounded-xl bg-card p-4 ring-1 ring-border"
    >
      <p className="text-body font-medium text-foreground">{title}</p>
      <p className="text-small text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}

/**
 * Phrase annoncée aux lecteurs d'écran — **un état, pas un décompte**.
 *
 * Elle ne change qu'aux transitions réelles (rien → réservée → plus tenue, échec) : annoncer les
 * minutes restantes en boucle rendrait la page inutilisable au lecteur d'écran (UX-DR-5.7).
 */
function announcementFor(
  view: ReservationView | null,
  failure: ReservationFailureReason | null,
  t: (key: string) => string,
): string {
  if (failure !== null) {
    return t(`failure.${failure}.title`);
  }
  switch (view) {
    case "payable":
      return t("announceReserved");
    case "hold-expired":
      return t("announceHoldExpired");
    case "cancelled":
      return t("announceReservationCancelled");
    case "settled":
      return t("announceReservationSettled");
    case "unknown":
      return t("announceReservationStatusUnknown");
    case "mismatch":
      return t("announceReservationMismatch");
    default:
      return "";
  }
}

/**
 * Vue à rendre pour un statut donné.
 *
 * `Unknown` n'est **jamais** assimilé à `Pending` : le BFF le pose quand il n'a pas su lire le
 * statut du PMS, et payer sur cette base engagerait le voyageur sur une réservation dont l'état
 * réel est ignoré.
 */
function viewForStatus(
  status: ReservationStatus,
  holdActive: boolean,
): Exclude<ReservationView, "mismatch"> {
  switch (status) {
    case "Pending":
      return holdActive ? "payable" : "hold-expired";
    case "Confirmed":
    case "CheckedIn":
    case "CheckedOut":
      return "settled";
    case "Cancelled":
    case "NoShow":
      return "cancelled";
    default:
      return "unknown";
  }
}

/** La réservation relue décrit-elle bien le séjour porté par l'URL ? */
function describesStay(
  reservation: BookingReservationResult,
  params: ParsedBookingParams,
): boolean {
  return (
    reservation.hotelId === params.hotelId &&
    reservation.roomId === params.roomId &&
    dateOnly(reservation.checkInDate) === params.checkInDate &&
    dateOnly(reservation.checkOutDate) === params.checkOutDate &&
    reservation.guests === params.guests
  );
}

/** Jour calendaire d'une date PMS, qu'elle arrive en date-only ou en instant ISO. */
function dateOnly(value: string): string {
  return value.slice(0, 10);
}

/** Ajoute `reservationId` à une URL du tunnel (le contexte porte déjà une query-string). */
function withReservationId(url: string, reservationId: string | null): string {
  return reservationId === null
    ? url
    : `${url}&reservationId=${encodeURIComponent(reservationId)}`;
}

/** Trois causes distinctes d'échec de relecture — trois issues (voir `ReservationLoadErrorPanel`). */
function reservationLoadCause(
  error: unknown,
): "session" | "outage" | "not-found" {
  if (error instanceof ApiClientError) {
    if (error.status === 401) {
      return "session";
    }
    if (error.status >= 500) {
      return "outage";
    }
    return "not-found";
  }
  // Coupure réseau, DNS, CORS : `fetch` rejette sans statut. Ce n'est pas une absence.
  return "outage";
}

/** Un 4xx du devis est définitif (séjour refusé, chambre introuvable) ; un 5xx est rejouable. */
function isRetryableQuoteError(error: unknown): boolean {
  return !(
    error instanceof ApiClientError &&
    error.status >= 400 &&
    error.status < 500
  );
}

function quoteErrorTitle(error: unknown, t: (key: string) => string): string {
  if (error instanceof ApiClientError && error.status === 404) {
    return t("notFoundTitle");
  }
  return isRetryableQuoteError(error)
    ? t("degradedTitle")
    : t("stayRejectedTitle");
}

function quoteErrorBody(error: unknown, t: (key: string) => string): string {
  if (error instanceof ApiClientError && error.status === 404) {
    return t("notFoundBody");
  }
  return isRetryableQuoteError(error)
    ? t("degradedBody")
    : t("stayRejectedBody");
}

/** Codes devise connus de l'ICU, résolus une seule fois (la liste en compte ~300). */
let icuCurrencyCodes: ReadonlySet<string> | undefined;

/**
 * L'exposant d'unités mineures de cette devise est-il **réellement** connu ?
 *
 * `minorUnitExponent` (front) et `minorUnitExponent` (BFF) retombent tous deux sur 2 décimales
 * pour une devise que l'ICU ne connaît pas — et un code libre saisi en back-office passe sans
 * lever : `Intl` accepte n'importe quel code bien formé et lui prête 2 décimales par défaut. La
 * seule vérification fiable est l'appartenance à la liste ICU.
 */
function isCurrencyExponentReliable(currency: string): boolean {
  if (icuCurrencyCodes === undefined) {
    try {
      icuCurrencyCodes = new Set(Intl.supportedValuesOf("currency"));
    } catch {
      icuCurrencyCodes = new Set<string>();
    }
  }
  if (icuCurrencyCodes.size === 0) {
    // Environnement sans `Intl.supportedValuesOf` : on ne peut pas trancher. On ne fabrique pas un
    // doute qui masquerait tous les montants — on se limite au code manifestement non formable.
    return /^[A-Za-z]{3}$/.test(currency);
  }
  return icuCurrencyCodes.has(currency.toUpperCase());
}

/**
 * Déplace le focus après le prochain rendu.
 *
 * Les panneaux de cet écran sont montés/démontés au fil des bascules (échec, expiration du hold,
 * reprise) : la cible n'existe pas encore au moment où l'état change. `requestAnimationFrame`
 * attend la peinture, là où un `setTimeout(…, 0)` pouvait s'exécuter avant le remontage et
 * échouer en silence — sans repli, le focus retombe sur `<body>`. Patron repris de
 * `booking-identify.tsx`.
 */
function focusAfterPaint(focus: () => void): void {
  if (typeof requestAnimationFrame !== "function") {
    focus();
    return;
  }
  requestAnimationFrame(() => {
    focus();
  });
}
