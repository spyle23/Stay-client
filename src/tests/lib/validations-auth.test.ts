import { describe, expect, it } from "vitest";

import { buildLoginSchema } from "@/lib/validations/auth";
import { zodFieldValidator } from "@/lib/validations/rhf";

/** Traducteur factice : prouve que TOUS les messages viennent de i18n, aucun texte en dur. */
const t = (key: string, values?: Record<string, string | number>) =>
  values ? `${key}:${JSON.stringify(values)}` : key;

const schema = buildLoginSchema(t);

describe("buildLoginSchema", () => {
  it("accepte des identifiants valides", () => {
    const result = schema.safeParse({
      email: "voyageur@example.com",
      password: "secret123",
    });
    expect(result.success).toBe(true);
  });

  it("exige un email et le valide", () => {
    expect(
      schema.safeParse({ email: "", password: "secret123" }).error?.issues[0]
        ?.message,
    ).toBe("required");
    expect(
      schema.safeParse({ email: "pas-un-email", password: "secret123" }).error
        ?.issues[0]?.message,
    ).toBe("emailInvalid");
  });

  it("n’impose AUCUNE longueur minimale au mot de passe à la connexion", () => {
    // Une contrainte de création appliquée à l'authentification enfermerait définitivement hors
    // de son compte tout utilisateur au mot de passe plus court (compte legacy, import, seed).
    // Le PMS reste seul juge des identifiants.
    const short = schema.safeParse({
      email: "voyageur@example.com",
      password: "court",
    });
    expect(short.success).toBe(true);
  });

  it("exige tout de même un mot de passe non vide", () => {
    const empty = schema.safeParse({
      email: "voyageur@example.com",
      password: "",
    });
    expect(empty.success).toBe(false);
    expect(empty.error?.issues[0]?.message).toBe("required");
  });
});

describe("zodFieldValidator", () => {
  it("renvoie true pour une valeur valide", () => {
    expect(zodFieldValidator(schema.shape.email)("a@b.co")).toBe(true);
  });

  it("renvoie le premier message d’erreur (i18n) sinon", () => {
    expect(zodFieldValidator(schema.shape.email)("bidon")).toBe("emailInvalid");
    expect(zodFieldValidator(schema.shape.password)("")).toBe("required");
  });
});
