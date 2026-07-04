import { NextResponse } from "next/server";

// Squelette (Story 1.1). La garde des routes (compte) sera implémentée en Story 2.1
// (elle utilisera alors le NextRequest entrant pour vérifier la session).
// NB Next 16 : la convention "middleware" est dépréciée → renommée "proxy".
export function proxy() {
  return NextResponse.next();
}

export const config = {
  matcher: ["/account/:path*", "/reservations/:path*", "/invoices/:path*"],
};
