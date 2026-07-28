import { Skeleton } from "@/components/ui/skeleton";

// Skeleton de transition de route (story 2.2). Le chargement du devis lui-même affiche ses
// propres skeletons dans l'île client `BookingRecap`.
export default function BookingRecapLoading() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6">
      <Skeleton className="h-6 w-64 rounded-lg" />
      <Skeleton className="h-9 w-80 rounded-lg" />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    </main>
  );
}
