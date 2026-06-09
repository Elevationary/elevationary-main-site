import { describe, it, expect } from "vitest";
import { deriveCtId } from "../src/ct_id.js";

// Spec § 3.4 — ct_id derivation algorithm.

describe("deriveCtId", () => {
  it("simple email → ct_<local>_<domain_with_dots_as_underscores>", () => {
    expect(deriveCtId("alice@acme.com")).toBe("ct_alice_acme_com");
  });

  it("uppercase normalized to lowercase", () => {
    expect(deriveCtId("Alice@Acme.com")).toBe("ct_alice_acme_com");
  });

  it("plus-addressing stripped from local-part", () => {
    expect(deriveCtId("alice+work@acme.com")).toBe("ct_alice_acme_com");
    expect(deriveCtId("alice+home@acme.com")).toBe("ct_alice_acme_com");
    expect(deriveCtId("alice+anything-goes@acme.com")).toBe("ct_alice_acme_com");
  });

  it("dots in local-part become underscores", () => {
    expect(deriveCtId("alice.smith@acme.com")).toBe("ct_alice_smith_acme_com");
  });

  it("multi-label TLD handled by uniform underscore substitution", () => {
    expect(deriveCtId("alice@acme.co.uk")).toBe("ct_alice_acme_co_uk");
  });

  it("plus-addressing + dots + multi-label TLD compose correctly", () => {
    expect(deriveCtId("Alice.Smith+work@acme.CO.uk")).toBe("ct_alice_smith_acme_co_uk");
  });

  it("hyphens preserved in domain", () => {
    expect(deriveCtId("alice@elevationary-main.com")).toBe(
      "ct_alice_elevationary-main_com",
    );
  });
});
