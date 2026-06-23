/* Elevationary BVP — client-side hook for tier-card subscribe CTAs.
 *
 * Status: PRE-STAGE (Day 2). The script is committed but not yet loaded
 * by any surface. To activate (Day 3, post-LIVE-Stripe-activation):
 *   1. Add `<script defer src="/assets/bvp-checkout.js"></script>` to
 *      src/subscribe/index.njk just before the closing </main>.
 *   2. Optional: set `window.BVP_CHECKOUT_LIVE = true` inline before the
 *      script tag to enable network-bound behavior. While the flag is
 *      false, the script wires the listeners but defers to native anchor
 *      navigation — safe to ship behind a flag.
 *
 * Endpoint: POST /api/checkout — handled by subscribe-checkout Worker
 * (workers/subscribe-checkout/). See spec § 3 for the request contract.
 *
 * Pre-stage behavior verified by build, not by network test. Network
 * verification waits on task_b0d86b20 (LIVE activation) + the email
 * collection form which D1.2 has not yet promoted to a component.
 */

(function () {
  "use strict";

  if (typeof document === "undefined") return;

  function selectTierSlug(buttonEl) {
    var card = buttonEl.closest("[data-tier]");
    return card ? card.getAttribute("data-tier") : null;
  }

  function isCheckoutLive() {
    return typeof window !== "undefined" && window.BVP_CHECKOUT_LIVE === true;
  }

  function postCheckout(body) {
    return fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
    });
  }

  function onSignupClick(ev) {
    var trigger = ev.currentTarget;
    var tier = selectTierSlug(trigger);
    if (!tier) return; // not inside a tier card — let anchor navigate normally.
    if (!isCheckoutLive()) return; // flag off — preserve static anchor href.

    ev.preventDefault();

    // PRE-STAGE: an inline email collection field is required before POST
    // can fire. D1.2 has not promoted a form component yet — until it
    // does, prompt is the safe interim path (no styling, but functional).
    // Day 3 swap: replace prompt() with a Marketing-blessed inline form.
    var email = window.prompt("Email for your Elevationary subscription:");
    if (!email) return;

    // The minimum request body the Worker accepts. swimlanes_accessible is
    // empty for now (lane picker Day 3); Worker validation rejects
    // individual/functional_bundle without lanes — flag this as a follow-up.
    var body = {
      tier: tier,
      billing_period: "monthly",
      stream: "commercial",
      swimlanes_accessible: [],
      email: email,
    };

    postCheckout(body)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data && data.ok && data.checkout_url) {
          window.location.assign(data.checkout_url);
        } else {
          window.alert(
            (data && data.message) || "Checkout could not start. Please retry."
          );
        }
      })
      .catch(function () {
        window.alert("Network error. Please retry.");
      });
  }

  function wire() {
    var triggers = document.querySelectorAll('[data-cta="primary-signup"]');
    for (var i = 0; i < triggers.length; i++) {
      triggers[i].addEventListener("click", onSignupClick);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
