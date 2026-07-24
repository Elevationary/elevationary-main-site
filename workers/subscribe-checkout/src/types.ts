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
  | "internal"
  // Welcome-page surface (BVP Day 2; D2.4 Website half).
  | "session_id_missing"
  | "session_id_malformed"
  | "session_id_invalid"
  | "stripe_session_retrieve_failed"
  | "entitlement_lookup_failed"
  // Stripe webhook receiver surface (D2.1; spec § 3.4 rejection posture).
  | "missing_signature"
  | "malformed_signature"
  | "invalid_signature"
  | "timestamp_out_of_range"
  | "config_error";

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

// Entitlement state for the /subscribe/welcome/ surface. Constructed from the
// Stripe Session (tier + billing) + the Entitlement Worker subrequest (swimlanes
// + portal URL). Marketing contract (D2.1, 2026-06-21): seven data-hook slots
// in the shell HTML are mutated server-side from this object.
export interface Entitlement {
  // Display label for the tier slot. Marketing copy: "Individual" |
  // "Functional Bundle" | "All-Access".
  tierLabel: string;
  // Raw tier enum — used for upsell-card omission (server hides the card
  // matching the subscriber's current tier).
  tier: Tier;
  // Unlocked swimlane slugs. Worker emits one <li> per slug into the
  // entitlement-swimlanes container.
  swimlanes: string[];
  // ISO date string (YYYY-MM-DD). Marketing renders display formatting via CSS
  // ::before or template; Worker writes the ISO value into the text node.
  billingNextIso: string;
  // Absolute URL — Stripe Customer Portal session URL. Worker sets href on
  // entitlement-portal-link.
  portalUrl: string;
}

// Failure context for the /subscribe/welcome/ surface — when session_id is
// missing/malformed/invalid OR a downstream call (Stripe / Entitlement Worker)
// fails, the Worker un-hides the entitlement-failure block and writes the
// human-readable message into the nested message hook. The entitlement slots
// keep their static-shell defaults per Marketing's graceful-fallback convention.
export interface WelcomeFailure {
  code: WorkerErrorCode;
  message: string;
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

  // Service binding to the P4_D1 Entitlement Worker (subscriber-content).
  // D1.6 architecture lock (COO ratified 2026-06-21): /subscribe/welcome/
  // subrequests this Worker for entitlement state — single source of truth,
  // no direct KV/R2 read. TODO(wrangler): add [[services]] block at activation.
  ENTITLEMENT_WORKER?: Fetcher;

  // Read-side Stripe key — needs `checkout.sessions:read` +
  // `subscriptions:read` scopes. Provisioned 2026-06-22.
  STRIPE_READ_KEY?: string;

  // CF Access service token for ENTITLEMENT_WORKER subrequests. The
  // subscriber-content Worker's CF Access policy accepts this token in place
  // of a user JWT, so the welcome handler can authenticate as a service
  // principal. Pair of secrets — both required. Provisioned 2026-06-22 via
  // CF dashboard service-auth flow.
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;

  // ==========================================================================
  // D2.1 Stripe Webhook Receiver — Subscription Revenue Linkage (spec § 11).
  // Frozen contract: spec_stripe_event_mapping_2026_07_18.md (D1.3 signed
  // 2026-07-19). All optional until the LIVE-deploy increment provisions them
  // via `wrangler secret put` + claims the wrangler.toml bindings — the Worker
  // asserts presence at webhook-handler entry (spec § 3.4 config_error), so the
  // existing checkout path is unaffected by their absence.
  // ==========================================================================

  // --- Stripe webhook secrets (spec § 11.1) ---
  // Signature signing secret (whsec_…) — spec § 3.2. DISTINCT from the API key.
  STRIPE_WEBHOOK_SECRET?: string;
  // Restricted API key (spec § 10, scope per § 10 table).
  // ⚠ DIVERGENCE (L1): spec § 10/§11.1 label is STRIPE_SECRET_KEY; CEO 2026-07-19
  // unique-secret-name rule renamed it STRIPE_WEBSITE_SECRET_KEY (consumer-Worker
  // -prefixed). Rename overrides spec label. See auto-memory
  // feedback_stripe_website_secret_key_rename_convention + this increment's ORS.
  STRIPE_WEBSITE_SECRET_KEY?: string;

  // --- Stripe Price IDs (spec § 11.1 frozen names; supersede the older
  //     STRIPE_PRICE_*_MONTHLY forward-decls above). Tiers per Master Business
  //     Plan §274-276. No 4th cross-vertical slot (§11.1 note: bespoke SKU). ---
  STRIPE_PRICE_INDIVIDUAL_ACCESS_MONTHLY?: string;
  STRIPE_PRICE_INDIVIDUAL_ACCESS_ANNUAL?: string;
  STRIPE_PRICE_FUNCTIONAL_BUNDLE_MONTHLY?: string;
  STRIPE_PRICE_FUNCTIONAL_BUNDLE_ANNUAL?: string;
  STRIPE_PRICE_ALL_ACCESS_CORPORATE_MONTHLY?: string;
  STRIPE_PRICE_ALL_ACCESS_CORPORATE_ANNUAL?: string;

  // --- Zoho Books OAuth v2 (spec § 11.2) ---
  ZOHO_CLIENT_ID?: string;
  ZOHO_CLIENT_SECRET?: string;
  ZOHO_REFRESH_TOKEN?: string;
  ZOHO_ORGANIZATION_ID?: string; // well-known 920008429; non-secret

  // --- Bindings (spec § 11.3; claimed in wrangler.toml at LIVE-deploy) ---
  STRIPE_IDEMPOTENCY?: KVNamespace; // Layer-1 event.id dedup (§7.1)
  STRIPE_DLQ?: R2Bucket;            // DLQ storage (§9.1)
  DLQ_PAGED_MARKER?: KVNamespace;   // stuck-loop page suppression (§9.4)
}
