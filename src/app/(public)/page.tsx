// Placeholder d'accueil (SSR) — sera remplacé par la recherche multi-hôtels
// (Story 1.6). Consomme les tokens du design-system (aucune valeur en dur).
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-display text-foreground">Hotelerie</h1>
      <p className="max-w-md text-body text-muted-foreground">
        Réservez votre séjour en toute confiance. La recherche multi-hôtels
        arrive prochainement.
      </p>
    </main>
  );
}
