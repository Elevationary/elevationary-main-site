// Stripe-Signature verification for the D2.1 webhook receiver.
//
// Spec: ~/Antigravity_Data/Website/docs/plans/spec_stripe_event_mapping_2026_07_18.md § 3
// Frozen contract (D1.3 signed 2026-07-19). Supersedes the v1 stub in
// src/webhook.ts (verifySignatureStub), which stays only until src/index.ts
// wires this real verifier in the continuation increment.
//
// Scheme (§ 3.1): `Stripe-Signature: t=<unix>,v1=<hex_hmac_sha256>[,v1=<hex>...]`
//   - HMAC-SHA256 over the raw request body prefixed with `${t}.` (§ 3.1).
//   - Accept if ANY v1 matches (rotation window); reject if none (§ 3.1).
//   - Legacy v0 MUST NOT be accepted (§ 3.1) — we simply never compare v0.
//   - Timestamp tolerance 5 min (§ 3.3).
//
// Implementation note (§ 3.5): uses the Web Crypto `crypto.subtle` HMAC — the
// spec-sanctioned "equivalent Web Crypto API HMAC-SHA256" — so no `stripe` SDK
// dependency is added to the Worker. Caller MUST pass the RAW body text read
// via `request.text()` BEFORE any JSON parse (§ 3.5): the signature is over the
// exact bytes; parse-then-restringify is not byte-identical.

import type { WorkerError } from "./types.js";

// § 3.3 — reject if |now - t| exceeds this. Stripe's own recommendation.
export const DEFAULT_TOLERANCE_SEC = 300;

export interface VerifiedOk {
  ok: true;
  /** The `t=` timestamp (unix seconds) that produced a matching signature. */
  timestamp: number;
}

/** Parsed Stripe-Signature header. `t` null when absent/non-numeric. */
interface ParsedSignature {
  t: number | null;
  v1: string[];
}

/**
 * Parse `t=...,v1=...[,v1=...][,v0=...]`. Tolerant of whitespace and unknown
 * scheme keys; collects every `v1` value; ignores `v0` (deprecated, § 3.1).
 * `t` must be all-digits to count; otherwise null (→ malformed downstream).
 */
function parseSignatureHeader(header: string): ParsedSignature {
  const parsed: ParsedSignature = { t: null, v1: [] };
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") {
      if (/^\d+$/.test(value)) parsed.t = parseInt(value, 10);
    } else if (key === "v1") {
      if (value) parsed.v1.push(value.toLowerCase());
    }
    // v0 and any other scheme keys are intentionally ignored.
  }
  return parsed;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return toHex(sig);
}

/**
 * Constant-time hex-string comparison. Both inputs are lowercase hex of equal
 * expected length (64 chars for SHA-256); length mismatch short-circuits false
 * but does not early-return on content, avoiding a content-timing oracle.
 */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Verify a Stripe webhook signature per spec § 3.
 *
 * Check order mirrors Stripe's `constructEvent` (signature match BEFORE
 * timestamp): a tampered/forged payload returns `invalid_signature`, and
 * `timestamp_out_of_range` is reserved for a genuinely-valid-but-stale
 * signature (replay). This keeps `timestamp_out_of_range` from leaking that an
 * arbitrary attacker payload had a valid HMAC.
 *
 * Rejection posture (§ 3.4):
 *   missing secret        → 500 config_error          (Stripe retries 5xx; ops must fix)
 *   missing header        → 400 missing_signature     (permanent)
 *   malformed header      → 400 malformed_signature   (permanent)
 *   no v1 matches HMAC    → 401 invalid_signature     (permanent; no oracle)
 *   timestamp skew > 5min → 401 timestamp_out_of_range (permanent)
 *
 * @param signatureHeader value of the `Stripe-Signature` request header (or null)
 * @param rawBody         exact raw request body text (pre-parse; § 3.5)
 * @param webhookSecret   STRIPE_WEBHOOK_SECRET (whsec_…)
 * @param opts.toleranceSec override tolerance (default 300s)
 * @param opts.nowSec        override "now" in unix seconds (test injection)
 */
export async function verifyStripeSignature(
  signatureHeader: string | null,
  rawBody: string,
  webhookSecret: string,
  opts?: { toleranceSec?: number; nowSec?: number },
): Promise<WorkerError | VerifiedOk> {
  // Config error first — without the secret no verification is possible. This
  // is our own misconfiguration (surface via 5xx + Telegram page), not an
  // attacker-distinguishable oracle. (§ 3.4 last row.)
  if (!webhookSecret) {
    return {
      error: "config_error",
      message: "STRIPE_WEBHOOK_SECRET is not configured on the Worker.",
      status: 500,
    };
  }
  if (!signatureHeader) {
    return { error: "missing_signature", message: "Missing Stripe-Signature header.", status: 400 };
  }

  const parsed = parseSignatureHeader(signatureHeader);
  if (parsed.t === null || parsed.v1.length === 0) {
    return {
      error: "malformed_signature",
      message: "Stripe-Signature header is malformed (missing t= or v1=).",
      status: 400,
    };
  }

  const expected = await hmacSha256Hex(webhookSecret, `${parsed.t}.${rawBody}`);
  const matched = parsed.v1.some((candidate) => timingSafeEqualHex(candidate, expected));
  if (!matched) {
    return { error: "invalid_signature", message: "No v1 signature matched.", status: 401 };
  }

  const now = opts?.nowSec ?? Math.floor(Date.now() / 1000);
  const tolerance = opts?.toleranceSec ?? DEFAULT_TOLERANCE_SEC;
  if (Math.abs(now - parsed.t) > tolerance) {
    return {
      error: "timestamp_out_of_range",
      message: "Signature timestamp is outside the tolerance window.",
      status: 401,
    };
  }

  return { ok: true, timestamp: parsed.t };
}

/**
 * Test/helper: produce a valid `Stripe-Signature` header for a body+secret at a
 * given timestamp. Not used in the request path — exported so unit tests (and a
 * future signed-replay tool) can craft canonical signatures without the SDK.
 */
export async function signPayload(
  rawBody: string,
  webhookSecret: string,
  timestampSec: number,
): Promise<string> {
  const v1 = await hmacSha256Hex(webhookSecret, `${timestampSec}.${rawBody}`);
  return `t=${timestampSec},v1=${v1}`;
}
