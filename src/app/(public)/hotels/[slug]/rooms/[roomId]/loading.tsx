import { Skeleton } from "@/components/ui/skeleton";

// Skeleton de transition de route de la fiche chambre (Story 1.10). Le rendu SSR étant dynamique
// (dates en contexte), ce squelette couvre l'attente : en-tête, galerie et bloc de réservation.
export default function RoomLoading() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6">
      <Skeleton className="h-5 w-32 rounded-lg" />
      <Skeleton className="h-9 w-1/2 rounded-lg" />
      <Skeleton className="aspect-[16/9] w-full rounded-xl" />
      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton
              key={`room-detail-skeleton-${index}`}
              className="h-20 w-full rounded-xl"
            />
          ))}
        </div>
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    </main>
  );
}
