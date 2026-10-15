import { expect, it } from "vitest";
import { decimalPlaces, dollars, price } from "../lib/utils";
it("preserves executable sub-cent prices instead of rounding research levels to four decimals", () => {
  expect(dollars(1.04877)).toBe("$1.04877");
  expect(price(100.000001)).toBe("100.000001");
  expect(dollars(-12.34567)).toBe("−$12.34567");
});
it("retains exchange precision for non-power-of-ten and scientific tick sizes", () => {
  expect(decimalPlaces(.25)).toBe(2);
  expect(decimalPlaces(1e-8)).toBe(8);
});
