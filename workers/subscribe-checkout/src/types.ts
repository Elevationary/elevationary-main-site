// Types shared across the subscribe-checkout Worker.
// Spec § 2 (metadata contract) + § 3 (Worker architecture).

export type Tier = "individual" | "functional_bundle" | "all_access";
export type Stream = "commercial" | "nonprofit";
export type BillingPeriod = "monthly" | "annual";

// Spec § 2 Required + optional fields — subset that Worker SETS at first checkout.
// Sales' _extract_subscription_from_meta enforces every field on receive.
export interface SubscriptionMetadata {
  contact_id: string;            // required — ct_ prefix; spec § 3.4 derivation
  stream: Stream;                // required — derived from lane prefixes; spec § 3.5
  tier: Tier;                    // required — buyer's tier choice
  swimlanes_accessible?: string; // CSV string; required for individual + functional_bundle; omitted for all_access (Sales auto-fills)
  source: string;                // always "stripe_checkout_elevationary_com" per spec § 2
}

// Spec § 3 request shape — what `/api/checkout` POST body looks like after JSON.parse.
export interface CheckoutRequest {
  tier: Tier;
  billing_period: BillingPeriod;
  stream: Stream;
  swimlanes_accessible: string[]; // empty array for all_access
  email: string;
  name?: string;
  company?: string;
}

// Spec § 3 error code table — every error response shape.
export type WorkerErrorCode =
  | "tier_invalid"
  | "stream_invalid"
  | "swimlanes_invalid"
  | "billing_period_invalid"
  | "email_invalid"
  | "contact_collision"
  | "already_subscribed"
  | "contact_create_failed"
  | "stripe_session_create_failed"
  | "rate_limited"
  | "forbidden"
  | "method_not_allowed"
  | "internal";

export interface WorkerError {
  error: WorkerErrorCode;
  message: string;
  status: number;
}

// Spec § 3.11 Sales Contact JSON shape.
// TODO(Sales coordination): confirm this shape matches Sales' actual schema
// before LIVE (spec § 3.10 dry-run procedure).
export interface SalesContact {
  ct_id: string;
  email: string;        // lowercased — spec § 3.6
  name: string;
  company_id: string | null;
  company: string;
  source: string;
  created_at: string;   // ISO 8601
  notes: string;
}

// Cloudflare Worker env bindings — every secret + KV + R2 binding.
// TODO(CEO Q6): STRIPE_SECRET_KEY + STRIPE_PRICE_* are unprovisioned in v1.
// Skeleton-state assertion: at activation, `assertSecretsConfigured(env)`
// throws if any required secret is empty.
export interface Env {
  // Non-secret vars (wrangler.toml [vars]):
  WORKER_ENV: "production" | "preview" | string;
  ALLOWED_ORIGINS: string;          // comma-separated; spec § 3.8
  STRIPE_API_VERSION: string;       // pinned per spec § 6
  DRY_RUN_CONTACT_WRITE: string;    // "true" | "false"; spec § 3.10

  // Secrets (wrangler secret put):
  // TODO(CEO Q6): provision restricted Stripe key (scope: write:checkout.sessions)
  STRIPE_SECRET_KEY: string;
  // TODO(CEO Q6): provision Stripe Products + Prices; one secret per tier × period
  STRIPE_PRICE_INDIVIDUAL_MONTHLY: string;
  STRIPE_PRICE_BUNDLE_MONTHLY: string;
  STRIPE_PRICE_ALL_ACCESS_MONTHLY: string;
  // TODO(CEO Q4): annual prices — set when CEO decides annual v1 vs monthly-only
  STRIPE_PRICE_INDIVIDUAL_ANNUAL?: string;
  STRIPE_PRICE_BUNDLE_ANNUAL?: string;
  STRIPE_PRICE_ALL_ACCESS_ANNUAL?: string;

  // Bindings (uncommented in wrangler.toml at activation):
  R2_SALES?: R2Bucket;
  IDEMPOTENCY_KV?: KVNamespace;
}
