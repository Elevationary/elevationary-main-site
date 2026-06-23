// Unit tests for the welcome-page SSR module — pure-logic helpers.
//
// The renderWelcomePage orchestrator uses HTMLRewriter (Cloudflare runtime
// global) and is verified at Worker smoke test, not here. These tests
// exercise the helpers that build the strings HTMLRewriter splices in.

import { describe, expect, it } from "vitest";
import {
  buildSwimlaneItemsHtml,
  escapeAttr,
  escapeText,
  shouldOmitUpsellCard,
} from "../src/welcome_render.js";

describe("buildSwimlaneItemsHtml", () => {
  it("emits one li per slug with both data-hook and data-swimlane-id attrs", () => {
    const html = buildSwimlaneItemsHtml([
      "commercial_marketing_demand_generation",
      "commercial_sales_pipeline",
    ]);
    expect(html).toContain(
      `data-swimlane-id="commercial_marketing_demand_generation"`,
    );
    expect(html).toContain(`data-swimlane-id="commercial_sales_pipeline"`);
    expect(html.match(/<li /g)?.length).toBe(2);
    expect(html).toContain(`data-hook="entitlement-swimlane-item"`);
  });

  it("returns an empty string for zero swimlanes", () => {
    expect(buildSwimlaneItemsHtml([])).toBe("");
  });

  it("HTML-escapes slug content so injection in slug data cannot break out", () => {
    const html = buildSwimlaneItemsHtml(["<script>alert(1)</script>"]);
    expect(html).not.toContain(`<script>alert(1)</script>`);
    expect(html).toContain(`&lt;script&gt;alert(1)&lt;/script&gt;`);
  });

  it("escapes double-quotes in attribute values", () => {
    const html = buildSwimlaneItemsHtml([`evil"onload="x`]);
    expect(html).not.toContain(`evil"onload="x"`);
    expect(html).toContain(`&quot;onload=&quot;`);
  });
});

describe("shouldOmitUpsellCard", () => {
  it("omits the card matching the subscriber's current tier (individual)", () => {
    expect(shouldOmitUpsellCard("individual", "individual")).toBe(true);
    expect(shouldOmitUpsellCard("functional_bundle", "individual")).toBe(false);
    expect(shouldOmitUpsellCard("all_access", "individual")).toBe(false);
  });

  it("omits the card matching the subscriber's current tier (functional_bundle)", () => {
    expect(shouldOmitUpsellCard("functional_bundle", "functional_bundle")).toBe(true);
    expect(shouldOmitUpsellCard("individual", "functional_bundle")).toBe(false);
    expect(shouldOmitUpsellCard("all_access", "functional_bundle")).toBe(false);
  });

  it("omits the card matching the subscriber's current tier (all_access)", () => {
    expect(shouldOmitUpsellCard("all_access", "all_access")).toBe(true);
    expect(shouldOmitUpsellCard("individual", "all_access")).toBe(false);
    expect(shouldOmitUpsellCard("functional_bundle", "all_access")).toBe(false);
  });

  it("keeps the card when data-upsell-tier is missing (null)", () => {
    expect(shouldOmitUpsellCard(null, "individual")).toBe(false);
    expect(shouldOmitUpsellCard(null, "all_access")).toBe(false);
  });

  it("keeps the card on unknown / typo'd tier slugs", () => {
    expect(shouldOmitUpsellCard("enterprise", "individual")).toBe(false);
    expect(shouldOmitUpsellCard("Individual", "individual")).toBe(false); // case-sensitive
  });
});

describe("escapeText", () => {
  it("escapes & < >", () => {
    expect(escapeText("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
  });

  it("escapes & first to avoid double-escaping", () => {
    expect(escapeText("&lt;")).toBe("&amp;lt;");
  });

  it("passes plain strings through unchanged", () => {
    expect(escapeText("commercial_marketing_demand_generation")).toBe(
      "commercial_marketing_demand_generation",
    );
  });
});

describe("escapeAttr", () => {
  it("escapes & < > and also \"", () => {
    expect(escapeAttr(`x"y<z>&`)).toBe(`x&quot;y&lt;z&gt;&amp;`);
  });

  it("does not escape single quotes (HTML5 attribute values delimited by double quote in our output)", () => {
    expect(escapeAttr(`it's`)).toBe(`it's`);
  });
});
