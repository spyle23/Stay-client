// Configuration i18n de l'Application Cliente — next-intl SANS routing d'URL.
// La locale est portée par le cookie `NEXT_LOCALE` (aucun préfixe /fr /en dans
// l'URL) → le changement de langue préserve le contexte de navigation (FR-20,
// UX-DR-8.1). Miroir de la convention `Stay/src/i18n/config.ts`.

export const locales = ["fr", "en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "fr";

// Nom de la langue affiché dans son propre alphabet (endonyme) — indépendant de
// la langue courante de l'interface.
export const localeNames: Record<Locale, string> = {
  fr: "Français",
  en: "English",
};

// Cookie de persistance de la langue (lu côté serveur par `request.ts`).
export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isLocale(value: string | undefined | null): value is Locale {
  return value != null && (locales as readonly string[]).includes(value);
}
