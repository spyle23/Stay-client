"use client";

import { useTranslations } from "next-intl";
import { z } from "zod";
import type { Translator } from "@/lib/validations/example";

/**
 * Schémas d'authentification (story 2.1 — FR-19). Convention **« factory + hook »** du dépôt
 * (`lib/validations/example.ts`) : les messages viennent de `messages/{fr,en}.json`, jamais du
 * code (UX-DR-8.3).
 *
 * Périmètre volontairement réduit à la **connexion** : `registerCustomerSchema` (inscription)
 * arrive en story 4.1 — l'y ajouter ici imposerait aussi la validation du téléphone
 * (`react-phone-number-input`, absent de ce dépôt) sans qu'aucun écran ne la consomme.
 */

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
