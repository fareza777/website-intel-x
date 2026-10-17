import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "CryptoScanora — Crypto Market Scanner & Research Terminal", description: "Real-data crypto market intelligence. Deterministic spot research, liquidity analysis, transparent signal tracking, and paper trading.", robots: { index: true, follow: true } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0b0d12" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en" className="dark"><body>{children}</body></html>; }
