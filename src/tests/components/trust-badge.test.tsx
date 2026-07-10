import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { TrustBadge } from "@/components/atoms/trust-badge";

describe("TrustBadge", () => {
  afterEach(cleanup);

  it("rend toujours icône + texte (jamais la couleur seule)", () => {
    render(<TrustBadge variant="avail" label="Disponibilité réelle" />);
    const badge = document.querySelector('[data-trust-badge="avail"]');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain("Disponibilité réelle");
    expect(badge?.querySelector("svg")).not.toBeNull();
  });

  it("expose la variante en attribut de données", () => {
    render(<TrustBadge variant="free" label="Annulation gratuite" />);
    expect(document.querySelector('[data-trust-badge="free"]')).not.toBeNull();
  });
});
