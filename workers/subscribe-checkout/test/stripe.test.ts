import { describe, it, expect } from "vitest";
import {
  buildCheckoutSessionParams,
  buildMetadata,
  formEncode,
} from "../src/stripe.js";

// Spec § 2 (canonical Checkout Session payload),
// § 3.3 (bracket-notation form-encoder),
// § 6 (Stripe-Version pin).

describe("formEncode", () => {
  it("flat key-value", () => {
    expect(formEncode({ mode: "subscription" })).toBe("mode=subscription");
  });

  it("URL-encodes special chars in values", () => {
    expect(formEncode({ customer_email: "alice@acme.com" })).toBe(
      "customer_email=alice%40acme.com",
    );
  });

  it("nested object → bracket-notation", () => {
    const out = formEncode({
      subscription_data: { metadata: { contact_id: "ct_alice_acme_com" } },
    });
    expect(out).toBe(
      "subscription_data%5Bmetadata%5D%5Bcontact_id%5D=ct_alice_acme_com",
    );
  });

  it("array of objects → numeric indices", () => {
    const out = formEncode({
      line_items: [{ price: "price_X", quantity: 1 }],
    });
    expect(out).toContain("line_items%5B0%5D%5Bprice%5D=price_X");
    expect(out).toContain("line_items%5B0%5D%5Bquantity%5D=1");
  });

  it("comma in CSV string is URL-encoded as %2C", () => {
    const out = formEncode({
      subscription_data: {
        metadata: {
          swimlanes_accessible:
            "commercial_a,commercial_b,commercial_c",
        },
      },
    });
    expect(out).toContain("commercial_a%2Ccommercial_b%2Ccommercial_c");
  });

  it("Stripe template literal {CHECKOUT_SESSION_ID} URL-encodes the braces", () => {
    const out = formEncode({
      success_url:
        "https://elevationary.com/subscribe/welcome/?session_id={CHECKOUT_SESSION_ID}",
    });
    expect(out).toContain("%7BCHECKOUT_SESSION_ID%7D");
  });

  it("skips undefined and null values", () => {
    const out = formEncode({ a: 1, b: undefined, c: null, d: "x" });
    expect(out).toBe("a=1&d=x");
  });
});

describe("buildMetadata", () => {
  it("Functional Bundle includes swimlanes_accessible CSV", () => {
    const m = buildMetadata({
      ctId: "ct_alice_acme_com",
      tier: "functional_bundle",
      stream: "commercial",
      lanes: ["commercial_a", "commercial_b", "commercial_c"],
    });
    expect(m.contact_id).toBe("ct_alice_acme_com");
    expect(m.tier).toBe("functional_bundle");
    expect(m.stream).toBe("commercial");
    expect(m.swimlanes_accessible).toBe("commercial_a,commercial_b,commercial_c");
    expect(m.source).toBe("stripe_checkout_elevationary_com");
  });

  it("All-Access OMITS swimlanes_accessible (Sales auto-fills)", () => {
    const m = buildMetadata({
      ctId: "ct_alice_acme_com",
      tier: "all_access",
      stream: "commercial",
      lanes: [],
    });
    expect(m.swimlanes_accessible).toBeUndefined();
  });

  it("Individual includes single lane", () => {
    const m = buildMetadata({
      ctId: "ct_alice_acme_com",
      tier: "individual",
      stream: "commercial",
      lanes: ["commercial_leadership_aim"],
    });
    expect(m.swimlanes_accessible).toBe("commercial_leadership_aim");
  });
});

describe("buildCheckoutSessionParams", () => {
  it("constructs canonical spec § 2 payload shape", () => {
    const params = buildCheckoutSessionParams({
      priceId: "price_FUNCTIONAL_BUNDLE_MONTHLY",
      email: "alice@acme.com",
      metadata: {
        contact_id: "ct_alice_acme_com",
        stream: "commercial",
        tier: "functional_bundle",
        swimlanes_accessible: "commercial_a,commercial_b,commercial_c",
        source: "stripe_checkout_elevationary_com",
      },
    });
    expect(params.mode).toBe("subscription");
    expect(params.customer_email).toBe("alice@acme.com");
    expect(params.line_items[0].price).toBe("price_FUNCTIONAL_BUNDLE_MONTHLY");
    expect(params.line_items[0].quantity).toBe(1);
    expect(params.subscription_data.metadata.contact_id).toBe("ct_alice_acme_com");
    expect(params.success_url).toContain("{CHECKOUT_SESSION_ID}");
    expect(params.cancel_url).toContain("cancelled=1");
  });

  it("encodes end-to-end to spec § 3.3 bracket-notation shape", () => {
    const params = buildCheckoutSessionParams({
      priceId: "price_X",
      email: "a@b.co",
      metadata: {
        contact_id: "ct_a_b_co",
        stream: "commercial",
        tier: "individual",
        swimlanes_accessible: "commercial_leadership_aim",
        source: "stripe_checkout_elevationary_com",
      },
    });
    const encoded = formEncode(params as unknown as Record<string, unknown>);
    expect(encoded).toContain("mode=subscription");
    expect(encoded).toContain("customer_email=a%40b.co");
    expect(encoded).toContain("line_items%5B0%5D%5Bprice%5D=price_X");
    expect(encoded).toContain(
      "subscription_data%5Bmetadata%5D%5Bcontact_id%5D=ct_a_b_co",
    );
    expect(encoded).toContain(
      "subscription_data%5Bmetadata%5D%5Btier%5D=individual",
    );
  });
});
