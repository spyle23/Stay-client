import { EventEmitter } from "node:events";
import type { Page } from "@playwright/test";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Helpers de navigation du smoke (#148, AC-4) : la synchronisation sur les préchargements RSC
 * ajoutée par #125 est retirée. Le clic part dès que l'élément est visible, sans écoute réseau ni
 * attente, puis l'URL de destination est exigée.
 */
const FRONT = "http://localhost:3003";

const calls: string[] = [];

vi.mock("@playwright/test", () => ({
  expect: (target: { kind?: string }, message?: string) => ({
    toBeVisible: async (opts: { timeout: number }) => {
      calls.push(
        `visible:${target.kind}:${opts.timeout}${message ? `:${message}` : ""}`,
      );
    },
    toHaveURL: async (url: RegExp) => {
      calls.push(`url:${url.source}`);
    },
  }),
}));

class CardPage extends EventEmitter {
  reloads = 0;
  gotos = 0;
  constructor(private current = `${FRONT}/search?city=Paris`) {
    super();
  }
  url(): string {
    return this.current;
  }
  getByTestId(id: string) {
    return {
      nth: (index: number) => ({
        kind: `${id}#${index}`,
        click: async () => {
          calls.push(`click:${id}#${index}`);
        },
      }),
    };
  }
  async reload() {
    this.reloads += 1;
  }
  async goto() {
    this.gotos += 1;
  }
}

describe("openHotelCard", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("clique dès que la carte est visible, puis exige la fiche, sans écoute des requêtes", async () => {
    const { openHotelCard } =
      await import("../../../e2e/smoke/helpers/navigation");
    const page = new CardPage();
    const on = vi.spyOn(page, "on");

    await openHotelCard(page as unknown as Page, 2);

    expect(calls).toEqual([
      "visible:hotel-card#2:20000",
      "click:hotel-card#2",
      "url:\\/hotels\\/",
    ]);
    expect(on).not.toHaveBeenCalled();
    expect(page.reloads).toBe(0);
    expect(page.gotos).toBe(0);
  });

  it("n'attend aucun calme réseau : rend la main sans avancer le temps", async () => {
    vi.useFakeTimers();
    try {
      const { openHotelCard } =
        await import("../../../e2e/smoke/helpers/navigation");
      let settled = false;
      void openHotelCard(new CardPage() as unknown as Page).then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("openRoomCard", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("clique dès que la chambre est visible et nomme la fiche hôtel si elle manque", async () => {
    const { openRoomCard } =
      await import("../../../e2e/smoke/helpers/navigation");
    const hotelUrl = `${FRONT}/hotels/hotel-le-parisien-1a2b?checkInDate=2027-05-20`;
    const page = new CardPage(hotelUrl);
    const on = vi.spyOn(page, "on");

    await openRoomCard(page as unknown as Page);

    expect(calls).toEqual([
      `visible:room-card-cta#0:20000:aucune chambre proposée sur ${hotelUrl}`,
      "click:room-card-cta#0",
      "url:\\/rooms\\/",
    ]);
    expect(on).not.toHaveBeenCalled();
  });
});
