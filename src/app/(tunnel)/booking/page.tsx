import { redirect } from "next/navigation";

/**
 * `/booking` — **redirection** vers la première étape du tunnel, `/booking/recap` (story 2.2).
 *
 * L'architecture place les étapes sous `(tunnel)/booking/{recap,identify,payment,confirmation}`,
 * mais la fiche chambre de la story 1.10 émet déjà des liens `/booking?hotelId=…` : cette route
 * reste donc vivante et **préserve l'intégralité de la query** pour que les liens déjà partagés
 * (ou ouverts dans un onglet) n'atterrissent jamais sur un écran vide.
 *
 * `redirect()` lève : il est appelé hors de tout `try/catch` (cf. docs Next 16).
 */
export default async function BookingEntryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        query.append(key, item);
      }
    } else if (value !== undefined) {
      query.append(key, value);
    }
  }
  const qs = query.toString();
  redirect(qs ? `/booking/recap?${qs}` : "/booking/recap");
}
