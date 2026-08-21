"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import type {
  Appearance,
  StripePaymentElementOptions,
} from "@stripe/stripe-js";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { LockIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePaymentIntent } from "@/hooks/use-payment-intent";
import { isCurrencyExponentReliable } from "@/lib/currency";
import { getStripe } from "@/lib/stripe";
import { cn, formatCurrency } from "@/lib/utils";
import {
  paymentFailureReason,
  RETRYABLE_PAYMENT_REASONS,
  type PaymentIntentResult,
} from "@/services/payment.service";

/**
 * Paiement carte du tunnel — **Payment Element, 3-D Secure, capture manuelle** (story 3.1, FR-12).
 *
 * ## Ce que cet écran fait, et ce qu'il ne fait PAS
 *
 * Il obtient une **autorisation** : les fonds sont retenus sur la carte, **rien n'est encaissé**.
 * La confirmation ferme (`Pending → Confirmed`), la capture, l'e-mail et le PDF/QR appartiennent à
 * la **story 3.2**. Cet écran ne doit donc jamais annoncer une réservation confirmée, un e-mail
 * envoyé, ni afficher un code ou un QR — c'est le défaut trouvé en Phase 3 de la story 2.3, et
 * l'AC-8 existe pour empêcher sa réédition.
 *
 * ## Les données de carte ne passent jamais par nos serveurs
 *
 * Le Payment Element est une **iframe Stripe** : la saisie va du navigateur à Stripe directement
 * (PCI SAQ-A). Le BFF ne voit qu'un `clientSecret`, jeton à portée d'un seul PaymentIntent.
 */

/** Période de rescrutation d'un intent resté dans un état transitoire (ms). */
const POLL_INTERVAL_MS = 3_000;

/** Délai au-delà duquel un Stripe.js qui n'a pas chargé est considéré comme injoignable (ms). */
const STRIPE_LOAD_TIMEOUT_MS = 15_000;

/** États observables de l'écran de paiement — chacun a un rendu distinct et une annonce. */
type PaymentPhase =
  | "idle"
  | "intent-loading"
  | "ready"
  | "confirming"
  | "3ds"
  | "authorized"
  | "declined";

interface BookingPaymentFormProps {
  reservationId: string;
  /** Total attendu, en unités mineures — sert de contrôle d'affichage, pas de source du montant. */
  expectedTotal: number;
  expectedCurrency: string;
}

export function BookingPaymentForm({
  reservationId,
  expectedTotal,
  expectedCurrency,
}: BookingPaymentFormProps) {
  const t = useTranslations("booking.payment");

  // Une requête, pas une mutation : voir `use-payment-intent.ts` — la clé de cache dédoublonne les
  // montages successifs, là où les callbacks d'une mutation pouvaient être perdus.
  const {
    data: intent,
    error,
    isError,
    refetch,
  } = usePaymentIntent(reservationId);

  // ⚠️ Un `clientSecret` malformé fait **lever `<Elements>` au montage**, ce qui vide la page
  // entière (« This page couldn't load ») en plein tunnel de paiement — le pire endroit possible.
  // Un contrat rompu doit dégrader en message, jamais en écran blanc. Trouvé en e2e isolé.
  const usable = intent && isStripeClientSecret(intent.clientSecret);
  const failure = isError ? paymentFailureReason(error) : null;

  // ⚠️ `already-authorized` n'est PAS une erreur : c'est l'état « paiement autorisé » vu depuis le
  // serveur. Le PMS refuse un second intent dès que la ligne passe `Authorized` (webhook Stripe),
  // si bien qu'après un rechargement le voyageur — dont la carte porte une retenue réelle —
  // recevait un bandeau `role="alert"` sans issue. Ce chemin ne se manifestait pas en Phase 3
  // parce que le webhook n'arrive pas sur un poste de développement : il est donc, en production,
  // le chemin NOMINAL du rechargement. Trouvé en revue de code 3.1.
  if (failure === "already-authorized") {
    return <PaymentAuthorized captureMethod="manual" />;
  }

  const intentError = failure ?? (intent && !usable ? "unknown" : null);

  if (intentError) {
    return (
      <PaymentNotice
        tone="error"
        testId="payment-intent-error"
        title={t(`errors.${intentError}.title`)}
        body={t(`errors.${intentError}.body`)}
        action={
          RETRYABLE_PAYMENT_REASONS.has(intentError)
            ? { label: t("retry"), onClick: () => void refetch() }
            : undefined
        }
      />
    );
  }

  if (!intent || !usable) {
    return (
      <div
        className="flex flex-col gap-3"
        data-testid="payment-intent-loading"
        aria-busy="true"
      >
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-28 w-full" />
        <span className="sr-only" role="status">
          {t("phase.intentLoading")}
        </span>
      </div>
    );
  }

  return (
    <PayableGate
      intent={intent}
      expectedTotal={expectedTotal}
      expectedCurrency={expectedCurrency}
    />
  );
}

/**
 * Décide s'il faut monter un formulaire de paiement — **avant** de le monter.
 *
 * ⚠️ Stripe **refuse d'initialiser `<Elements>`** sur un intent qui n'est plus payable
 * (`requires_capture`, `succeeded`) : `/v1/elements/sessions` répond 400 et le Payment Element émet
 * un `loaderror`. Vérifier le statut à l'intérieur d'`<Elements>` — comme le faisait la première
 * version — donnait donc le bon écran mais **deux erreurs console à chaque rechargement** après
 * autorisation. Défaut trouvé en Phase 3 cliente.
 *
 * La sonde utilise `retrievePaymentIntent`, qui ne nécessite que la clé publique et le
 * `clientSecret` : aucune donnée de carte, aucun secret serveur.
 */
function PayableGate({
  intent,
  expectedTotal,
  expectedCurrency,
}: {
  intent: PaymentIntentResult;
  expectedTotal: number;
  expectedCurrency: string;
}) {
  const t = useTranslations("booking.payment");
  const [probed, setProbed] = useState<
    "pending" | "payable" | "authorized" | "unknown"
  >("pending");

  useEffect(() => {
    let cancelled = false;

    void getStripe(intent.publishableKey)
      .then((stripe) => stripe?.retrievePaymentIntent(intent.clientSecret))
      .then((result) => {
        if (cancelled) {
          return;
        }
        const status = result?.paymentIntent?.status;
        setProbed(
          status === "requires_capture" || status === "succeeded"
            ? "authorized"
            : "payable",
        );
      })
      .catch(() => {
        // ⚠️ Sonde impossible (réseau instable, Stripe injoignable). Monter le formulaire « au cas
        // où » proposait un bouton « Payer » actif sur une carte peut-être DÉJÀ retenue, et la
        // confirmation échouait ensuite avec un message de rejet trompeur. On rend la main au
        // voyageur au lieu de deviner. Trouvé en revue de code 3.1.
        if (!cancelled) {
          setProbed("unknown");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [intent.publishableKey, intent.clientSecret]);

  if (probed === "pending") {
    return (
      <div
        className="flex flex-col gap-3"
        data-testid="payment-stripe-loading"
        aria-busy="true"
      >
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-28 w-full" />
        <span className="sr-only" role="status">
          {t("phase.intentLoading")}
        </span>
      </div>
    );
  }

  if (probed === "authorized") {
    return <PaymentAuthorized captureMethod={intent.captureMethod} />;
  }

  if (probed === "unknown") {
    return (
      <PaymentNotice
        tone="error"
        testId="payment-probe-failed"
        title={t("errors.probe-failed.title")}
        body={t("errors.probe-failed.body")}
        action={{ label: t("retry"), onClick: () => window.location.reload() }}
      />
    );
  }

  return (
    <StripeBoundary intent={intent}>
      <PaymentFormInner
        intent={intent}
        expectedTotal={expectedTotal}
        expectedCurrency={expectedCurrency}
      />
    </StripeBoundary>
  );
}

/**
 * Écran d'autorisation obtenue.
 *
 * ⚠️ AC-8 : « autorisé », **jamais** « confirmé ». Aucun code, aucun QR, aucun PDF, aucune mention
 * d'e-mail — la confirmation ferme est le périmètre de la story 3.2. Le défaut « confirmation
 * annoncée comme déjà envoyée » avait été trouvé en Phase 3 de la story 2.3 ; il ne doit pas se
 * rejouer ici sous une autre forme.
 */
function PaymentAuthorized({
  captureMethod,
}: {
  captureMethod: PaymentIntentResult["captureMethod"];
}) {
  const t = useTranslations("booking.payment");
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="status"
      data-testid="payment-authorized"
      data-phase="authorized"
      className="flex flex-col gap-2 rounded-lg bg-success-soft p-4 text-success"
    >
      <p className="text-body font-medium">{t("authorizedTitle")}</p>
      <p className="text-small">
        {captureMethod === "manual"
          ? t("authorizedBodyHeld")
          : t("authorizedBody")}
      </p>
    </div>
  );
}

/**
 * Fournit le contexte Stripe.
 *
 * ⚠️ Les `options` d'`<Elements>` sont **immuables après montage** : ce composant ne doit jamais
 * être remonté tant que le `clientSecret` ne change pas, sinon le Payment Element se réinitialise
 * et la saisie du voyageur est perdue. La `key` est donc le `clientSecret` lui-même — remonter
 * devient alors exactement aussi fréquent qu'un changement d'intent, ni plus ni moins.
 */
function StripeBoundary({
  intent,
  children,
}: {
  intent: PaymentIntentResult;
  children: React.ReactNode;
}) {
  const { resolvedTheme } = useTheme();
  const stripePromise = useMemo(
    () => getStripe(intent.publishableKey),
    [intent.publishableKey],
  );

  // L'Element vit dans une iframe et n'hérite d'AUCUN css du site : le thème passe par l'API
  // `appearance`, recalculée quand le thème bascule.
  const appearance = useMemo<Appearance>(
    () => buildAppearance(resolvedTheme === "dark"),
    [resolvedTheme],
  );

  return (
    <Elements
      key={intent.clientSecret}
      stripe={stripePromise}
      options={{ clientSecret: intent.clientSecret, appearance }}
    >
      {children}
    </Elements>
  );
}

function PaymentFormInner({
  intent,
  expectedTotal,
  expectedCurrency,
}: {
  intent: PaymentIntentResult;
  expectedTotal: number;
  expectedCurrency: string;
}) {
  const t = useTranslations("booking.payment");
  const locale = useLocale();
  const stripe = useStripe();
  const elements = useElements();
  const statusId = useId();
  const errorId = useId();
  const [stripeTimedOut, setStripeTimedOut] = useState(false);

  const [phase, setPhase] = useState<PaymentPhase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const statusRef = useRef<HTMLDivElement | null>(null);

  /**
   * La **payabilité a déjà été vérifiée** par `PayableGate` avant ce montage : inutile de resonder
   * ici, et surtout impossible de le faire proprement — `<Elements>` n'existerait pas si l'intent
   * n'était plus payable.
   */
  // Déplacer le focus sur le message d'état à chaque bascule terminale : au clavier, l'issue du
  // paiement ne doit pas se découvrir en explorant la page.
  useEffect(() => {
    if (phase === "authorized" || phase === "declined") {
      statusRef.current?.focus();
    }
  }, [phase]);

  const busy = phase === "confirming" || phase === "3ds";

  /**
   * ⚠️ `processing` et `requires_action` étaient des culs-de-sac DÉFINITIFS : les deux posaient
   * `busy`, `handleSubmit` sortait en tête à toute resoumission, et rien ne rescrutait jamais le
   * statut (`refetchOnMount: false`, `staleTime: Infinity`). L'écran restait figé sur « Paiement en
   * cours » sans délai ni issue. On rescrute donc l'intent tant qu'il est dans un état transitoire.
   */
  useEffect(() => {
    if (!stripe || !busy) {
      return;
    }

    let cancelled = false;
    const timer = setInterval(() => {
      void stripe
        .retrievePaymentIntent(intent.clientSecret)
        .then(({ paymentIntent }) => {
          if (cancelled || !paymentIntent) {
            return;
          }
          switch (paymentIntent.status) {
            case "requires_capture":
            case "succeeded":
              setPhase("authorized");
              break;
            case "requires_payment_method":
              // La tentative s'est soldée par un échec : rendre la main plutôt que rester figé.
              setPhase("declined");
              setMessage(t("errors.rejected.body"));
              break;
            default:
              break;
          }
        })
        .catch(() => {
          // Sonde impossible : on retentera au prochain tour.
        });
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [stripe, busy, intent.clientSecret, t]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!stripe || !elements || busy || phase === "authorized") {
        return;
      }

      setMessage(null);
      setPhase("confirming");

      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          // Retour sur l'écran de paiement lui-même : la confirmation ferme n'existe pas encore
          // (story 3.2). Pointer vers une page de confirmation serait une promesse fausse.
          return_url: window.location.href,
        },
        // `if_required` garde la carte SUR la page ; seuls les moyens qui l'exigent partent en
        // redirection. La 3-D Secure s'ouvre alors en modale Stripe, sans quitter le tunnel.
        redirect: "if_required",
      });

      if (error) {
        setPhase("declined");
        // Message de Stripe : il est localisé et décrit précisément le refus (carte expirée, fonds
        // insuffisants…). Le remplacer par un texte générique appauvrirait le diagnostic.
        setMessage(error.message ?? t("errors.rejected.body"));
        return;
      }

      if (!paymentIntent) {
        setPhase("declined");
        setMessage(t("errors.unknown.body"));
        return;
      }

      switch (paymentIntent.status) {
        case "requires_capture":
        case "succeeded":
          setPhase("authorized");
          break;
        case "requires_action":
          setPhase("3ds");
          break;
        case "processing":
          setPhase("confirming");
          break;
        default:
          setPhase("declined");
          setMessage(t("errors.rejected.body"));
      }
    },
    [stripe, elements, busy, phase, t],
  );

  // ⚠️ Tant que Stripe.js n'a pas fini de charger, on n'affiche PAS le formulaire avec un bouton
  // « Payer » inerte et grisé : `disabled:opacity-50` fait tomber le contraste du bouton primaire à
  // 2,06:1 (violation AA relevée par axe), et un CTA mort à l'étape du paiement est le pire endroit
  // pour en montrer un. Un squelette dit la vérité — ça charge.
  const stripeReady = Boolean(stripe && elements);

  useEffect(() => {
    if (stripeReady) {
      return;
    }
    const timer = setTimeout(
      () => setStripeTimedOut(true),
      STRIPE_LOAD_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [stripeReady]);

  /**
   * Phase telle qu'elle doit être **annoncée et exposée**.
   *
   * ⚠️ `ready` était **inatteignable** : aucun `setPhase("ready")` n'existait depuis que l'effet de
   * reprise a été retiré au profit de `PayableGate`, si bien que la région `aria-live` annonçait
   * « Préparation du paiement » sur un formulaire pleinement interactif et que `data-phase` valait
   * `idle`. Trouvé en revue de code 3.1 (AC-3, AC-9).
   *
   * C'est un état **dérivé** (« au repos, et Stripe.js chargé »), pas un événement : le calculer
   * évite un effet qui écrirait dans l'état, et supprime la possibilité même de l'oublier.
   */
  const announcedPhase: PaymentPhase =
    phase === "idle" && stripeReady ? "ready" : phase;

  const amountReliable = isCurrencyExponentReliable(intent.currency);
  const amountMatches =
    intent.amount === expectedTotal &&
    intent.currency.toUpperCase() === expectedCurrency.toUpperCase();

  if (!stripeReady && stripeTimedOut) {
    // ⚠️ Stripe.js peut ne JAMAIS charger (bloqueur, CSP d'entreprise, réseau filtré) : `loadStripe`
    // résout alors `null` et l'écran restait sur son squelette indéfiniment, `aria-busy` compris,
    // sans message ni issue — alors que le hold, lui, était déjà gelé. Trouvé en revue de code 3.1.
    return (
      <PaymentNotice
        tone="error"
        testId="payment-stripe-unavailable"
        title={t("errors.stripe-unavailable.title")}
        body={t("errors.stripe-unavailable.body")}
        action={{ label: t("retry"), onClick: () => window.location.reload() }}
      />
    );
  }

  if (!stripeReady) {
    return (
      <div
        className="flex flex-col gap-3"
        data-testid="payment-stripe-loading"
        aria-busy="true"
      >
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-28 w-full" />
        <span className="sr-only" role="status">
          {t("phase.intentLoading")}
        </span>
      </div>
    );
  }

  if (phase === "authorized") {
    return <PaymentAuthorized captureMethod={intent.captureMethod} />;
  }

  // ⚠️ C9 : ne JAMAIS proposer de payer un montant qui ne peut pas être vérifié. Ces deux gardes ne
  // faisaient que changer le libellé du montant — le Payment Element et le bouton « Payer »
  // restaient rendus, et le texte de repli (« le montant sera confirmé par votre banque ») était de
  // surcroît faux. Trouvé en revue de code 3.1.
  if (!amountReliable || !amountMatches) {
    return (
      <PaymentNotice
        tone="error"
        testId="payment-amount-unverified"
        title={t("errors.amount-mismatch.title")}
        body={t("errors.amount-mismatch.body")}
      />
    );
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-4"
      data-testid="payment-form"
      data-phase={announcedPhase}
      noValidate
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-body font-medium text-foreground">
          {t("formTitle")}
        </h3>
        {/* Le mode de capture est RAPPORTÉ par le serveur : si le PMS repassait en capture
            automatique, cette promesse disparaîtrait au lieu de devenir fausse. */}
        {intent.captureMethod === "manual" ? (
          <p
            className="flex items-center gap-1.5 text-small text-muted-foreground"
            data-testid="payment-no-firm-debit"
          >
            <LockIcon aria-hidden="true" className="size-3.5 shrink-0" />
            {t("noFirmDebit")}
          </p>
        ) : null}
      </div>

      <PaymentElement options={ELEMENT_OPTIONS} />

      {/* Le montant qui sera réellement autorisé, affiché depuis l'intent (ce qui engage). */}
      {amountReliable && amountMatches ? (
        <p
          className="text-small text-muted-foreground"
          data-testid="payment-amount"
        >
          {t("amountToAuthorize", {
            amount: formatCurrency(intent.amount, intent.currency, locale),
          })}
        </p>
      ) : (
        <p
          className="text-small text-muted-foreground"
          data-testid="payment-amount-unverified"
        >
          {t("amountUnverified")}
        </p>
      )}

      <div
        ref={statusRef}
        tabIndex={-1}
        id={statusId}
        role="status"
        aria-live="polite"
        className="sr-only"
      >
        {t(`phase.${announcedPhase}`)}
      </div>

      {message ? (
        <p
          id={errorId}
          role="alert"
          data-testid="payment-error"
          className="rounded-lg bg-destructive-soft p-3 text-small text-destructive"
        >
          {message}
        </p>
      ) : null}

      {/* `aria-disabled` et non `disabled` natif : ce dernier sortirait le bouton de l'ordre de
          tabulation en plein appel et ferait retomber le focus sur `<body>` (défaut relevé en revue
          2.4). La garde réelle est le test `busy` en tête de `handleSubmit`. */}
      <Button
        type="submit"
        aria-disabled={busy}
        aria-describedby={cn(statusId, message ? errorId : undefined)}
        className={cn("min-h-(--tap-min)", busy && "cursor-progress")}
        data-testid="payment-submit"
      >
        {busy ? t("submitBusy") : t("submit")}
      </Button>

      {phase === "declined" ? (
        // AC-4 : la réservation reste `Pending`. On ne renvoie NI au récapitulatif, NI à la
        // création — le voyageur corrige sa carte et resoumet le même formulaire.
        <p
          className="text-small text-muted-foreground"
          data-testid="payment-retry-hint"
        >
          {t("retryHint")}
        </p>
      ) : null}
    </form>
  );
}

/** Bandeau d'état réutilisé par les échecs de demande d'intent. */
function PaymentNotice({
  tone,
  testId,
  title,
  body,
  action,
}: {
  tone: "error" | "info";
  testId: string;
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div
      role="alert"
      data-testid={testId}
      className={cn(
        "flex flex-col items-start gap-3 rounded-lg p-4",
        tone === "error"
          ? "bg-warning-soft text-warning"
          : "bg-muted text-muted-foreground",
      )}
    >
      <p className="text-body font-medium">{title}</p>
      <p className="text-small">{body}</p>
      {action ? (
        <Button
          type="button"
          variant="outline"
          onClick={action.onClick}
          className="min-h-(--tap-min)"
          data-testid={`${testId}-action`}
        >
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Forme d'un `clientSecret` Stripe : `{intentId}_secret_{secret}`.
 *
 * Vérifiée avant de monter `<Elements>` : la bibliothèque **lève** sur une valeur mal formée, et
 * une exception à cet endroit détruit la page au lieu d'afficher une erreur.
 */
function isStripeClientSecret(value: string): boolean {
  return /^[A-Za-z0-9_]+_secret_[A-Za-z0-9_-]+$/.test(value);
}

/**
 * Disposition en onglets, dépliée d'emblée.
 *
 * ⚠️ Le commentaire précédent affirmait « onglets masqués : le tunnel ne collecte qu'une carte » —
 * l'inverse de ce que ces options font. La restriction aux moyens compatibles avec la capture
 * différée vient du PMS (`AutomaticPaymentMethods` + `capture_method: manual`), pas d'ici.
 */
const ELEMENT_OPTIONS: StripePaymentElementOptions = {
  layout: { type: "tabs", defaultCollapsed: false },
};

/**
 * Thème de l'iframe Stripe, aligné sur les tokens du design system (story 1.4).
 *
 * Les valeurs sont littérales : `appearance` traverse la frontière iframe et ne peut pas résoudre
 * une variable CSS de notre document.
 */
function buildAppearance(dark: boolean): Appearance {
  return {
    theme: dark ? "night" : "stripe",
    variables: {
      colorPrimary: dark ? "#8ab4f8" : "#1a56db",
      colorBackground: dark ? "#111827" : "#ffffff",
      colorText: dark ? "#e5e7eb" : "#111827",
      colorDanger: dark ? "#f87171" : "#b91c1c",
      borderRadius: "0.5rem",
      fontSizeBase: "1rem",
    },
  };
}
