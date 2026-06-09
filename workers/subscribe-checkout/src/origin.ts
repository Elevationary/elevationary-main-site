// Spec § 3.8 — Origin allow-list per env.
// Closes spec ORS red-team R-7 + § 8 F-13 (CSRF) + § 8 F-14 (CORS).
//
// Production allow-list = exact-match for apex + www.
// Preview allow-list = exact-match for known + suffix-match for *.pages.dev.
// Dev allow-list = localhost variants.
//
// Missing Origin header → reject. Browser fetches always send Origin for
// cross-origin POSTs; absence indicates a non-browser client.

import type { Env } from "./types.js";

export function isOriginAllowed(originHeader: string | null, env: Env): boolean {
  if (originHeader === null || originHeader === "") return false;

  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);

  // Exact-match first.
  if (allowed.includes(originHeader)) return true;

  // Suffix-match for preview *.pages.dev review URLs.
  // Worker_env=preview adds suffix-match implicitly; production explicitly excludes.
  if (env.WORKER_ENV === "preview") {
    if (originHeader.endsWith(".elevationary-main-site.pages.dev")) {
      // Match scheme + host suffix.
      try {
        const u = new URL(originHeader);
        if (
          u.protocol === "https:" &&
          u.host.endsWith(".elevationary-main-site.pages.dev")
        ) {
          return true;
        }
      } catch {
        return false;
      }
    }
  }

  return false;
}

// Spec § 3.8 — CORS preflight: echo back the requesting Origin only if
// allow-listed; otherwise NO Access-Control-Allow-Origin header → browser
// blocks the request. No wildcard.
export function corsHeaders(originHeader: string | null, env: Env): HeadersInit {
  if (!isOriginAllowed(originHeader, env)) {
    return {};
  }
  return {
    "Access-Control-Allow-Origin": originHeader as string,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
