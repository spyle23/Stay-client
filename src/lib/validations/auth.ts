"use client";

import { useTranslations } from "next-intl";
import { z } from "zod";
import type { Translator } from "@/lib/validations/example";

/**
 * Schémas d'authentification (story 2.1 — FR-19). Convention **« factory + hook »** du dépôt
 * (`lib/validations/example.ts`) : les messages viennent de `messages/{fr,en}.json`, jamais du
 * code (UX-DR-8.3).
 *
 * Périmètre : **connexion** (2.1) et **Checkout invité** (2.3). L'inscription explicite avec mot
 * de passe choisi (`registerCustomerSchema`) reste en story 4.1.
 */

/** Bornes reprises **à l'identique** de `RegisterCustomerRequestValidator.cs` côté PMS. */
export const PMS_LIMITS = {
  email: 255,
  name: 100,
  phone: 20,
} as const;

/**
 * Fabrique pure (testable sans React) : messages fournis par `t`.
 *
 * ⚠️ Le mot de passe n'est validé que **non vide**. Imposer ici la longueur minimale de la
 * politique d'inscription enfermerait définitivement hors de son compte tout utilisateur dont
 * le mot de passe est plus court (compte antérieur à la politique, import, seed) : le formulaire
 * refuserait d'émettre la requête, avec un message suggérant à tort un mot de passe erroné.
 * La longueur relève de l'**inscription** (story 4.1) et du PMS, seul validateur autoritatif.
 */
export function buildLoginSchema(t: Translator) {
  return z.object({
    email: z.string().min(1, t("required")).email(t("emailInvalid")),
    password: z.string().min(1, t("required")),
  });
}

/** Hook applicatif : câble la fabrique sur le namespace i18n `validation`. */
export function useLoginSchema() {
  const t = useTranslations("validation");
  return buildLoginSchema(t as Translator);
}

export type LoginFormValues = z.infer<ReturnType<typeof buildLoginSchema>>;

/**
 * Motif de téléphone volontairement **permissif** : formats internationaux et séparateurs usuels,
 * au moins 6 chiffres. Le dépôt n'embarque pas `react-phone-number-input` (contrairement au
 * back-office `Stay/`) et ajouter une bibliothèque de numérotation pour un seul champ serait
 * disproportionné — un numéro valide qu'on ne saurait pas reconnaître bloquerait la réservation.
 *
 * L'espace est **littéral** et non `\s` : un `\n` ou une tabulation collés depuis un contact
 * ressortiraient dans les emails et PDF produits par le PMS. Miroir exact du `@Matches` du DTO BFF.
 */
const PHONE_PATTERN = /^\+?[\d ().-]+$/;
const MIN_PHONE_DIGITS = 6;

/**
 * Checkout invité (story 2.3 — FR-8) : email + prénom + nom + téléphone.
 *
 * Aucun mot de passe : le BFF en génère un pour le compte léger. Les bornes reproduisent celles
 * du PMS — un dépassement non intercepté ici reviendrait en 400 générique, **indiscernable**
 * d'une collision d'email côté écran.
 */
export function buildGuestCheckoutSchema(t: Translator) {
  return z.object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .min(1, t("required"))
      .max(PMS_LIMITS.email, t("tooLong", { max: PMS_LIMITS.email }))
      .email(t("emailInvalid")),
    firstName: z
      .string()
      .trim()
      .min(1, t("required"))
      .max(PMS_LIMITS.name, t("tooLong", { max: PMS_LIMITS.name })),
    lastName: z
      .string()
      .trim()
      .min(1, t("required"))
      .max(PMS_LIMITS.name, t("tooLong", { max: PMS_LIMITS.name })),
    phone: z
      .string()
      .trim()
      .min(1, t("required"))
      .max(PMS_LIMITS.phone, t("tooLong", { max: PMS_LIMITS.phone }))
      .refine(
        (value) =>
          PHONE_PATTERN.test(value) &&
          (value.match(/\d/g)?.length ?? 0) >= MIN_PHONE_DIGITS,
        t("phoneInvalid"),
      ),
  });
}

/** Hook applicatif : câble la fabrique sur le namespace i18n `validation`. */
export function useGuestCheckoutSchema() {
  const t = useTranslations("validation");
  return buildGuestCheckoutSchema(t as Translator);
}

export type GuestCheckoutFormValues = z.infer<
  ReturnType<typeof buildGuestCheckoutSchema>
>;
