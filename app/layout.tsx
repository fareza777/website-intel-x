import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const sans = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-ui", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-num", display: "swap" });

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://cryptoscanora.top";
const siteDescription = "Real-data crypto market intelligence for disciplined spot research: multi-timeframe signals, transparent risk plans, market structure, and paper trading.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "CryptoScanora — Crypto Market Scanner & Research Terminal",
    template: "%s | CryptoScanora",
  },
  description: siteDescription,
  applicationName: "CryptoScanora",
  keywords: [
    "crypto market scanner",
    "crypto trading research",
    "Binance spot analysis",
    "multi-timeframe crypto signals",
    "crypto paper trading",
    "technical analysis terminal",
  ],
  authors: [{ name: "CryptoScanora" }],
  creator: "CryptoScanora",
  publisher: "CryptoScanora",
  category: "finance",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/",
    siteName: "CryptoScanora",
    title: "CryptoScanora — Advanced Crypto Trading Intelligence",
    description: siteDescription,
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "CryptoScanora crypto research terminal" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "CryptoScanora — Advanced Crypto Trading Intelligence",
    description: siteDescription,
    images: ["/opengraph-image"],
  },
  icons: { icon: "/icon.svg", shortcut: "/icon.svg", apple: "/icon.svg" },
  manifest: "/site.webmanifest",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  ...(process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
    ? { verification: { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION } }
    : {}),
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#070a12" };

const structuredData = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "CryptoScanora",
  url: siteUrl,
  description: siteDescription,
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web",
  browserRequirements: "Requires JavaScript",
  featureList: [
    "Multi-timeframe crypto market scanning",
    "Deterministic entry, stop-loss, and take-profit research plans",
    "Liquidity and market structure analysis",
    "Signal history and paper trading",
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`dark ${sans.variable} ${mono.variable}`}>
      <head>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
