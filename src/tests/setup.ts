// Setup Vitest — matchers DOM de Testing Library.
import "@testing-library/jest-dom";
import { vi } from "vitest";

// next-themes lit `window.matchMedia` (prefers-color-scheme) : jsdom ne l'implémente
// pas → stub minimal pour éviter un crash dans les tests de thème.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// Les primitives Base UI (menus/sélecteurs) observent la taille de l'ancre :
// jsdom n'implémente pas ResizeObserver → stub minimal (rendu des sélecteurs
// langue/devise de la Story 1.5).
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
