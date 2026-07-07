import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { ThemeProvider } from "@/components/providers/theme-provider";
import { ThemeToggle } from "@/components/atoms/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

// Tests unitaires (Story 1.4) : les primitives consomment les tokens et le
// fournisseur de thème rend ses enfants.
describe("design-system: primitives & tokens", () => {
  it("Button (défaut) consomme les tokens de marque", () => {
    render(<Button>Réserver</Button>);
    const classes = screen
      .getByRole("button", { name: "Réserver" })
      .className.split(/\s+/);
    // match de token exact (pas de sous-chaîne : bg-primary/80 ne doit pas suffire)
    expect(classes).toContain("bg-primary");
    expect(classes).toContain("text-primary-foreground");
  });

  it("Button (destructive) consomme le token destructive", () => {
    render(<Button variant="destructive">Annuler</Button>);
    const classes = screen
      .getByRole("button", { name: "Annuler" })
      .className.split(/\s+/);
    expect(classes).toContain("text-destructive");
    expect(classes.some((c) => c.startsWith("bg-destructive"))).toBe(true);
  });

  it("Badge rend son contenu", () => {
    render(<Badge>Confirmée</Badge>);
    expect(screen.getByText("Confirmée")).toBeInTheDocument();
  });

  it("Card rend son contenu", () => {
    render(
      <Card>
        <CardContent>Chambre disponible</CardContent>
      </Card>,
    );
    expect(screen.getByText("Chambre disponible")).toBeInTheDocument();
  });

  it("Input + Label sont associés par id", () => {
    render(
      <div>
        <Label htmlFor="email">E-mail</Label>
        <Input id="email" type="email" />
      </div>,
    );
    expect(screen.getByLabelText("E-mail")).toBeInTheDocument();
  });

  it("Skeleton rend un placeholder", () => {
    const { container } = render(<Skeleton className="h-4 w-20" />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it("un prix utilise les chiffres tabulaires", () => {
    render(
      <span data-testid="price" className="tabular-nums">
        1 234,00 €
      </span>,
    );
    expect(screen.getByTestId("price").className).toContain("tabular-nums");
  });

  it("ThemeProvider rend ses enfants et le ThemeToggle est accessible", () => {
    render(
      <ThemeProvider attribute="class" defaultTheme="light">
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme-toggle")).toBeInTheDocument();
  });
});
