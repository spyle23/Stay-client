import { Skeleton } from "@/components/ui/skeleton";

// Skeleton de transition de route de la fiche hôtel (Story 1.9). Le rendu SSR étant dynamique
// (dates en contexte), ce squelette couvre l'attente : en-tête, galerie et liste de chambres.
export default function HotelLoading() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-6">
      <Skeleton className="h-9 w-1/2 rounded-lg" />
      <Skeleton className="aspect-[16/9] w-full rounded-xl" />
      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton
              key={`room-skeleton-${index}`}
              className="h-28 w-full rounded-xl"
            />
          ))}
        </div>
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    </main>
  );
}
