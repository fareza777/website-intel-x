import { describe, expect, it } from "vitest";
import { dollars, money, percent, relativeTime } from "../lib/utils";
describe("readable account amounts and unavailable values", () => {
  it("formats account money to cents without rounding market price precision", () => {
    expect(money(9496.83194752)).toBe("$9,496.83");
    expect(money(-12.345)).toBe("−$12.35");
    expect(dollars(.00001234)).toBe("$0.00001234");
  });
  it("withholds nonfinite values and invalid timestamps", () => {
    for (const value of [NaN, Infinity, -Infinity]) { expect(money(value)).toBe("—"); expect(dollars(value)).toBe("—"); expect(percent(value)).toBe("—"); }
    expect(relativeTime("invalid")).toBe("Not available");
  });
});
