import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// Test de fumée du scaffold front (Story 1.1) : l'outillage de test, l'alias @,
// le util cn et une primitive shadcn fonctionnent bout en bout.
describe("smoke: scaffold front", () => {
  it("cn fusionne les classes conditionnelles", () => {
    expect(cn("px-2", false && "hidden", "py-1")).toBe("px-2 py-1");
  });

  it("rend une primitive shadcn Button", () => {
    render(<Button>Rechercher</Button>);
    expect(
      screen.getByRole("button", { name: "Rechercher" }),
    ).toBeInTheDocument();
  });
});
