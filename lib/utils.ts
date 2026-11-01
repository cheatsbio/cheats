export const USERNAME_RE = /^[a-z0-9_]{3,24}$/;
export const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export const RESERVED_USERNAMES = new Set([
  "login", "register", "dashboard", "api", "admin", "settings", "auth",
  "www", "app", "static", "_next", "about", "terms", "privacy", "help",
  "support", "cheats",
]);

export function isLight(hex: string): boolean {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return false;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62;
}

export function normalizeUrl(input: string, allowMailto = true): string | null {
  const value = input.trim();
  if (!value) return null;
  const schemeOk = allowMailto
    ? /^(https?:\/\/|mailto:)/i.test(value)
    : /^https?:\/\//i.test(value);
  const candidate = schemeOk ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    const allowed = allowMailto
      ? ["http:", "https:", "mailto:"]
      : ["http:", "https:"];
    if (!allowed.includes(url.protocol)) return null;
    return candidate;
  } catch {
    return null;
  }
}

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
