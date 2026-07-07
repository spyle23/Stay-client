"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

/**
 * Fournisseur de thème clair/sombre (next-themes).
 * Utilise `attribute="class"` → pose la classe `.dark` sur <html>, consommée par
 * le variant `@custom-variant dark` de globals.css et l'accent `[data-hotel-theme]`.
 */
export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
