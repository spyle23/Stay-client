"use client";

import { useState } from "react";
import Image from "next/image";
import { Building2Icon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Image distante (PMS `/files`) avec **repli placeholder** propre. Pattern posé en 1.6
 * (`HotelThumbnail`) et **partagé** par la carte hôtel et la galerie (story 1.9) :
 * `next/image` en `unoptimized` — les URLs proviennent d'hôtes arbitraires → pas de config
 * `remotePatterns` requise, pas d'avertissement de loader. La passe d'optimisation/CDN (NFR-13)
 * relève d'Epic 6. Sur `src` absent OU chargement en échec → icône neutre (jamais d'image cassée).
 *
 * ⚠️ L'échec est mémorisé **par URL** (`failedSrc`), pas par un booléen : en navigation client, le
 * composant est réutilisé au même emplacement de l'arbre React ; un booléen ferait hériter à
 * l'hôtel suivant l'échec du précédent (placeholder affiché alors que son image est valide).
 */
export function RemoteImage({
  src,
  alt,
  className,
  sizes,
  priority = false,
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const errored = src != null && failedSrc === src;

  return (
    <div className={cn("relative overflow-hidden bg-muted", className)}>
      {src && !errored ? (
        <Image
          src={src}
          alt={alt}
          fill
          unoptimized
          priority={priority}
          sizes={sizes}
          className="object-cover"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center text-muted-foreground"
          aria-hidden="true"
        >
          <Building2Icon className="size-8" />
        </div>
      )}
    </div>
  );
}
