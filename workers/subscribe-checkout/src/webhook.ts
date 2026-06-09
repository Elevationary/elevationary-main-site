// =============================================================================
// STUB — FORWARD OPTIONALITY ONLY — NOT ROUTED IN v1
// =============================================================================
// Per spec § 5: Sales receives ALL Stripe webhooks at webhooks.elevationary.com.
// Website Worker is buyer-side ONLY. This module is a scaffolded shape for
// future Customer Portal events (spec § 10 Q5 re-subscribe; Q7 cancel/upgrade).
//
// Logged as L1 divergence in
//   ORS_website_stripe_checkout_skeleton_2026_06_09.md
//
// TODO(activation): when Q5/Q7 activates, wire into src/index.ts router and
// add an activation-time ORS with executable tests against Stripe webhook
// signature spec. Until then, this file exists only to keep the swap-in path
// short.
// =============================================================================

import type { WorkerError } from "./types.js";

// Spec reference (forward): Stripe-Signature header v1 — HMAC-SHA256 of
//   "<timestamp>.<raw_body>"
// using the webhook signing secret (separate secret from STRIPE_SECRET_KEY).
// Sales' implementation: stripe_webhook.py lines 142-165.

export interface StripeWebhookPayload {
  id: string;
  type: string;
  data: { object: unknown };
  // ... full Stripe event shape; extend at activation
}

/**
 * Stub signature verifier. Returns "ok" only for the structural placeholder
 * pattern below; never accepts a real Stripe webhook in v1. At activation:
 * replace with real Stripe-Signature HMAC verification + replay-window check
 * (default 5 minute tolerance per Stripe docs).
 *
 * Stub accepts shape: header `t=<digits>,v1=<64-hex>` with non-empty bodyText.
 * This is intentionally NOT a Stripe-spec verification — it exists only so
 * vitest can exercise the structural API of the eventual real function.
 */
export function verifySignatureStub(
  signatureHeader: string | null,
  bodyText: string,
  webhookSecret: string,
): WorkerError | { ok: true } {
  if (!webhookSecret) {
    // TODO(activation): once a webhook secret is provisioned, replace this
    // with the canonical Stripe HMAC check.
    return {
      error: "internal",
      message: "Webhook handler is not active in v1 (Sales receives Stripe webhooks).",
      status: 501,
    };
  }
  if (!signatureHeader) {
    return { error: "forbidden", message: "Missing signature header.", status: 403 };
  }
  if (!bodyText) {
    return { error: "internal", message: "Empty body.", status: 400 };
  }
  // Structural-only stub: header must look like `t=<digits>,v1=<64-hex>`.
  const re = /^t=\d+,v1=[a-f0-9]{64}$/;
  if (!re.test(signatureHeader)) {
    return { error: "forbidden", message: "Malformed signature header.", status: 403 };
  }
  // Stub returns ok for structurally-valid header. Real impl WILL reject this
  // if it doesn't actually verify against the secret.
  return { ok: true };
}

/**
 * Stub event router. v1 returns 501 Not Implemented. At activation, route
 * each Stripe event type (customer.subscription.updated for portal changes,
 * customer.subscription.deleted for cancel, etc.) to a handler that writes
 * the appropriate envelope to sales/inbox_subscription_events/.
 */
export function routeStripeEvent(_payload: StripeWebhookPayload): WorkerError {
  return {
    error: "internal",
    message: "Stripe webhook handling is not active in v1.",
    status: 501,
  };
}
