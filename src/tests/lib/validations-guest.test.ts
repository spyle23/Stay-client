import { describe, expect, it } from "vitest";

import { buildGuestCheckoutSchema } from "@/lib/validations/auth";

/** Traducteur factice : prouve que TOUS les messages viennent de i18n, aucun texte en dur. */
const t = (key: string, values?: Record<string, string | number>) =>
  values ? `${key}:${JSON.stringify(values)}` : key;

const schema = buildGuestCheckoutSchema(t);

const VALID = {
  email: "invite@example.com",
  firstName: "Hery",
  lastName: "Rakoto",
  phone: "+261 34 00 000 00",
};

function messageFor(field: keyof typeof VALID, value: unknown) {
  const result = schema.safeParse({ ...VALID, [field]: value });
  return result.error?.issues[0]?.message;
}

describe("buildGuestCheckoutSchema (story 2.3)", () => {
  it("accepte des coordonnées valides", () => {
    expect(schema.safeParse(VALID).success).toBe(true);
  });

  it.each([
    ["+261340000000", "international compact"],
    ["+33 6 12 34 56 78", "espacé"],
    ["0341234567", "national"],
    ["(033) 12-345-67", "parenthèses et tirets"],
  ])("accepte le numéro %s (%s)", (phone) => {
    expect(schema.safeParse({ ...VALID, phone }).success).toBe(true);
  });

  it("exige chaque champ", () => {
    expect(messageFor("email", "")).toBe("required");
    expect(messageFor("firstName", "")).toBe("required");
    expect(messageFor("lastName", "")).toBe("required");
    expect(messageFor("phone", "")).toBe("required");
  });

  it("valide le format de l’email et du téléphone", () => {
    expect(messageFor("email", "pas-un-email")).toBe("emailInvalid");
    expect(messageFor("phone", "appelez-moi")).toBe("phoneInvalid");
    expect(messageFor("phone", "12345")).toBe("phoneInvalid"); // < 6 chiffres
  });

  // Bornes en miroir du PMS (`RegisterCustomerRequestValidator`) : les faire respecter ici évite
  // un aller-retour dont le 400 serait indiscernable d'une collision d'email.
  it("applique les bornes de longueur du PMS", () => {
    expect(messageFor("email", `${"x".repeat(250)}@example.com`)).toBe(
      'tooLong:{"max":255}',
    );
    expect(messageFor("firstName", "x".repeat(101))).toBe(
      'tooLong:{"max":100}',
    );
    expect(messageFor("lastName", "x".repeat(101))).toBe('tooLong:{"max":100}');
    expect(messageFor("phone", `+${"1".repeat(20)}`)).toBe(
      'tooLong:{"max":20}',
    );
  });

  it("nettoie les espaces superflus avant validation", () => {
    const parsed = schema.safeParse({
      ...VALID,
      firstName: "  Hery  ",
      email: "  Invite@Example.COM ",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.firstName).toBe("Hery");
    // L'email part en minuscules : le PMS compare l'email brut à la connexion.
    expect(parsed.data?.email).toBe("invite@example.com");
  });
});
