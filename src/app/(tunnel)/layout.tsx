import type { ReactNode } from "react";

import { SiteHeader } from "@/components/organisms/site-header";

/**
 * Layout du tunnel de réservation (story 2.2).
 *
 * Reprend le **header léger** des surfaces publiques : sans lui, `/booking/*` serait un cul-de-sac
 * sans navigation, sans sélecteur de langue/devise ni bascule de thème — et l'audit d'accessibilité
 * en mode sombre serait impossible (leçon de la story 2.1, où le groupe `(compte)` avait été livré
 * sans layout). Les providers i18n/thème/devise restent posés une seule fois dans le layout racine.
 *
 * Le fil d'étapes (Séjour · Vos infos · Confirmation) est rendu par chaque page : lui seul connaît
 * l'étape active.
 */
export default function TunnelLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      {children}
    </>
  );
}
