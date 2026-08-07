import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Champ de saisie multiligne (story 2.5, FR-10) — miroir exact d'`Input` pour la bordure, le focus
 * et les états d'erreur, afin qu'un formulaire mêlant les deux reste visuellement homogène.
 *
 * `@base-ui/react` n'expose pas de primitive `Textarea` : on rend le `<textarea>` natif, comme le
 * fait shadcn. C'est suffisant — un textarea n'a ni comportement composite, ni état interne à
 * piloter, contrairement à `Select` ou `Popover`.
 *
 * `resize-y` : le redimensionnement horizontal casserait la grille du tunnel (UX-DR-6.4) ; le
 * vertical, lui, sert vraiment une demande longue. `field-sizing-content` laisse le champ grandir
 * avec le texte là où le navigateur le supporte, sans jamais descendre sous `min-h`.
 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "field-sizing-content min-h-24 w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
