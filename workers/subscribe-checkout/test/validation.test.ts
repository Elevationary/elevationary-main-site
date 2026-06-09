import { describe, it, expect } from "vitest";
import {
  deriveStream,
  normalizeEmail,
  validateCheckoutRequest,
  validateEmail,
} from "../src/validation.js";

// Spec § 3.2 (email), § 3.5 (stream derivation), § 3 step 1 (request validation).

describe("validateEmail", () => {
  it("accepts a simple valid email", () => {
    expect(validateEmail("alice@acme.com")).toBeNull();
  });

  it("accepts multi-label TLD", () => {
    expect(validateEmail("alice@acme.co.uk")).toBeNull();
  });

  it("rejects empty string", () => {
    const r = validateEmail("");
    expect(r?.error).toBe("email_invalid");
  });

  it("rejects missing @", () => {
    const r = validateEmail("noatsign");
    expect(r?.error).toBe("email_invalid");
  });

  it("rejects missing TLD", () => {
    const r = validateEmail("alice@acme");
    expect(r?.error).toBe("email_invalid");
  });

  it("rejects > 254 chars (RFC 5321 max)", () => {
    const long = "a".repeat(250) + "@b.co"; // 256 chars
    const r = validateEmail(long);
    expect(r?.error).toBe("email_invalid");
  });

  it("rejects unicode local-part per simplified regex", () => {
    const r = validateEmail("josé@acme.com");
    expect(r?.error).toBe("email_invalid");
  });
});

describe("normalizeEmail", () => {
  it("lowercases", () => {
    expect(normalizeEmail("Alice@Acme.COM")).toBe("alice@acme.com");
  });
});

describe("deriveStream", () => {
  it("3 commercial_* lanes → commercial", () => {
    expect(
      deriveStream([
        "commercial_marketing_demand_generation",
        "commercial_sales_revenue_operations",
        "commercial_leadership_aim",
      ]),
    ).toBe("commercial");
  });

  it("3 nonprofit_* lanes → nonprofit", () => {
    expect(
      deriveStream([
        "nonprofit_a",
        "nonprofit_b",
        "nonprofit_c",
      ]),
    ).toBe("nonprofit");
  });

  it("mixed-stream → null", () => {
    expect(
      deriveStream([
        "commercial_a",
        "commercial_b",
        "nonprofit_c",
      ]),
    ).toBeNull();
  });

  it("empty array → null (all_access path; Sales auto-fills)", () => {
    expect(deriveStream([])).toBeNull();
  });

  it("unknown prefix → null", () => {
    expect(deriveStream(["industrial_xyz"])).toBeNull();
  });
});

describe("validateCheckoutRequest", () => {
  const baseValid = {
    tier: "functional_bundle",
    billing_period: "monthly",
    stream: "commercial",
    swimlanes_accessible: [
      "commercial_marketing_demand_generation",
      "commercial_sales_revenue_operations",
      "commercial_leadership_aim",
    ],
    email: "alice@acme.com",
    name: "Alice Anderson",
    company: "Acme Corp",
  };

  it("accepts canonical Functional Bundle request", () => {
    const r = validateCheckoutRequest(baseValid);
    if ("error" in r) throw new Error(`expected ok, got ${r.error}`);
    expect(r.tier).toBe("functional_bundle");
    expect(r.email).toBe("alice@acme.com");
    expect(r.swimlanes_accessible).toHaveLength(3);
  });

  it("accepts Individual with 1 lane", () => {
    const r = validateCheckoutRequest({
      ...baseValid,
      tier: "individual",
      swimlanes_accessible: ["commercial_leadership_aim"],
    });
    expect("error" in r).toBe(false);
  });

  it("accepts All-Access with empty lane array", () => {
    const r = validateCheckoutRequest({
      ...baseValid,
      tier: "all_access",
      swimlanes_accessible: [],
    });
    expect("error" in r).toBe(false);
  });

  it("rejects unknown tier", () => {
    const r = validateCheckoutRequest({ ...baseValid, tier: "enterprise" });
    if (!("error" in r)) throw new Error("expected error");
    expect(r.error).toBe("tier_invalid");
  });

  it("rejects unknown stream", () => {
    const r = validateCheckoutRequest({ ...baseValid, stream: "industrial" });
    if (!("error" in r)) throw new Error("expected error");
    expect(r.error).toBe("stream_invalid");
  });

  it("rejects Individual with 2 lanes", () => {
    const r = validateCheckoutRequest({
      ...baseValid,
      tier: "individual",
      swimlanes_accessible: ["commercial_a", "commercial_b"],
    });
    if (!("error" in r)) throw new Error("expected error");
    expect(r.error).toBe("swimlanes_invalid");
  });

  it("rejects Functional Bundle with 2 lanes", () => {
    const r = validateCheckoutRequest({
      ...baseValid,
      swimlanes_accessible: ["commercial_a", "commercial_b"],
    });
    if (!("error" in r)) throw new Error("expected error");
    expect(r.error).toBe("swimlanes_invalid");
  });

  it("rejects mixed-stream lanes", () => {
    const r = validateCheckoutRequest({
      ...baseValid,
      swimlanes_accessible: ["commercial_a", "commercial_b", "nonprofit_c"],
    });
    if (!("error" in r)) throw new Error("expected error");
    expect(r.error).toBe("swimlanes_invalid");
  });

  it("rejects stream/lane prefix mismatch", () => {
    const r = validateCheckoutRequest({
      ...baseValid,
      stream: "nonprofit",
      swimlanes_accessible: [
        "commercial_a",
        "commercial_b",
        "commercial_c",
      ],
    });
    if (!("error" in r)) throw new Error("expected error");
    expect(r.error).toBe("swimlanes_invalid");
  });

  it("rejects unknown billing_period", () => {
    const r = validateCheckoutRequest({ ...baseValid, billing_period: "weekly" });
    if (!("error" in r)) throw new Error("expected error");
    expect(r.error).toBe("billing_period_invalid");
  });

  it("rejects malformed email", () => {
    const r = validateCheckoutRequest({ ...baseValid, email: "noatsign" });
    if (!("error" in r)) throw new Error("expected error");
    expect(r.error).toBe("email_invalid");
  });

  it("rejects non-array swimlanes_accessible", () => {
    const r = validateCheckoutRequest({
      ...baseValid,
      swimlanes_accessible: "commercial_a,commercial_b,commercial_c" as unknown as string[],
    });
    if (!("error" in r)) throw new Error("expected error");
    expect(r.error).toBe("swimlanes_invalid");
  });

  it("rejects null body", () => {
    const r = validateCheckoutRequest(null);
    if (!("error" in r)) throw new Error("expected error");
    expect(r.error).toBe("internal");
  });
});
