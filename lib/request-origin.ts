/** Public read-only previews allow CLI requests; browser requests must match the HTTP Host. */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const source = new URL(origin);
    const host = request.headers.get("host") || new URL(request.url).host;
    return ["http:", "https:"].includes(source.protocol) && source.host.toLowerCase() === host.toLowerCase();
  } catch { return false; }
}
