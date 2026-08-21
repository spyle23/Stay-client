import { loadStripe, type Stripe } from "@stripe/stripe-js";

/**
 * Chargement de Stripe.js (story 3.1, FR-12 / AR-14 / PCI SAQ-A).
 *
 * `loadStripe` injecte le script de **js.stripe.com** : c'est ce qui garde les données de carte
 * dans une iframe Stripe, hors de ce site et hors du BFF. Ne jamais le remplacer par une copie
 * auto-hébergée du script — la conformité SAQ-A repose précisément sur ce chargement direct.
 *
 * ⚠️ La clé publique vient de la **réponse d'intent du BFF**, jamais d'une variable
 * d'environnement front : elle appartient au compte encaisseur détenu par le PMS, et la dupliquer
 * ici créerait une seconde vérité qui pourrait diverger sans que rien ne le signale.
 */

/**
 * Une instance Stripe par clé publique, mémoïsée **hors composant**.
 *
 * `loadStripe` déclenche un chargement réseau : l'appeler dans un rendu recréerait l'objet à chaque
 * passe, remonterait le Payment Element et **perdrait la saisie en cours**. Le cache est indexé par
 * clé pour rester correct si un jour deux comptes Stripe coexistaient.
 */
const cache = new Map<string, Promise<Stripe | null>>();

export function getStripe(publishableKey: string): Promise<Stripe | null> {
  const cached = cache.get(publishableKey);
  if (cached) {
    return cached;
  }

  // ⚠️ Une promesse REJETÉE ne doit pas rester en cache : elle y restait pour toute la vie de la
  // page, si bien que le bouton « Réessayer » retombait indéfiniment sur le même rejet — la reprise
  // proposée au voyageur ne pouvait structurellement pas aboutir. Trouvé en revue de code 3.1.
  const promise = loadStripe(publishableKey).catch((error: unknown) => {
    cache.delete(publishableKey);
    throw error;
  });

  cache.set(publishableKey, promise);
  return promise;
}
