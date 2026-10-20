/**
 * Serializes API payloads for the browser. Floats keep 10 significant digits, far beyond
 * any displayed precision, and model feature vectors are dropped: only the publisher and
 * the audit read them, while they make up a large share of every published setup.
 */
export function compactJson(value: unknown): string {
  return JSON.stringify(value, (key, item) => key === "features" ? undefined : typeof item === "number" && !Number.isInteger(item) && Number.isFinite(item) ? Number(item.toPrecision(10)) : item);
}

export function compactResponse(value: unknown, cacheControl: string, status = 200): Response {
  return new Response(compactJson(value), { status, headers: { "Content-Type": "application/json", "Cache-Control": cacheControl } });
}
