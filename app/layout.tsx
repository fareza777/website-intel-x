import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
const sans = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-ui", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-num", display: "swap" });
export const metadata: Metadata = { title: "CryptoScanora — Crypto Market Scanner & Research Terminal", description: "Real-data crypto market intelligence. Deterministic spot research, liquidity analysis, transparent signal tracking, and paper trading.", robots: { index: true, follow: true } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#070a12" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en" className={`dark ${sans.variable} ${mono.variable}`}><body>{children}</body></html>; }
