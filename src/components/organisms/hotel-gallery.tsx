import { useTranslations } from "next-intl";

import { RemoteImage } from "@/components/atoms/remote-image";
import type { HotelGalleryImage } from "@/services/catalog.service";

/** Nombre de vignettes rendues sous l'image héros — **aligné** sur `CATALOG_GALLERY_MAX_ROOMS`. */
const THUMBNAILS = 5;

/**
 * Galerie de la fiche hôtel (UX-DR-3.3). **Grille** responsive (Décision 2 : pas de carrousel/
 * lightbox au MVP → aucun élément interactif, trivialement accessible clavier ; `alt` sur chaque
 * image). 1ʳᵉ image = « héros » priorisée pour le LCP (NFR-2). Images en `next/image unoptimized`
 * via `RemoteImage` (repli placeholder si aucune image).
 *
 * Le texte alternatif est composé **ici** (i18n) : le BFF n'a pas de locale et un `alt` en dur
 * serait servi en français aux utilisateurs `en`.
 */
export function HotelGallery({
  images,
  hotelName,
}: {
  images: HotelGalleryImage[];
  hotelName: string;
}) {
  const t = useTranslations("hotel");

  const altFor = (image: HotelGalleryImage): string =>
    image.roomNumber
      ? t("galleryAltRoom", { name: hotelName, number: image.roomNumber })
      : t("galleryAltHotel", { name: hotelName });

  if (images.length === 0) {
    return (
      <div data-testid="hotel-gallery">
        <RemoteImage
          src={null}
          alt={t("galleryAltHotel", { name: hotelName })}
          className="aspect-[16/9] w-full rounded-xl"
        />
      </div>
    );
  }

  const [hero, ...rest] = images;
  return (
    <div
      data-testid="hotel-gallery"
      className="grid grid-cols-2 gap-2 sm:grid-cols-5"
    >
      <RemoteImage
        src={hero.url}
        alt={altFor(hero)}
        priority
        sizes="100vw"
        className="col-span-2 aspect-[16/9] w-full rounded-xl sm:col-span-5"
      />
      {rest.slice(0, THUMBNAILS).map((image) => (
        <RemoteImage
          key={image.url}
          src={image.url}
          alt={altFor(image)}
          sizes="(max-width: 640px) 50vw, 20vw"
          className="aspect-[4/3] w-full rounded-lg"
        />
      ))}
    </div>
  );
}
