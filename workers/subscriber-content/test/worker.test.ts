// Detailed red-team test harness for the P4_D1 Entitlement Worker (post-P9_D3 v2 schema).
// Mocked R2 + mocked globalThis.fetch (for Stripe + JWKS). Faithful to runtime
// because R2Bucket and Fetch are both standard Web APIs the Worker depends on.
//
// Test method documented in ORS_p9_d3_swimlane_migration_2026_06_02.md.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import worker, { _resetJwksCacheForTests } from "../src/index";

// ---------- Mock R2 ----------

type R2Listing = { objects: { key: string }[]; truncated: boolean; cursor?: string };

class MockR2Object {
  constructor(private data: string) {}
  async text(): Promise<string> {
    return this.data;
  }
  async json<T = unknown>(): Promise<T> {
    return JSON.parse(this.data) as T;
  }
}

class MockR2Bucket {
  store = new Map<string, string>();
  getCalls = 0;
  listCalls = 0;
  put(key: string, value: string | object) {
    this.store.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  async get(key: string): Promise<MockR2Object | null> {
    this.getCalls++;
    return this.store.has(key) ? new MockR2Object(this.store.get(key)!) : null;
  }
  async list({ prefix }: { prefix?: string; cursor?: string } = {}): Promise<R2Listing> {
    this.listCalls++;
    const keys = [...this.store.keys()].filter((k) => !prefix || k.startsWith(prefix));
    return { objects: keys.map((key) => ({ key })), truncated: false, cursor: undefined };
  }
}

// ---------- Fixture helpers (v2 schema) ----------

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

const ALL_NONPROFIT_SWIMLANES: Swimlane[] = [
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
];

const ALL_COMMERCIAL_SWIMLANES: Swimlane[] = [
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
];

function makeContact(opts: {
  ct_id: string;
  email: string;
  company_id?: string | null;
  first_name?: string;
  last_name?: string;
}) {
  return { ...opts };
}

function makeSubscription(opts: {
  sb_id: string;
  contact_id: string;
  company_id?: string | null;
  stream: Stream;
  tier: Tier;
  status: SubStatus;
  stripe_subscription_id: string;
  swimlanes_accessible?: Swimlane[];
  shared_contact_ids?: string[];
  historical_access_from?: string;
  deep_content_access?: boolean;
  current_period_end?: string;
}) {
  // Default swimlanes: 1 for individual, 3 for functional_bundle, 10 of stream for all_access.
  let swimlanes = opts.swimlanes_accessible;
  if (!swimlanes) {
    const all = opts.stream === "nonprofit" ? ALL_NONPROFIT_SWIMLANES : ALL_COMMERCIAL_SWIMLANES;
    if (opts.tier === "individual") swimlanes = [all[0]];
    else if (opts.tier === "functional_bundle") swimlanes = all.slice(0, 3);
    else swimlanes = all.slice();
  }
  const shared = opts.shared_contact_ids ?? (opts.tier === "all_access" ? [] : []);
  return {
    sb_id: opts.sb_id,
    contact_id: opts.contact_id,
    company_id: opts.company_id ?? null,
    stream: opts.stream,
    tier: opts.tier,
    status: opts.status,
    stripe_customer_id: "cus_test_" + opts.sb_id,
    stripe_subscription_id: opts.stripe_subscription_id,
    stripe_price_id: "price_test_" + opts.sb_id,
    started_at: "2026-01-01T00:00:00Z",
    current_period_end: opts.current_period_end ?? "2026-12-31T23:59:59Z",
    cancel_at_period_end: false,
    cancelled_at: opts.status === "cancelled" ? "2026-05-01T00:00:00Z" : null,
    shared_contact_ids: shared,
    entitlements: {
      swimlanes_accessible: swimlanes,
      historical_access_from: opts.historical_access_from ?? "2026-01-01",
      deep_content_access: opts.deep_content_access ?? true,
    },
    source: "test_fixture",
    notes: "",
  };
}

function makeIndex(subs: ReturnType<typeof makeSubscription>[]) {
  return {
    generated_at: "2026-06-02T00:00:00Z",
    subscriptions: subs.map((s) => ({
      sb_id: s.sb_id,
      contact_id: s.contact_id,
      company_id: s.company_id,
      stream: s.stream,
      tier: s.tier,
      status: s.status,
      current_period_end: s.current_period_end,
      swimlanes_accessible: s.entitlements.swimlanes_accessible,
      shared_contact_ids: s.shared_contact_ids,
      stripe_subscription_id: s.stripe_subscription_id,
    })),
  };
}

function makeEdition(opts: {
  swimlane: Swimlane;
  stream?: Stream;
  title?: string;
  body?: string;
}) {
  const stream = opts.stream ?? (opts.swimlane.startsWith("nonprofit_") ? "nonprofit" : "commercial");
  const title = opts.title ?? "Test Edition";
  const body = opts.body ?? "## Body\n\nContent paragraph.";
  return `---\nswimlane: ${opts.swimlane}\nstream: ${stream}\ntitle: ${title}\n---\n${body}\n`;
}

function gatedRequest(path: string, opts: { email?: string | null } = {}) {
  const headers: Record<string, string> = {};
  if (opts.email !== null) {
    headers["cf-access-authenticated-user-email"] = opts.email ?? "alice@example.com";
  }
  return new Request("https://elevationary.com" + path, { headers });
}

function mockEnv(sales: MockR2Bucket, news: MockR2Bucket, stripeKey = "sk_test_dummy") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { SALES_CRM: sales as any, NEWSLETTER_CONTENT: news as any, STRIPE_SECRET_KEY: stripeKey };
}

function mockStripeFetch(
  map: Record<string, { status: number; body?: { status?: string } } | "throw">
) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const m = url.match(/\/v1\/subscriptions\/([^/?]+)/);
    if (!m) throw new Error(`Unexpected fetch in test: ${url}`);
    const subId = decodeURIComponent(m[1]);
    const resp = map[subId];
    if (!resp) throw new Error(`Test fixture missing Stripe mock for ${subId}`);
    if (resp === "throw") throw new Error("network");
    return new Response(JSON.stringify(resp.body ?? { status: "active" }), { status: resp.status });
  });
}

// Default scenario: a single individual nonprofit subscriber, one edition keyed
// to that subscriber's lone swimlane. Override per test as needed.
function seedDefault(opts: {
  contact?: ReturnType<typeof makeContact>;
  subs?: ReturnType<typeof makeSubscription>[];
  editions?: { date: string; topic: string; swimlane: Swimlane; stream?: Stream; body?: string }[];
} = {}) {
  const sales = new MockR2Bucket();
  const news = new MockR2Bucket();
  const contact = opts.contact ?? makeContact({ ct_id: "ct_alice", email: "alice@example.com", company_id: "co_anvil" });
  sales.put(`sales/contacts/${contact.ct_id}.json`, contact);
  const subs = opts.subs ?? [];
  for (const s of subs) sales.put(`sales/subscriptions/${s.sb_id}.json`, s);
  sales.put("sales/index_subscriptions.json", makeIndex(subs));
  const editions = opts.editions ?? [
    { date: "2026-06-01", topic: "index", swimlane: "nonprofit_marketing_outreach" as Swimlane, stream: "nonprofit" as Stream },
  ];
  for (const e of editions) {
    news.put(
      `newsletter/drafts/${e.date}/${e.topic}.md`,
      makeEdition({ swimlane: e.swimlane, stream: e.stream, title: `Edition ${e.date}/${e.topic}`, body: e.body })
    );
  }
  return { sales, news, contact };
}

afterEach(() => {
  vi.restoreAllMocks();
  _resetJwksCacheForTests();
});

// ============================================================
// 1. AUTH GATE — Access header presence (dev mode)
// ============================================================
describe("Auth gate (Access header, dev mode)", () => {
  it("returns 403 'not enforced' when cf-access-authenticated-user-email is absent", async () => {
    const { sales, news } = seedDefault();
    const env = mockEnv(sales, news);
    const res = await worker.fetch(gatedRequest("/editions/2026-06-01/index", { email: null }), env, {} as ExecutionContext);
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/Cloudflare Access is not enforced/);
  });

  it("returns 404 for unknown top-level path", async () => {
    const { sales, news } = seedDefault();
    const env = mockEnv(sales, news);
    const res = await worker.fetch(gatedRequest("/some/other/path"), env, {} as ExecutionContext);
    expect(res.status).toBe(404);
  });
});

// ============================================================
// 2. EMAIL RESOLUTION
// ============================================================
describe("Email resolution", () => {
  it("redirects to /upgrade with swimlane param when no contact matches email", async () => {
    const { sales, news } = seedDefault();
    const env = mockEnv(sales, news);
    const res = await worker.fetch(
      gatedRequest("/editions/2026-06-01/index", { email: "stranger@example.com" }),
      env,
      {} as ExecutionContext
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/\/upgrade\/\?swimlane=nonprofit_marketing_outreach&edition=2026-06-01/);
  });

  it("matches email case-insensitively", async () => {
    const sub = makeSubscription({
      sb_id: "sb_alice",
      contact_id: "ct_alice",
      stream: "nonprofit",
      tier: "individual",
      status: "active",
      swimlanes_accessible: ["nonprofit_marketing_outreach"],
      stripe_subscription_id: "sub_alice",
    });
    const { sales, news } = seedDefault({ subs: [sub] });
    mockStripeFetch({ sub_alice: { status: 200, body: { status: "active" } } });
    const env = mockEnv(sales, news);
    const res = await worker.fetch(
      gatedRequest("/editions/2026-06-01/index", { email: "ALICE@Example.COM" }),
      env,
      {} as ExecutionContext
    );
    expect(res.status).toBe(200);
  });
});

// ============================================================
// 3. ENTITLEMENT MATRIX — v2 schema
//    (tier × stream × swimlane × status × historical edge × shared seats)
// ============================================================
describe("Entitlement matrix (v2)", () => {
  it("active individual nonprofit grants the matching swimlane content", async () => {
    const sub = makeSubscription({
      sb_id: "sb_a", contact_id: "ct_alice",
      stream: "nonprofit", tier: "individual", status: "active",
      swimlanes_accessible: ["nonprofit_marketing_outreach"],
      stripe_subscription_id: "sub_a",
    });
    const { sales, news } = seedDefault({ subs: [sub] });
    mockStripeFetch({ sub_a: { status: 200, body: { status: "active" } } });
    const res = await worker.fetch(gatedRequest("/editions/2026-06-01/index"), mockEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(200);
    const entitlement = res.headers.get("x-elevationary-entitlement");
    expect(entitlement).toMatch(/sb=sb_a/);
    expect(entitlement).toMatch(/tier=individual/);
    expect(entitlement).toMatch(/swimlane=nonprofit_marketing_outreach/);
  });

  it("active individual nonprofit DENIES a different nonprofit swimlane", async () => {
    const sub = makeSubscription({
      sb_id: "sb_a", contact_id: "ct_alice",
      stream: "nonprofit", tier: "individual", status: "active",
      swimlanes_accessible: ["nonprofit_marketing_outreach"],
      stripe_subscription_id: "sub_a",
    });
    const { sales, news } = seedDefault({
      subs: [sub],
      editions: [{ date: "2026-06-01", topic: "index", swimlane: "nonprofit_fundraising_campaigns" }],
    });
    mockStripeFetch({});
    const res = await worker.fetch(gatedRequest("/editions/2026-06-01/index"), mockEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/swimlane=nonprofit_fundraising_campaigns/);
  });

  it("active individual commercial grants the matching commercial swimlane", async () => {
    const sub = makeSubscription({
      sb_id: "sb_c", contact_id: "ct_alice",
      stream: "commercial", tier: "individual", status: "active",
      swimlanes_accessible: ["commercial_marketing_demand_generation"],
      stripe_subscription_id: "sub_c",
    });
    const { sales, news } = seedDefault({
      subs: [sub],
      editions: [{ date: "2026-06-01", topic: "index", swimlane: "commercial_marketing_demand_generation" }],
    });
    mockStripeFetch({ sub_c: { status: 200, body: { status: "active" } } });
    const res = await worker.fetch(gatedRequest("/editions/2026-06-01/index"), mockEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(200);
  });

  it("functional_bundle (3 swimlanes) grants any of the 3", async () => {
    const sub = makeSubscription({
      sb_id: "sb_b", contact_id: "ct_alice",
      stream: "nonprofit", tier: "functional_bundle", status: "active",
      swimlanes_accessible: [
        "nonprofit_marketing_outreach",
        "nonprofit_fundraising_campaigns",
        "nonprofit_donor_stewardship",
      ],
      stripe_subscription_id: "sub_b",
    });
    const { sales, news } = seedDefault({
      subs: [sub],
      editions: [
        { date: "2026-06-01", topic: "topic1", swimlane: "nonprofit_marketing_outreach" },
        { date: "2026-06-01", topic: "topic2", swimlane: "nonprofit_donor_stewardship" },
        { date: "2026-06-01", topic: "topic3", swimlane: "nonprofit_volunteer_engagement" }, // NOT entitled
      ],
    });
    mockStripeFetch({ sub_b: { status: 200, body: { status: "active" } } });
    const env = mockEnv(sales, news);
    const r1 = await worker.fetch(gatedRequest("/editions/2026-06-01/topic1"), env, {} as ExecutionContext);
    const r2 = await worker.fetch(gatedRequest("/editions/2026-06-01/topic2"), env, {} as ExecutionContext);
    const r3 = await worker.fetch(gatedRequest("/editions/2026-06-01/topic3"), env, {} as ExecutionContext);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(302);
  });

  it("all_access (10 swimlanes of stream) grants every nonprofit swimlane and denies commercial swimlanes", async () => {
    const sub = makeSubscription({
      sb_id: "sb_all", contact_id: "ct_alice",
      stream: "nonprofit", tier: "all_access", status: "active",
      swimlanes_accessible: ALL_NONPROFIT_SWIMLANES,
      stripe_subscription_id: "sub_all",
    });
    const { sales, news } = seedDefault({
      subs: [sub],
      editions: [
        { date: "2026-06-01", topic: "np-1", swimlane: "nonprofit_advocacy_awareness" },
        { date: "2026-06-01", topic: "np-10", swimlane: "nonprofit_leadership_aim" },
        { date: "2026-06-01", topic: "c-1", swimlane: "commercial_marketing_demand_generation" }, // cross-stream
      ],
    });
    mockStripeFetch({ sub_all: { status: 200, body: { status: "active" } } });
    const env = mockEnv(sales, news);
    const r1 = await worker.fetch(gatedRequest("/editions/2026-06-01/np-1"), env, {} as ExecutionContext);
    const r2 = await worker.fetch(gatedRequest("/editions/2026-06-01/np-10"), env, {} as ExecutionContext);
    const r3 = await worker.fetch(gatedRequest("/editions/2026-06-01/c-1"), env, {} as ExecutionContext);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(302);
  });

  it("all_access shared_contact_ids[] entitles a non-purchaser seat-holder (OR-join replacement for retired enterprise)", async () => {
    const bob = makeContact({ ct_id: "ct_bob", email: "bob@anvil.com" });
    const purchaser = makeContact({ ct_id: "ct_alice", email: "alice@anvil.com" });
    const sub = makeSubscription({
      sb_id: "sb_all_seats", contact_id: "ct_alice",
      stream: "nonprofit", tier: "all_access", status: "active",
      swimlanes_accessible: ALL_NONPROFIT_SWIMLANES,
      shared_contact_ids: ["ct_bob", "ct_carol", "ct_dave"], // 3 of 4 max shared seats
      stripe_subscription_id: "sub_all_seats",
    });
    const sales = new MockR2Bucket();
    const news = new MockR2Bucket();
    sales.put("sales/contacts/ct_alice.json", purchaser);
    sales.put("sales/contacts/ct_bob.json", bob);
    sales.put(`sales/subscriptions/${sub.sb_id}.json`, sub);
    sales.put("sales/index_subscriptions.json", makeIndex([sub]));
    news.put(
      "newsletter/drafts/2026-06-01/index.md",
      makeEdition({ swimlane: "nonprofit_marketing_outreach" })
    );
    mockStripeFetch({ sub_all_seats: { status: 200, body: { status: "active" } } });
    const res = await worker.fetch(
      gatedRequest("/editions/2026-06-01/index", { email: "bob@anvil.com" }),
      mockEnv(sales, news),
      {} as ExecutionContext
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-elevationary-entitlement")).toMatch(/tier=all_access/);
  });

  it("status=past_due (dunning grace) is still entitled", async () => {
    const sub = makeSubscription({
      sb_id: "sb_pd", contact_id: "ct_alice",
      stream: "nonprofit", tier: "individual", status: "past_due",
      swimlanes_accessible: ["nonprofit_marketing_outreach"],
      stripe_subscription_id: "sub_pd",
    });
    const { sales, news } = seedDefault({ subs: [sub] });
    mockStripeFetch({ sub_pd: { status: 200, body: { status: "past_due" } } });
    const res = await worker.fetch(gatedRequest("/editions/2026-06-01/index"), mockEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(200);
  });

  it("status=cancelled is denied (filtered before Stripe call)", async () => {
    const sub = makeSubscription({
      sb_id: "sb_c", contact_id: "ct_alice",
      stream: "nonprofit", tier: "individual", status: "cancelled",
      swimlanes_accessible: ["nonprofit_marketing_outreach"],
      stripe_subscription_id: "sub_c",
    });
    const { sales, news } = seedDefault({ subs: [sub] });
    const stripeSpy = mockStripeFetch({});
    const res = await worker.fetch(gatedRequest("/editions/2026-06-01/index"), mockEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(302);
    expect(stripeSpy).not.toHaveBeenCalled();
  });

  it("status=suppressed is denied (Postmark-bounce path)", async () => {
    const sub = makeSubscription({
      sb_id: "sb_s", contact_id: "ct_alice",
      stream: "nonprofit", tier: "individual", status: "suppressed",
      swimlanes_accessible: ["nonprofit_marketing_outreach"],
      stripe_subscription_id: "sub_s",
    });
    const { sales, news } = seedDefault({ subs: [sub] });
    const stripeSpy = mockStripeFetch({});
    const res = await worker.fetch(gatedRequest("/editions/2026-06-01/index"), mockEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(302);
    expect(stripeSpy).not.toHaveBeenCalled();
  });

  it("edition_date == historical_access_from is entitled (inclusive boundary)", async () => {
    const sub = makeSubscription({
      sb_id: "sb_h1", contact_id: "ct_alice",
      stream: "nonprofit", tier: "individual", status: "active",
      swimlanes_accessible: ["nonprofit_marketing_outreach"],
      historical_access_from: "2026-06-01",
      stripe_subscription_id: "sub_h1",
    });
    const { sales, news } = seedDefault({ subs: [sub] });
    mockStripeFetch({ sub_h1: { status: 200, body: { status: "active" } } });
    const res = await worker.fetch(gatedRequest("/editions/2026-06-01/index"), mockEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(200);
  });

  it("edition_date < historical_access_from is denied", async () => {
    const sub = makeSubscription({
      sb_id: "sb_h2", contact_id: "ct_alice",
      stream: "nonprofit", tier: "individual", status: "active",
      swimlanes_accessible: ["nonprofit_marketing_outreach"],
      historical_access_from: "2026-06-01",
      stripe_subscription_id: "sub_h2",
    });
    const { sales, news } = seedDefault({
      subs: [sub],
      editions: [{ date: "2026-05-15", topic: "index", swimlane: "nonprofit_marketing_outreach" }],
    });
    mockStripeFetch({});
    const res = await worker.fetch(gatedRequest("/editions/2026-05-15/index"), mockEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(302);
  });

  it("deep_content_access=false denies even with all other checks passing", async () => {
    const sub = makeSubscription({
      sb_id: "sb_no_deep", contact_id: "ct_alice",
      stream: "nonprofit", tier: "individual", status: "active",
      swimlanes_accessible: ["nonprofit_marketing_outreach"],
      deep_content_access: false,
      stripe_subscription_id: "sub_nd",
    });
    const { sales, news } = seedDefault({ subs: [sub] });
    mockStripeFetch({});
    const res = await worker.fetch(gatedRequest("/editions/2026-06-01/index"), mockEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(302);
  });

  it("retired enterprise tier semantics: same-company different-contact is NO LONGER entitled (company_id OR-join removed)", async () => {
    // Pre-v2 this case granted access via tier=enterprise + company_id match.
    // Post-v2: only contact_id OR shared_contact_ids membership wins. Without
    // bob in shared_contact_ids, he doesn't get in even though he shares a
    // company_id with alice's individual sub.
    const bob = makeContact({ ct_id: "ct_bob", email: "bob@anvil.com", company_id: "co_anvil" });
    const alice = makeContact({ ct_id: "ct_alice", email: "alice@anvil.com", company_id: "co_anvil" });
    const aliceIndividualSub = makeSubscription({
      sb_id: "sb_indiv", contact_id: "ct_alice", company_id: "co_anvil",
      stream: "nonprofit", tier: "individual", status: "active",
      swimlanes_accessible: ["nonprofit_marketing_outreach"],
      stripe_subscription_id: "sub_indiv",
    });
    const sales = new MockR2Bucket();
    const news = new MockR2Bucket();
    sales.put("sales/contacts/ct_alice.json", alice);
    sales.put("sales/contacts/ct_bob.json", bob);
    sales.put(`sales/subscriptions/${aliceIndividualSub.sb_id}.json`, aliceIndividualSub);
    sales.put("sales/index_subscriptions.json", makeIndex([aliceIndividualSub]));
    news.put("newsletter/drafts/2026-06-01/index.md", makeEdition({ swimlane: "nonprofit_marketing_outreach" }));
    mockStripeFetch({});
    const res = await worker.fetch(
      gatedRequest("/editions/2026-06-01/index", { email: "bob@anvil.com" }),
      mockEnv(sales, news),
      {} as ExecutionContext
    );
    expect(res.status).toBe(302);
  });
});

// ============================================================
// 4. STRIPE DEFENSE-IN-DEPTH
// ============================================================
describe("Stripe defense-in-depth", () => {
  const baseSub = () =>
    makeSubscription({
      sb_id: "sb_did", contact_id: "ct_alice",
      stream: "nonprofit", tier: "individual", status: "active",
      swimlanes_accessible: ["nonprofit_marketing_outreach"],
      stripe_subscription_id: "sub_did",
    });

  it("Stripe returns active → entitled", async () => {
    const { sales, news } = seedDefault({ subs: [baseSub()] });
    mockStripeFetch({ sub_did: { status: 200, body: { status: "active" } } });
    const res = await worker.fetch(gatedRequest("/editions/2026-06-01/index"), mockEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(200);
  });

  it("Stripe returns canceled (R2 still active) → DiD catches, denies", async () => {
    const { sales, news } = seedDefault({ subs: [baseSub()] });
    mockStripeFetch({ sub_did: { status: 200, body: { status: "canceled" } } });
    const res = await worker.fetch(gatedRequest("/editions/2026-06-01/index"), mockEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(302);
  });

  it("Stripe returns 401 (bad key) → fail closed, denies", async () => {
    const { sales, news } = seedDefault({ subs: [baseSub()] });
    mockStripeFetch({ sub_did: { status: 401, body: {} } });
    const res = await worker.fetch(gatedRequest("/editions/2026-06-01/index"), mockEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(302);
  });

  it("Stripe throws network error → fail closed, denies", async () => {
    const { sales, news } = seedDefault({ subs: [baseSub()] });
    mockStripeFetch({ sub_did: "throw" });
    const res = await worker.fetch(gatedRequest("/editions/2026-06-01/index"), mockEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(302);
  });

  it("Stripe returns past_due → entitled (accepted dunning state)", async () => {
    const sub = makeSubscription({
      sb_id: "sb_pd2", contact_id: "ct_alice",
      stream: "nonprofit", tier: "individual", status: "active",
      swimlanes_accessible: ["nonprofit_marketing_outreach"],
      stripe_subscription_id: "sub_pd2",
    });
    const { sales, news } = seedDefault({ subs: [sub] });
    mockStripeFetch({ sub_pd2: { status: 200, body: { status: "past_due" } } });
    const res = await worker.fetch(gatedRequest("/editions/2026-06-01/index"), mockEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(200);
  });

  it("Stripe returns unrecognized status (e.g. 'incomplete_expired') → denied", async () => {
    const { sales, news } = seedDefault({ subs: [baseSub()] });
    mockStripeFetch({ sub_did: { status: 200, body: { status: "incomplete_expired" } } });
    const res = await worker.fetch(gatedRequest("/editions/2026-06-01/index"), mockEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(302);
  });

  it("Worker authenticates to Stripe with bearer token", async () => {
    const { sales, news } = seedDefault({ subs: [baseSub()] });
    const spy = mockStripeFetch({ sub_did: { status: 200, body: { status: "active" } } });
    await worker.fetch(gatedRequest("/editions/2026-06-01/index"), mockEnv(sales, news, "sk_test_secret_value"), {} as ExecutionContext);
    expect(spy).toHaveBeenCalled();
    const callInit = spy.mock.calls[0][1] as RequestInit | undefined;
    const headers = (callInit?.headers || {}) as Record<string, string>;
    expect(headers["Authorization"] || headers["authorization"]).toBe("Bearer sk_test_secret_value");
  });
});

// ============================================================
// 5. SECURITY RED-TEAM
// ============================================================
describe("Security red-team", () => {
  it("literal '..' path traversal is normalized by URL parser to /editions/ archive route", async () => {
    const { sales, news } = seedDefault();
    const res = await worker.fetch(
      new Request("https://elevationary.com/editions/2026-06-01/..", {
        headers: { "cf-access-authenticated-user-email": "alice@example.com" },
      }),
      mockEnv(sales, news),
      {} as ExecutionContext
    );
    expect(res.status).toBe(302);  // upgrade redirect from archive handler — no content leak
  });

  it("URL-encoded %2E%2E in topic regex-rejects → 302 or 404 (never 200)", async () => {
    const { sales, news } = seedDefault();
    const res = await worker.fetch(
      new Request("https://elevationary.com/editions/2026-06-01/%2E%2E%2Fetc", {
        headers: { "cf-access-authenticated-user-email": "alice@example.com" },
      }),
      mockEnv(sales, news),
      {} as ExecutionContext
    );
    expect([302, 404]).toContain(res.status);
  });

  it("path traversal in date is normalized; lands outside Worker route", async () => {
    const { sales, news } = seedDefault();
    const res = await worker.fetch(
      new Request("https://elevationary.com/editions/../etc/passwd", {
        headers: { "cf-access-authenticated-user-email": "alice@example.com" },
      }),
      mockEnv(sales, news),
      {} as ExecutionContext
    );
    expect(res.status).toBe(404);
  });

  it("topic with uppercase or special chars rejected → 404", async () => {
    const { sales, news } = seedDefault();
    const res = await worker.fetch(
      new Request("https://elevationary.com/editions/2026-06-01/Topic%20With%20Spaces", {
        headers: { "cf-access-authenticated-user-email": "alice@example.com" },
      }),
      mockEnv(sales, news),
      {} as ExecutionContext
    );
    expect(res.status).toBe(404);
  });

  it("malformed contact JSON is skipped, lookup continues", async () => {
    const sales = new MockR2Bucket();
    const news = new MockR2Bucket();
    sales.put("sales/contacts/ct_bad.json", "{not valid json");
    sales.put("sales/contacts/ct_alice.json", makeContact({ ct_id: "ct_alice", email: "alice@example.com" }));
    const sub = makeSubscription({
      sb_id: "sb_x", contact_id: "ct_alice",
      stream: "nonprofit", tier: "individual", status: "active",
      swimlanes_accessible: ["nonprofit_marketing_outreach"],
      stripe_subscription_id: "sub_x",
    });
    sales.put(`sales/subscriptions/${sub.sb_id}.json`, sub);
    sales.put("sales/index_subscriptions.json", makeIndex([sub]));
    news.put("newsletter/drafts/2026-06-01/index.md", makeEdition({ swimlane: "nonprofit_marketing_outreach" }));
    mockStripeFetch({ sub_x: { status: 200, body: { status: "active" } } });
    const res = await worker.fetch(gatedRequest("/editions/2026-06-01/index"), mockEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(200);
  });

  it("malformed subscription index returns empty candidates → upgrade redirect", async () => {
    const sales = new MockR2Bucket();
    const news = new MockR2Bucket();
    sales.put("sales/contacts/ct_alice.json", makeContact({ ct_id: "ct_alice", email: "alice@example.com" }));
    sales.put("sales/index_subscriptions.json", "{broken");
    news.put("newsletter/drafts/2026-06-01/index.md", makeEdition({ swimlane: "nonprofit_marketing_outreach" }));
    mockStripeFetch({});
    const res = await worker.fetch(gatedRequest("/editions/2026-06-01/index"), mockEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(302);
  });

  it("malformed full subscription JSON makes that candidate skip (continue loop)", async () => {
    const sub = makeSubscription({
      sb_id: "sb_brk", contact_id: "ct_alice",
      stream: "nonprofit", tier: "individual", status: "active",
      swimlanes_accessible: ["nonprofit_marketing_outreach"],
      stripe_subscription_id: "sub_brk",
    });
    const sales = new MockR2Bucket();
    const news = new MockR2Bucket();
    sales.put("sales/contacts/ct_alice.json", makeContact({ ct_id: "ct_alice", email: "alice@example.com" }));
    sales.put("sales/index_subscriptions.json", makeIndex([sub]));
    sales.put(`sales/subscriptions/${sub.sb_id}.json`, "{partially-written");
    news.put("newsletter/drafts/2026-06-01/index.md", makeEdition({ swimlane: "nonprofit_marketing_outreach" }));
    mockStripeFetch({});
    const res = await worker.fetch(gatedRequest("/editions/2026-06-01/index"), mockEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(302);
  });

  it("FINDING (dev-mode header trust): forged cf-access-authenticated-user-email is trusted when CF_ACCESS_* unset", async () => {
    // This DOCUMENTS the dev-mode behavior. Production has CF_ACCESS_TEAM_DOMAIN
    // + CF_ACCESS_AUD set (see JWT strict-mode tests below) — header alone is
    // rejected there. This test reaffirms the boundary.
    const sub = makeSubscription({
      sb_id: "sb_forge", contact_id: "ct_alice",
      stream: "nonprofit", tier: "individual", status: "active",
      swimlanes_accessible: ["nonprofit_marketing_outreach"],
      stripe_subscription_id: "sub_forge",
    });
    const { sales, news } = seedDefault({ subs: [sub] });
    mockStripeFetch({ sub_forge: { status: 200, body: { status: "active" } } });
    const res = await worker.fetch(
      new Request("https://elevationary.com/editions/2026-06-01/index", {
        headers: { "cf-access-authenticated-user-email": "alice@example.com" },
      }),
      mockEnv(sales, news),
      {} as ExecutionContext
    );
    expect(res.status).toBe(200);
  });
});

// ============================================================
// 6. EDITION LOOKUP edge cases
// ============================================================
describe("Edition lookup", () => {
  it("missing edition file → 404", async () => {
    const { sales, news } = seedDefault({ editions: [] });
    const res = await worker.fetch(gatedRequest("/editions/2026-06-01/missing"), mockEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(404);
  });

  it("edition missing swimlane frontmatter → 500", async () => {
    const sales = new MockR2Bucket();
    const news = new MockR2Bucket();
    sales.put("sales/contacts/ct_alice.json", makeContact({ ct_id: "ct_alice", email: "alice@example.com" }));
    sales.put("sales/index_subscriptions.json", makeIndex([]));
    news.put("newsletter/drafts/2026-06-01/index.md", "---\ntitle: No Swimlane\nstream: nonprofit\n---\nBody\n");
    const res = await worker.fetch(gatedRequest("/editions/2026-06-01/index"), mockEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(500);
    expect(await res.text()).toMatch(/swimlane/);
  });

  it("edition with invalid swimlane value → 500", async () => {
    const sales = new MockR2Bucket();
    const news = new MockR2Bucket();
    sales.put("sales/contacts/ct_alice.json", makeContact({ ct_id: "ct_alice", email: "alice@example.com" }));
    sales.put("sales/index_subscriptions.json", makeIndex([]));
    news.put("newsletter/drafts/2026-06-01/index.md", "---\nswimlane: nonprofit_invented_one\nstream: nonprofit\n---\nBody\n");
    const res = await worker.fetch(gatedRequest("/editions/2026-06-01/index"), mockEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(500);
  });

  it("/editions/<date>/ (no topic) defaults to topic 'index'", async () => {
    const sub = makeSubscription({
      sb_id: "sb_d", contact_id: "ct_alice",
      stream: "nonprofit", tier: "individual", status: "active",
      swimlanes_accessible: ["nonprofit_marketing_outreach"],
      stripe_subscription_id: "sub_d",
    });
    const { sales, news } = seedDefault({ subs: [sub] });
    mockStripeFetch({ sub_d: { status: 200, body: { status: "active" } } });
    const res = await worker.fetch(gatedRequest("/editions/2026-06-01/"), mockEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(200);
  });
});

// ============================================================
// 7. /account/ ROUTE — v2 display
// ============================================================
describe("/account/ route (v2)", () => {
  it("active individual subscriber sees account page with new tier label + swimlane count", async () => {
    const sub = makeSubscription({
      sb_id: "sb_ac", contact_id: "ct_alice",
      stream: "nonprofit", tier: "individual", status: "active",
      swimlanes_accessible: ["nonprofit_marketing_outreach"],
      stripe_subscription_id: "sub_ac",
    });
    const { sales, news } = seedDefault({ subs: [sub] });
    const res = await worker.fetch(gatedRequest("/account/"), mockEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/Your Account/);
    expect(body).toMatch(/Individual Access/);
    expect(body).toMatch(/1 swimlane/);
    expect(body).toMatch(/Stripe Customer Portal/);
  });

  it("all_access purchaser sees seat-count summary when shared_contact_ids is non-empty", async () => {
    const sub = makeSubscription({
      sb_id: "sb_team", contact_id: "ct_alice",
      stream: "nonprofit", tier: "all_access", status: "active",
      swimlanes_accessible: ALL_NONPROFIT_SWIMLANES,
      shared_contact_ids: ["ct_bob", "ct_carol"],
      stripe_subscription_id: "sub_team",
    });
    const { sales, news } = seedDefault({ subs: [sub] });
    const res = await worker.fetch(gatedRequest("/account/"), mockEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/All-Access Pass/);
    expect(body).toMatch(/2 shared seats/);
    expect(body).toMatch(/10 swimlanes/);
  });

  it("subscriber with no active sub → upgrade redirect (no params)", async () => {
    const cancelled = makeSubscription({
      sb_id: "sb_x", contact_id: "ct_alice",
      stream: "nonprofit", tier: "individual", status: "cancelled",
      swimlanes_accessible: ["nonprofit_marketing_outreach"],
      stripe_subscription_id: "sub_x",
    });
    const { sales, news } = seedDefault({ subs: [cancelled] });
    const res = await worker.fetch(gatedRequest("/account/"), mockEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/\/upgrade\/$/);
  });

  it("/account (no trailing slash) is also handled", async () => {
    const sub = makeSubscription({
      sb_id: "sb_ac2", contact_id: "ct_alice",
      stream: "nonprofit", tier: "individual", status: "active",
      swimlanes_accessible: ["nonprofit_marketing_outreach"],
      stripe_subscription_id: "sub_ac2",
    });
    const { sales, news } = seedDefault({ subs: [sub] });
    const res = await worker.fetch(gatedRequest("/account"), mockEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(200);
  });
});

// ============================================================
// 8. /editions/ ARCHIVE
// ============================================================
describe("/editions/ archive", () => {
  it("active subscriber → 200 placeholder archive", async () => {
    const sub = makeSubscription({
      sb_id: "sb_ar", contact_id: "ct_alice",
      stream: "nonprofit", tier: "individual", status: "active",
      swimlanes_accessible: ["nonprofit_marketing_outreach"],
      stripe_subscription_id: "sub_ar",
    });
    const { sales, news } = seedDefault({ subs: [sub] });
    const res = await worker.fetch(gatedRequest("/editions/"), mockEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/Your Editions/);
  });

  it("no subscriber → upgrade redirect", async () => {
    const { sales, news } = seedDefault();
    const res = await worker.fetch(gatedRequest("/editions/"), mockEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(302);
  });
});

// ============================================================
// 9. MULTI-SUB SCENARIOS
// ============================================================
describe("Multi-sub scenarios", () => {
  it("two subs (cancelled + active) → entitled by the active one", async () => {
    const cancelled = makeSubscription({
      sb_id: "sb_old", contact_id: "ct_alice",
      stream: "nonprofit", tier: "individual", status: "cancelled",
      swimlanes_accessible: ["nonprofit_marketing_outreach"],
      stripe_subscription_id: "sub_old",
    });
    const active = makeSubscription({
      sb_id: "sb_new", contact_id: "ct_alice",
      stream: "nonprofit", tier: "individual", status: "active",
      swimlanes_accessible: ["nonprofit_marketing_outreach"],
      stripe_subscription_id: "sub_new",
    });
    const { sales, news } = seedDefault({ subs: [cancelled, active] });
    mockStripeFetch({ sub_new: { status: 200, body: { status: "active" } } });
    const res = await worker.fetch(gatedRequest("/editions/2026-06-01/index"), mockEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-elevationary-entitlement")).toMatch(/sb=sb_new/);
  });

  it("two subs different swimlanes → only the one matching the edition is used", async () => {
    const nonprofitSub = makeSubscription({
      sb_id: "sb_np", contact_id: "ct_alice",
      stream: "nonprofit", tier: "individual", status: "active",
      swimlanes_accessible: ["nonprofit_marketing_outreach"],
      stripe_subscription_id: "sub_np",
    });
    const commercialSub = makeSubscription({
      sb_id: "sb_co", contact_id: "ct_alice",
      stream: "commercial", tier: "individual", status: "active",
      swimlanes_accessible: ["commercial_sales_revenue_operations"],
      stripe_subscription_id: "sub_co",
    });
    const { sales, news } = seedDefault({
      subs: [nonprofitSub, commercialSub],
      editions: [{ date: "2026-06-01", topic: "rev-ops", swimlane: "commercial_sales_revenue_operations" }],
    });
    mockStripeFetch({ sub_co: { status: 200, body: { status: "active" } } });
    const res = await worker.fetch(gatedRequest("/editions/2026-06-01/rev-ops"), mockEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-elevationary-entitlement")).toMatch(/sb=sb_co/);
  });
});

// ============================================================
// 9b. JWT VERIFICATION (strict Access mode)
// ============================================================

describe("JWT verification (strict Access mode)", () => {
  const TEAM_DOMAIN = "test-team.cloudflareaccess.com";
  const AUD = "test-aud-1234";
  const KID = "test-kid-1";
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

  function mockJwksAndStripe(stripeMap: Record<string, { status: number; body?: { status?: string } } | "throw"> = {}) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.startsWith(`https://${TEAM_DOMAIN}/cdn-cgi/access/certs`)) {
        return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
      }
      const m = url.match(/\/v1\/subscriptions\/([^/?]+)/);
      if (m) {
        const subId = decodeURIComponent(m[1]);
        const resp = stripeMap[subId];
        if (!resp) throw new Error(`Test fixture missing Stripe mock for ${subId}`);
        if (resp === "throw") throw new Error("network");
        return new Response(JSON.stringify(resp.body ?? { status: "active" }), { status: resp.status });
      }
      throw new Error(`Unexpected fetch in test: ${url}`);
    });
  }

  async function makeJwt(opts: { email?: string; aud?: string; iss?: string; expIn?: number; kid?: string } = {}) {
    const email = opts.email ?? "alice@example.com";
    const aud = opts.aud ?? AUD;
    const iss = opts.iss ?? `https://${TEAM_DOMAIN}`;
    const expIn = opts.expIn ?? 3600;
    const kid = opts.kid ?? KID;
    return await new SignJWT({ email })
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuer(iss)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime(`${expIn}s`)
      .sign(privateKey);
  }

  function strictEnv(sales: MockR2Bucket, news: MockR2Bucket) {
    return { ...mockEnv(sales, news), CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, CF_ACCESS_AUD: AUD };
  }

  function withJwt(path: string, jwt: string, headerEmail?: string) {
    const headers: Record<string, string> = { "Cf-Access-Jwt-Assertion": jwt };
    if (headerEmail) headers["cf-access-authenticated-user-email"] = headerEmail;
    return new Request("https://elevationary.com" + path, { headers });
  }

  it("strict mode: valid JWT → email extracted from JWT, request proceeds", async () => {
    const sub = makeSubscription({
      sb_id: "sb_jwt1", contact_id: "ct_alice",
      stream: "nonprofit", tier: "individual", status: "active",
      swimlanes_accessible: ["nonprofit_marketing_outreach"],
      stripe_subscription_id: "sub_jwt1",
    });
    const { sales, news } = seedDefault({ subs: [sub] });
    mockJwksAndStripe({ sub_jwt1: { status: 200, body: { status: "active" } } });
    const jwt = await makeJwt({ email: "alice@example.com" });
    const res = await worker.fetch(withJwt("/editions/2026-06-01/index", jwt), strictEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(200);
  });

  it("strict mode: missing JWT → 403", async () => {
    const { sales, news } = seedDefault();
    mockJwksAndStripe({});
    const res = await worker.fetch(
      new Request("https://elevationary.com/editions/2026-06-01/index", {
        headers: { "cf-access-authenticated-user-email": "alice@example.com" },
      }),
      strictEnv(sales, news),
      {} as ExecutionContext
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/JWT missing/);
  });

  it("strict mode: wrong AUD → 403", async () => {
    const { sales, news } = seedDefault();
    mockJwksAndStripe({});
    const jwt = await makeJwt({ aud: "wrong-aud" });
    const res = await worker.fetch(withJwt("/editions/2026-06-01/index", jwt), strictEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/failed verification/);
  });

  it("strict mode: wrong issuer → 403", async () => {
    const { sales, news } = seedDefault();
    mockJwksAndStripe({});
    const jwt = await makeJwt({ iss: "https://attacker.example.com" });
    const res = await worker.fetch(withJwt("/editions/2026-06-01/index", jwt), strictEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(403);
  });

  it("strict mode: expired JWT → 403", async () => {
    const { sales, news } = seedDefault();
    mockJwksAndStripe({});
    const jwt = await makeJwt({ expIn: -60 });
    const res = await worker.fetch(withJwt("/editions/2026-06-01/index", jwt), strictEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(403);
  });

  it("strict mode: unknown kid → 403", async () => {
    const { sales, news } = seedDefault();
    mockJwksAndStripe({});
    const jwt = await makeJwt({ kid: "unknown-kid" });
    const res = await worker.fetch(withJwt("/editions/2026-06-01/index", jwt), strictEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(403);
  });

  it("strict mode: forged signature → 403", async () => {
    const { sales, news } = seedDefault();
    mockJwksAndStripe({});
    const otherKp = await generateKeyPair("RS256", { extractable: true });
    const forged = await new SignJWT({ email: "alice@example.com" })
      .setProtectedHeader({ alg: "RS256", kid: KID })
      .setIssuer(`https://${TEAM_DOMAIN}`)
      .setAudience(AUD)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(otherKp.privateKey as CryptoKey);
    const res = await worker.fetch(withJwt("/editions/2026-06-01/index", forged), strictEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(403);
  });

  it("strict mode: JWT/header email mismatch → 403", async () => {
    const { sales, news } = seedDefault();
    mockJwksAndStripe({});
    const jwt = await makeJwt({ email: "alice@example.com" });
    const res = await worker.fetch(
      withJwt("/editions/2026-06-01/index", jwt, "bob@example.com"),
      strictEnv(sales, news),
      {} as ExecutionContext
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/mismatch/);
  });

  it("strict mode: malformed JWT (not 3 parts) → 403", async () => {
    const { sales, news } = seedDefault();
    mockJwksAndStripe({});
    const res = await worker.fetch(
      withJwt("/editions/2026-06-01/index", "not.a.jwt.really"),
      strictEnv(sales, news),
      {} as ExecutionContext
    );
    expect(res.status).toBe(403);
  });

  it("strict mode: alg=HS256 algorithm-confusion → 403", async () => {
    const { sales, news } = seedDefault();
    mockJwksAndStripe({});
    const header = Buffer.from(JSON.stringify({ alg: "HS256", kid: KID })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      email: "alice@example.com", aud: AUD, iss: `https://${TEAM_DOMAIN}`,
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString("base64url");
    const fakeSig = Buffer.from("not-a-real-sig").toString("base64url");
    const forged = `${header}.${payload}.${fakeSig}`;
    const res = await worker.fetch(withJwt("/editions/2026-06-01/index", forged), strictEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(403);
  });

  it("dev mode (no env vars): forged header is still trusted (documented dev-mode behavior)", async () => {
    const sub = makeSubscription({
      sb_id: "sb_dev", contact_id: "ct_alice",
      stream: "nonprofit", tier: "individual", status: "active",
      swimlanes_accessible: ["nonprofit_marketing_outreach"],
      stripe_subscription_id: "sub_dev",
    });
    const { sales, news } = seedDefault({ subs: [sub] });
    mockStripeFetch({ sub_dev: { status: 200, body: { status: "active" } } });
    const res = await worker.fetch(gatedRequest("/editions/2026-06-01/index"), mockEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(200);
  });
});

// ============================================================
// 9c. STAGE 3 INDUCED-FAILURE MATRIX (P9_D3 Detailed Red-Team)
// Each test deliberately seeds malformed R2 payloads or injection
// attempts. Real induction, real output. Findings → fix inline + retest.
// ============================================================

describe("Stage 3 induced-failure matrix", () => {
  function malformedSeed(opts: {
    // Override individual sub fields with arbitrary shapes
    indexRowOverrides?: Partial<{
      swimlanes_accessible: unknown;
      shared_contact_ids: unknown;
      status: unknown;
      contact_id: unknown;
    }>;
    fullSubOverrides?: Record<string, unknown>;
    editionMd?: string;
    contactEmail?: string;
    contactCtId?: string;
  }) {
    const sales = new MockR2Bucket();
    const news = new MockR2Bucket();
    const contact = makeContact({
      ct_id: opts.contactCtId ?? "ct_alice",
      email: opts.contactEmail ?? "alice@example.com",
    });
    sales.put(`sales/contacts/${contact.ct_id}.json`, contact);
    const baseSub = makeSubscription({
      sb_id: "sb_induce", contact_id: contact.ct_id,
      stream: "nonprofit", tier: "individual", status: "active",
      swimlanes_accessible: ["nonprofit_marketing_outreach"],
      stripe_subscription_id: "sub_induce",
    });
    const fullSub: Record<string, unknown> = { ...baseSub, ...(opts.fullSubOverrides ?? {}) };
    sales.put(`sales/subscriptions/${baseSub.sb_id}.json`, fullSub);
    // Build index row by hand so we can poison fields
    const indexRow: Record<string, unknown> = {
      sb_id: baseSub.sb_id,
      contact_id: baseSub.contact_id,
      company_id: baseSub.company_id,
      stream: baseSub.stream,
      tier: baseSub.tier,
      status: baseSub.status,
      current_period_end: baseSub.current_period_end,
      swimlanes_accessible: baseSub.entitlements.swimlanes_accessible,
      shared_contact_ids: baseSub.shared_contact_ids,
      stripe_subscription_id: baseSub.stripe_subscription_id,
      ...(opts.indexRowOverrides ?? {}),
    };
    sales.put("sales/index_subscriptions.json", { generated_at: "2026-06-02T00:00:00Z", subscriptions: [indexRow] });
    news.put(
      "newsletter/drafts/2026-06-01/p9d3-live-fire.md",
      opts.editionMd ?? makeEdition({ swimlane: "nonprofit_marketing_outreach" })
    );
    return { sales, news, contact, sbId: baseSub.sb_id };
  }

  // INDUCTION 1: index row swimlanes_accessible = null → predicted TypeError on .includes()
  it("[A] index row swimlanes_accessible=null", async () => {
    const { sales, news } = malformedSeed({ indexRowOverrides: { swimlanes_accessible: null } });
    mockStripeFetch({ sub_induce: { status: 200, body: { status: "active" } } });
    let res: Response | { status: number; body: string };
    try {
      res = await worker.fetch(gatedRequest("/editions/2026-06-01/p9d3-live-fire"), mockEnv(sales, news), {} as ExecutionContext);
    } catch (e) {
      res = { status: 500, body: `THREW: ${(e as Error).message}` };
    }
    console.log(`[A] status=${res.status}`);
    // After fix: must be 302 (graceful fail-closed) — not 500/throw
    expect(res.status).toBe(302);
  });

  // INDUCTION 2: index row swimlanes_accessible = "nonprofit_marketing_outreach" (string not array)
  it("[B] index row swimlanes_accessible=<string not array>", async () => {
    const { sales, news } = malformedSeed({ indexRowOverrides: { swimlanes_accessible: "nonprofit_marketing_outreach" } });
    mockStripeFetch({ sub_induce: { status: 200, body: { status: "active" } } });
    let res: Response | { status: number; body: string };
    try {
      res = await worker.fetch(gatedRequest("/editions/2026-06-01/p9d3-live-fire"), mockEnv(sales, news), {} as ExecutionContext);
    } catch (e) {
      res = { status: 500, body: `THREW: ${(e as Error).message}` };
    }
    console.log(`[B] status=${res.status}`);
    // String has .includes() — would match substring, NOT semantic match. Real bug surface.
    // After fix: must be 302 (graceful fail-closed)
    expect(res.status).toBe(302);
  });

  // INDUCTION 3: full sub entitlements = null → predicted TypeError on .historical_access_from
  it("[C] full sub entitlements=null", async () => {
    const { sales, news } = malformedSeed({ fullSubOverrides: { entitlements: null } });
    mockStripeFetch({ sub_induce: { status: 200, body: { status: "active" } } });
    let res: Response | { status: number; body: string };
    try {
      res = await worker.fetch(gatedRequest("/editions/2026-06-01/p9d3-live-fire"), mockEnv(sales, news), {} as ExecutionContext);
    } catch (e) {
      res = { status: 500, body: `THREW: ${(e as Error).message}` };
    }
    console.log(`[C] status=${res.status}`);
    expect(res.status).toBe(302);
  });

  // INDUCTION 4: full sub entitlements={} (empty object, no fields)
  it("[D] full sub entitlements={} (empty object)", async () => {
    const { sales, news } = malformedSeed({ fullSubOverrides: { entitlements: {} } });
    mockStripeFetch({ sub_induce: { status: 200, body: { status: "active" } } });
    let res: Response | { status: number; body: string };
    try {
      res = await worker.fetch(gatedRequest("/editions/2026-06-01/p9d3-live-fire"), mockEnv(sales, news), {} as ExecutionContext);
    } catch (e) {
      res = { status: 500, body: `THREW: ${(e as Error).message}` };
    }
    console.log(`[D] status=${res.status}`);
    expect(res.status).toBe(302);
  });

  // INDUCTION 5: HTML <script> tag in MD body → confirm marked escapes
  it("[E] MD body with <script>alert(1)</script> injection", async () => {
    const md =
      "---\nswimlane: nonprofit_marketing_outreach\ntitle: Injection Test\n---\n" +
      "Normal paragraph.\n\n<script>alert('XSS')</script>\n\nMore content.";
    const { sales, news } = malformedSeed({ editionMd: md });
    mockStripeFetch({ sub_induce: { status: 200, body: { status: "active" } } });
    const res = await worker.fetch(gatedRequest("/editions/2026-06-01/p9d3-live-fire"), mockEnv(sales, news), {} as ExecutionContext);
    expect(res.status).toBe(200);
    const body = await res.text();
    console.log(`[E] contains-raw-script=${body.includes("<script>alert")}`);
    // Confirm marked does NOT pass the raw script through as live HTML
    expect(body.includes("<script>alert('XSS')</script>")).toBe(false);
  });

  // INDUCTION 6: Frontmatter swimlane with leading/trailing whitespace
  it("[F] frontmatter 'swimlane:   nonprofit_marketing_outreach   ' (whitespace)", async () => {
    const md =
      "---\nswimlane:   nonprofit_marketing_outreach   \ntitle: Whitespace Test\n---\nBody.\n";
    const { sales, news } = malformedSeed({ editionMd: md });
    mockStripeFetch({ sub_induce: { status: 200, body: { status: "active" } } });
    const res = await worker.fetch(gatedRequest("/editions/2026-06-01/p9d3-live-fire"), mockEnv(sales, news), {} as ExecutionContext);
    console.log(`[F] status=${res.status}`);
    expect(res.status).toBe(200);
  });

  // INDUCTION 7: MD with frontmatter delimiter inside body — does parser get confused?
  it("[G] MD body containing literal '---' lines", async () => {
    const md =
      "---\nswimlane: nonprofit_marketing_outreach\ntitle: Delimiter Confusion\n---\nIntro paragraph.\n\n---\n\nSecond section after delimiter.\n";
    const { sales, news } = malformedSeed({ editionMd: md });
    mockStripeFetch({ sub_induce: { status: 200, body: { status: "active" } } });
    const res = await worker.fetch(gatedRequest("/editions/2026-06-01/p9d3-live-fire"), mockEnv(sales, news), {} as ExecutionContext);
    console.log(`[G] status=${res.status}`);
    // The first '---\n...\n---\n' should match; body should contain rest
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/Second section after delimiter/);
  });

  // INDUCTION 8: index row missing swimlanes_accessible field (undefined)
  it("[H] index row missing swimlanes_accessible (undefined)", async () => {
    const { sales, news } = malformedSeed({
      // delete-equivalent: set to undefined; spread skips it but explicit makes it not enumerable.
      // Use a manually-crafted index instead.
    });
    // Manually overwrite the index with a row missing swimlanes_accessible
    sales.put("sales/index_subscriptions.json", {
      generated_at: "2026-06-02T00:00:00Z",
      subscriptions: [{
        sb_id: "sb_induce", contact_id: "ct_alice", company_id: null,
        stream: "nonprofit", tier: "individual", status: "active",
        current_period_end: "2026-12-31T23:59:59Z",
        shared_contact_ids: [], stripe_subscription_id: "sub_induce",
        // swimlanes_accessible MISSING
      }],
    });
    mockStripeFetch({ sub_induce: { status: 200, body: { status: "active" } } });
    let res: Response | { status: number; body: string };
    try {
      res = await worker.fetch(gatedRequest("/editions/2026-06-01/p9d3-live-fire"), mockEnv(sales, news), {} as ExecutionContext);
    } catch (e) {
      res = { status: 500, body: `THREW: ${(e as Error).message}` };
    }
    console.log(`[H] status=${res.status}`);
    expect(res.status).toBe(302);
  });

  // INDUCTION 9: very large MD body (~1 MB) — Worker perf + Workers response size
  it("[I] MD body ~1 MB (perf + size check)", async () => {
    const big = "Paragraph. ".repeat(100_000);  // ~1.1 MB
    const md =
      "---\nswimlane: nonprofit_marketing_outreach\ntitle: Big Body\n---\n" + big;
    const { sales, news } = malformedSeed({ editionMd: md });
    mockStripeFetch({ sub_induce: { status: 200, body: { status: "active" } } });
    const t0 = performance.now();
    const res = await worker.fetch(gatedRequest("/editions/2026-06-01/p9d3-live-fire"), mockEnv(sales, news), {} as ExecutionContext);
    const elapsed = performance.now() - t0;
    console.log(`[I] status=${res.status} elapsed_ms=${Math.round(elapsed)}`);
    expect(res.status).toBe(200);
    // Workers free tier has 25 MB response size limit; 1 MB MD → ~3 MB HTML; fine.
  });

  // INDUCTION 10: Stripe Sub ID with shell-metachar/URL-special chars
  it("[J] stripe_subscription_id with URL-special chars (encode safety)", async () => {
    const weirdSubId = "sub_test/../injected?query=1";
    const sales = new MockR2Bucket();
    const news = new MockR2Bucket();
    sales.put("sales/contacts/ct_alice.json", makeContact({ ct_id: "ct_alice", email: "alice@example.com" }));
    const sub = makeSubscription({
      sb_id: "sb_weird", contact_id: "ct_alice",
      stream: "nonprofit", tier: "individual", status: "active",
      swimlanes_accessible: ["nonprofit_marketing_outreach"],
      stripe_subscription_id: weirdSubId,
    });
    sales.put(`sales/subscriptions/${sub.sb_id}.json`, sub);
    sales.put("sales/index_subscriptions.json", makeIndex([sub]));
    news.put("newsletter/drafts/2026-06-01/index.md", makeEdition({ swimlane: "nonprofit_marketing_outreach" }));
    // Intercept fetch and observe the URL the Worker constructs
    let capturedUrl = "";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      capturedUrl = url;
      // Return 200 active so Worker proceeds
      return new Response(JSON.stringify({ status: "active" }), { status: 200 });
    });
    const res = await worker.fetch(gatedRequest("/editions/2026-06-01/index"), mockEnv(sales, news), {} as ExecutionContext);
    console.log(`[J] stripe_url=${capturedUrl} status=${res.status}`);
    // Confirm encodeURIComponent escapes the sub ID into the path
    expect(capturedUrl).toMatch(/\/v1\/subscriptions\/sub_test%2F\.\.%2Finjected%3Fquery%3D1/);
    expect(res.status).toBe(200);  // Worker proceeds; injection neutralized
  });
});

// ============================================================
// 10. PERFORMANCE INSTRUMENTATION
// ============================================================
describe("Performance instrumentation", () => {
  it("entitled request makes 1 Stripe call + 1 contact list + 1 contact GET + 1 index GET + 1 full-sub GET + 1 edition GET", async () => {
    const sub = makeSubscription({
      sb_id: "sb_perf", contact_id: "ct_alice",
      stream: "nonprofit", tier: "individual", status: "active",
      swimlanes_accessible: ["nonprofit_marketing_outreach"],
      stripe_subscription_id: "sub_perf",
    });
    const { sales, news } = seedDefault({ subs: [sub] });
    const spy = mockStripeFetch({ sub_perf: { status: 200, body: { status: "active" } } });
    sales.getCalls = 0;
    sales.listCalls = 0;
    news.getCalls = 0;
    await worker.fetch(gatedRequest("/editions/2026-06-01/index"), mockEnv(sales, news), {} as ExecutionContext);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(sales.listCalls).toBe(1);
    expect(sales.getCalls).toBe(3); // contact + index + full sub
    expect(news.getCalls).toBe(1);
  });
});
