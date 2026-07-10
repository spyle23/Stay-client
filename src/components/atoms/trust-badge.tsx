import {
  BadgeCheckIcon,
  BanIcon,
  CalendarCheckIcon,
  ShieldCheckIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

export type TrustBadgeVariant = "free" | "secure" | "avail" | "norefund";

// Règle d'or : jamais l'info par la couleur seule → toujours icône + texte (UX-DR-5.3/7.6).
const variantStyle: Record<TrustBadgeVariant, string> = {
  free: "bg-success-soft text-success",
  secure: "bg-primary-soft text-primary",
  avail: "bg-success-soft text-success",
  norefund: "bg-warning-soft text-warning",
};

const variantIcon: Record<TrustBadgeVariant, LucideIcon> = {
  free: CalendarCheckIcon,
  secure: ShieldCheckIcon,
  avail: BadgeCheckIcon,
  norefund: BanIcon,
};

/**
 * Signal de confiance (UX-DR-2.8) : annulation gratuite, paiement sécurisé, disponibilité
 * réelle, non-remboursable. Toujours **icône + texte**, contraste ≥ 4,5:1 (tokens soft/AA).
 */
export function TrustBadge({
  variant,
  label,
  className,
}: {
  variant: TrustBadgeVariant;
  label: string;
  className?: string;
}) {
  const Icon = variantIcon[variant];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-caption font-medium",
        variantStyle[variant],
        className,
      )}
      data-trust-badge={variant}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
