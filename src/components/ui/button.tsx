import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // ⚠️ Le survol s'écarte de la couleur du **texte du bouton**, il ne réduit PAS l'opacité.
        //
        // 1ʳᵉ correction : `hover:bg-primary/80` laissait le fond de la page transparaître, et le
        //    blanc tombait à 4,20:1 — sous le seuil AA de 4,5, alors que l'état de repos tient
        //    4,99:1. Le défaut avait échappé aux audits parce qu'`axe` ne mesure que l'état rendu.
        // 2ᵉ correction (revue 2ᵉ passe, F10) : mélanger vers `--foreground` supposait que le texte
        //    du bouton soit de polarité opposée au premier plan de la page. Vrai pour `:root` et
        //    `.dark` — **faux** sous `[data-hotel-theme]`, qui surcharge `--primary` et
        //    `--primary-foreground` mais **pas** `--foreground` (`globals.css`). Avec un accent
        //    hôtel clair à texte foncé, le survol *rapprochait* le fond du texte : 5,91 → 4,82.
        //
        // Conclusion : **toute** variation de luminosité du fond peut réduire le contraste, le sens
        // dépendant d'une couleur de texte que le CSS ne peut pas interroger (`color-contrast()`
        // reste trop peu supporté). L'affordance de survol ne touche donc plus au couple
        // fond/texte : elle passe par l'**élévation**, qui est contraste-neutre par construction et
        // tient sous n'importe quelle paire injectée par un hôtelier. Même registre que le
        // `active:translate-y-px` déjà porté par la base.
        default:
          "bg-primary text-primary-foreground shadow-soft hover:shadow-elevated",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
