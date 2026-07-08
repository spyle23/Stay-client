import type { ReactNode } from "react";
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import {
  buildContactSchema,
  useContactSchema,
} from "@/lib/validations/example";
import frMessages from "@/i18n/messages/fr.json";
import enMessages from "@/i18n/messages/en.json";

// Tests unitaires (Story 1.5) : la validation Zod tire ses messages de l'i18n
// (UX-DR-8.3), sans aucun texte en dur — vérifié dans les deux locales.
function wrapper(locale: string, messages: Record<string, unknown>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale={locale} messages={messages}>
        {children}
      </NextIntlClientProvider>
    );
  };
}

describe("validations: socle Zod i18n", () => {
  it("buildContactSchema n'a aucun message en dur (messages injectés)", () => {
    const schema = buildContactSchema((key) => `T:${key}`);
    const parsed = schema.safeParse({ name: "", email: "" });
    expect(parsed.success).toBe(false);
    const messages = parsed.error!.issues.map((i) => i.message);
    // Tous les messages proviennent du traducteur injecté (préfixe T:).
    expect(messages.every((m) => m.startsWith("T:"))).toBe(true);
  });

  it("produit des messages en français via next-intl", () => {
    const { result } = renderHook(() => useContactSchema(), {
      wrapper: wrapper("fr", frMessages),
    });
    const parsed = result.current.safeParse({ name: "", email: "" });
    expect(parsed.success).toBe(false);
    const messages = parsed.error!.issues.map((i) => i.message).join(" | ");
    expect(messages).toContain("caractères"); // tooShort (fr)
    expect(messages).toContain("requis"); // required (fr)
  });

  it("produit des messages en anglais via next-intl", () => {
    const { result } = renderHook(() => useContactSchema(), {
      wrapper: wrapper("en", enMessages),
    });
    const parsed = result.current.safeParse({ name: "", email: "" });
    expect(parsed.success).toBe(false);
    const messages = parsed.error!.issues.map((i) => i.message).join(" | ");
    expect(messages).toContain("characters"); // tooShort (en)
    expect(messages).toContain("required"); // required (en)
  });
});
