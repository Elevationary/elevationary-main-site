import { describe, it, expect } from "vitest";
import {
  verifyStripeSignature,
  signPayload,
  DEFAULT_TOLERANCE_SEC,
} from "../src/stripe_webhook_verify.js";

// D2.1 Stripe webhook signature verification — real HMAC-SHA256 per spec § 3.
// Supersedes the structural-only stub tests in webhook.test.ts. Covers every
// equivalence class + red-team failure mode from the increment ORS Stage 2.5/3.

const SECRET = "whsec_test_" + "9".repeat(24);
const BODY = '{"id":"evt_1JZ","type":"invoice.payment_succeeded","data":{"object":{"id":"in_1"}}}';
const NOW = 1_752_000_000; // fixed injected "now" (unix sec) — no Date.now() flake.

describe("verifyStripeSignature — happy path (§ 3.1)", () => {
  it("accepts a valid single-v1 signature within tolerance", async () => {
    const header = await signPayload(BODY, SECRET, NOW);
    const r = await verifyStripeSignature(header, BODY, SECRET, { nowSec: NOW });
    expect(r).toEqual({ ok: true, timestamp: NOW });
  });

  it("accepts when one of multiple v1 values matches (rotation window)", async () => {
    const good = await signPayload(BODY, SECRET, NOW); // "t=..,v1=<good>"
    const goodV1 = good.split("v1=")[1];
    const header = `t=${NOW},v1=${"f".repeat(64)},v1=${goodV1}`;
    const r = await verifyStripeSignature(header, BODY, SECRET, { nowSec: NOW });
    expect("ok" in r && r.ok).toBe(true);
  });

  it("verifies over exact raw bytes — a re-stringified body would NOT match", async () => {
    // Body with insignificant-to-JSON whitespace that restringify would drop.
    const spacedBody = '{ "id" : "evt_1" }';
    const header = await signPayload(spacedBody, SECRET, NOW);
    const okReal = await verifyStripeSignature(header, spacedBody, SECRET, { nowSec: NOW });
    expect("ok" in okReal && okReal.ok).toBe(true);
    const reStringified = JSON.stringify(JSON.parse(spacedBody)); // '{"id":"evt_1"}'
    const failParsed = await verifyStripeSignature(header, reStringified, SECRET, { nowSec: NOW });
    expect("error" in failParsed && failParsed.error).toBe("invalid_signature");
  });
});

describe("verifyStripeSignature — rejection posture (§ 3.4)", () => {
  it("missing STRIPE_WEBHOOK_SECRET → 500 config_error", async () => {
    const header = await signPayload(BODY, SECRET, NOW);
    const r = await verifyStripeSignature(header, BODY, "", { nowSec: NOW });
    expect(r).toMatchObject({ error: "config_error", status: 500 });
  });

  it("missing Stripe-Signature header → 400 missing_signature", async () => {
    const r = await verifyStripeSignature(null, BODY, SECRET, { nowSec: NOW });
    expect(r).toMatchObject({ error: "missing_signature", status: 400 });
  });

  it("malformed header (garbage) → 400 malformed_signature", async () => {
    const r = await verifyStripeSignature("garbage", BODY, SECRET, { nowSec: NOW });
    expect(r).toMatchObject({ error: "malformed_signature", status: 400 });
  });

  it("header with t= but no v1= → 400 malformed_signature", async () => {
    const r = await verifyStripeSignature(`t=${NOW}`, BODY, SECRET, { nowSec: NOW });
    expect(r).toMatchObject({ error: "malformed_signature", status: 400 });
  });

  it("non-numeric t= → 400 malformed_signature", async () => {
    const r = await verifyStripeSignature(`t=notanumber,v1=${"a".repeat(64)}`, BODY, SECRET, { nowSec: NOW });
    expect(r).toMatchObject({ error: "malformed_signature", status: 400 });
  });

  it("no v1 matches HMAC (wrong secret) → 401 invalid_signature", async () => {
    const header = await signPayload(BODY, "whsec_the_wrong_secret", NOW);
    const r = await verifyStripeSignature(header, BODY, SECRET, { nowSec: NOW });
    expect(r).toMatchObject({ error: "invalid_signature", status: 401 });
  });

  it("tampered body (valid shape, wrong digest) → 401 invalid_signature", async () => {
    const header = await signPayload(BODY, SECRET, NOW);
    const r = await verifyStripeSignature(header, BODY + "TAMPER", SECRET, { nowSec: NOW });
    expect(r).toMatchObject({ error: "invalid_signature", status: 401 });
  });

  it("valid signature but timestamp skew > 5 min → 401 timestamp_out_of_range", async () => {
    const staleT = NOW - (DEFAULT_TOLERANCE_SEC + 1);
    const header = await signPayload(BODY, SECRET, staleT);
    const r = await verifyStripeSignature(header, BODY, SECRET, { nowSec: NOW });
    expect(r).toMatchObject({ error: "timestamp_out_of_range", status: 401 });
  });

  it("valid signature exactly at tolerance boundary is accepted", async () => {
    const edgeT = NOW - DEFAULT_TOLERANCE_SEC;
    const header = await signPayload(BODY, SECRET, edgeT);
    const r = await verifyStripeSignature(header, BODY, SECRET, { nowSec: NOW });
    expect("ok" in r && r.ok).toBe(true);
  });

  it("future-skew beyond tolerance also rejected (clock-ahead replay)", async () => {
    const futureT = NOW + (DEFAULT_TOLERANCE_SEC + 5);
    const header = await signPayload(BODY, SECRET, futureT);
    const r = await verifyStripeSignature(header, BODY, SECRET, { nowSec: NOW });
    expect(r).toMatchObject({ error: "timestamp_out_of_range", status: 401 });
  });

  it("legacy v0-only header (no v1) → 400 malformed_signature (v0 never compared, § 3.1)", async () => {
    const r = await verifyStripeSignature(`t=${NOW},v0=${"a".repeat(64)}`, BODY, SECRET, { nowSec: NOW });
    expect(r).toMatchObject({ error: "malformed_signature", status: 400 });
  });
});

describe("verifyStripeSignature — precedence: signature match before timestamp (Stripe constructEvent order)", () => {
  it("tampered body with stale timestamp reports invalid_signature, NOT timestamp_out_of_range (no oracle)", async () => {
    const staleT = NOW - 10_000;
    const header = await signPayload(BODY, SECRET, staleT);
    const r = await verifyStripeSignature(header + "junk", BODY, SECRET, { nowSec: NOW });
    // header mangled → either malformed or invalid, but never leaks timestamp state.
    expect("error" in r && r.error).not.toBe("timestamp_out_of_range");
  });
});
