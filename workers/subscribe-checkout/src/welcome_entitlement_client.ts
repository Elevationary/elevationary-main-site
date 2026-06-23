// Subrequest client for the P4_D1 Entitlement Worker (subscriber-content).
//
// D1.6 architecture lock (COO ratified 2026-06-21): /subscribe/welcome/
// resolves the subscriber's entitlement via service binding to subscriber-
// content. Authentication uses a Cloudflare Access service token (Option II,
// COO ratified 2026-06-22), not a user JWT, so the call has the same
// security posture as a user request but no human in the loop.
//
// Contract with subscriber-content (Day 3 follow-up — endpoint must ship on
// subscriber-content side before this client returns useful data):
//
//   POST /api/entitlement                           (origin: service binding)
//   Headers:
//     CF-Access-Client-Id:     <token id>
//     CF-Access-Client-Secret: <token secret>
//     Content-Type:            application/json
//   Body:
//     { "email": "<subscriber email>" }
//   Response 200:
//     { "tier": "individual" | "functional_bundle" | "all_access",
//       "tierLabel": "Individual" | ... ,
//       "swimlanes": [ "<slug>", ... ],
//       "billingNextIso": "YYYY-MM-DD",
//       "portalUrl": "https://billing.stripe.com/..." }
//   Response 404:
//     no active subscription for this email
//   Response 401/403:
//     auth failure (token rejected by CF Access policy)
//
// Until subscriber-content ships /api/entitlement, this client returns the
// same "lookup_failed" error code on every call and the welcome handler
// renders the failure UX. That's the safe pre-LIVE state.

import type { Entitlement, Env } from "./types.js";

export type EntitlementResult =
  | { ok: true; entitlement: Entitlement }
  | { ok: false; code: "not_subscribed" | "lookup_failed" };

export async function fetchEntitlement(
  env: Env,
  email: string,
): Promise<EntitlementResult> {
  if (
    !env.ENTITLEMENT_WORKER ||
    !env.CF_ACCESS_CLIENT_ID ||
    !env.CF_ACCESS_CLIENT_SECRET
  ) {
    return { ok: false, code: "lookup_failed" };
  }

  const req = new Request("https://subscriber-content/api/entitlement", {
    method: "POST",
    headers: {
      "CF-Access-Client-Id": env.CF_ACCESS_CLIENT_ID,
      "CF-Access-Client-Secret": env.CF_ACCESS_CLIENT_SECRET,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email }),
  });

  let res: Response;
  try {
    res = await env.ENTITLEMENT_WORKER.fetch(req);
  } catch {
    return { ok: false, code: "lookup_failed" };
  }

  if (res.status === 404) {
    return { ok: false, code: "not_subscribed" };
  }
  if (!res.ok) {
    return { ok: false, code: "lookup_failed" };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, code: "lookup_failed" };
  }

  const ent = normalizeEntitlement(body);
  if (!ent) {
    return { ok: false, code: "lookup_failed" };
  }
  return { ok: true, entitlement: ent };
}

function normalizeEntitlement(body: unknown): Entitlement | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  const tier = b.tier;
  if (tier !== "individual" && tier !== "functional_bundle" && tier !== "all_access") {
    return null;
  }
  const tierLabel = typeof b.tierLabel === "string" ? b.tierLabel : "";
  if (!tierLabel) return null;
  const swimlanes = Array.isArray(b.swimlanes) && b.swimlanes.every((s) => typeof s === "string")
    ? (b.swimlanes as string[])
    : null;
  if (!swimlanes) return null;
  const billingNextIso = typeof b.billingNextIso === "string" ? b.billingNextIso : "";
  if (!billingNextIso) return null;
  const portalUrl = typeof b.portalUrl === "string" ? b.portalUrl : "";
  if (!portalUrl) return null;

  return { tier, tierLabel, swimlanes, billingNextIso, portalUrl };
}
