// subscribe-checkout Worker — buyer-side Stripe Checkout Session creator.
//
// Spec: ~/Antigravity_Data/Website/docs/plans/stripe_checkout_integration_spec_2026_06_08.md
// Skeleton ORS: ~/Antigravity_Data/Website/docs/ORS_logs/ORS_website_stripe_checkout_skeleton_2026_06_09.md
//
// v1 routes:
//   OPTIONS /api/checkout       → CORS preflight (origin-gated)
//   POST    /api/checkout       → validate → resolve Contact → call Stripe → return URL
//   (all other paths)           → 405 method_not_allowed
//
// Webhook handling is NOT routed in v1 — Sales receives all Stripe webhooks
// per spec § 5. See src/webhook.ts banner.

import type { Env, WorkerError } from "./types.js";
import { deriveCtId } from "./ct_id.js";
import { validateCheckoutRequest } from "./validation.js";
import { resolveOrCreateContact } from "./contact.js";
import {
  assertSecretsConfigured,
  buildCheckoutSessionParams,
  buildMetadata,
  createCheckoutSession,
  newIdempotencyKey,
  resolvePriceId,
} from "./stripe.js";
import { corsHeaders, isOriginAllowed } from "./origin.js";
import {
  checkRateLimit,
  getEmailLockout,
  setEmailLockout,
} from "./idempotency.js";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    // CORS preflight.
    if (request.method === "OPTIONS") {
      if (!isOriginAllowed(origin, env)) {
        return jsonError({ error: "forbidden", message: "Origin not allowed.", status: 403 });
      }
      return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
    }

    // Only POST /api/checkout in v1.
    if (request.method !== "POST" || url.pathname !== "/api/checkout") {
      return jsonError({
        error: "method_not_allowed",
        message: "Only POST /api/checkout is supported.",
        status: 405,
      });
    }

    // Origin allow-list (CSRF protection — spec § 3.8 + § 8 F-13/F-14).
    if (!isOriginAllowed(origin, env)) {
      return jsonError(
        { error: "forbidden", message: "Origin not allowed.", status: 403 },
        corsHeaders(origin, env),
      );
    }

    // Per-IP rate limit (spec § 8 F-3).
    const clientIp = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
    const rl = await checkRateLimit(env.IDEMPOTENCY_KV, clientIp);
    if (!rl.allowed) {
      return jsonError(
        { error: "rate_limited", message: "Too many requests.", status: 429 },
        corsHeaders(origin, env),
      );
    }

    // Parse + validate body.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(
        { error: "internal", message: "Request body must be valid JSON.", status: 400 },
        corsHeaders(origin, env),
      );
    }

    const validated = validateCheckoutRequest(body);
    if ("error" in validated) {
      return jsonError(validated, corsHeaders(origin, env));
    }

    // Secrets configured? (Spec § 8 F-11 fail-closed; CEO Q6 gate.)
    const secretsErr = assertSecretsConfigured(env, validated.billing_period);
    if (secretsErr) {
      return jsonError(secretsErr, corsHeaders(origin, env));
    }

    // Derive ct_id + resolve Sales Contact.
    const ctId = deriveCtId(validated.email);

    // Per-email lockout — return cached URL if buyer rapid-fire-submits (spec § 8 F-4).
    const cached = await getEmailLockout(env.IDEMPOTENCY_KV, ctId);
    if (cached) {
      return jsonOk(
        { ok: true, checkout_url: cached.session_url },
        corsHeaders(origin, env),
      );
    }

    const resolution = await resolveOrCreateContact({
      env,
      ctId,
      email: validated.email,
      name: validated.name ?? "",
      company: validated.company ?? "",
    });
    if ("error" in resolution) {
      return jsonError(resolution, corsHeaders(origin, env));
    }

    // Build metadata + price + Stripe params.
    const metadata = buildMetadata({
      ctId,
      tier: validated.tier,
      stream: validated.stream,
      lanes: validated.swimlanes_accessible,
    });

    const priceId = resolvePriceId(env, validated.tier, validated.billing_period);
    if (!priceId) {
      return jsonError(
        {
          error: "internal",
          message: "Price not configured. Awaiting CEO Q6.",
          status: 500,
        },
        corsHeaders(origin, env),
      );
    }

    const params = buildCheckoutSessionParams({
      priceId,
      email: validated.email,
      metadata,
    });

    // Call Stripe.
    const session = await createCheckoutSession({
      env,
      params,
      idempotencyKey: newIdempotencyKey(),
    });
    if ("error" in session) {
      return jsonError(session, corsHeaders(origin, env));
    }

    // Cache URL for double-submit window.
    await setEmailLockout(env.IDEMPOTENCY_KV, ctId, {
      session_url: session.session_url,
      created_at: Math.floor(Date.now() / 1000),
    });

    return jsonOk(
      { ok: true, checkout_url: session.session_url },
      corsHeaders(origin, env),
    );
  },
};

function jsonOk(body: object, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}

function jsonError(err: WorkerError, extraHeaders: HeadersInit = {}): Response {
  return new Response(
    JSON.stringify({ ok: false, error: err.error, message: err.message }),
    {
      status: err.status,
      headers: {
        "Content-Type": "application/json",
        ...extraHeaders,
      },
    },
  );
}
