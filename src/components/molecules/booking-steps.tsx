import { CheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

/** Étapes du tunnel, dans l'ordre (UX-DR-7.12 : l'utilisateur sait toujours où il en est). */
const STEPS = ["stay", "identify", "confirmation"] as const;
export type BookingStep = (typeof STEPS)[number];

/**
 * Fil d'étapes du tunnel (design `design-system/screens/checkout.html`).
 *
 * Purement informatif : les étapes ne sont pas cliquables (revenir en arrière se fait par les
 * liens contextuels de chaque écran, jamais par un raccourci qui court-circuiterait une validation).
 * L'étape courante est marquée `aria-current="step"` ; les étapes franchies portent une icône
 * **en plus** de la couleur (UX-DR-5.3 : jamais l'info par la seule couleur).
 */
export function BookingSteps({ current }: { current: BookingStep }) {
  const t = useTranslations("booking");
  const currentIndex = STEPS.indexOf(current);

  return (
    <ol
      data-testid="booking-steps"
      aria-label={t("stepsLabel")}
      className="flex flex-wrap items-center gap-2 text-small"
    >
      {STEPS.map((step, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;
        return (
          <li
            key={step}
            aria-current={active ? "step" : undefined}
            data-step={step}
            data-state={done ? "done" : active ? "active" : "todo"}
            className={cn(
              "inline-flex items-center gap-1.5",
              active
                ? "font-semibold text-foreground"
                : "text-muted-foreground",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "inline-flex size-5 items-center justify-center rounded-full text-caption font-semibold",
                done
                  ? "bg-success-soft text-success"
                  : active
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {done ? <CheckIcon className="size-3" /> : index + 1}
            </span>
            <span>{t(`step_${step}`)}</span>
            {index < STEPS.length - 1 ? (
              <span aria-hidden="true" className="mx-1 text-border">
                ›
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
