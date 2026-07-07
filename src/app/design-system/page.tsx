import type { Metadata } from "next";

import { DesignSystemShowcase } from "@/components/organisms/design-system-showcase";

// Page interne (non indexée) : banc d'essai des tokens/primitives/thème,
// cible des tests e2e/axe et de la vérification navigateur (Phase 3).
export const metadata: Metadata = {
  title: "Design System — interne",
  robots: { index: false, follow: false },
};

export default function DesignSystemPage() {
  return <DesignSystemShowcase />;
}
