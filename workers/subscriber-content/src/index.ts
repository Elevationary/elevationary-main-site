// Subscriber Content Entitlement Worker — Phase B + P9_D3 (Sales schema v2).
//
// Gates elevationary.com/editions/* and /account/* behind Cloudflare Access
// (identity) AND subscription entitlement (this Worker).
//
// Flow per gated request:
//   1. Read cf-access-authenticated-user-email (set by Access). Missing → 403.
//   2. Resolve email → Contact via R2 list on sales/contacts/.
//   3. Find active subscriptions via sales/index_subscriptions.json,
//      OR-joining (contact_id = ct.ct_id) OR (ct.ct_id ∈ shared_contact_ids).
//      The latter covers All-Access Pass seat sharing (max 4 shared + 1 purchaser
//      = 5 seats). The retired `enterprise` tier's company_id OR-join is gone.
//   4. Match the requested edition's `swimlane` frontmatter against the
//      subscription's entitlements.swimlanes_accessible[] (20-value enum:
//      10 commercial_* + 10 nonprofit_*). The `stream` field is now Postmark
//      routing only and does NOT drive entitlement.
//   5. Edition date vs entitlements.historical_access_from + deep_content_access
//      (per-sub R2 GET — the two fields not projected into the index row).
//   6. Stripe defense-in-depth: fetch /v1/subscriptions/<sub_id>; reject if
//      Stripe says not active. +50ms accepted per CEO ratification 2026-05-30.
//   7. Pass → render newsletter/drafts/<date>/<topic>.md as HTML.
//   8. Fail → 302 /upgrade?swimlane=<requested>&edition=<date>.

import { marked } from "marked";

// Defense-in-depth: tell marked to ESCAPE any raw HTML / `<script>` blocks
// in the markdown source rather than passing them through. Newsletter MD is
// assumed authored by an internal agent but the Worker treats it as untrusted
// input. The default marked v12 renderer passes inline + block HTML through
// unmodified (Stage 3 finding [E]). Overriding the `html` renderer to escape
// the raw HTML string keeps real <script> tags inert as text. Configured once
// at module load; applies to every marked.parse() call.
marked.use({
  renderer: {
    html(html: string) {
      return html
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    },
  },
});

type Stream = "nonprofit" | "commercial";
type Tier = "individual" | "functional_bundle" | "all_access";
type SubStatus = "active" | "past_due" | "cancelled" | "suppressed";

type Swimlane =
  | "commercial_marketing_demand_generation"
  | "commercial_sales_revenue_operations"
  | "commercial_customer_success"
  | "commercial_workforce_partner_enablement"
  | "commercial_product_service_delivery"
  | "commercial_brand_influence_thought_leadership"
  | "commercial_strategic_partnerships"
  | "commercial_business_intelligence_performance"
  | "commercial_digital_transformation"
  | "commercial_leadership_aim"
  | "nonprofit_marketing_outreach"
  | "nonprofit_fundraising_campaigns"
  | "nonprofit_donor_stewardship"
  | "nonprofit_volunteer_engagement"
  | "nonprofit_program_delivery"
  | "nonprofit_advocacy_awareness"
  | "nonprofit_grant_prospecting_reporting"
  | "nonprofit_impact_measurement"
  | "nonprofit_organizational_readiness"
  | "nonprofit_leadership_aim";

const STREAMS: readonly Stream[] = ["nonprofit", "commercial"] as const;

const SWIMLANES: readonly Swimlane[] = [
  "commercial_marketing_demand_generation",
  "commercial_sales_revenue_operations",
  "commercial_customer_success",
  "commercial_workforce_partner_enablement",
  "commercial_product_service_delivery",
  "commercial_brand_influence_thought_leadership",
  "commercial_strategic_partnerships",
  "commercial_business_intelligence_performance",
  "commercial_digital_transformation",
  "commercial_leadership_aim",
  "nonprofit_marketing_outreach",
  "nonprofit_fundraising_campaigns",
  "nonprofit_donor_stewardship",
  "nonprofit_volunteer_engagement",
  "nonprofit_program_delivery",
  "nonprofit_advocacy_awareness",
  "nonprofit_grant_prospecting_reporting",
  "nonprofit_impact_measurement",
  "nonprofit_organizational_readiness",
  "nonprofit_leadership_aim",
] as const;

const SWIMLANE_SET = new Set<string>(SWIMLANES);

const ENTITLED_STATUSES: readonly SubStatus[] = ["active", "past_due"] as const;

const STRIPE_ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

interface Env {
  SALES_CRM: R2Bucket;
  NEWSLETTER_CONTENT: R2Bucket;
  STRIPE_SECRET_KEY: string;
  // Cloudflare Access JWT verification — both must be set for strict mode.
  // Leave both unset for dev/local (header trust only; do NOT use in prod).
  CF_ACCESS_TEAM_DOMAIN?: string;  // e.g. "elevationary.cloudflareaccess.com"
  CF_ACCESS_AUD?: string;          // Access app AUD tag from Cloudflare dashboard
}

// JWKS cache — Worker isolate scope; per-instance. 1h TTL matches Cloudflare's
// rotation cadence guidance. ~5 KB per fetch, infrequent enough to skip Cache API.
type JwksCache = { keys: Map<string, CryptoKey>; expiresAt: number };
let jwksCache: { byTeam: Map<string, JwksCache> } = { byTeam: new Map() };
const JWKS_TTL_MS = 60 * 60 * 1000;

interface Contact {
  ct_id: string;
  email: string | null;
  company_id?: string | null;  // metadata only post-v2; no longer load-bearing
  first_name?: string;
  last_name?: string;
}

interface SubscriptionIndexRow {
  sb_id: string;
  contact_id: string;
  company_id: string | null;
  stream: Stream;
  tier: Tier;
  status: SubStatus;
  current_period_end: string;
  swimlanes_accessible: Swimlane[];
  shared_contact_ids: string[];
  stripe_subscription_id: string;
}

interface SubscriptionIndex {
  generated_at: string;
  subscriptions: SubscriptionIndexRow[];
}

interface SubscriptionEntitlements {
  swimlanes_accessible: Swimlane[];
  historical_access_from: string;
  deep_content_access: boolean;
}

interface FullSubscription {
  sb_id: string;
  contact_id: string;
  company_id: string | null;
  stream: Stream;
  tier: Tier;
  status: SubStatus;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  stripe_price_id: string;
  started_at: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  cancelled_at: string | null;
  shared_contact_ids: string[];
  entitlements: SubscriptionEntitlements;
  source: string;
  notes?: string;
}

interface Frontmatter {
  // Post-v2: `swimlane` drives entitlement. `stream` is retained for display
  // (and Newsletter's Postmark targeting upstream) but no longer used by the
  // Worker's gating decision.
  swimlane?: Swimlane;
  stream?: Stream;
  title?: string;
  edition_date?: string;
  topic?: string;
}

const EDITION_PATH_RE = /^\/editions\/(\d{4}-\d{2}-\d{2})(?:\/([a-z0-9-]+))?\/?$/;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const auth = await resolveAuthenticatedEmail(request, env);
    if (!auth.ok) {
      return text(auth.reason, 403);
    }
    const email = auth.email;

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/account" || path === "/account/" || path.startsWith("/account/")) {
      return handleAccount(env, email, url);
    }

    const editionMatch = path.match(EDITION_PATH_RE);
    if (editionMatch) {
      const editionDate = editionMatch[1];
      const topic = editionMatch[2] || "index";
      return handleEdition(env, email, url, editionDate, topic);
    }

    if (path === "/editions" || path === "/editions/") {
      return handleArchive(env, email, url);
    }

    return text("Not found.", 404);
  },
} satisfies ExportedHandler<Env>;

async function handleEdition(
  env: Env,
  email: string,
  url: URL,
  editionDate: string,
  topic: string
): Promise<Response> {
  const r2Key = `newsletter/drafts/${editionDate}/${topic}.md`;
  const obj = await env.NEWSLETTER_CONTENT.get(r2Key);
  if (!obj) {
    return text("Edition not found.", 404);
  }
  const mdText = await obj.text();
  const { frontmatter, body } = parseFrontmatter(mdText);

  const swimlane = frontmatter.swimlane;
  if (!swimlane || !SWIMLANE_SET.has(swimlane)) {
    return text("Edition missing valid swimlane frontmatter.", 500);
  }

  const contact = await resolveContactByEmail(env, email);
  if (!contact) {
    return upgradeRedirect(url, swimlane, editionDate);
  }

  const candidates = await findActiveSubscriptions(env, contact.ct_id);
  if (candidates.length === 0) {
    return upgradeRedirect(url, swimlane, editionDate);
  }

  for (const row of candidates) {
    // Defense: tolerate malformed index rows where `swimlanes_accessible` is
    // missing, null, or wrong-typed. Stage 3 findings [A], [B], [H].
    if (!Array.isArray(row.swimlanes_accessible)) continue;
    if (!row.swimlanes_accessible.includes(swimlane)) continue;

    const full = await getFullSubscription(env, row.sb_id);
    if (!full) continue;

    // Defense: tolerate malformed full sub where `entitlements` is missing
    // or has missing fields. Stage 3 finding [C]. Fail closed.
    if (!full.entitlements || typeof full.entitlements !== "object") continue;
    if (typeof full.entitlements.historical_access_from !== "string") continue;
    if (editionDate < full.entitlements.historical_access_from) continue;
    if (!full.entitlements.deep_content_access) continue;

    const stripeOk = await stripeVerifyActive(env.STRIPE_SECRET_KEY, full.stripe_subscription_id);
    if (!stripeOk) continue;

    const html = renderEditionHtml(body, frontmatter, editionDate, topic);
    return new Response(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "private, no-store",
        "x-elevationary-entitlement": `sb=${full.sb_id};tier=${full.tier};swimlane=${swimlane}`,
      },
    });
  }

  return upgradeRedirect(url, swimlane, editionDate);
}

async function handleAccount(env: Env, email: string, url: URL): Promise<Response> {
  const contact = await resolveContactByEmail(env, email);
  if (!contact) {
    return upgradeRedirect(url, null, null);
  }
  const subs = await findActiveSubscriptions(env, contact.ct_id);
  if (subs.length === 0) {
    return upgradeRedirect(url, null, null);
  }
  return new Response(renderAccountHtml(contact, subs, email), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });
}

async function handleArchive(env: Env, email: string, url: URL): Promise<Response> {
  const contact = await resolveContactByEmail(env, email);
  if (!contact) {
    return upgradeRedirect(url, null, null);
  }
  const subs = await findActiveSubscriptions(env, contact.ct_id);
  if (subs.length === 0) {
    return upgradeRedirect(url, null, null);
  }
  const html = renderArchivePlaceholderHtml(email);
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });
}

type AuthResult = { ok: true; email: string } | { ok: false; reason: string };

async function resolveAuthenticatedEmail(request: Request, env: Env): Promise<AuthResult> {
  const headerEmail = request.headers.get("cf-access-authenticated-user-email");
  const jwt =
    request.headers.get("Cf-Access-Jwt-Assertion") ||
    request.headers.get("cf-access-jwt-assertion");

  const strict = !!(env.CF_ACCESS_TEAM_DOMAIN && env.CF_ACCESS_AUD);

  if (strict) {
    if (!jwt) {
      return { ok: false, reason: "Cloudflare Access JWT missing (strict mode requires Cf-Access-Jwt-Assertion)." };
    }
    const claim = await verifyAccessJwt(jwt, env.CF_ACCESS_AUD!, env.CF_ACCESS_TEAM_DOMAIN!);
    if (!claim) {
      return { ok: false, reason: "Cloudflare Access JWT failed verification." };
    }
    if (headerEmail && headerEmail.toLowerCase() !== claim.email.toLowerCase()) {
      return { ok: false, reason: "Cloudflare Access JWT/header email mismatch." };
    }
    return { ok: true, email: claim.email };
  }

  // Dev/local mode — header trust only. NOT for production.
  if (!headerEmail) {
    return {
      ok: false,
      reason:
        "Cloudflare Access is not enforced for this route. " +
        "Configure the Subscriber Content app per cloudflare/access/subscriber_content_app.md, " +
        "then set CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD wrangler vars to enable strict JWT verification.",
    };
  }
  return { ok: true, email: headerEmail };
}

async function verifyAccessJwt(
  token: string,
  expectedAud: string,
  teamDomain: string
): Promise<{ email: string } | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  let header: { alg?: string; kid?: string };
  let payload: { aud?: string | string[]; email?: string; exp?: number; nbf?: number; iss?: string };
  try {
    header = JSON.parse(b64UrlDecodeString(headerB64));
    payload = JSON.parse(b64UrlDecodeString(payloadB64));
  } catch {
    return null;
  }

  if (header.alg !== "RS256" || !header.kid) return null;

  const auds = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
  if (!auds.includes(expectedAud)) return null;

  if (payload.iss !== `https://${teamDomain}`) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  if (!payload.exp || nowSec >= payload.exp) return null;
  // Pass-2 Stage 4 (F-Q-1, 2026-06-03): reject premature tokens. Strict verifier
  // must check `nbf` if present; CF Access mints nbf ≤ now in normal flow, but
  // defense-in-depth requires we reject future-dated tokens reaching the Worker.
  if (typeof payload.nbf === "number" && nowSec < payload.nbf) return null;

  if (!payload.email) return null;

  const jwks = await loadJwks(teamDomain);
  const key = jwks.get(header.kid);
  if (!key) return null;

  const signature = b64UrlDecodeBytes(sigB64);
  const signed = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      signature.buffer.slice(signature.byteOffset, signature.byteOffset + signature.byteLength) as ArrayBuffer,
      signed.buffer.slice(signed.byteOffset, signed.byteOffset + signed.byteLength) as ArrayBuffer
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  return { email: payload.email };
}

interface JwkWithKid extends JsonWebKey {
  kid: string;
}

async function loadJwks(teamDomain: string): Promise<Map<string, CryptoKey>> {
  const cached = jwksCache.byTeam.get(teamDomain);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.keys;
  }
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) {
    throw new Error(`JWKS fetch failed: ${res.status}`);
  }
  const data = (await res.json()) as { keys: JwkWithKid[] };
  const keys = new Map<string, CryptoKey>();
  for (const jwk of data.keys || []) {
    if (jwk.kty !== "RSA" || !jwk.kid) continue;
    if (jwk.use && jwk.use !== "sig") continue;
    try {
      const key = await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"]
      );
      keys.set(jwk.kid, key);
    } catch {
      // Skip individual key that fails to import; don't poison the whole set.
      continue;
    }
  }
  jwksCache.byTeam.set(teamDomain, { keys, expiresAt: Date.now() + JWKS_TTL_MS });
  return keys;
}

function b64UrlDecodeString(s: string): string {
  return new TextDecoder().decode(b64UrlDecodeBytes(s));
}

function b64UrlDecodeBytes(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice(0, (4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf;
}

// Test-only export — lets the test suite reset the per-isolate JWKS cache
// between cases (real Workers reset between deploys; tests need an explicit
// hook). NOT used at runtime.
export function _resetJwksCacheForTests(): void {
  jwksCache = { byTeam: new Map() };
}

async function resolveContactByEmail(env: Env, email: string): Promise<Contact | null> {
  const target = email.toLowerCase();
  let cursor: string | undefined;
  do {
    const listed = await env.SALES_CRM.list({ prefix: "sales/contacts/", cursor });
    for (const obj of listed.objects) {
      if (!obj.key.endsWith(".json")) continue;
      const data = await env.SALES_CRM.get(obj.key);
      if (!data) continue;
      try {
        const c = (await data.json()) as Contact;
        if (c.email && c.email.toLowerCase() === target) {
          return c;
        }
      } catch {
        // Malformed contact JSON — skip, do not poison the lookup.
        continue;
      }
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return null;
}

async function findActiveSubscriptions(
  env: Env,
  contactId: string
): Promise<SubscriptionIndexRow[]> {
  const obj = await env.SALES_CRM.get("sales/index_subscriptions.json");
  if (!obj) return [];
  let idx: SubscriptionIndex;
  try {
    idx = (await obj.json()) as SubscriptionIndex;
  } catch {
    return [];
  }
  if (!Array.isArray(idx.subscriptions)) return [];
  return idx.subscriptions.filter((s) => {
    if (!ENTITLED_STATUSES.includes(s.status)) return false;
    // Purchaser path — works for all 3 tiers (individual, functional_bundle, all_access).
    if (s.contact_id === contactId) return true;
    // Seat-sharing path — only populated for All-Access Pass per the v2 schema's
    // if/then constraints (empty for individual + functional_bundle).
    if (Array.isArray(s.shared_contact_ids) && s.shared_contact_ids.includes(contactId)) return true;
    return false;
  });
}

async function getFullSubscription(env: Env, sbId: string): Promise<FullSubscription | null> {
  const obj = await env.SALES_CRM.get(`sales/subscriptions/${sbId}.json`);
  if (!obj) return null;
  try {
    return (await obj.json()) as FullSubscription;
  } catch {
    return null;
  }
}

async function stripeVerifyActive(stripeKey: string, subId: string): Promise<boolean> {
  if (!stripeKey) return false;
  try {
    const res = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subId)}`, {
      headers: { Authorization: `Bearer ${stripeKey}` },
    });
    if (!res.ok) return false;
    const sub = (await res.json()) as { status?: string };
    return typeof sub.status === "string" && STRIPE_ACTIVE_STATUSES.has(sub.status);
  } catch {
    return false;
  }
}

function parseFrontmatter(md: string): { frontmatter: Frontmatter; body: string } {
  const m = md.match(FRONTMATTER_RE);
  if (!m) return { frontmatter: {}, body: md };
  const fmBlock = m[1];
  const body = m[2];
  const fm: Frontmatter = {};
  for (const line of fmBlock.split(/\r?\n/)) {
    const eq = line.indexOf(":");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const raw = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key === "swimlane" && SWIMLANE_SET.has(raw)) {
      fm.swimlane = raw as Swimlane;
    } else if (key === "stream" && (raw === "nonprofit" || raw === "commercial")) {
      fm.stream = raw;
    } else if (key === "title") {
      fm.title = raw;
    } else if (key === "edition_date") {
      fm.edition_date = raw;
    } else if (key === "topic") {
      fm.topic = raw;
    }
  }
  return { frontmatter: fm, body };
}

function upgradeRedirect(url: URL, swimlane: Swimlane | null, date: string | null): Response {
  const upgrade = new URL("/upgrade/", url.origin);
  if (swimlane) upgrade.searchParams.set("swimlane", swimlane);
  if (date) upgrade.searchParams.set("edition", date);
  return Response.redirect(upgrade.toString(), 302);
}

function text(body: string, status: number): Response {
  return new Response(body + "\n", {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function renderEditionHtml(
  body: string,
  fm: Frontmatter,
  editionDate: string,
  topic: string
): string {
  const title = escapeHtml(fm.title || `${editionDate} — ${topic}`);
  const bodyHtml = String(marked.parse(body, { async: false }));
  // Display both: swimlane is the entitled lane (what unlocked this view);
  // stream is the Postmark/persona context (still useful for orientation).
  const swimlaneDisplay = fm.swimlane ? escapeHtml(humanSwimlane(fm.swimlane)) : "";
  const streamDisplay = fm.stream ? escapeHtml(fm.stream) : "";
  const meta = [
    `Edition: ${escapeHtml(editionDate)}`,
    swimlaneDisplay ? `Swimlane: ${swimlaneDisplay}` : "",
    streamDisplay ? `Stream: ${streamDisplay}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return baseHtml(
    title,
    `
    <article class="page-content article-content">
      <nav class="breadcrumb">
        <a href="/editions/">← Editions</a>
      </nav>
      <p class="article-subtitle">${meta}</p>
      <h1>${title}</h1>
      ${bodyHtml}
    </article>`
  );
}

function renderAccountHtml(contact: Contact, subs: SubscriptionIndexRow[], email: string): string {
  const rows = subs
    .map((s) => {
      const tier = humanTier(s.tier);
      const lanes = s.swimlanes_accessible.length;
      const seatNote =
        s.tier === "all_access" && s.shared_contact_ids.length > 0
          ? ` (+ ${s.shared_contact_ids.length} shared seat${s.shared_contact_ids.length === 1 ? "" : "s"})`
          : "";
      return `
      <tr>
        <td>${escapeHtml(tier)}${seatNote}</td>
        <td>${escapeHtml(s.stream)}</td>
        <td>${lanes} swimlane${lanes === 1 ? "" : "s"}</td>
        <td>${escapeHtml(s.status)}</td>
        <td>${escapeHtml(s.current_period_end)}</td>
      </tr>`;
    })
    .join("");
  const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim() || email;
  return baseHtml(
    "Your Account",
    `
    <article class="page-content">
      <h1>Your Account</h1>
      <p>Signed in as <strong>${escapeHtml(name)}</strong> (${escapeHtml(email)}).</p>

      <h2>Active subscriptions</h2>
      <table class="account-subs">
        <thead><tr><th>Plan</th><th>Stream</th><th>Access</th><th>Status</th><th>Renews / ends</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>

      <p>Manage your subscription, update payment details, or change plans through the Stripe Customer Portal.</p>
      <p><a href="https://billing.stripe.com/p/login/PLACEHOLDER" class="cta-primary" target="_blank" rel="noopener">Open Stripe Customer Portal →</a></p>

      <p class="muted">Need help? <a href="/contact/">Contact us</a>.</p>
    </article>`
  );
}

function renderArchivePlaceholderHtml(email: string): string {
  return baseHtml(
    "Your Editions",
    `
    <article class="page-content">
      <h1>Your Editions</h1>
      <p>Signed in as <strong>${escapeHtml(email)}</strong>.</p>
      <p>Your edition archive will list every issue your subscription entitles you to. Per-date links arrive as Newsletter ships editions to R2.</p>
      <p class="muted">If you have a direct link to an edition (e.g. <code>/editions/2026-06-01/your-topic</code>), it will load if your subscription's swimlanes cover that edition.</p>
    </article>`
  );
}

function humanTier(t: Tier): string {
  switch (t) {
    case "individual":
      return "Individual Access";
    case "functional_bundle":
      return "Functional Bundle";
    case "all_access":
      return "All-Access Pass";
  }
}

function humanSwimlane(s: Swimlane): string {
  // commercial_marketing_demand_generation → "Commercial · Marketing Demand Generation"
  const parts = s.split("_");
  const stream = parts.shift() || "";
  const rest = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
  return `${stream.charAt(0).toUpperCase() + stream.slice(1)} · ${rest}`;
}

function baseHtml(title: string, inner: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} | Elevationary</title>
  <link rel="icon" href="/assets/elevationary-logo-512.png">
  <link rel="stylesheet" href="/assets/styles.css">
  <meta name="robots" content="noindex">
</head>
<body>
  <nav class="site-nav">
    <a href="/" class="nav-brand">Elevationary</a>
    <ul>
      <li><a href="/about/">About</a></li>
      <li><a href="/services/">Services</a></li>
      <li><a href="/newsletter-stories/">Newsletter</a></li>
      <li><a href="/account/">Account</a></li>
      <li><a href="/contact/">Contact</a></li>
    </ul>
  </nav>
  <main>
${inner}
  </main>
  <footer class="site-footer">
    <p>&copy; Elevationary · <a href="/legal/">Legal &amp; Privacy</a></p>
  </footer>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
