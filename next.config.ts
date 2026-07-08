import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// next-intl SANS routing d'URL : le plugin pointe vers la config de requête qui
// résout la locale depuis le cookie `NEXT_LOCALE` (src/i18n/request.ts).
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Conteneurisation : build autonome pour l'image Docker (Story 1.1, AC-1/AC-6)
  output: "standalone",
};

export default withNextIntl(nextConfig);
