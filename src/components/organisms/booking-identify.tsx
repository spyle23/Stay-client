"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, InfoIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";

import { BookingSummary } from "@/components/organisms/booking-summary";
import { LoginForm } from "@/components/organisms/login-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBookingQuote } from "@/hooks/use-booking-quote";
import { useGuestCheckout, useLogout, useSession } from "@/hooks/use-session";
import { ApiClientError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { ParsedBookingParams } from "@/lib/validations/booking";
import {
  useGuestCheckoutSchema,
  type GuestCheckoutFormValues,
} from "@/lib/validations/auth";
import { zodFieldValidator } from "@/lib/validations/rhf";
import { fetchSession, isEmailConflict } from "@/services/auth.service";
import {
  buildPaymentUrl,
  buildRecapUrl,
  isOverCapacity,
} from "@/services/booking.service";
import { buildHotelPageUrl } from "@/services/catalog.service";

/**
 * Île client de l'**étape 2 du tunnel** — identification invité ou compte (story 2.3, FR-8).
 *
 * Deux chemins, invité **par défaut** (UX-DR-9.6 : l'inscription n'est jamais forcée) :
 * 1. **Invité** — email + nom + téléphone → le BFF provisionne un `Customer` léger et ouvre la
 *    session. Aucun mot de passe ne transite : il est généré côté serveur (NFR-8).
 * 2. **Compte** — le `LoginForm` de la story 2.1, réutilisé **in situ** (mode `onSuccess`) pour
 *    ne pas quitter le tunnel ni perdre le récapitulatif persistant.
 *
 * Un voyageur déjà connecté ne voit **aucun formulaire** : son identité de session est affichée
 * (pré-remplissage au sens de FR-8), avec une sortie explicite pour changer de compte.
 *
 * Le récapitulatif (`BookingSummary`) reste affiché à cette étape (UX-DR-2.5) et les règles de
 * blocage de la story 2.2 s'appliquent à l'identique : un dépassement de capacité ou une chambre
 * réellement indisponible neutralisent le passage au paiement — s'identifier pour une réservation
 * vouée à l'échec serait un cul-de-sac.
 */
export function BookingIdentify({ params }: { params: ParsedBookingParams }) {
  const t = useTranslations("booking");
  const tAuth = useTranslations("auth");
  const router = useRouter();

  const session = useSession();
  const quoteQuery = useBookingQuote(params);
  const guestCheckout = useGuestCheckout();
  const logout = useLogout();

  const [tab, setTab] = useState<"guest" | "account">("guest");
  const [conflictEmail, setConflictEmail] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  /** Reflet de la saisie email, pour la ré-afficher au niveau du CTA (AC-4). */
  const [emailPreview, setEmailPreview] = useState("");

  const firstNameId = useId();
  const lastNameId = useId();
  const emailId = useId();
  const phoneId = useId();
  const emailHelpId = useId();
  const formErrorId = useId();
  const accountPanelRef = useRef<HTMLDivElement | null>(null);

  const schema = useGuestCheckoutSchema();
  const {
    register,
    handleSubmit,
    getValues,
    setValue,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<GuestCheckoutFormValues>({
    defaultValues: { email: "", firstName: "", lastName: "", phone: "" },
    mode: "onSubmit",
  });

  const quote = quoteQuery.data;
  const overCapacity = quote ? isOverCapacity(quote) : false;
  const unavailable = quote
    ? !quote.available && !quote.availabilityDegraded && !overCapacity
    : false;
  // Une disponibilité **indéterminée** (panne du cross-check PMS) ne bloque pas : elle sera
  // tranchée à la création (règle héritée de 1.10, reprise en 2.2).
  //
  // ⚠️ **Absence de devis ≠ séjour valide.** Sans `quote`, `overCapacity` et `unavailable` valent
  // tous deux `false` : laisser passer reviendrait à créer un vrai compte `Customer` puis à
  // envoyer le voyageur payer une chambre dont on ignore tout. Trois chemins mènent ici — le
  // premier rendu (`isPending`), un devis en erreur, et le `queryClient.clear()` de « changer de
  // compte », qui repasse la requête en attente. On bloque donc **tant que le devis n'est pas
  // connu**, et on rend l'erreur explicite plutôt qu'un écran muet.
  const quoteUnknown = quote === undefined;
  const blocked = overCapacity || unavailable || quoteUnknown;

  const goToPayment = useCallback(() => {
    router.push(buildPaymentUrl(params));
  }, [router, params]);

  // Une navigation peut partir pendant l'appel (lien « Retour au récapitulatif », bouton natif du
  // navigateur) : après démontage, ni `router.push` ni `setState` ne doivent plus s'exécuter —
  // sinon le voyageur est arraché de la page qu'il vient d'atteindre, ou voit un bandeau de
  // collision sur un écran qu'il a quitté.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Handler défini séparément, puis passé à `handleSubmit` **au moment de la soumission** : appeler
  // `handleSubmit(fn)` pendant le rendu donnerait à lire le garde de montage à une closure que le
  // compilateur React ne peut pas prouver hors-rendu (`react-hooks/refs`).
  const submitGuest = useCallback(
    async (values: GuestCheckoutFormValues) => {
      setFormError(null);
      setConflictEmail(null);
      // `zodFieldValidator` ne consomme que le VERDICT de Zod : la valeur transformée par
      // `.trim().toLowerCase()` est jetée, et `values` porte la saisie brute. Sans cette
      // normalisation explicite, la comparaison d'emails plus bas échouerait sur une simple
      // majuscule (autocapitalisation mobile, copier-coller) — et la reprise de double soumission
      // ne se déclencherait jamais.
      const identity = normalizeGuestInput(values);
      try {
        await guestCheckout.mutateAsync(identity);
        if (mounted.current) {
          goToPayment();
        }
      } catch (error) {
        if (isEmailConflict(error)) {
          // Course de double soumission : la première requête a pu aboutir et poser le cookie.
          // Avant d'accuser une collision, on demande au BFF qui est connecté.
          const current = await fetchSession().catch(() => null);
          if (!mounted.current) {
            return;
          }
          if (
            current?.authenticated &&
            current.user?.email === identity.email
          ) {
            goToPayment();
            return;
          }
          setConflictEmail(identity.email);
          setTab("account");
          // Le panneau invité vient d'être démonté (`keepMounted: false`) : l'élément focalisé —
          // le bouton de soumission — a disparu et le focus retomberait sur `<body>`.
          focusAfterPaint(() => accountPanelRef.current?.focus());
          return;
        }
        if (mounted.current) {
          setFormError(guestMessageFor(error, tAuth));
        }
      }
    },
    [guestCheckout, goToPayment, tAuth],
  );

  const switchToGuestEmail = useCallback(() => {
    setConflictEmail(null);
    setTab("guest");
    setValue("email", "");
    setEmailPreview("");
    // Le champ à corriger reçoit le focus : sans cela, le voyageur revient sur un formulaire
    // dont rien n'indique où agir (UX-DR-5.8).
    focusAfterPaint(() => setFocus("email"));
  }, [setValue, setFocus]);

  // Changer d'onglet à la main après une collision : l'alerte et le pré-remplissage portent une
  // adresse que le voyageur est peut-être en train de remplacer. Les retirer évite d'afficher un
  // avertissement périmé à côté d'une nouvelle saisie.
  const onTabChange = useCallback((value: unknown) => {
    setTab(value as "guest" | "account");
    setConflictEmail(null);
  }, []);

  const pending = isSubmitting || guestCheckout.isPending;

  // Champ email enregistré une fois, puis enrichi d'un `onChange` : `watch()` aurait suffi, mais
  // il fait renoncer le compilateur React à optimiser tout le composant (`incompatible-library`).
  const emailField = register("email", {
    validate: zodFieldValidator(schema.shape.email),
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-4">
        {/* Neutralisé pendant la soumission : quitter la page en plein appel produirait une
            navigation concurrente avec `goToPayment` (le garde `mounted` empêche l'incident,
            ce lien inerte empêche la situation). */}
        <Link
          href={buildRecapUrl(params)}
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
          data-testid="identify-back-to-recap"
        >
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
          {t("backToRecap")}
        </Link>

        {/* Devis en erreur : l'écran doit le DIRE et offrir une issue (UX-DR-4.5). Rendre `null`
            laisserait une page à moitié vide, sans explication ni porte de sortie. */}
        {quoteQuery.isError ? (
          <div
            role="alert"
            data-testid="identify-quote-error"
            className="flex flex-col items-start gap-3 rounded-xl bg-card p-4 ring-1 ring-border"
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
                  onClick={() => void quoteQuery.refetch()}
                  className="min-h-(--tap-min)"
                  data-testid="identify-quote-retry"
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
                data-testid="identify-quote-exit"
              >
                {t("backToRecap")}
              </Link>
            </div>
          </div>
        ) : null}

        {overCapacity || unavailable ? (
          <div
            role="alert"
            data-testid="identify-blocked"
            className="flex flex-col items-start gap-3 rounded-xl bg-warning-soft p-4 text-warning"
          >
            <p className="text-body font-medium">
              {overCapacity ? t("overCapacityTitle") : t("unavailableTitle")}
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
              href={buildHotelPageUrl(params.hotelId, null, {
                checkInDate: params.checkInDate,
                checkOutDate: params.checkOutDate,
                guests: params.guests,
                currency: params.currency,
              })}
              className={cn(
                buttonVariants({ variant: "outline" }),
                "min-h-(--tap-min)",
              )}
              data-testid="identify-blocked-exit"
            >
              {t("seeOtherRooms")}
            </Link>
          </div>
        ) : null}

        {/* Une panne de lecture de session n'est PAS un état anonyme : proposer le formulaire
            invité à un voyageur connecté le pousserait à créer un second compte — et le BFF
            détruirait alors sa session réelle, court-circuitant « changer de compte ». */}
        {session.isError ? (
          <div
            role="alert"
            data-testid="identify-session-error"
            className="flex flex-col items-start gap-3 rounded-xl bg-card p-4 ring-1 ring-border"
          >
            <p className="text-body font-medium text-foreground">
              {t("sessionErrorTitle")}
            </p>
            <p className="text-small text-muted-foreground">
              {t("sessionErrorBody")}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => void session.refetch()}
              className="min-h-(--tap-min)"
              data-testid="identify-session-retry"
            >
              {t("retry")}
            </Button>
          </div>
        ) : session.isPending ? (
          <Skeleton className="h-64 w-full" data-testid="identify-loading" />
        ) : session.data?.authenticated ? (
          <SignedInPanel
            email={session.data.user?.email ?? ""}
            name={displayName(
              session.data.user,
              session.data.user?.email ?? "",
            )}
            blocked={blocked}
            onContinue={goToPayment}
            onSwitchAccount={() => logout.mutate()}
            switching={logout.isPending}
            switchError={logout.isError ? t("changeAccountError") : null}
          />
        ) : (
          <section
            className="flex flex-col gap-4 rounded-xl bg-card p-5 ring-1 ring-border"
            aria-labelledby={`${formErrorId}-title`}
          >
            <div className="flex flex-col gap-1">
              <h2
                id={`${formErrorId}-title`}
                className="text-h3 text-foreground"
              >
                {t("identifyTitle")}
              </h2>
              <p className="text-small text-muted-foreground">
                {t("identifyIntro")}
              </p>
            </div>

            <Tabs
              value={tab}
              onValueChange={onTabChange}
              data-testid="identify-tabs"
            >
              <TabsList className="h-auto w-full">
                <TabsTrigger
                  value="guest"
                  className="min-h-(--tap-min)"
                  data-testid="identify-tab-guest"
                >
                  {t("tabGuest")}
                </TabsTrigger>
                <TabsTrigger
                  value="account"
                  className="min-h-(--tap-min)"
                  data-testid="identify-tab-account"
                >
                  {t("tabAccount")}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="guest" className="pt-4">
                <form
                  onSubmit={(event) => void handleSubmit(submitGuest)(event)}
                  noValidate
                  className="flex flex-col gap-5"
                  data-testid="guest-form"
                >
                  {formError !== null && (
                    <p
                      id={formErrorId}
                      role="alert"
                      data-testid="guest-error"
                      className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-small text-destructive"
                    >
                      {formError}
                    </p>
                  )}

                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor={firstNameId}>
                        {tAuth("firstNameLabel")}
                      </FieldLabel>
                      <Input
                        id={firstNameId}
                        autoComplete="given-name"
                        placeholder={tAuth("firstNamePlaceholder")}
                        aria-invalid={errors.firstName ? true : undefined}
                        aria-describedby={
                          errors.firstName ? `${firstNameId}-error` : undefined
                        }
                        className="min-h-(--tap-min)"
                        data-testid="guest-first-name"
                        {...register("firstName", {
                          validate: zodFieldValidator(schema.shape.firstName),
                        })}
                      />
                      {errors.firstName?.message && (
                        <FieldError id={`${firstNameId}-error`}>
                          {errors.firstName.message}
                        </FieldError>
                      )}
                    </Field>

                    <Field>
                      <FieldLabel htmlFor={lastNameId}>
                        {tAuth("lastNameLabel")}
                      </FieldLabel>
                      <Input
                        id={lastNameId}
                        autoComplete="family-name"
                        placeholder={tAuth("lastNamePlaceholder")}
                        aria-invalid={errors.lastName ? true : undefined}
                        aria-describedby={
                          errors.lastName ? `${lastNameId}-error` : undefined
                        }
                        className="min-h-(--tap-min)"
                        data-testid="guest-last-name"
                        {...register("lastName", {
                          validate: zodFieldValidator(schema.shape.lastName),
                        })}
                      />
                      {errors.lastName?.message && (
                        <FieldError id={`${lastNameId}-error`}>
                          {errors.lastName.message}
                        </FieldError>
                      )}
                    </Field>
                  </div>

                  <Field>
                    <FieldLabel htmlFor={emailId}>
                      {tAuth("emailLabel")}
                    </FieldLabel>
                    <Input
                      id={emailId}
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      placeholder={tAuth("emailPlaceholder")}
                      aria-invalid={errors.email ? true : undefined}
                      // L'aide reste associée même en erreur : c'est elle qui explique
                      // pourquoi l'adresse doit être exacte (AC-4).
                      aria-describedby={cn(
                        emailHelpId,
                        errors.email ? `${emailId}-error` : "",
                      ).trim()}
                      className="min-h-(--tap-min)"
                      data-testid="guest-email"
                      {...emailField}
                      onChange={(event) => {
                        void emailField.onChange(event);
                        setEmailPreview(event.target.value);
                      }}
                    />
                    <p
                      id={emailHelpId}
                      className="flex items-start gap-1.5 text-caption text-muted-foreground"
                      data-testid="guest-email-help"
                    >
                      <InfoIcon
                        className="mt-0.5 size-3.5 shrink-0"
                        aria-hidden="true"
                      />
                      {t("guestEmailHelp")}
                    </p>
                    {errors.email?.message && (
                      <FieldError id={`${emailId}-error`}>
                        {errors.email.message}
                      </FieldError>
                    )}
                  </Field>

                  <Field>
                    <FieldLabel htmlFor={phoneId}>
                      {tAuth("phoneLabel")}
                    </FieldLabel>
                    <Input
                      id={phoneId}
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder={tAuth("phonePlaceholder")}
                      aria-invalid={errors.phone ? true : undefined}
                      aria-describedby={
                        errors.phone ? `${phoneId}-error` : undefined
                      }
                      className="min-h-(--tap-min)"
                      data-testid="guest-phone"
                      {...register("phone", {
                        validate: zodFieldValidator(schema.shape.phone),
                      })}
                    />
                    {errors.phone?.message && (
                      <FieldError id={`${phoneId}-error`}>
                        {errors.phone.message}
                      </FieldError>
                    )}
                  </Field>

                  {/* AC-4 : l'adresse saisie est **ré-affichée** au niveau du CTA. L'aide
                      statique ne suffit pas — c'est la relecture de sa propre saisie, au moment
                      de valider, qui rattrape une faute de frappe. */}
                  {emailPreview.trim().length > 0 ? (
                    <p
                      className="text-small text-foreground"
                      data-testid="guest-confirmation-recap"
                    >
                      {t("confirmationNotice", {
                        email: emailPreview.trim().toLowerCase(),
                      })}
                    </p>
                  ) : null}

                  {overCapacity || unavailable ? (
                    <p className="text-small text-muted-foreground">
                      {t("identifyBlockedNotice")}
                    </p>
                  ) : null}

                  <Button
                    type="submit"
                    disabled={pending || blocked}
                    aria-disabled={pending || blocked ? true : undefined}
                    className="min-h-(--tap-min) w-full lg:w-auto"
                    data-testid="guest-submit"
                  >
                    {pending ? t("guestSubmitting") : t("guestSubmit")}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent
                value="account"
                className="flex flex-col gap-4 pt-4"
                // Cible de repli du focus quand la bascule automatique (collision) démonte le
                // panneau invité : sans elle, le focus retomberait sur `<body>`.
                ref={accountPanelRef}
                tabIndex={-1}
              >
                {conflictEmail !== null && (
                  <div
                    role="alert"
                    data-testid="guest-email-conflict"
                    className="flex flex-col items-start gap-2 rounded-lg bg-warning-soft p-3 text-warning"
                  >
                    <p className="text-body font-medium">
                      {t("conflictTitle")}
                    </p>
                    <p className="text-small">{t("conflictBody")}</p>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={switchToGuestEmail}
                      className="min-h-(--tap-min)"
                      data-testid="guest-use-another-email"
                    >
                      {t("useAnotherEmail")}
                    </Button>
                  </div>
                )}
                {/*
                  Mode in situ : la connexion ne navigue pas. La mutation met à jour le cache de
                  session, ce composant se recompose et affiche le panneau « connecté ».
                */}
                <LoginForm
                  onSuccess={() => setConflictEmail(null)}
                  defaultEmail={conflictEmail ?? getValues("email")}
                />
              </TabsContent>
            </Tabs>
          </section>
        )}
      </div>

      {/* Le récapitulatif est **persistant** dans le tunnel (UX-DR-2.5) : en cas d'erreur, on
          l'annonce là où il devrait être plutôt que de laisser la colonne vide — l'explication
          détaillée et la porte de sortie vivent dans la colonne principale. */}
      {quoteQuery.isPending ? (
        <Skeleton
          className="h-80 w-full"
          data-testid="identify-summary-loading"
        />
      ) : quote ? (
        <BookingSummary quote={quote} />
      ) : (
        <p
          data-testid="identify-summary-unavailable"
          className="rounded-xl bg-card p-4 text-small text-muted-foreground ring-1 ring-border"
        >
          {t("summaryUnavailable")}
        </p>
      )}
    </div>
  );
}

/** Panneau du voyageur déjà identifié — aucune re-saisie, sortie explicite (FR-8, UX-DR-9.6). */
function SignedInPanel({
  email,
  name,
  blocked,
  onContinue,
  onSwitchAccount,
  switching,
  switchError,
}: {
  email: string;
  name: string;
  blocked: boolean;
  onContinue: () => void;
  onSwitchAccount: () => void;
  switching: boolean;
  switchError: string | null;
}) {
  const t = useTranslations("booking");

  return (
    <section
      className="flex flex-col gap-4 rounded-xl bg-card p-5 ring-1 ring-border"
      data-testid="identify-signed-in"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-h3 text-foreground">{t("signedInTitle")}</h2>
        <p
          className="text-small text-muted-foreground"
          data-testid="identify-identity"
        >
          {t("signedInAs", { name, email })}
        </p>
      </div>

      <p
        className="text-caption text-muted-foreground"
        data-testid="identify-confirmation-notice"
      >
        {t("confirmationNotice", { email })}
      </p>

      {switchError !== null && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-small text-destructive"
          data-testid="identify-switch-error"
        >
          {switchError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="lg"
          onClick={onContinue}
          disabled={blocked}
          aria-disabled={blocked ? true : undefined}
          className="min-h-(--tap-min) w-full lg:w-auto"
          data-testid="identify-continue"
        >
          {t("continueToPayment")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onSwitchAccount}
          disabled={switching}
          className="min-h-(--tap-min)"
          data-testid="identify-switch-account"
        >
          {switching ? t("changingAccount") : t("changeAccount")}
        </Button>
      </div>
    </section>
  );
}

/**
 * Applique les transformations du schéma (`trim`, `toLowerCase`) aux valeurs soumises.
 *
 * Nécessaire parce que `zodFieldValidator` est branché sur l'option `validate` de `register` :
 * il ne renvoie que `true | string`, donc react-hook-form conserve la **saisie brute**. Le BFF
 * normalise de son côté, mais le front compare localement cet email à celui de la session (repris
 * du PMS, toujours en minuscules) — sans cette étape, la comparaison échoue sur une majuscule.
 */
function normalizeGuestInput(
  values: GuestCheckoutFormValues,
): GuestCheckoutFormValues {
  return {
    email: values.email.trim().toLowerCase(),
    firstName: values.firstName.trim(),
    lastName: values.lastName.trim(),
    phone: values.phone.trim(),
  };
}

/**
 * Déplace le focus après le prochain rendu.
 *
 * Les panneaux d'onglet du dépôt ne sont pas montés en permanence (`keepMounted: false`) : la
 * cible n'existe pas encore au moment où l'on change d'onglet. `requestAnimationFrame` attend la
 * peinture, là où un `setTimeout(…, 0)` pouvait s'exécuter avant le remontage et échouer en
 * silence — sans repli, le focus retombe sur `<body>`.
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

/**
 * Nom affichable d'une identité de session.
 *
 * Le PMS peut ne porter aucun nom (`firstName`/`lastName` nullables) : sans repli, la phrase
 * « Réservation au nom de {name} ({email}) » sortirait amputée, avec un double espace, juste
 * avant le paiement. On retombe alors sur l'email, seule identité toujours présente.
 */
function displayName(
  user: { firstName: string | null; lastName: string | null } | null,
  fallback: string,
): string {
  const name = [user?.firstName, user?.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  return name.length > 0 ? name : fallback;
}

/**
 * Traduit une erreur de provisioning en message i18n. Jamais le texte du BFF/PMS à l'écran :
 * il est technique, en anglais côté PMS, et peut décrire l'état d'un compte tiers.
 *
 * Trois familles, délibérément distinctes :
 * - **compte créé sans session** — le compte EXISTE côté PMS ; proposer de réessayer sur la même
 *   adresse mènerait droit à un 409 portant un compte que personne ne peut ouvrir ;
 * - **503 ordinaire** — panne transitoire, le rejeu a du sens ;
 * - **4xx** — saisie refusée : déterministe, le rejeu à l'identique échouera toujours (patron
 *   condamné en revue 2.2 : ne jamais afficher « Réessayez » sur un échec définitif).
 */
function guestMessageFor(error: unknown, t: (key: string) => string): string {
  if (error instanceof ApiClientError) {
    if (isGuestAccountOrphaned(error)) {
      return t("guestErrorAccountCreated");
    }
    if (error.status === 503) {
      return t("errorUnavailable");
    }
    if (error.status >= 400 && error.status < 500) {
      return t("guestErrorRejected");
    }
  }
  return t("guestErrorGeneric");
}

/** Code machine posé par le BFF quand le compte PMS existe mais que la session a échoué. */
function isGuestAccountOrphaned(error: ApiClientError): boolean {
  return error.errors?.reason?.includes("guest-account-created") ?? false;
}
