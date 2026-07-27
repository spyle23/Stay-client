import type { ZodType } from "zod";

/**
 * Pont **Zod → react-hook-form** sans dépendance supplémentaire (`@hookform/resolvers` n'est
 * pas installé dans ce dépôt).
 *
 * Branché sur l'option `validate` de `register`, il conserve :
 * - Zod comme **source unique** des règles et des messages (i18n via la fabrique + hook) ;
 * - le câblage a11y natif de react-hook-form (focus automatique sur le 1ᵉʳ champ en erreur,
 *   `aria-invalid`, association du message via `aria-describedby`).
 */
export function zodFieldValidator(
  schema: ZodType,
): (value: unknown) => true | string {
  return (value: unknown) => {
    const result = schema.safeParse(value);
    if (result.success) {
      return true;
    }
    // Un seul message par champ : le premier est le plus spécifique (ordre des règles Zod).
    return result.error.issues[0]?.message ?? "";
  };
}
