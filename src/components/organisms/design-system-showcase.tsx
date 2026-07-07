"use client";

import type { CSSProperties } from "react";
import {
  BadgeCheckIcon,
  CheckCircle2Icon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  XCircleIcon,
} from "lucide-react";

import { ThemeToggle } from "@/components/atoms/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

/** Style d'injection du branding hôtel (simule l'injection PMS de la Phase 3). */
const hotelAccent = {
  "--hotel-primary": "#7c3aed",
  "--hotel-primary-soft": "#efe7fd",
} as CSSProperties;

/**
 * Vitrine du design-system (interne, non indexée) — sert de banc d'essai a11y
 * (axe-core), de cible aux tests e2e et de vérification navigateur (Phase 3).
 * Tout consomme les tokens ; aucune valeur en dur (hors injection `--hotel-*`).
 */
export function DesignSystemShowcase() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-10 p-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-display text-foreground">Design System</h1>
          <p className="text-body text-muted-foreground">
            Tokens, primitives &amp; thème — Application Cliente.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <section aria-labelledby="typo-title" className="flex flex-col gap-3">
        <h2 id="typo-title" className="text-h2 text-foreground">
          Typographie
        </h2>
        <p className="text-display text-foreground">Display</p>
        <p className="text-h1 text-foreground">Titre H1</p>
        <p className="text-h2 text-foreground">Titre H2</p>
        <p className="text-h3 text-foreground">Titre H3</p>
        <p className="text-body text-foreground">
          Corps de texte — longueur de ligne confortable pour la lecture.
        </p>
        <p className="text-small text-muted-foreground">
          Texte secondaire (small)
        </p>
        <p className="text-caption text-muted-foreground uppercase">
          Caption / label
        </p>
      </section>

      <section aria-labelledby="btn-title" className="flex flex-col gap-3">
        <h2 id="btn-title" className="text-h2 text-foreground">
          Boutons
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <Button data-testid="neutral-primary">Réserver</Button>
          <Button variant="secondary">Secondaire</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Annuler</Button>
          <Button variant="link">Lien</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="default">Default</Button>
          <Button size="lg">Large</Button>
        </div>
      </section>

      <section aria-labelledby="badge-title" className="flex flex-col gap-3">
        <h2 id="badge-title" className="text-h2 text-foreground">
          Badges &amp; états (couleur + icône + texte)
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <Badge>Défaut</Badge>
          <Badge variant="secondary">Secondaire</Badge>
          <Badge variant="outline">Outline</Badge>
          <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-small font-medium text-success">
            <CheckCircle2Icon className="size-3.5" aria-hidden="true" />
            Confirmée
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-small font-medium text-warning">
            <TriangleAlertIcon className="size-3.5" aria-hidden="true" />
            Non-remboursable
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-destructive-soft px-2 py-0.5 text-small font-medium text-destructive">
            <XCircleIcon className="size-3.5" aria-hidden="true" />
            Refusé
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-small font-medium text-primary-foreground">
            <ShieldCheckIcon className="size-3.5" aria-hidden="true" />
            Paiement sécurisé
          </span>
        </div>
      </section>

      <section aria-labelledby="price-title" className="flex flex-col gap-3">
        <h2 id="price-title" className="text-h2 text-foreground">
          Prix (chiffres tabulaires)
        </h2>
        <p
          data-testid="price-tag"
          className="text-h1 font-bold tabular-nums text-foreground"
        >
          1 234,00 €
        </p>
      </section>

      <section
        aria-labelledby="form-title"
        className="flex max-w-sm flex-col gap-3"
      >
        <h2 id="form-title" className="text-h2 text-foreground">
          Formulaire
        </h2>
        <div className="flex flex-col gap-2">
          <Label htmlFor="email-demo">Adresse e-mail</Label>
          <Input
            id="email-demo"
            type="email"
            placeholder="vous@exemple.com"
            autoComplete="email"
          />
        </div>
      </section>

      <section aria-labelledby="card-title" className="flex flex-col gap-3">
        <h2 id="card-title" className="text-h2 text-foreground">
          Carte &amp; skeleton
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Hôtel Sérénité</CardTitle>
              <CardDescription>Paris, France · ★★★★</CardDescription>
            </CardHeader>
            <CardContent className="text-body text-muted-foreground">
              Chambre disponible pour vos dates.
            </CardContent>
            <CardFooter className="justify-between">
              <span className="text-h3 font-bold tabular-nums text-foreground">
                320,00 €
              </span>
              <Button size="sm">Réserver</Button>
            </CardFooter>
          </Card>
          <Card aria-hidden="true">
            <CardHeader className="gap-2">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </CardContent>
          </Card>
        </div>
      </section>

      <section aria-labelledby="accent-title" className="flex flex-col gap-3">
        <h2 id="accent-title" className="text-h2 text-foreground">
          Accent par hôtel
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div
            data-testid="hotel-accent"
            data-hotel-theme
            style={hotelAccent}
            className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-4"
          >
            <p className="text-small text-muted-foreground">
              Surface hôtel (accent injecté)
            </p>
            <Button data-testid="accent-primary">
              <BadgeCheckIcon aria-hidden="true" />
              Réserver
            </Button>
            <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-small font-medium text-primary-foreground">
              Accent hôtel
            </span>
          </div>
          <div className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-4">
            <p className="text-small text-muted-foreground">
              Chrome neutre (marque par défaut)
            </p>
            <Button>
              <BadgeCheckIcon aria-hidden="true" />
              Réserver
            </Button>
            <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-small font-medium text-primary-foreground">
              Marque
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}
