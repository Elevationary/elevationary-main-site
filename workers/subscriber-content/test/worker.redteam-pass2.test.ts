// Detailed Red-Team Pass 2 — 2026-06-03.
// Targets axes yesterday's matrix under-covered: swimlane entitlement boundary
// cases, Cloudflare Access JWT verification edge cases, R2 binding resolution
// under denied paths. ≥10 induced failure modes; real induction with real
// observed output. Each mode prints `[<letter>] <result>` so the vitest
// stdout becomes the ORS evidence directly.
//
// Companion ORS: ORS_p9_d3_detailed_redteam_pass2_2026_06_03.md

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import worker, { _resetJwksCacheForTests } from "../src/index";

// ---------- Minimal harness (mirrors worker.test.ts shape, kept local) ----------

class MockR2Object {
  constructor(private data: string) {}
  async text() { return this.data; }
  async json<T = unknown>() { return JSON.parse(this.data) as T; }
}

class MockR2Bucket {
  store = new Map<string, string>();
  throwOnGet = false;
  throwOnList = false;
  put(key: string, value: string | object) {
    this.store.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  async get(key: string) {
    if (this.throwOnGet) throw new Error("R2 down");
    return this.store.has(key) ? new MockR2Object(this.store.get(key)!) : null;
  }
  async list({ prefix }: { prefix?: string; cursor?: string } = {}) {
    if (this.throwOnList) throw new Error("R2 list down");
    const keys = [...this.store.keys()].filter((k) => !prefix || k.startsWith(prefix));
    return { objects: keys.map((key) => ({ key })), truncated: false, cursor: undefined };
  }
}

function gatedRequest(path: string, email: string | null = "alice@example.com") {
  const headers: Record<string, string> = {};
  if (email !== null) headers["cf-access-authenticated-user-email"] = email;
  return new Request("https://elevationary.com" + path, { headers });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const env = (sales: MockR2Bucket, news: MockR2Bucket, extra: Record<string, unknown> = {}) => ({
  SALES_CRM: sales as any,
  NEWSLETTER_CONTENT: news as any,
  STRIPE_SECRET_KEY: "sk_test_dummy",
  ...extra,
});

function makeContact(ct_id: string, email: string) {
  return { ct_id, email, first_name: "Alice", last_name: "Test" };
}

const SWIMLANE_FULL = "nonprofit_marketing_outreach";

function makeFullSub(opts: { sb_id: string; ct_id: string; swimlanes: string[]; status?: string }) {
  return {
    sb_id: opts.sb_id,
    contact_id: opts.ct_id,
    company_id: null,
    stream: "nonprofit",
    tier: "individual",
    status: opts.status ?? "active",
    stripe_customer_id: "cus_" + opts.sb_id,
    stripe_subscription_id: "sub_" + opts.sb_id,
    stripe_price_id: "price_" + opts.sb_id,
    started_at: "2026-01-01T00:00:00Z",
    current_period_end: "2026-12-31T23:59:59Z",
    cancel_at_period_end: false,
    cancelled_at: null,
    shared_contact_ids: [],
    entitlements: {
      swimlanes_accessible: opts.swimlanes,
      historical_access_from: "2026-01-01",
      deep_content_access: true,
    },
    source: "test_fixture",
    notes: "",
  };
}

function makeIndexRow(sub: ReturnType<typeof makeFullSub>) {
  return {
    sb_id: sub.sb_id,
    contact_id: sub.contact_id,
    company_id: sub.company_id,
    stream: sub.stream,
    tier: sub.tier,
    status: sub.status,
    current_period_end: sub.current_period_end,
    swimlanes_accessible: sub.entitlements.swimlanes_accessible,
    shared_contact_ids: sub.shared_contact_ids,
    stripe_subscription_id: sub.stripe_subscription_id,
  };
}

function makeEdition(swimlane: string, body = "## Body\n\nContent.\n") {
  return `---\nswimlane: ${swimlane}\nstream: nonprofit\ntitle: Test\n---\n${body}`;
}

function seedHappy(swimlanes: string[] = [SWIMLANE_FULL]) {
  const sales = new MockR2Bucket();
  const news = new MockR2Bucket();
  const contact = makeContact("ct_alice", "alice@example.com");
  const sub = makeFullSub({ sb_id: "sb_a", ct_id: "ct_alice", swimlanes });
  sales.put("sales/contacts/ct_alice.json", contact);
  sales.put(`sales/subscriptions/${sub.sb_id}.json`, sub);
  sales.put("sales/index_subscriptions.json", {
    generated_at: "2026-06-03",
    subscriptions: [makeIndexRow(sub)],
  });
  news.put("newsletter/drafts/2026-06-01/index.md", makeEdition(SWIMLANE_FULL));
  return { sales, news };
}

function mockStripeActive(subId: string) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.includes(`/v1/subscriptions/${subId}`)) {
      return new Response(JSON.stringify({ status: "active" }), { status: 200 });
    }
    throw new Error("Unexpected fetch " + url);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  _resetJwksCacheForTests();
});

// ============================================================
// SWIMLANE AXIS
// ============================================================
describe("Pass-2 Stage 3: Swimlane axis", () => {
  it("[K] frontmatter swimlane typo 'nonprofit_marketing_outrach' (1-letter omission) → 500", async () => {
    const { sales, news } = seedHappy();
    // Overwrite the seeded edition with a typo swimlane:
    news.put("newsletter/drafts/2026-06-01/index.md", makeEdition("nonprofit_marketing_outrach"));
    mockStripeActive("sb_a");
    const res = await worker.fetch(gatedRequest("/editions/2026-06-01/index"), env(sales, news), {} as ExecutionContext);
    const body = await res.text();
    console.log(`[K] status=${res.status} body=${body.trim()}`);
    expect(res.status).toBe(500);
    expect(body).toMatch(/missing valid swimlane/);
  });

  it("[L] frontmatter swimlane UPPERCASE 'NONPROFIT_MARKETING_OUTREACH' (case-sensitive set) → 500", async () => {
    const { sales, news } = seedHappy();
    news.put("newsletter/drafts/2026-06-01/index.md", makeEdition("NONPROFIT_MARKETING_OUTREACH"));
    mockStripeActive("sb_a");
    const res = await worker.fetch(gatedRequest("/editions/2026-06-01/index"), env(sales, news), {} as ExecutionContext);
    console.log(`[L] status=${res.status}`);
    expect(res.status).toBe(500);
  });

  it("[M] sub's swimlanes_accessible=[] (empty array) → 302 fail-closed", async () => {
    const { sales, news } = seedHappy([]); // empty
    mockStripeActive("sb_a");
    const res = await worker.fetch(gatedRequest("/editions/2026-06-01/index"), env(sales, news), {} as ExecutionContext);
    console.log(`[M] status=${res.status} location=${res.headers.get("location")}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/\/upgrade\/\?swimlane=nonprofit_marketing_outreach/);
  });
});

// ============================================================
// JWT AXIS
// ============================================================
describe("Pass-2 Stage 3: JWT axis", () => {
  const TEAM_DOMAIN = "test-team.cloudflareaccess.com";
  const AUD = "test-aud-pass2";
  const KID = "test-kid-pass2";
  let privateKey: CryptoKey;
  let publicJwk: JsonWebKey;

  beforeEach(async () => {
    const kp = await generateKeyPair("RS256", { extractable: true });
    privateKey = kp.privateKey as CryptoKey;
    publicJwk = (await exportJWK(kp.publicKey)) as JsonWebKey;
    (publicJwk as { kid?: string; alg?: string; use?: string }).kid = KID;
    (publicJwk as { kid?: string; alg?: string; use?: string }).alg = "RS256";
    (publicJwk as { kid?: string; alg?: string; use?: string }).use = "sig";
  });

  function mockJwks() {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.startsWith(`https://${TEAM_DOMAIN}/cdn-cgi/access/certs`)) {
        return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
      }
      if (url.includes("/v1/subscriptions/")) {
        return new Response(JSON.stringify({ status: "active" }), { status: 200 });
      }
      throw new Error("Unexpected fetch " + url);
    });
  }

  function strictEnv(sales: MockR2Bucket, news: MockR2Bucket) {
    return env(sales, news, { CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, CF_ACCESS_AUD: AUD });
  }

  function withJwt(path: string, jwt: string) {
    return new Request("https://elevationary.com" + path, { headers: { "Cf-Access-Jwt-Assertion": jwt } });
  }

  it("[N] alg=none unsigned JWT → 403 (header alg !== RS256 pin)", async () => {
    // Hand-construct an unsigned alg=none token. jose refuses to sign these,
    // so we build the parts directly. payload claims are otherwise valid.
    const header = { alg: "none", kid: KID };
    const payload = {
      email: "alice@example.com",
      aud: AUD,
      iss: `https://${TEAM_DOMAIN}`,
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const b64u = (o: object) =>
      Buffer.from(JSON.stringify(o)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    const jwt = `${b64u(header)}.${b64u(payload)}.`; // empty signature, alg=none

    const { sales, news } = seedHappy();
    mockJwks();
    const res = await worker.fetch(withJwt("/editions/2026-06-01/index", jwt), strictEnv(sales, news), {} as ExecutionContext);
    const text = await res.text();
    console.log(`[N] status=${res.status} body=${text.trim()}`);
    expect(res.status).toBe(403);
  });

  it("[O] JWT with empty kid header → 403 (truthy guard rejects '')", async () => {
    // jose's setProtectedHeader will accept kid: '' as a string. The Worker's
    // `!header.kid` guard at the algorithm check should reject it.
    const jwt = await new SignJWT({ email: "alice@example.com" })
      .setProtectedHeader({ alg: "RS256", kid: "" })
      .setIssuer(`https://${TEAM_DOMAIN}`)
      .setAudience(AUD)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);

    const { sales, news } = seedHappy();
    mockJwks();
    const res = await worker.fetch(withJwt("/editions/2026-06-01/index", jwt), strictEnv(sales, news), {} as ExecutionContext);
    console.log(`[O] status=${res.status}`);
    expect(res.status).toBe(403);
  });

  it("[P] JWT iss with trailing slash mismatch 'https://{team}/' vs expected 'https://{team}' → 403", async () => {
    const jwt = await new SignJWT({ email: "alice@example.com" })
      .setProtectedHeader({ alg: "RS256", kid: KID })
      .setIssuer(`https://${TEAM_DOMAIN}/`) // trailing slash
      .setAudience(AUD)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);

    const { sales, news } = seedHappy();
    mockJwks();
    const res = await worker.fetch(withJwt("/editions/2026-06-01/index", jwt), strictEnv(sales, news), {} as ExecutionContext);
    console.log(`[P] status=${res.status}`);
    expect(res.status).toBe(403);
  });

  it("[Q] JWT with nbf in FUTURE — does Worker reject?", async () => {
    // Worker code path verifyAccessJwt only inspects exp, not nbf. CF Access
    // itself mints nbf <= now, so practically this isn't exploitable via CF,
    // but the Worker's strict-mode promise is "we verify the JWT" — a token
    // with nbf=in-future would be premature. Worth measuring.
    const nowSec = Math.floor(Date.now() / 1000);
    const futureNbf = nowSec + 3600; // not valid for another hour
    const jwt = await new SignJWT({ email: "alice@example.com", nbf: futureNbf })
      .setProtectedHeader({ alg: "RS256", kid: KID })
      .setIssuer(`https://${TEAM_DOMAIN}`)
      .setAudience(AUD)
      .setIssuedAt()
      .setNotBefore(futureNbf)
      .setExpirationTime(futureNbf + 3600) // exp also in future, but > nbf
      .sign(privateKey);

    const sub = makeFullSub({ sb_id: "sb_a", ct_id: "ct_alice", swimlanes: [SWIMLANE_FULL] });
    const sales = new MockR2Bucket();
    const news = new MockR2Bucket();
    sales.put("sales/contacts/ct_alice.json", makeContact("ct_alice", "alice@example.com"));
    sales.put(`sales/subscriptions/${sub.sb_id}.json`, sub);
    sales.put("sales/index_subscriptions.json", { generated_at: "x", subscriptions: [makeIndexRow(sub)] });
    news.put("newsletter/drafts/2026-06-01/index.md", makeEdition(SWIMLANE_FULL));
    mockJwks();
    const res = await worker.fetch(withJwt("/editions/2026-06-01/index", jwt), strictEnv(sales, news), {} as ExecutionContext);
    console.log(`[Q] status=${res.status} (nbf=${futureNbf}, now=${nowSec}, delta_secs=+${futureNbf - nowSec})`);
    // Post-fix (F-Q-1 remediation, 2026-06-03): premature token must be rejected.
    expect(res.status).toBe(403);
  });
});

// ============================================================
// R2 AXIS
// ============================================================
describe("Pass-2 Stage 3: R2 axis", () => {
  it("[R] NEWSLETTER_CONTENT.get() throws (R2 outage) → uncaught surfaces as 5xx, not 302", async () => {
    const { sales, news } = seedHappy();
    news.throwOnGet = true; // R2 reads on newsletter prefix throw
    mockStripeActive("sb_a");
    let status = 0;
    let caught: unknown = null;
    try {
      const res = await worker.fetch(gatedRequest("/editions/2026-06-01/index"), env(sales, news), {} as ExecutionContext);
      status = res.status;
    } catch (e) {
      caught = e;
    }
    console.log(`[R] status=${status} caught=${caught ? (caught as Error).message : "none"}`);
    // Expectation: Worker is fail-OPEN-with-error (5xx or uncaught throw),
    // not fail-CLOSED to upgrade. Both are non-302. Document observed.
    expect(status === 0 || status >= 500).toBe(true);
  });

  it("[S] SALES_CRM.list() throws in contact resolution → uncaught surfaces as 5xx", async () => {
    const { sales, news } = seedHappy();
    sales.throwOnList = true;
    let status = 0;
    let caught: unknown = null;
    try {
      const res = await worker.fetch(gatedRequest("/editions/2026-06-01/index"), env(sales, news), {} as ExecutionContext);
      status = res.status;
    } catch (e) {
      caught = e;
    }
    console.log(`[S] status=${status} caught=${caught ? (caught as Error).message : "none"}`);
    expect(status === 0 || status >= 500).toBe(true);
  });

  it("[T] sales/index_subscriptions.json MISSING (R2 returns null) → 302 fail-closed", async () => {
    const sales = new MockR2Bucket();
    const news = new MockR2Bucket();
    sales.put("sales/contacts/ct_alice.json", makeContact("ct_alice", "alice@example.com"));
    // No sales/index_subscriptions.json; no sales/subscriptions/* either.
    news.put("newsletter/drafts/2026-06-01/index.md", makeEdition(SWIMLANE_FULL));
    const res = await worker.fetch(gatedRequest("/editions/2026-06-01/index"), env(sales, news), {} as ExecutionContext);
    console.log(`[T] status=${res.status} location=${res.headers.get("location")}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/\/upgrade\//);
  });

  it("[U] two contacts share lowercased email — first match wins (non-determinism flag)", async () => {
    // Two contacts in R2 both have email alice@example.com. Worker iterates
    // sales/contacts/ prefix; whichever R2 returns first wins. R2 list order
    // is lexicographic by key in practice, so ct_alice < ct_bob → ct_alice
    // wins here. But if a future Sales-side bug lets duplicate-email contacts
    // ship, the entitlement attaches to the lexicographically-first ct_id.
    const sales = new MockR2Bucket();
    const news = new MockR2Bucket();
    sales.put("sales/contacts/ct_alice.json", makeContact("ct_alice", "alice@example.com"));
    sales.put("sales/contacts/ct_bob.json", makeContact("ct_bob", "alice@example.com")); // collision
    // sb attached to ct_bob — so if ct_alice is matched first, sub lookup fails:
    const sub = makeFullSub({ sb_id: "sb_b", ct_id: "ct_bob", swimlanes: [SWIMLANE_FULL] });
    sales.put(`sales/subscriptions/${sub.sb_id}.json`, sub);
    sales.put("sales/index_subscriptions.json", { generated_at: "x", subscriptions: [makeIndexRow(sub)] });
    news.put("newsletter/drafts/2026-06-01/index.md", makeEdition(SWIMLANE_FULL));
    mockStripeActive("sb_b");
    const res = await worker.fetch(gatedRequest("/editions/2026-06-01/index"), env(sales, news), {} as ExecutionContext);
    console.log(`[U] status=${res.status} (sub is bound to ct_bob; ct_alice has no sub → expect 302 if ct_alice matched first)`);
    // Outcome documents which contact wins. If 302: ct_alice matched first
    // and has no sub → fail-closed (acceptable; bob lost his entitlement to a
    // duplicate-email collision but Worker did not over-grant). If 200: ct_bob
    // matched first.
    expect([200, 302]).toContain(res.status);
  });
});
