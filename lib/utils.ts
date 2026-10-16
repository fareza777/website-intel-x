import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { SCAN_INTERVAL_HOURS } from "./live-market";
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
export function price(value: number | null | undefined, compact = false): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (compact) return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
  const magnitude = Math.abs(value);
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: magnitude >= 1 ? 2 : 4, maximumFractionDigits: 8 }).format(value);
}
export function decimalPlaces(value: number): number {
  const [mantissa, exponent = "0"] = value.toString().toLowerCase().split("e");
  return Math.max(0, Math.min(12, (mantissa.split(".")[1]?.length || 0) - Number(exponent)));
}
export function dollars(value: number | null | undefined, compact = false): string { return value == null || !Number.isFinite(value) ? "—" : value < 0 ? `−$${price(-value, compact)}` : `$${price(value, compact)}`; }
export function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value < 0 ? "−" : ""}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function percent(value: number | null | undefined): string { return value == null || !Number.isFinite(value) ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`; }
export function relativeTime(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not available";
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000));
  return minutes < 1 ? "Just now" : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m ago` : `${Math.floor(minutes / 1440)}d ago`;
}
export function isStale(generatedAt: string | null | undefined, now = Date.now()): boolean {
  const age = now - Date.parse(generatedAt || "");
  return !Number.isFinite(age) || age < -60_000 || age > 2 * SCAN_INTERVAL_HOURS * 3_600_000;
}
