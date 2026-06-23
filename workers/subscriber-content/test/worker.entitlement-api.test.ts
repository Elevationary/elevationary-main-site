// Tests for the internal /api/entitlement endpoint added 2026-06-22 for the
// /subscribe/welcome/ service-binding flow (D1.6 Worker-subrequest architecture).

import { describe, expect, it } from "vitest";
import worker from "../src/index";

class MockR2Object {
  constructor(private data: string) {}
  async text(): Promise<string> { return this.data; }
  async json<T = unknown>(): Promise<T> { return JSON.parse(this.data) as T; }
}

class MockR2Bucket {
  store = new Map<string, string>();
  put(key: string, value: string | object) {
    this.store.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  async get(key: string): Promise<MockR2Object | null> {
    return this.store.has(key) ? new MockR2Object(this.store.get(key)!) : null;
  }
  async list({ prefix }: { prefix?: string } = {}): Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }> {
    const keys = [...this.store.keys()].filter((k) => !prefix || k.startsWith(prefix));
    return { objects: keys.map((key) => ({ key })), truncated: false, cursor: undefined };
  }
}

type Sub = {
  sb_id: string;
  contact_id: string;
  company_id: string | null;
  stream: "commercial" | "nonprofit";
  tier: "individual" | "functional_bundle" | "all_access";
  status: "active" | "past_due" | "cancelled" | "suppressed";
  stripe_subscription_id: string;
  swimlanes: string[];
  current_period_end?: string;
};

function seed(opts: { contact?: { ct_id: string; email: string } | null; subs?: Sub[] } = {}) {
  const sales = new MockR2Bucket();
  const news = new MockR2Bucket();
  if (opts.contact !== null) {
    const c = opts.contact ?? { ct_id: "ct_alice", email: "alice@example.com" };
    sales.put(`sales/contacts/${c.ct_id}.json`, { ...c, company_id: null });
  }
  const subs = opts.subs ?? [];
  for (const s of subs) {
    sales.put(`sales/subscriptions/${s.sb_id}.json`, {
      sb_id: s.sb_id,
      contact_id: s.contact_id,
      company_id: s.company_id,
      stream: s.stream,
      tier: s.tier,
      status: s.status,
      stripe_customer_id: "cus_" + s.sb_id,
      stripe_subscription_id: s.stripe_subscription_id,
      stripe_price_id: "price_" + s.sb_id,
      started_at: "2026-01-01T00:00:00Z",
      current_period_end: s.current_period_end ?? "2026-12-31T23:59:59Z",
      cancel_at_period_end: false,
      cancelled_at: null,
      shared_contact_ids: [],
      entitlements: {
        swimlanes_accessible: s.swimlanes,
        historical_access_from: "2026-01-01",
        deep_content_access: true,
      },
      source: "test",
    });
  }
  sales.put("sales/index_subscriptions.json", {
    generated_at: "2026-06-22T00:00:00Z",
    subscriptions: subs.map((s) => ({
      sb_id: s.sb_id,
      contact_id: s.contact_id,
      company_id: s.company_id,
      stream: s.stream,
      tier: s.tier,
      status: s.status,
      current_period_end: s.current_period_end ?? "2026-12-31T23:59:59Z",
      swimlanes_accessible: s.swimlanes,
      shared_contact_ids: [],
      stripe_subscription_id: s.stripe_subscription_id,
    })),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { env: { SALES_CRM: sales as any, NEWSLETTER_CONTENT: news as any, STRIPE_SECRET_KEY: "sk_test" } };
}

function req(method: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://subscriber-content/api/entitlement", {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const GOOD_HEADERS = {
  "CF-Access-Client-Id": "tok.access",
  "CF-Access-Client-Secret": "secret",
};

describe("/api/entitlement", () => {
  it("rejects non-POST methods with 405", async () => {
    const { env } = seed();
    const res = await worker.fetch(
      new Request("https://subscriber-content/api/entitlement", { method: "GET", headers: GOOD_HEADERS }),
      env, {} as ExecutionContext,
    );
    expect(res.status).toBe(405);
  });

  it("rejects request missing CF Access headers with 401", async () => {
    const { env } = seed();
    const res = await worker.fetch(req("POST", { email: "alice@example.com" }), env, {} as ExecutionContext);
    expect(res.status).toBe(401);
  });

  it("rejects malformed body with 400", async () => {
    const { env } = seed();
    const r = new Request("https://subscriber-content/api/entitlement", {
      method: "POST",
      headers: { "content-type": "application/json", ...GOOD_HEADERS },
      body: "not json",
    });
    const res = await worker.fetch(r, env, {} as ExecutionContext);
    expect(res.status).toBe(400);
  });

  it("rejects body without email with 400", async () => {
    const { env } = seed();
    const res = await worker.fetch(req("POST", { foo: "bar" }, GOOD_HEADERS), env, {} as ExecutionContext);
    expect(res.status).toBe(400);
  });

  it("returns 404 when no contact for email", async () => {
    const { env } = seed({ contact: null });
    const res = await worker.fetch(req("POST", { email: "ghost@example.com" }, GOOD_HEADERS), env, {} as ExecutionContext);
    expect(res.status).toBe(404);
  });

  it("returns 404 when contact has no active subs", async () => {
    const { env } = seed({ subs: [] });
    const res = await worker.fetch(req("POST", { email: "alice@example.com" }, GOOD_HEADERS), env, {} as ExecutionContext);
    expect(res.status).toBe(404);
  });

  it("returns 200 + payload for an active individual subscriber", async () => {
    const { env } = seed({
      subs: [{
        sb_id: "sb1", contact_id: "ct_alice", company_id: null,
        stream: "commercial", tier: "individual", status: "active",
        stripe_subscription_id: "sub_1",
        swimlanes: ["commercial_marketing_demand_generation"],
        current_period_end: "2026-07-22T00:00:00Z",
      }],
    });
    const res = await worker.fetch(req("POST", { email: "alice@example.com" }, GOOD_HEADERS), env, {} as ExecutionContext);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      tier: string; tierLabel: string; swimlanes: string[];
      billingNextIso: string; portalUrl: string;
    };
    expect(body.tier).toBe("individual");
    expect(body.tierLabel).toBe("Individual Access");
    expect(body.swimlanes).toEqual(["commercial_marketing_demand_generation"]);
    expect(body.billingNextIso).toBe("2026-07-22");
    expect(body.portalUrl).toMatch(/\/account\//);
  });

  it("picks highest-tier sub when contact has multiple (all_access > functional_bundle > individual)", async () => {
    const { env } = seed({
      subs: [
        { sb_id: "sb_i", contact_id: "ct_alice", company_id: null,
          stream: "commercial", tier: "individual", status: "active",
          stripe_subscription_id: "sub_i", swimlanes: ["commercial_marketing_demand_generation"] },
        { sb_id: "sb_aa", contact_id: "ct_alice", company_id: null,
          stream: "commercial", tier: "all_access", status: "active",
          stripe_subscription_id: "sub_aa",
          swimlanes: [
            "commercial_marketing_demand_generation",
            "commercial_sales_revenue_operations",
            "commercial_customer_success",
          ] },
      ],
    });
    const res = await worker.fetch(req("POST", { email: "alice@example.com" }, GOOD_HEADERS), env, {} as ExecutionContext);
    expect(res.status).toBe(200);
    const body = await res.json() as { tier: string; swimlanes: string[] };
    expect(body.tier).toBe("all_access");
    expect(body.swimlanes.length).toBe(3);
  });

  it("normalizes email to lowercase before lookup", async () => {
    const { env } = seed({
      subs: [{
        sb_id: "sb1", contact_id: "ct_alice", company_id: null,
        stream: "commercial", tier: "individual", status: "active",
        stripe_subscription_id: "sub_1",
        swimlanes: ["commercial_marketing_demand_generation"],
      }],
    });
    const res = await worker.fetch(req("POST", { email: "ALICE@EXAMPLE.COM" }, GOOD_HEADERS), env, {} as ExecutionContext);
    expect(res.status).toBe(200);
  });
});
