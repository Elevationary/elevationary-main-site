// /subscribe/welcome/* route handler — D2.4 Website half (BVP Day 2).
//
// Flow (per D1.6 architecture lock + D2.4 split, ratified 2026-06-21):
//
//   1. Parse session_id from query string. Missing/malformed → failure UX.
//   2. Stripe Checkout Session retrieve via STRIPE_READ_KEY. Invalid → failure UX.
//   3. Subrequest ENTITLEMENT_WORKER (P4_D1 / subscriber-content) for the
//      subscriber's entitlement state. Failure → failure UX (defaults stay).
//   4. Compose Entitlement object + render Marketing's shell HTML via SSR.
//   5. Respond with the mutated HTML. Idempotent on reload — Stripe Session is
//      source of truth; refreshing re-runs retrieve + subrequest with the same
//      inputs.
//
// State of dependencies on this commit (2026-06-21 PT eve):
//   - Marketing shell HTML: pending (D1.2 + D1.4 land 12:00 PT).
//   - STRIPE_READ_KEY: NOT YET PROVISIONED — flagged to COO/CEO.
//   - ENTITLEMENT_WORKER service binding: NOT YET WIRED in wrangler.toml.
//   - This handler currently returns 501 not_implemented until each TODO clears.
//   - The pure-logic SSR module (welcome_render.ts) IS implementation-complete
//     and unit-tested independently.

import type { Env, WelcomeFailure } from "./types.js";
import { renderWelcomePage } from "./welcome_render.js";
import { WELCOME_SHELL_HTML } from "./welcome_shell.js";
import { fetchEntitlement } from "./welcome_entitlement_client.js";
import { retrieveStripeSessionEmail } from "./welcome_stripe_client.js";

const SESSION_ID_PATTERN = /^cs_(test|live)_[A-Za-z0-9]{1,128}$/;

function liveFlowReady(env: Env): boolean {
  return Boolean(
    env.STRIPE_READ_KEY &&
      env.ENTITLEMENT_WORKER &&
      env.CF_ACCESS_CLIENT_ID &&
      env.CF_ACCESS_CLIENT_SECRET,
  );
}

export async function handleWelcome(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id");

  // (1) session_id validation — pure local check, no network. Failure copy
  // is sourced from the spec at render time; `message` is informational only
  // (preserved for logs / future inline rendering).
  if (!sessionId) {
    return renderFailure(env, {
      code: "session_id_missing",
      message: "session_id query parameter not present",
    });
  }
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    return renderFailure(env, {
      code: "session_id_malformed",
      message: "session_id failed cs_(test|live)_<alnum> pattern check",
    });
  }

  // Progressive enhancement: live flow when ALL deps are wired; otherwise
  // serve the static shell with a diagnostic mode header so the route stays
  // useful for brand-gate visuals + smoke tests.
  if (!liveFlowReady(env)) {
    return new Response(WELCOME_SHELL_HTML, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        "X-Welcome-Mode": "pre-stage-static-shell",
      },
    });
  }

  // (2) Stripe Session retrieve — follow session.subscription to recover
  // the Subscription's metadata (2026-06-16 write-only-on-Session lesson).
  // Failure copy is sourced from spec at render time per Q-WP5.b.
  const stripeResult = await retrieveStripeSessionEmail(env, sessionId);
  if (!stripeResult.ok) {
    return renderFailureWithShell(env, {
      code: stripeResult.code,
      message: `Stripe session retrieve failed: ${stripeResult.code}`,
    });
  }

  // (3) Entitlement Worker subrequest via service binding + CF Access token.
  // Failure copy is sourced from spec at render time per Q-WP5.c.
  const entResult = await fetchEntitlement(env, stripeResult.email);
  if (!entResult.ok) {
    return renderFailureWithShell(env, {
      code: "entitlement_lookup_failed",
      message: `Entitlement lookup failed: ${entResult.code}`,
    });
  }

  // (4) + (5) — SSR Marketing's shell with the resolved Entitlement.
  return renderWelcomePage(WELCOME_SHELL_HTML, entResult.entitlement, null);
}

function renderFailureWithShell(env: Env, failure: WelcomeFailure): Response {
  void env;
  return renderWelcomePage(WELCOME_SHELL_HTML, null, failure);
}

async function renderFailure(
  env: Env,
  failure: WelcomeFailure,
): Promise<Response> {
  // Used for session_id missing/malformed — i.e. failures detected before
  // any binding is consulted. Renders the shell with the failure block
  // unhidden via the same SSR module used in the live flow.
  void env;
  return renderWelcomePage(WELCOME_SHELL_HTML, null, failure);
}
