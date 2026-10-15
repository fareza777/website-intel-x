import { expect, it } from "vitest";
import { symbolSchema } from "../lib/validation";
it("accepts valid one-letter Binance spot bases and rejects path injection", () => {
  expect(symbolSchema.safeParse("FUSDT").success).toBe(true);
  expect(symbolSchema.safeParse("BTCUSDT").success).toBe(true);
  expect(symbolSchema.safeParse("BTCUSDT/../account").success).toBe(false);
});
