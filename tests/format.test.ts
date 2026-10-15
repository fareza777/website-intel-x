import { expect, it } from "vitest";
import { decimalPlaces, dollars, price, isStale } from "../lib/utils";
it("preserves executable sub-cent prices instead of rounding research levels to four decimals", () => {
  expect(dollars(1.04877)).toBe("$1.04877");
  expect(price(100.000001)).toBe("100.000001");
  expect(dollars(-12.34567)).toBe("−$12.34567");
});
it("retains exchange precision for non-power-of-ten and scientific tick sizes", () => {
  expect(decimalPlaces(.25)).toBe(2);
  expect(decimalPlaces(1e-8)).toBe(8);
});
it("withholds invalid dates and marks missed hourly publications stale after two hours", () => {
  const now = Date.parse("2026-10-15T16:30:00Z");
  expect(isStale("2026-10-15T15:17:00Z", now)).toBe(false);
  expect(isStale("2026-10-15T14:29:59Z", now)).toBe(true);
  expect(isStale("invalid", now)).toBe(true);
  expect(isStale("2026-10-15T16:35:00Z", now)).toBe(true);
});
