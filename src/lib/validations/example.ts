"use client";

import { useTranslations } from "next-intl";
import { z } from "zod";

/**
 * Socle de validation Zod internationalisée (UX-DR-8.3 : messages i18n, aucun
 * texte en dur).
 *
 * Convention « factory + hook » (miroir de `Stay/src/lib/validations/*`) : un
 * traducteur `t` est injecté dans la fabrique → tout message provient des
 * catalogues `messages/{fr,en}.json` (namespace `validation.*`), jamais du code.
 * Ce schéma est une DÉMONSTRATION du socle : les vrais formulaires (compte,
 * tunnel) arrivent aux Épics 2 et 4 et réutiliseront exactement ce pattern.
 */
export type Translator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

/** Fabrique pure (testable sans React) : messages fournis par `t`. */
export function buildContactSchema(t: Translator) {
  return z.object({
    name: z.string().min(2, t("tooShort", { min: 2 })),
    email: z.string().min(1, t("required")).email(t("emailInvalid")),
  });
}

/** Hook applicatif : câble la fabrique sur le namespace i18n `validation`. */
export function useContactSchema() {
  const t = useTranslations("validation");
  return buildContactSchema(t as Translator);
}
