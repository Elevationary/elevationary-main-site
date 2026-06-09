// Spec § 3.2 (email), § 3.5 (stream derivation), § 3 step 1 (request validation).
// Closes spec ORS red-team R-1, R-4.
//
// Every check here is pure (no I/O, no env). The output feeds stripe.ts
// directly — no path that skips validation can construct Stripe params.

import type {
  CheckoutRequest,
  Stream,
  Tier,
  BillingPeriod,
  WorkerError,
} from "./types.js";

// Spec § 3.2 — simplified RFC 5321 regex (deliberately stricter than full grammar).
// 254-char limit per RFC 5321 max.
const EMAIL_REGEX = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;
const EMAIL_MAX_LEN = 254;

// Schema v2 enums (post P9_D1 2026-06-02; enterprise tier retired).
const VALID_TIERS: Tier[] = ["individual", "functional_bundle", "all_access"];
const VALID_STREAMS: Stream[] = ["commercial", "nonprofit"];

// TODO(CEO Q4): annual billing — currently monthly-only. When CEO ratifies
// annual v1, add "annual" gating off `env.BILLING_PERIODS_ENABLED` or similar.
const VALID_BILLING_PERIODS: BillingPeriod[] = ["monthly", "annual"];

// Spec § 3.5 — 20-value swimlane enum (10 commercial_*, 10 nonprofit_*).
// Sales' schema v2 owns the master list; this Worker re-validates structurally
// (correct prefix + non-empty + count enforcement). Sales' receiver also
// validates against the master enum on receive — defense in depth.

export function validateEmail(rawEmail: string): WorkerError | null {
  if (typeof rawEmail !== "string" || rawEmail.length === 0) {
    return err("email_invalid", "Email is required.", 400);
  }
  if (rawEmail.length > EMAIL_MAX_LEN) {
    return err("email_invalid", "Email exceeds 254-character RFC 5321 limit.", 400);
  }
  if (!EMAIL_REGEX.test(rawEmail)) {
    return err("email_invalid", "Email is malformed.", 400);
  }
  return null;
}

// Spec § 3.6 — email is lowercased EVERYWHERE we store.
export function normalizeEmail(rawEmail: string): string {
  return rawEmail.toLowerCase();
}

// Spec § 3.5 — derive stream from swimlane prefixes; reject mixed-stream.
// Returns null for empty list (all_access path; Sales auto-fills).
// Returns null for invalid mix (mixed streams, unknown prefix).
export function deriveStream(lanes: string[]): Stream | null {
  if (lanes.length === 0) return null;
  const first = lanes[0];
  const stream: Stream | null = first.startsWith("commercial_")
    ? "commercial"
    : first.startsWith("nonprofit_")
    ? "nonprofit"
    : null;
  if (stream === null) return null;
  for (const lane of lanes) {
    if (!lane.startsWith(stream + "_")) return null;
  }
  return stream;
}

// Spec § 3 step 1 — strict shape + enum validation of the POST body.
// Caller has already done JSON.parse and runtime-guarded that the result
// is an object. We only return ONE error at a time (first-failure surfaces
// best UX message to the buyer).
export function validateCheckoutRequest(body: unknown): WorkerError | CheckoutRequest {
  if (typeof body !== "object" || body === null) {
    return err("internal", "Request body must be a JSON object.", 400);
  }
  const b = body as Record<string, unknown>;

  // tier
  if (typeof b.tier !== "string" || !VALID_TIERS.includes(b.tier as Tier)) {
    return err("tier_invalid", `tier must be one of ${VALID_TIERS.join(", ")}.`, 400);
  }
  const tier = b.tier as Tier;

  // billing_period
  if (
    typeof b.billing_period !== "string" ||
    !VALID_BILLING_PERIODS.includes(b.billing_period as BillingPeriod)
  ) {
    return err(
      "billing_period_invalid",
      `billing_period must be one of ${VALID_BILLING_PERIODS.join(", ")}.`,
      400,
    );
  }
  const billing_period = b.billing_period as BillingPeriod;

  // stream
  if (typeof b.stream !== "string" || !VALID_STREAMS.includes(b.stream as Stream)) {
    return err("stream_invalid", `stream must be one of ${VALID_STREAMS.join(", ")}.`, 400);
  }
  const stream = b.stream as Stream;

  // swimlanes_accessible — must be array of strings.
  if (!Array.isArray(b.swimlanes_accessible)) {
    return err("swimlanes_invalid", "swimlanes_accessible must be an array.", 400);
  }
  for (const lane of b.swimlanes_accessible) {
    if (typeof lane !== "string") {
      return err("swimlanes_invalid", "swimlanes_accessible entries must be strings.", 400);
    }
  }
  const swimlanes_accessible = b.swimlanes_accessible as string[];

  // Count enforcement per tier (spec § 3 step 1).
  const countErr = enforceLaneCountByTier(tier, swimlanes_accessible);
  if (countErr) return countErr;

  // Stream-derivation re-check (spec § 3.5) — if buyer chose lanes, they must
  // share prefix with stated stream. all_access skips (Sales auto-fills).
  if (tier !== "all_access") {
    const derived = deriveStream(swimlanes_accessible);
    if (derived === null) {
      return err(
        "swimlanes_invalid",
        "swimlanes_accessible mixes streams or contains unknown prefixes.",
        400,
      );
    }
    if (derived !== stream) {
      return err(
        "swimlanes_invalid",
        `swimlanes_accessible derives stream ${derived} but body stated ${stream}.`,
        400,
      );
    }
  }

  // email
  const emailErr = validateEmail(typeof b.email === "string" ? b.email : "");
  if (emailErr) return emailErr;
  const email = normalizeEmail(b.email as string);

  // name + company (optional, free-form strings)
  const name = typeof b.name === "string" ? b.name : "";
  const company = typeof b.company === "string" ? b.company : "";

  return { tier, billing_period, stream, swimlanes_accessible, email, name, company };
}

function enforceLaneCountByTier(tier: Tier, lanes: string[]): WorkerError | null {
  switch (tier) {
    case "individual":
      if (lanes.length !== 1) {
        return err(
          "swimlanes_invalid",
          `Individual tier requires exactly 1 swimlane; received ${lanes.length}.`,
          400,
        );
      }
      return null;
    case "functional_bundle":
      if (lanes.length !== 3) {
        return err(
          "swimlanes_invalid",
          `Functional Bundle requires exactly 3 swimlanes; received ${lanes.length}.`,
          400,
        );
      }
      return null;
    case "all_access":
      // Spec § 2: all_access omits swimlanes_accessible — Sales auto-fills.
      // Worker accepts either empty array (preferred) or full list (tolerated).
      return null;
  }
}

function err(code: WorkerError["error"], message: string, status: number): WorkerError {
  return { error: code, message, status };
}
