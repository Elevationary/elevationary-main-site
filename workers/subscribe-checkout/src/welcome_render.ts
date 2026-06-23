// SSR layer for /subscribe/welcome/* — applies an Entitlement (or failure
// context) onto Marketing's brand-applied shell HTML by mutating seven
// `data-hook="entitlement-*"` elements server-side via HTMLRewriter.
//
// Marketing contract (D2.1, locked 2026-06-21, corr d21_dom_hooks_adc2218e):
//
//   data-hook="entitlement-shell"          — SSR root wrapper (scope)
//   data-hook="entitlement-tier"           — text node, tier label
//   data-hook="entitlement-swimlanes"      — container, one <li> per swimlane
//   data-hook="entitlement-billing-next"   — text node, ISO date
//   data-hook="entitlement-portal-link"    — anchor, href attribute
//   data-hook="entitlement-upsell"         — container; child cards have
//                                            data-hook="entitlement-upsell-card"
//                                            and data-upsell-tier="<tier-slug>"
//   data-hook="entitlement-failure"        — hidden by default; unhide on err
//
// Conventions:
//   - Happy-path defaults rendered in the static shell so the page degrades
//     gracefully if the Worker subrequest fails.
//   - On failure, entitlement slots keep their static defaults; only the
//     entitlement-failure block is un-hidden + its message hook populated.
//
// Module shape: pure-logic helpers exported for unit tests; the
// renderWelcomePage orchestrator uses HTMLRewriter and is verified at
// Worker smoke test (HTMLRewriter is not available in vitest's Node env).

import type { Entitlement, Tier, WelcomeFailure } from "./types.js";

const UPSELL_TIER_SLUG: Record<Tier, string> = {
  individual: "individual",
  functional_bundle: "functional_bundle",
  all_access: "all_access",
};

// ---- pure-logic helpers (unit-testable in Node) -------------------------

/** Build the inner HTML for the entitlement-swimlanes container — one li per slug. */
export function buildSwimlaneItemsHtml(slugs: readonly string[]): string {
  return slugs
    .map(
      (slug) =>
        `<li data-hook="entitlement-swimlane-item" data-swimlane-id="${
          escapeAttr(slug)
        }">${escapeText(slug)}</li>`,
    )
    .join("");
}

/** Decide whether to omit an upsell card given the subscriber's current tier. */
export function shouldOmitUpsellCard(
  cardTier: string | null,
  currentTier: Tier,
): boolean {
  return cardTier === UPSELL_TIER_SLUG[currentTier];
}

/** HTML text-node escaper — defense-in-depth on user-derived strings. */
export function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** HTML attribute-value escaper — additionally escapes ". */
export function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}

// ---- HTMLRewriter orchestrator (Worker-runtime only) --------------------

/**
 * Apply an Entitlement to Marketing's shell HTML. Returns a transformed
 * Response that streams the mutated body to the caller. The shell MUST be
 * valid HTML with the seven `data-hook` slots present (per D2.1 contract).
 *
 * Failure UX: when `failure` is supplied (entitlement is null), the
 * entitlement slots are left at their static-shell defaults and only the
 * entitlement-failure block is un-hidden.
 *
 * NOTE: HTMLRewriter is a Cloudflare-runtime global; this function executes
 * inside workerd, not vitest's Node env. Smoke-tested at Worker deploy time.
 */
export function renderWelcomePage(
  shellHtml: string,
  entitlement: Entitlement | null,
  failure: WelcomeFailure | null,
): Response {
  const shellResponse = new Response(shellHtml, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

  let rewriter = new HTMLRewriter();

  if (entitlement) {
    rewriter = rewriter
      .on(
        '[data-hook="entitlement-tier"]',
        new TextNodeHandler(entitlement.tierLabel),
      )
      .on(
        '[data-hook="entitlement-billing-next"]',
        new TextNodeHandler(entitlement.billingNextIso),
      )
      .on(
        '[data-hook="entitlement-portal-link"]',
        new HrefHandler(entitlement.portalUrl),
      )
      .on(
        '[data-hook="entitlement-swimlanes"]',
        new SwimlanesHandler(entitlement.swimlanes),
      )
      .on(
        '[data-hook="entitlement-upsell-card"]',
        new UpsellOmitHandler(entitlement.tier),
      );
  }

  if (failure) {
    rewriter = rewriter
      .on('[data-hook="entitlement-failure"]', new UnhideHandler())
      .on(
        '[data-hook="entitlement-failure-message"]',
        new TextNodeHandler(failure.message),
      );
  }

  return rewriter.transform(shellResponse);
}

class TextNodeHandler {
  constructor(readonly value: string) {}
  element(el: Element): void {
    el.setInnerContent(this.value, { html: false });
  }
}

class HrefHandler {
  constructor(readonly href: string) {}
  element(el: Element): void {
    el.setAttribute("href", this.href);
  }
}

class SwimlanesHandler {
  constructor(readonly slugs: readonly string[]) {}
  element(el: Element): void {
    el.setInnerContent(buildSwimlaneItemsHtml(this.slugs), { html: true });
  }
}

class UpsellOmitHandler {
  constructor(readonly currentTier: Tier) {}
  element(el: Element): void {
    const cardTier = el.getAttribute("data-upsell-tier");
    if (shouldOmitUpsellCard(cardTier, this.currentTier)) {
      el.remove();
    }
  }
}

class UnhideHandler {
  element(el: Element): void {
    el.removeAttribute("hidden");
  }
}
