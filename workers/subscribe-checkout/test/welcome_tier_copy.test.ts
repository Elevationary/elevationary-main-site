// D1.7 / Q-WP4.a per-tier copy scaffold — verifies the lookup helpers
// resolve every tier + failure case to a non-empty value. Pre-stage tests:
// when Marketing's amended spec lands on `d17_spec_amendment_2026_06_23`,
// these tests stay green and the cutover edits welcome_handler.ts only.

import { describe, expect, it } from "vitest";

import type { Tier } from "../src/types.js";
import {
  FAILURE_COPY,
  TIER_COPY,
  TIER_DISPLAY_NAME,
  getFailureCopy,
  getTierCopy,
  getTierDisplayName,
} from "../src/welcome_tier_copy.js";

const ALL_TIERS: readonly Tier[] = [
  "individual",
  "functional_bundle",
  "all_access",
];

describe("welcome_tier_copy — Q-WP4.a per-tier scaffolding", () => {
  it("TIER_DISPLAY_NAME covers every Stripe tier enum", () => {
    for (const tier of ALL_TIERS) {
      expect(TIER_DISPLAY_NAME[tier]).toBeTruthy();
    }
  });

  it("TIER_COPY exposes acknowledgment + orientation + nextAction per tier", () => {
    for (const tier of ALL_TIERS) {
      const copy = TIER_COPY[tier];
      expect(copy.acknowledgment).toBeTruthy();
      expect(copy.orientation).toBeTruthy();
      expect(copy.nextAction).toBeTruthy();
    }
  });

  it("acknowledgment is the locked Q-WP1 voice register across every tier", () => {
    // Locked-tier-defaults rule (build_handover 2026-06-22): every tier
    // opens with "You're in." Acknowledgment is tier-invariant by design.
    for (const tier of ALL_TIERS) {
      expect(TIER_COPY[tier].acknowledgment).toBe("You're in.");
    }
  });

  it("FAILURE_COPY covers session_invalid + stripe_unreachable + mismatched_account with headline + body + nextAction", () => {
    for (const k of ["session_invalid", "stripe_unreachable", "mismatched_account"] as const) {
      expect(FAILURE_COPY[k].headline).toBeTruthy();
      expect(FAILURE_COPY[k].body).toBeTruthy();
      expect(FAILURE_COPY[k].nextAction).toBeTruthy();
    }
  });

  it("FAILURE_COPY copy is verbatim per d17_spec_amendment_2026_06_23", () => {
    expect(FAILURE_COPY.session_invalid.headline).toBe(
      "We can't read that subscription link.",
    );
    expect(FAILURE_COPY.stripe_unreachable.headline).toBe(
      "We can't reach payment confirmation right now.",
    );
    expect(FAILURE_COPY.mismatched_account.headline).toBe(
      "This subscription link belongs to a different account.",
    );
  });

  it("getTierDisplayName + getTierCopy + getFailureCopy are pass-through accessors", () => {
    expect(getTierDisplayName("all_access")).toBe(TIER_DISPLAY_NAME.all_access);
    expect(getTierCopy("functional_bundle")).toBe(TIER_COPY.functional_bundle);
    expect(getFailureCopy("session_invalid")).toBe(FAILURE_COPY.session_invalid);
  });
});
