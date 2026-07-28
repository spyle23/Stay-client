"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useLogin, useSession } from "@/hooks/use-session";
import { ApiClientError } from "@/lib/api-client";
import { useLoginSchema, type LoginFormValues } from "@/lib/validations/auth";
import { zodFieldValidator } from "@/lib/validations/rhf";

/**
 * Formulaire de connexion (story 2.1 — FR-19, UX-DR-3.12 / 7.7 / 5.8 / 5.9).
 *
 * Deux usages : la page `/login` (navigation vers `next`) et l'onglet « J'ai un compte » de
 * l'étape d'identification du tunnel (story 2.3, mode `onSuccess` sans navigation).
 *
 * Sécurité & confiance :
 * - aucun jeton n'est manipulé ici : le BFF pose un cookie **opaque HttpOnly** (NFR-8) ;
 * - le message d'échec est **générique et i18n** — on ne relaie jamais le texte du PMS, qui
 *   révélerait si l'adresse existe (énumération de comptes) ;
 * - la redirection post-connexion passe par `safeInternalPath` (validée côté page).
 *
 * a11y : labels visibles, `aria-invalid` + `aria-describedby` sur les champs en erreur, focus
 * automatique sur le 1ᵉʳ champ invalide (react-hook-form), erreurs annoncées (`role="alert"`
 * porté par `FieldError`), cibles ≥ 44 px (`--tap-min`).
 */

interface LoginFormProps {
  /**
   * Destination post-connexion, **déjà validée** comme chemin interne. Ignorée quand
   * `onSuccess` est fourni (le formulaire ne navigue alors plus lui-même).
   */
  next?: string;
  /**
   * Mode **in situ** (story 2.3, étape d'identification du tunnel) : appelé au lieu de naviguer.
   *
   * Dans le tunnel, une navigation ferait perdre le récapitulatif persistant et rejouerait une
   * page entière pour un changement d'état local. L'appelant recompose son écran à partir de la
   * session, que la mutation vient de mettre à jour dans le cache.
   */
  onSuccess?: () => void;
  /** Valeur initiale du champ email (pré-remplissage après collision d'email — story 2.3). */
  defaultEmail?: string;
}

export function LoginForm({ next, onSuccess, defaultEmail }: LoginFormProps) {
  const t = useTranslations("auth");
  const router = useRouter();
  const schema = useLoginSchema();
  const login = useLogin();
  const { data: session } = useSession();
  const [formError, setFormError] = useState<string | null>(null);
  const emailId = useId();
  const passwordId = useId();
  const formErrorId = useId();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    defaultValues: { email: defaultEmail ?? "", password: "" },
    mode: "onSubmit",
  });

  // Déjà connecté (session ouverte dans un autre onglet, retour arrière) : ne pas proposer
  // un formulaire inutile — on rejoint directement la destination.
  // En mode in situ, c'est l'appelant qui décide de l'affichage : ne jamais naviguer d'ici,
  // sous peine de rejouer la course « handler vs effet de garde » diagnostiquée en 2.1.
  useEffect(() => {
    if (
      onSuccess === undefined &&
      next !== undefined &&
      session?.authenticated
    ) {
      router.replace(next);
    }
  }, [session?.authenticated, next, onSuccess, router]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login.mutateAsync(values);
      if (onSuccess) {
        onSuccess();
        return;
      }
      router.replace(next ?? "/");
      // Rafraîchit les Server Components (la garde `proxy.ts` voit désormais le cookie).
      router.refresh();
    } catch (error) {
      setFormError(messageFor(error, t));
    }
  });

  const pending = isSubmitting || login.isPending;

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      noValidate
      className="flex flex-col gap-5"
      data-testid="login-form"
    >
      {formError !== null && (
        <p
          id={formErrorId}
          role="alert"
          data-testid="login-error"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-small text-destructive"
        >
          {formError}
        </p>
      )}

      <Field>
        <FieldLabel htmlFor={emailId}>{t("emailLabel")}</FieldLabel>
        <Input
          id={emailId}
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder={t("emailPlaceholder")}
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? `${emailId}-error` : undefined}
          className="min-h-(--tap-min)"
          data-testid="login-email"
          {...register("email", {
            validate: zodFieldValidator(schema.shape.email),
          })}
        />
        {errors.email?.message && (
          <FieldError id={`${emailId}-error`}>
            {errors.email.message}
          </FieldError>
        )}
      </Field>

      <Field>
        <FieldLabel htmlFor={passwordId}>{t("passwordLabel")}</FieldLabel>
        <Input
          id={passwordId}
          type="password"
          autoComplete="current-password"
          placeholder={t("passwordPlaceholder")}
          aria-invalid={errors.password ? true : undefined}
          aria-describedby={errors.password ? `${passwordId}-error` : undefined}
          className="min-h-(--tap-min)"
          data-testid="login-password"
          {...register("password", {
            validate: zodFieldValidator(schema.shape.password),
          })}
        />
        {errors.password?.message && (
          <FieldError id={`${passwordId}-error`}>
            {errors.password.message}
          </FieldError>
        )}
      </Field>

      <Button
        type="submit"
        disabled={pending}
        className="min-h-(--tap-min) w-full"
        data-testid="login-submit"
      >
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}

/**
 * Traduit une erreur d'appel en message **générique** (jamais le texte du PMS).
 * 400/401 partagent volontairement le même message : distinguer « mot de passe faux » de
 * « compte inconnu » permettrait d'énumérer les comptes.
 */
function messageFor(error: unknown, t: (key: string) => string): string {
  if (error instanceof ApiClientError) {
    if (error.status === 403) {
      return t("errorForbiddenRole");
    }
    if (error.status === 400 || error.status === 401) {
      return t("errorInvalidCredentials");
    }
    if (error.status === 503) {
      return t("errorUnavailable");
    }
  }
  return t("errorGeneric");
}
