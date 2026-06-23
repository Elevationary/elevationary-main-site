// Stripe Session retrieve helper for /subscribe/welcome/.
//
// Per the 2026-06-16 "subscription_data is write-only on Session retrieve"
// lesson: GET /v1/checkout/sessions/{id} returns the Session object whose
// `subscription_data` field is ALWAYS empty. To recover the Subscription's
// metadata + billing details, follow `session.subscription` to a separate
// GET /v1/subscriptions/{sub_id} call. Both reads use STRIPE_READ_KEY which
// must carry `checkout.sessions:read` + `subscriptions:read` (verified
// 2026-06-22 via scripts/smoke_test_stripe_read.py — 200/200).

import type { Env } from "./types.js";

const STRIPE_API = "https://api.stripe.com/v1";

export type StripeWelcomeResult =
  | {
      ok: true;
      email: string;
      // Stripe Subscription ID (sub_XXXX) — useful for log correlation only.
      subscriptionId: string;
    }
  | { ok: false; code: "stripe_session_retrieve_failed" };

export async function retrieveStripeSessionEmail(
  env: Env,
  sessionId: string,
): Promise<StripeWelcomeResult> {
  if (!env.STRIPE_READ_KEY) {
    return { ok: false, code: "stripe_session_retrieve_failed" };
  }
  const headers = {
    Authorization: `Bearer ${env.STRIPE_READ_KEY}`,
    "Stripe-Version": env.STRIPE_API_VERSION,
  };

  const sessionRes = await fetch(
    `${STRIPE_API}/checkout/sessions/${encodeURIComponent(sessionId)}`,
    { headers },
  );
  if (!sessionRes.ok) {
    return { ok: false, code: "stripe_session_retrieve_failed" };
  }
  const session = (await sessionRes.json()) as {
    customer_details?: { email?: string };
    subscription?: string | null;
  };
  const email = session.customer_details?.email;
  const subscriptionId = session.subscription;
  if (!email || typeof email !== "string") {
    return { ok: false, code: "stripe_session_retrieve_failed" };
  }
  if (!subscriptionId || typeof subscriptionId !== "string") {
    return { ok: false, code: "stripe_session_retrieve_failed" };
  }
  return { ok: true, email, subscriptionId };
}
