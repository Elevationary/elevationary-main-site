// Spec § 3 step 3-5 + § 3.3 + § 6 — Stripe Checkout Session creation.
// Closes spec ORS red-team R-2 (form-encoded bracket-notation), R-8 (Test vs Live), R-9 (API version).
//
// Direct fetch() against Stripe REST API — no `stripe` npm package
// (Node-only crypto internals + ~1 MiB bundle bloat). Hand-rolled
// bracket-notation encoder per spec § 3.3.

import type {
  BillingPeriod,
  Env,
  Stream,
  SubscriptionMetadata,
  Tier,
  WorkerError,
} from "./types.js";

const STRIPE_API_BASE = "https://api.stripe.com";

// Spec § 8 F-11 — restricted scope `write:checkout.sessions`.
// TODO(CEO Q6): provision restricted Stripe key + Price IDs in Stripe Dashboard.
// Until then, this function refuses to construct a request — fail-closed.
export function assertSecretsConfigured(env: Env, billingPeriod: BillingPeriod): WorkerError | null {
  if (!env.STRIPE_SECRET_KEY || env.STRIPE_SECRET_KEY.length === 0) {
    return {
      error: "internal",
      message: "Stripe is not configured. Awaiting CEO Q6 (restricted API key).",
      status: 500,
    };
  }
  if (billingPeriod === "annual") {
    // TODO(CEO Q4): annual billing — set when CEO decides annual v1.
    if (
      !env.STRIPE_PRICE_INDIVIDUAL_ANNUAL ||
      !env.STRIPE_PRICE_BUNDLE_ANNUAL ||
      !env.STRIPE_PRICE_ALL_ACCESS_ANNUAL
    ) {
      return {
        error: "billing_period_invalid",
        message: "Annual billing is not yet available.",
        status: 400,
      };
    }
  } else {
    if (
      !env.STRIPE_PRICE_INDIVIDUAL_MONTHLY ||
      !env.STRIPE_PRICE_BUNDLE_MONTHLY ||
      !env.STRIPE_PRICE_ALL_ACCESS_MONTHLY
    ) {
      return {
        error: "internal",
        message: "Stripe is not configured. Awaiting CEO Q6 (Stripe Products + Prices).",
        status: 500,
      };
    }
  }
  return null;
}

// Spec § 3 step 4 — resolve Price ID for (tier, billing_period).
export function resolvePriceId(
  env: Env,
  tier: Tier,
  billingPeriod: BillingPeriod,
): string | null {
  const key = `STRIPE_PRICE_${tier === "functional_bundle" ? "BUNDLE" : tier.toUpperCase()}_${billingPeriod.toUpperCase()}` as keyof Env;
  const value = env[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

// Spec § 3.3 — Stripe bracket-notation form encoder.
// Flat input: { "subscription_data": { "metadata": { "contact_id": "ct_..." } } }
// Output:    subscription_data[metadata][contact_id]=ct_...
// Handles arrays via numeric indices: line_items[0][price]=price_...
export function formEncode(payload: Record<string, unknown>): string {
  const pairs: [string, string][] = [];
  function walk(prefix: string, value: unknown): void {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(`${prefix}[${i}]`, v));
      return;
    }
    if (typeof value === "object") {
      for (const k of Object.keys(value as Record<string, unknown>)) {
        walk(`${prefix}[${k}]`, (value as Record<string, unknown>)[k]);
      }
      return;
    }
    pairs.push([prefix, String(value)]);
  }
  for (const k of Object.keys(payload)) {
    walk(k, payload[k]);
  }
  return pairs
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

// Spec § 2 — canonical Checkout Session create payload shape.
export interface CheckoutSessionParams {
  mode: "subscription";
  customer_email: string;
  line_items: Array<{ price: string; quantity: number }>;
  subscription_data: { metadata: SubscriptionMetadata };
  success_url: string;
  cancel_url: string;
  allow_promotion_codes: "true" | "false";
  billing_address_collection: "auto" | "required";
  // automatic_tax intentionally nested per spec § 2 example
  automatic_tax: { enabled: "true" | "false" };
}

// Spec § 2 — build the params dict. Required-by-construction: metadata MUST be
// passed in. TypeScript strict mode enforces — no skipped path can call this
// without a fully-populated SubscriptionMetadata.
export function buildCheckoutSessionParams(args: {
  priceId: string;
  email: string;
  metadata: SubscriptionMetadata;
}): CheckoutSessionParams {
  return {
    mode: "subscription",
    customer_email: args.email,
    line_items: [{ price: args.priceId, quantity: 1 }],
    subscription_data: { metadata: args.metadata },
    // {CHECKOUT_SESSION_ID} is Stripe's literal template placeholder.
    success_url:
      "https://elevationary.com/subscribe/welcome/?session_id={CHECKOUT_SESSION_ID}",
    cancel_url: "https://elevationary.com/subscribe/?cancelled=1",
    allow_promotion_codes: "true",
    billing_address_collection: "auto",
    automatic_tax: { enabled: "false" }, // spec § 2 — flip after tax registration
  };
}

// Spec § 2 — assemble metadata from validated request fields.
// Caller passes tier + stream + lanes (already validated); we apply spec § 2
// "Where Website sets each field" rules.
export function buildMetadata(args: {
  ctId: string;
  tier: Tier;
  stream: Stream;
  lanes: string[];
}): SubscriptionMetadata {
  const m: SubscriptionMetadata = {
    contact_id: args.ctId,
    stream: args.stream,
    tier: args.tier,
    source: "stripe_checkout_elevationary_com",
  };
  // all_access OMITS swimlanes_accessible — Sales auto-fills all 10 of stream.
  if (args.tier !== "all_access" && args.lanes.length > 0) {
    m.swimlanes_accessible = args.lanes.join(",");
  }
  return m;
}

// Spec § 3 step 5 — POST to Stripe.
// Spec § 6 — Stripe-Version header + Idempotency-Key per request.
// Spec § 8 F-2 — Stripe rate limit handling (caller decides retry).
export interface StripeSessionResult {
  ok: true;
  session_url: string;
  session_id: string;
}

export async function createCheckoutSession(args: {
  env: Env;
  params: CheckoutSessionParams;
  idempotencyKey: string;
  // Injectable fetch for testing — defaults to global fetch.
  fetchImpl?: typeof fetch;
}): Promise<StripeSessionResult | WorkerError> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const body = formEncode(args.params as unknown as Record<string, unknown>);
  let res: Response;
  try {
    res = await fetchImpl(`${STRIPE_API_BASE}/v1/checkout/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Stripe-Version": args.env.STRIPE_API_VERSION,
        "Idempotency-Key": args.idempotencyKey,
      },
      body,
    });
  } catch {
    return {
      error: "stripe_session_create_failed",
      message: "Could not reach Stripe.",
      status: 500,
    };
  }
  if (!res.ok) {
    const requestId = res.headers.get("request-id") || "";
    let detail = "";
    try {
      detail = await res.text();
    } catch {}
    console.error(
      "Stripe session create failed: status=%d request_id=%s detail=%s",
      res.status,
      requestId,
      detail.slice(0, 500),
    );
    return {
      error: "stripe_session_create_failed",
      message: "Could not create checkout session. Please try again or contact support@elevationary.com.",
      status: 500,
    };
  }
  let json: { id?: string; url?: string };
  try {
    json = (await res.json()) as { id?: string; url?: string };
  } catch {
    return {
      error: "stripe_session_create_failed",
      message: "Stripe returned an unexpected response.",
      status: 500,
    };
  }
  if (!json.id || !json.url) {
    return {
      error: "stripe_session_create_failed",
      message: "Stripe response missing id or url.",
      status: 500,
    };
  }
  return { ok: true, session_url: json.url, session_id: json.id };
}

// Idempotency-Key per spec § 6 — per-request UUID (Cloudflare crypto.randomUUID).
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
