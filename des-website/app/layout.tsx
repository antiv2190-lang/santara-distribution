import type { Metadata } from "next";
import { Space_Grotesk, Inter } from "next/font/google";
import "./globals.css";

const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const body = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "DES — Diawara Énergies | Solaire, Stockage & Transformateurs",
  description:
    "Diawara Énergies S.A.S. (DES) conçoit, finance et déploie des infrastructures énergétiques de premier plan — solaire photovoltaïque, stockage par batteries lithium et transformateurs électriques — à travers la région AES en Afrique de l'Ouest.",
  keywords: [
    "énergie solaire Afrique de l'Ouest",
    "stockage batteries lithium",
    "transformateurs électriques",
    "AES Mali Burkina Niger",
    "Diawara Énergies",
  ],
  openGraph: {
    title: "DES — Diawara Énergies",
    description:
      "Infrastructures énergétiques de premier plan pour la région AES : solaire, stockage lithium, transformateurs.",
    type: "website",
    locale: "fr_FR",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" className={`${display.variable} ${body.variable}`}>
      <body className="font-body antialiased selection:bg-solar-500/30">
        {children}
      </body>
    </html>
  );
}
