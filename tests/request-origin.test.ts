import { expect, it } from "vitest";
import { isSameOriginRequest } from "../lib/request-origin";

it("accepts the actual public Host when Next reconstructs an internal localhost URL", () => {
  expect(isSameOriginRequest(new Request("http://localhost:3000/api/scan", { headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" } }))).toBe(true);
  expect(isSameOriginRequest(new Request("http://internal:3000/api/scan", { headers: { host: "cryptointel-x-nu.vercel.app", origin: "https://cryptointel-x-nu.vercel.app" } }))).toBe(true);
});
it("rejects foreign, malformed and forged forwarded origins", () => {
  for (const origin of ["https://evil.invalid", "null", "javascript://cryptointel-x-nu.vercel.app"]) {
    expect(isSameOriginRequest(new Request("https://cryptointel-x-nu.vercel.app/api/scan", { headers: { host: "cryptointel-x-nu.vercel.app", origin, "x-forwarded-host": "evil.invalid" } }))).toBe(false);
  }
});
it("allows command-line previews without an Origin header", () => {
  expect(isSameOriginRequest(new Request("https://cryptointel-x-nu.vercel.app/api/scan"))).toBe(true);
});
