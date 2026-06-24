// D1.7 cutover — verifies Worker error code → Q-WP5 failure case mapping
// per spec amendment 2026-06-23. The mapping drives which verbatim copy
// the welcome page renders when entitlement resolution fails.

import { describe, expect, it } from "vitest";

import type { WelcomeFailure } from "../src/types.js";
import { mapWorkerCodeToFailureCase } from "../src/welcome_render.js";

function f(code: WelcomeFailure["code"]): WelcomeFailure {
  return { code, message: "test" };
}

describe("mapWorkerCodeToFailureCase — Q-WP5 discriminator", () => {
  it("session_id_missing → session_invalid (Q-WP5.a)", () => {
    expect(mapWorkerCodeToFailureCase(f("session_id_missing"))).toBe("session_invalid");
  });

  it("session_id_malformed → session_invalid (Q-WP5.a)", () => {
    expect(mapWorkerCodeToFailureCase(f("session_id_malformed"))).toBe("session_invalid");
  });

  it("session_id_invalid → session_invalid (Q-WP5.a)", () => {
    expect(mapWorkerCodeToFailureCase(f("session_id_invalid"))).toBe("session_invalid");
  });

  it("stripe_session_retrieve_failed → stripe_unreachable (Q-WP5.b)", () => {
    expect(mapWorkerCodeToFailureCase(f("stripe_session_retrieve_failed"))).toBe(
      "stripe_unreachable",
    );
  });

  it("entitlement_lookup_failed → mismatched_account (Q-WP5.c)", () => {
    expect(mapWorkerCodeToFailureCase(f("entitlement_lookup_failed"))).toBe(
      "mismatched_account",
    );
  });

  it("unknown Worker codes default to session_invalid (defensive default)", () => {
    expect(mapWorkerCodeToFailureCase(f("internal"))).toBe("session_invalid");
    expect(mapWorkerCodeToFailureCase(f("rate_limited"))).toBe("session_invalid");
  });
});
