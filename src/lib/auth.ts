export type Principal =
  | { kind: "customer"; accountId: string; accountName: string }
  | { kind: "staff"; role: string };

export const ACCOUNTS = [
  { id: "ACCT-001", name: "Northstar Logistics" },
  { id: "ACCT-002", name: "LumenWorks" },
  { id: "ACCT-003", name: "Beacon Retail" },
  { id: "ACCT-004", name: "Axis Labs" },
] as const;

export const STAFF = { role: "staff", label: "ParcelPilot Staff" } as const;

// HMAC-signed session token (no JWT lib needed on Workers)
async function hmacSign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlEncode(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): string {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return atob(b64);
}

export async function createSessionToken(principal: Principal, secret: string): Promise<string> {
  const payload = b64urlEncode(JSON.stringify(principal));
  const sig = await hmacSign(payload, secret);
  return `${payload}.${sig}`;
}

export async function verifySessionToken(token: string, secret: string): Promise<Principal | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = await hmacSign(payload, secret);
  if (sig !== expected) return null;
  try {
    const json = JSON.parse(b64urlDecode(payload));
    if (json.kind === "customer" && typeof json.accountId === "string") return json as Principal;
    if (json.kind === "staff" && typeof json.role === "string") return json as Principal;
    return null;
  } catch {
    return null;
  }
}

export function getSessionFromRequest(req: Request): string | null {
  // Prefer Authorization: Bearer <token>, fallback to cookie
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  const cookie = req.headers.get("cookie") ?? "";
  const m = cookie.match(/(?:^|;\s*)pp_session=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function sessionCookie(token: string): string {
  return `pp_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`;
}

export function clearSessionCookie(): string {
  return `pp_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
