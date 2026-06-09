// Spec § 3.7 — IDEMPOTENCY_KV namespace + key shapes.
// Closes spec ORS red-team R-6 + § 8 F-3 (per-IP abuse) + § 8 F-4 (double-submit).
//
// Single KV namespace, prefixed keys:
//   rl:ip:<sha256(client_ip)>   — per-IP rate counter, 60s TTL
//   lock:email:<ct_id>          — per-email lockout window, 30s TTL
//
// Stripe-side Idempotency-Key is per-request UUID (set in stripe.ts) — handled
// server-side by Stripe; no KV entry needed.

const RATE_LIMIT_TTL_SEC = 60;
const RATE_LIMIT_MAX = 10;        // 10 POSTs per IP per 60s
const EMAIL_LOCKOUT_TTL_SEC = 30; // 30s lockout window

// SHA-256 the IP to avoid storing raw addresses (GDPR-light hygiene).
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function checkRateLimit(
  kv: KVNamespace | undefined,
  clientIp: string,
): Promise<{ allowed: boolean; remaining: number }> {
  // TODO(CEO Q6): IDEMPOTENCY_KV binding is unprovisioned in skeleton state.
  // When binding is undefined (skeleton), allow everything — Stripe layer
  // catches abuse via its own rate limits as fallback.
  if (!kv) return { allowed: true, remaining: RATE_LIMIT_MAX };

  const key = "rl:ip:" + (await sha256Hex(clientIp));
  const raw = await kv.get(key);
  const current = raw ? parseInt(raw, 10) : 0;
  if (current >= RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0 };
  }
  await kv.put(key, String(current + 1), { expirationTtl: RATE_LIMIT_TTL_SEC });
  return { allowed: true, remaining: RATE_LIMIT_MAX - current - 1 };
}

// Per-email lockout window — spec § 8 F-4.
// First Worker writes cached session_url; second Worker reads + returns same URL.
export interface EmailLockoutPayload {
  session_url: string;
  created_at: number; // epoch seconds
}

export async function getEmailLockout(
  kv: KVNamespace | undefined,
  ctId: string,
): Promise<EmailLockoutPayload | null> {
  if (!kv) return null;
  const raw = await kv.get("lock:email:" + ctId);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as EmailLockoutPayload;
  } catch {
    return null;
  }
}

export async function setEmailLockout(
  kv: KVNamespace | undefined,
  ctId: string,
  payload: EmailLockoutPayload,
): Promise<void> {
  if (!kv) return;
  await kv.put("lock:email:" + ctId, JSON.stringify(payload), {
    expirationTtl: EMAIL_LOCKOUT_TTL_SEC,
  });
}
