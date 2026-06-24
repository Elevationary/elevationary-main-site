// Per-tier welcome-page copy — D1.7 / Q-WP4.a (Option B mapping ratified
// by Marketing post-wrap 2026-06-22; spec doc amendment incoming on corr
// `d17_spec_amendment_2026_06_23`).
//
// Wiring contract:
//   - TIER_DISPLAY_NAME — short label for the entitlement-tier hook.
//   - TIER_COPY         — acknowledgment / orientation / next_action triple
//                         per tier. Acknowledgment stays "You're in." across
//                         all tiers (Q-WP1 voice register).
//   - FAILURE_COPY      — Q-WP5.a / b / c variants for the failure block.
//
// Pre-stage status (2026-06-23): module is self-contained and tsc-clean.
// `welcome_handler.ts` does NOT yet import getTierCopy() — cutover is a
// two-line change (import + call) gated on Marketing's amended spec doc.
//
// Values below ARE the Marketing-ratified Option B copies verbatim from
// the 2026-06-22 EOD build_handover.md "Marketing D1.7 tier-mapping
// DECISION — landed post-wrap" section. Treat as locked; do not edit
// without Marketing brand-gate review.

import type { Tier } from "./types.js";

export const TIER_DISPLAY_NAME: Record<Tier, string> = {
  individual: "Individual",
  functional_bundle: "Functional Bundle",
  all_access: "All-Access",
};

export interface TierCopy {
  acknowledgment: string;
  orientation: string;
  nextAction: string;
}

export const TIER_COPY: Record<Tier, TierCopy> = {
  individual: {
    acknowledgment: "You're in.",
    orientation:
      "Your weekly edition arrives Wednesday morning. Edition #1 is already drafted.",
    nextAction:
      "Watch your inbox at the address you signed up with. The archive is at /editions/ when you want to revisit.",
  },
  functional_bundle: {
    acknowledgment: "You're in.",
    orientation:
      "Your three swimlane editions arrive Wednesday mornings. Edition #1 for each is already drafted.",
    nextAction:
      "Watch your inbox at the address you signed up with. The archive is at /editions/ — filter by swimlane when you want a single track.",
  },
  all_access: {
    acknowledgment: "You're in.",
    orientation:
      "All swimlanes plus shared seats. Your weekly editions arrive Wednesday morning, and All-Access companion materials publish alongside.",
    nextAction:
      "Watch your inbox. Your subscriber portal is at https://elevationary.com/account/ — manage seats and access tier from there.",
  },
};

export type FailureCase =
  | "session_invalid"      // Q-WP5.a — session_id missing/malformed/invalid
  | "stripe_unreachable"   // Q-WP5.b — Stripe API call failed
  | "mismatched_account";  // Q-WP5.c — entitlement lookup found no active sub

export interface FailureCopy {
  headline: string;
  body: string;
  nextAction: string;
}

// Q-WP4.c entitlement-read-failed fallback — session_id validates against
// Stripe but the tier lookup fails or returns `unknown`. Renders in the
// happy-path entitlement slots (Newsletter-base palette, no Clay) instead
// of unhiding the failure block. Verbatim per spec amendment 2026-06-23.
export const ENTITLEMENT_READ_FAILED_COPY: TierCopy = {
  acknowledgment: "You're in.",
  orientation: "Your subscription is active. We're loading your tier details now.",
  nextAction:
    "If the page still shows this message after a minute, your access works regardless — your first edition will arrive on schedule. Reach us at support@elevationary.com if you'd like us to verify.",
};

// Failure-state copies — verbatim per spec amendment 2026-06-23
// (d17_spec_amendment_2026_06_23, Marketing dispatch). Q-WP5.a/b/c carry
// distinct headline + body + next-action; all render in standard light-mode
// palette (no Clay).
export const FAILURE_COPY: Record<FailureCase, FailureCopy> = {
  session_invalid: {
    headline: "We can't read that subscription link.",
    body:
      "The link in your welcome email expires after a short window for security reasons. If you clicked an older copy of the email, or the link came from somewhere else, that's the cause.",
    nextAction:
      "Two options: forward your most recent welcome email to support@elevationary.com and we'll re-issue access, or sign in at https://elevationary.com/account/ if you already have an account.",
  },
  stripe_unreachable: {
    headline: "We can't reach payment confirmation right now.",
    body:
      "This is on our side — a brief outage in the subscription system. Your payment, if it went through, is recorded on Stripe's side and will reconcile automatically.",
    nextAction:
      "Reload this page in a minute. If you see this message twice in a row, email support@elevationary.com with the time you tried and we'll verify your subscription manually.",
  },
  mismatched_account: {
    headline: "This subscription link belongs to a different account.",
    body:
      "The link you clicked is valid, but it's tied to an email address that isn't this browser's logged-in account. This usually happens when a welcome email gets forwarded.",
    nextAction:
      "Sign in with the email address the welcome email was sent to, or email support@elevationary.com if you need help figuring out which account is which.",
  },
};

export function getTierDisplayName(tier: Tier): string {
  return TIER_DISPLAY_NAME[tier];
}

export function getTierCopy(tier: Tier): TierCopy {
  return TIER_COPY[tier];
}

export function getFailureCopy(kase: FailureCase): FailureCopy {
  return FAILURE_COPY[kase];
}
