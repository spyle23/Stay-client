import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { CurrencyProvider } from "@/contexts/currency-context";
import { Toaster } from "@/components/ui/sonner";
import {
  CURRENCY_COOKIE,
  defaultCurrencyForLocale,
  isCurrency,
  type Currency,
} from "@/lib/currency";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Hotelerie",
  description: "Réservez votre séjour en toute confiance.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  // Devise de travail initiale : cookie si valide, sinon défaut région/langue.
  // Lue côté serveur → hydratation SSR cohérente (aucun mismatch client).
  const cookieStore = await cookies();
  const currencyCookie = cookieStore.get(CURRENCY_COOKIE)?.value;
  const initialCurrency: Currency = isCurrency(currencyCookie)
    ? currencyCookie
    : defaultCurrencyForLocale(locale);

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider
            attribute="class"
            defaultTheme="light"
            enableSystem
            disableTransitionOnChange
          >
            <CurrencyProvider initialCurrency={initialCurrency}>
              {children}
              <Toaster />
            </CurrencyProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
