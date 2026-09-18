/**
 * Only public web addresses. The browser that opens them is remote, so this
 * is not the only line of defence, but there is no reason to spend a render on
 * an address that cannot be a public page.
 */
export function isPublicWebAddress(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host.includes(".") && !host.includes(":")) return false;
  if (host === "localhost" || /\.(localhost|local|internal|lan|home|corp)$/.test(host)) return false;
  // Literal private, loopback, link-local and reserved IPv4 ranges.
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  // Any literal IPv6 address: loopback, link-local and unique-local included.
  if (host.includes(":")) return false;
  return true;
}
