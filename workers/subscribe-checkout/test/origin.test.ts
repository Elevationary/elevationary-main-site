import { describe, it, expect } from "vitest";
import { corsHeaders, isOriginAllowed } from "../src/origin.js";
import type { Env } from "../src/types.js";

// Spec § 3.8 — Origin allow-list per env.

function mkEnv(allowed: string, workerEnv = "production"): Env {
  return {
    WORKER_ENV: workerEnv,
    ALLOWED_ORIGINS: allowed,
    STRIPE_API_VERSION: "2025-08-27.basil",
    DRY_RUN_CONTACT_WRITE: "false",
    STRIPE_SECRET_KEY: "",
    STRIPE_PRICE_INDIVIDUAL_MONTHLY: "",
    STRIPE_PRICE_BUNDLE_MONTHLY: "",
    STRIPE_PRICE_ALL_ACCESS_MONTHLY: "",
  };
}

describe("isOriginAllowed", () => {
  const prod = mkEnv("https://elevationary.com,https://www.elevationary.com");

  it("production accepts apex", () => {
    expect(isOriginAllowed("https://elevationary.com", prod)).toBe(true);
  });

  it("production accepts www", () => {
    expect(isOriginAllowed("https://www.elevationary.com", prod)).toBe(true);
  });

  it("production rejects http://elevationary.com (scheme mismatch)", () => {
    expect(isOriginAllowed("http://elevationary.com", prod)).toBe(false);
  });

  it("production rejects unrelated origin", () => {
    expect(isOriginAllowed("https://attacker.com", prod)).toBe(false);
  });

  it("rejects null origin", () => {
    expect(isOriginAllowed(null, prod)).toBe(false);
  });

  it("rejects empty origin", () => {
    expect(isOriginAllowed("", prod)).toBe(false);
  });

  it("preview accepts *.elevationary-main-site.pages.dev suffix", () => {
    const preview = mkEnv(
      "https://elevationary.com,http://localhost:8788",
      "preview",
    );
    expect(
      isOriginAllowed("https://abc123.elevationary-main-site.pages.dev", preview),
    ).toBe(true);
  });

  it("production does NOT accept *.pages.dev suffix (preview-only)", () => {
    expect(
      isOriginAllowed(
        "https://abc123.elevationary-main-site.pages.dev",
        prod,
      ),
    ).toBe(false);
  });

  it("preview accepts localhost", () => {
    const preview = mkEnv(
      "https://elevationary.com,http://localhost:8788",
      "preview",
    );
    expect(isOriginAllowed("http://localhost:8788", preview)).toBe(true);
  });
});

describe("corsHeaders", () => {
  const prod = mkEnv("https://elevationary.com,https://www.elevationary.com");

  it("returns headers when origin allowed", () => {
    const h = corsHeaders("https://elevationary.com", prod) as Record<string, string>;
    expect(h["Access-Control-Allow-Origin"]).toBe("https://elevationary.com");
    expect(h["Access-Control-Allow-Methods"]).toContain("POST");
    expect(h.Vary).toBe("Origin");
  });

  it("returns empty headers when origin disallowed (no wildcard)", () => {
    const h = corsHeaders("https://attacker.com", prod) as Record<string, string>;
    expect(h["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});
