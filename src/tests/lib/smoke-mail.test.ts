// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAIL_CATCHER_URL,
  extractLinks,
  lastMail,
  mailCatcherUrl,
  pickLatest,
  type MailpitSummary,
} from "../../../e2e/smoke/helpers/mail";

/**
 * spyle23/hotelerie#109 — lecture du capteur SMTP de la Phase 3 (Mailpit, #99) par le smoke cliente.
 * AC-1 : dernier e-mail du destinataire et premier lien correspondant à `match`, en sondant l'API ;
 * AC-3 : extraction du lien, destinataire sans e-mail = erreur explicite après le délai.
 */
const BASE = "http://catcher.test:8025";

interface FakeMessage extends MailpitSummary {
  Text?: string;
  HTML?: string;
}

/**
 * Faux capteur : `inbox()` rend la boîte au moment de chaque sondage (elle peut se remplir en cours
 * de route, comme un envoi asynchrone par Hangfire). Les URL demandées sont notées.
 */
function fakeCatcher(inbox: () => FakeMessage[]) {
  const calls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const list = /\/api\/v1\/messages(\?.*)?$/.exec(url);
    if (list) {
      const messages = inbox().map(({ ID, To, Subject, Created }) => ({
        ID,
        To,
        Subject,
        Created,
      }));
      return new Response(JSON.stringify({ messages, total: messages.length }));
    }
    const one = /\/api\/v1\/message\/([^/?]+)$/.exec(url);
    const found = one
      ? inbox().find((m) => m.ID === decodeURIComponent(one[1]))
      : undefined;
    if (!found) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(found));
  }) as typeof fetch;
  return { fetcher, calls };
}

const mail = (over: Partial<FakeMessage> & { ID: string }): FakeMessage => ({
  To: [{ Address: "voyageur@example.com", Name: "Hery Rakoto" }],
  Subject: "Votre demande de réservation chez Hôtel Test",
  Created: "2026-10-11T10:00:00.000Z",
  Text: "Bonjour",
  HTML: "",
  ...over,
});

describe("mailCatcherUrl", () => {
  it("rend http://localhost:8025 par défaut", () => {
    expect(DEFAULT_MAIL_CATCHER_URL).toBe("http://localhost:8025");
    expect(mailCatcherUrl({})).toBe("http://localhost:8025");
    expect(mailCatcherUrl({ MAIL_CATCHER_URL: "  " })).toBe(
      "http://localhost:8025",
    );
  });

  it("lit MAIL_CATCHER_URL, sans barre oblique finale", () => {
    expect(mailCatcherUrl({ MAIL_CATCHER_URL: "http://127.0.0.1:9025/" })).toBe(
      "http://127.0.0.1:9025",
    );
  });

  it("suit le port HTTP du capteur (MAIL_CATCHER_HTTP_PORT) à défaut d'URL", () => {
    expect(mailCatcherUrl({ MAIL_CATCHER_HTTP_PORT: "8125" })).toBe(
      "http://localhost:8125",
    );
    expect(
      mailCatcherUrl({
        MAIL_CATCHER_URL: "http://mail.test",
        MAIL_CATCHER_HTTP_PORT: "8125",
      }),
    ).toBe("http://mail.test");
  });
});

describe("pickLatest", () => {
  const list: MailpitSummary[] = [
    mail({ ID: "old", Created: "2026-10-11T10:00:00Z" }),
    mail({ ID: "new", Created: "2026-10-11T10:05:00Z" }),
    mail({
      ID: "other",
      Created: "2026-10-11T10:10:00Z",
      To: [{ Address: "autre@example.com" }],
    }),
  ];

  it("rend le plus récent du destinataire, casse ignorée", () => {
    expect(pickLatest(list, "VOYAGEUR@example.com")?.ID).toBe("new");
  });

  it("ignore les e-mails antérieurs à `since`", () => {
    expect(
      pickLatest(list, "voyageur@example.com", "2026-10-11T10:06:00Z"),
    ).toBeNull();
    expect(
      pickLatest(list, "voyageur@example.com", new Date("2026-10-11T10:01:00Z"))
        ?.ID,
    ).toBe("new");
  });

  it("rend null sans e-mail pour ce destinataire (To absent compris)", () => {
    expect(pickLatest(list, "inconnu@example.com")).toBeNull();
    expect(
      pickLatest(
        [{ ID: "x", Created: "2026-10-11T10:00:00Z", To: null }],
        "a@b.c",
      ),
    ).toBeNull();
  });
});

describe("extractLinks (AC-3)", () => {
  it("prend les liens du texte, puis du HTML (entités décodées), sans doublon", () => {
    const links = extractLinks({
      Text: "Ouvrir https://stay.test/booking/payment?reservationId=1. Merci",
      HTML: '<a href="https://stay.test/reset?token=a&amp;email=b&#x3D;c">ici</a> https://stay.test/booking/payment?reservationId=1',
    });
    expect(links).toEqual([
      "https://stay.test/booking/payment?reservationId=1",
      "https://stay.test/reset?token=a&email=b=c",
    ]);
  });

  it("filtre par `match` (texte ou RegExp, même globale)", () => {
    const message = {
      Text: "https://stay.test/a https://stay.test/reset?token=1",
    };
    expect(extractLinks(message, "reset")).toEqual([
      "https://stay.test/reset?token=1",
    ]);
    const re = /reset/g;
    expect(extractLinks(message, re)).toHaveLength(1);
    expect(extractLinks(message, re)).toHaveLength(1);
    expect(extractLinks(message, /introuvable/)).toEqual([]);
  });

  it("ignore les liens non http(s) du HTML et rend [] sans corps", () => {
    expect(extractLinks({ HTML: '<a href="mailto:x@y.z">m</a>' })).toEqual([]);
    expect(extractLinks({})).toEqual([]);
  });
});

describe("lastMail (AC-1)", () => {
  it("rend le dernier e-mail du destinataire : sujet, texte et premier lien correspondant", async () => {
    const { fetcher, calls } = fakeCatcher(() => [
      mail({
        ID: "m1",
        Created: "2026-10-11T10:00:00Z",
        Text: "ancien https://stay.test/old",
      }),
      mail({
        ID: "m2",
        Created: "2026-10-11T10:01:00Z",
        Text: "Référence RES-20261011-ABCDE https://stay.test/a https://stay.test/booking/x",
        HTML: "<p>html</p>",
      }),
    ]);

    const got = await lastMail({
      to: "Voyageur@Example.com",
      match: /booking/,
      baseUrl: `${BASE}/`,
      fetch: fetcher,
      timeoutMs: 1_000,
    });

    expect(got).toMatchObject({
      id: "m2",
      to: ["voyageur@example.com"],
      subject: "Votre demande de réservation chez Hôtel Test",
      text: expect.stringContaining("RES-20261011-ABCDE"),
      html: "<p>html</p>",
      link: "https://stay.test/booking/x",
      links: ["https://stay.test/booking/x"],
    });
    expect(calls[0]).toMatch(/^http:\/\/catcher\.test:8025\/api\/v1\/messages/);
    expect(calls).toContain(`${BASE}/api/v1/message/m2`);
  });

  it("sans `match`, rend le premier lien ; sans lien, link vaut null", async () => {
    const { fetcher } = fakeCatcher(() => [
      mail({ ID: "m1", Text: "https://stay.test/a puis https://stay.test/b" }),
    ]);
    const first = await lastMail({
      to: "voyageur@example.com",
      baseUrl: BASE,
      fetch: fetcher,
    });
    expect(first.link).toBe("https://stay.test/a");

    const none = await lastMail({
      to: "voyageur@example.com",
      match: "introuvable",
      baseUrl: BASE,
      fetch: fetcher,
    });
    expect(none.link).toBeNull();
    expect(none.links).toEqual([]);
  });

  it("sonde jusqu'à l'arrivée de l'e-mail (envoi asynchrone)", async () => {
    let polls = 0;
    const { fetcher } = fakeCatcher(() => {
      polls += 1;
      return polls < 3 ? [] : [mail({ ID: "late" })];
    });
    const got = await lastMail({
      to: "voyageur@example.com",
      baseUrl: BASE,
      fetch: fetcher,
      timeoutMs: 2_000,
      intervalMs: 5,
    });
    expect(got.id).toBe("late");
    expect(polls).toBeGreaterThanOrEqual(3);
  });

  it("AC-3 : destinataire sans e-mail = erreur explicite après le délai", async () => {
    const { fetcher, calls } = fakeCatcher(() => [
      mail({ ID: "m1", To: [{ Address: "autre@example.com" }] }),
    ]);
    const started = Date.now();
    await expect(
      lastMail({
        to: "absent@example.com",
        baseUrl: BASE,
        fetch: fetcher,
        timeoutMs: 60,
        intervalMs: 10,
      }),
    ).rejects.toThrow(
      /Aucun e-mail pour absent@example\.com .*http:\/\/catcher\.test:8025.* 60 ms/,
    );
    expect(Date.now() - started).toBeGreaterThanOrEqual(60);
    expect(calls.length).toBeGreaterThan(1);
  });

  it("un e-mail antérieur à `since` ne compte pas", async () => {
    const { fetcher } = fakeCatcher(() => [
      mail({ ID: "old", Created: "2026-10-11T10:00:00Z" }),
    ]);
    await expect(
      lastMail({
        to: "voyageur@example.com",
        since: "2026-10-11T11:00:00Z",
        baseUrl: BASE,
        fetch: fetcher,
        timeoutMs: 30,
        intervalMs: 10,
      }),
    ).rejects.toThrow(/Aucun e-mail pour voyageur@example\.com/);
  });

  it("capteur injoignable : erreur qui le nomme, après le délai", async () => {
    const fetcher = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(
      lastMail({
        to: "voyageur@example.com",
        baseUrl: BASE,
        fetch: fetcher,
        timeoutMs: 30,
        intervalMs: 10,
      }),
    ).rejects.toThrow(
      /capteur SMTP injoignable sur http:\/\/catcher\.test:8025.*fetch failed/,
    );
  });

  it("réponse HTTP en erreur du capteur : échec immédiat, sans attendre le délai", async () => {
    const fetcher = (async () =>
      new Response("boom", { status: 500 })) as typeof fetch;
    const started = Date.now();
    await expect(
      lastMail({
        to: "voyageur@example.com",
        baseUrl: BASE,
        fetch: fetcher,
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow(/HTTP 500/);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("refuse un destinataire vide", async () => {
    const { fetcher } = fakeCatcher(() => []);
    await expect(
      lastMail({ to: "  ", baseUrl: BASE, fetch: fetcher }),
    ).rejects.toThrow(/destinataire/);
  });
});
