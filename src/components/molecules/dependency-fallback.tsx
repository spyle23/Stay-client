import { InfoIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Repli de dépendance PMS (UX-DR-2.16, UX-DR-4.6, UX-DR-7.14).
 *
 * Certaines features dépendent d'évolutions du PMS non encore livrées (D2 politique d'annulation,
 * D7 taxe/facture ; D6 panier combiné a été livrée par la story 2.0). Tant qu'elles manquent, l'interface doit rester **honnête et
 * calme** : un bandeau discret qui explique, jamais une erreur brute, jamais un champ vide, et
 * surtout jamais une valeur inventée pour « remplir » l'écran.
 *
 * Primitive volontairement générique : `dependency` n'est qu'un marqueur de traçabilité
 * (`data-dependency`) pour les tests et le diagnostic — il ne change pas le rendu.
 */
export function DependencyFallback({
  dependency,
  children,
  className,
  "data-testid": dataTestId,
}: {
  /** Identifiant de la dépendance PMS concernée (`D2`, `D7`, `D10`). */
  dependency: string;
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}) {
  return (
    <div
      role="note"
      data-testid={dataTestId ?? "dependency-fallback"}
      data-dependency={dependency}
      className={cn(
        "flex items-start gap-2 rounded-lg bg-muted p-3 text-small text-muted-foreground",
        className,
      )}
    >
      <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}
