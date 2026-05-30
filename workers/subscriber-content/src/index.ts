// Subscriber Content Entitlement Worker — Phase B.
//
// Gates elevationary.com/editions/* and /account/* behind Cloudflare Access
// (identity) AND subscription entitlement (this Worker).
//
// Flow per gated request:
//   1. Read cf-access-authenticated-user-email (set by Access). Missing → 403.
//   2. Resolve email → Contact via R2 list on sales/contacts/.
//   3. Find active subscriptions via sales/index_subscriptions.json,
//      OR-joining (contact_id = ct) OR (tier=enterprise AND company_id = co).
//   4. Match against requested stream (URL → R2 frontmatter) and edition date
//      vs entitlements.historical_access_from (per-sub R2 GET).
//   5. Stripe defense-in-depth: fetch /v1/subscriptions/<sub_id>; reject if
//      Stripe says not active. +50ms accepted per CEO ratification 2026-05-30.
//   6. Pass → render newsletter/drafts/<date>/<topic>.md as HTML.
//   7. Fail → 302 /upgrade?stream=<requested>&edition=<date>.

import { marked } from "marked";

type Stream = "nonprofit" | "commercial";
type Tier = "individual" | "enterprise";
type SubStatus = "active" | "past_due" | "cancelled" | "suppressed";

const STREAMS: readonly Stream[] = ["nonprofit", "commercial"] as const;

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
  company_id: string;
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
  streams_accessible: Stream[];
  stripe_subscription_id: string;
}

interface SubscriptionIndex {
  generated_at: string;
  subscriptions: SubscriptionIndexRow[];
}

interface SubscriptionEntitlements {
  streams_accessible: Stream[];
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
  entitlements: SubscriptionEntitlements;
  source: string;
  notes?: string;
}

interface Frontmatter {
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

  const stream = frontmatter.stream;
  if (!stream || !STREAMS.includes(stream)) {
    return text("Edition missing valid stream frontmatter.", 500);
  }

  const contact = await resolveContactByEmail(env, email);
  if (!contact) {
    return upgradeRedirect(url, stream, editionDate);
  }

  const candidates = await findActiveSubscriptions(env, contact.ct_id, contact.company_id);
  if (candidates.length === 0) {
    return upgradeRedirect(url, stream, editionDate);
  }

  for (const row of candidates) {
    if (!row.streams_accessible.includes(stream)) continue;

    const full = await getFullSubscription(env, row.sb_id);
    if (!full) continue;

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
        "x-elevationary-entitlement": `sb=${full.sb_id};tier=${full.tier}`,
      },
    });
  }

  return upgradeRedirect(url, stream, editionDate);
}

async function handleAccount(env: Env, email: string, url: URL): Promise<Response> {
  const contact = await resolveContactByEmail(env, email);
  if (!contact) {
    return upgradeRedirect(url, null, null);
  }
  const subs = await findActiveSubscriptions(env, contact.ct_id, contact.company_id);
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
  const subs = await findActiveSubscriptions(env, contact.ct_id, contact.company_id);
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
  let payload: { aud?: string | string[]; email?: string; exp?: number; iss?: string };
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

  if (!payload.exp || Math.floor(Date.now() / 1000) >= payload.exp) return null;

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
  contactId: string,
  companyId: string | null
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
    if (s.contact_id === contactId) return true;
    if (s.tier === "enterprise" && companyId && s.company_id === companyId) return true;
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
    if (key === "stream" && (raw === "nonprofit" || raw === "commercial")) {
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

function upgradeRedirect(url: URL, stream: Stream | null, date: string | null): Response {
  const upgrade = new URL("/upgrade/", url.origin);
  if (stream) upgrade.searchParams.set("stream", stream);
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
  return baseHtml(
    title,
    `
    <article class="page-content article-content">
      <nav class="breadcrumb">
        <a href="/editions/">← Editions</a>
      </nav>
      <p class="article-subtitle">Edition: ${escapeHtml(editionDate)} · Stream: ${escapeHtml(fm.stream || "")}</p>
      <h1>${title}</h1>
      ${bodyHtml}
    </article>`
  );
}

function renderAccountHtml(contact: Contact, subs: SubscriptionIndexRow[], email: string): string {
  const rows = subs
    .map(
      (s) => `
      <tr>
        <td>${escapeHtml(s.stream)}</td>
        <td>${escapeHtml(s.tier)}</td>
        <td>${escapeHtml(s.status)}</td>
        <td>${escapeHtml(s.current_period_end)}</td>
      </tr>`
    )
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
        <thead><tr><th>Stream</th><th>Tier</th><th>Status</th><th>Renews / ends</th></tr></thead>
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
      <p class="muted">If you have a direct link to an edition (e.g. <code>/editions/2026-06-01/your-topic</code>), it will load if you are entitled to that stream and date.</p>
    </article>`
  );
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
