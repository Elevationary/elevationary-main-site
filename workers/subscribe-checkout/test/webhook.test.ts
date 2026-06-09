import { describe, it, expect } from "vitest";
import { routeStripeEvent, verifySignatureStub } from "../src/webhook.js";

// STUB ORS — verifies structural shape only.
// Per skeleton ORS divergence note: webhook.ts is forward-optionality, NOT
// routed in v1. These tests confirm the stub exists, refuses by default, and
// rejects malformed input. At activation, this file gets replaced with real
// Stripe-Signature HMAC verification tests.

describe("verifySignatureStub", () => {
  it("returns 501 when no webhook secret configured (v1 state)", () => {
    const r = verifySignatureStub(
      "t=1234567890,v1=" + "a".repeat(64),
      "{}",
      "",
    );
    if (!("error" in r)) throw new Error("expected error in v1 state");
    expect(r.status).toBe(501);
  });

  it("rejects missing signature header even with secret configured", () => {
    const r = verifySignatureStub(null, "{}", "whsec_fake");
    if (!("error" in r)) throw new Error("expected forbidden");
    expect(r.error).toBe("forbidden");
    expect(r.status).toBe(403);
  });

  it("rejects malformed signature header (no v1=...)", () => {
    const r = verifySignatureStub("garbage", "{}", "whsec_fake");
    if (!("error" in r)) throw new Error("expected forbidden");
    expect(r.error).toBe("forbidden");
  });

  it("rejects empty body", () => {
    const r = verifySignatureStub(
      "t=1234567890,v1=" + "a".repeat(64),
      "",
      "whsec_fake",
    );
    if (!("error" in r)) throw new Error("expected error");
    expect(r.status).toBe(400);
  });

  it("accepts structurally-valid signature header (stub only — NOT real verification)", () => {
    const r = verifySignatureStub(
      "t=1234567890,v1=" + "a".repeat(64),
      '{"id":"evt_1"}',
      "whsec_fake",
    );
    expect(r).toEqual({ ok: true });
  });
});

describe("routeStripeEvent", () => {
  it("always returns 501 in v1 (not routed)", () => {
    const r = routeStripeEvent({
      id: "evt_1",
      type: "customer.subscription.created",
      data: { object: {} },
    });
    expect(r.status).toBe(501);
  });
});
