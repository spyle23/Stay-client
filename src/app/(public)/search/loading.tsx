import { Skeleton } from "@/components/ui/skeleton";

// Skeleton de transition de route (Story 1.6). Le chargement des données lui-même
// affiche ses propres skeletons de cartes dans l'île client `SearchResults`.
export default function SearchLoading() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6">
      <Skeleton className="h-24 w-full rounded-xl" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton
            key={`route-skeleton-${index}`}
            className="h-72 w-full rounded-xl"
          />
        ))}
      </div>
    </main>
  );
}
