import { describe, it, expect } from "vitest";
import { ZohoClient, ZohoConfigError, type ZohoEnv } from "../src/zoho_client.js";

// D2.1 Increment 2a — Zoho Books REST client (spec § 6). Mocked fetch + fake KV;
// no live Zoho token mint or REST call.

const ENV: ZohoEnv = {
  ZOHO_CLIENT_ID: "cid_test",
  ZOHO_CLIENT_SECRET: "csec_test",
  ZOHO_REFRESH_TOKEN: "rt_test",
  ZOHO_ORGANIZATION_ID: "920008429",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
const TOKEN_OK = () => jsonResponse(200, { access_token: "tok_ABC", expires_in: 3600 });

/**
 * A BOUND Zoho list response. Real Zoho echoes `search_criteria` naming the
 * NORMALISED BASE COLUMN whenever a filter binds — in both the match and the
 * no-match case. Fixtures without it model an UNBOUND (silently org-wide)
 * response, which v1.4 § 4.3.1 requires the client to reject.
 */
function boundList(column: string, payload: Record<string, unknown>): Response {
  return jsonResponse(200, {
    code: 0,
    search_criteria: [{ column_name: column, comparator: "equal" }],
    ...payload,
  });
}

/** Script-driven fetch mock: each call consumes the next handler; records calls. */
function makeFetch(handlers: Array<(url: string, init?: RequestInit) => Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let i = 0;
  const fn = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (i >= handlers.length) throw new Error(`unexpected fetch call #${i + 1} to ${url}`);
    return handlers[i++](String(url), init);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function fakeKV() {
  const store = new Map<string, string>();
  const kv = {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => void store.set(k, v),
  } as unknown as KVNamespace;
  return { kv, store };
}

describe("ZohoClient — token minting + caching (§ 6.1)", () => {
  it("mints an access token via the OAuth refresh-token grant", async () => {
    const { fn, calls } = makeFetch([TOKEN_OK]);
    const client = new ZohoClient(ENV, { fetchFn: fn, nowMs: () => 1_000_000 });
    const tok = await client.getAccessToken();
    expect(tok).toBe("tok_ABC");
    expect(calls[0].url).toContain("accounts.zoho.com/oauth/v2/token");
    expect(calls[0].url).toContain("grant_type=refresh_token");
    expect(calls[0].url).toContain("refresh_token=rt_test");
    expect(calls[0].init?.method).toBe("POST");
  });

  it("serves the instance cache on the second call (no re-mint)", async () => {
    const { fn, calls } = makeFetch([TOKEN_OK]); // only ONE mint allowed
    const client = new ZohoClient(ENV, { fetchFn: fn, nowMs: () => 1_000_000 });
    await client.getAccessToken();
    const again = await client.getAccessToken();
    expect(again).toBe("tok_ABC");
    expect(calls.length).toBe(1); // second call hit the cache, no fetch
  });

  it("serves a fresh KV cache entry without minting", async () => {
    const { kv, store } = fakeKV();
    store.set(
      "zoho-access-token",
      JSON.stringify({ access_token: "tok_KV", expires_at_ms: 5_000_000 }),
    );
    const { fn, calls } = makeFetch([]); // zero fetches allowed
    const client = new ZohoClient(ENV, { fetchFn: fn, nowMs: () => 1_000_000, kv });
    const tok = await client.getAccessToken();
    expect(tok).toBe("tok_KV");
    expect(calls.length).toBe(0);
  });

  it("re-mints when the cached token is within the 60s expiry buffer", async () => {
    const { kv, store } = fakeKV();
    // expires_at 1_050_000ms; now 1_000_000ms → 50s remaining < 60s buffer → re-mint.
    store.set(
      "zoho-access-token",
      JSON.stringify({ access_token: "tok_STALE", expires_at_ms: 1_050_000 }),
    );
    const { fn } = makeFetch([TOKEN_OK]);
    const client = new ZohoClient(ENV, { fetchFn: fn, nowMs: () => 1_000_000, kv });
    const tok = await client.getAccessToken();
    expect(tok).toBe("tok_ABC");
    // fresh token persisted back to KV
    expect(JSON.parse(store.get("zoho-access-token")!).access_token).toBe("tok_ABC");
  });

  it("throws ZohoConfigError when credentials are missing", async () => {
    const { fn } = makeFetch([]);
    const client = new ZohoClient({ ZOHO_ORGANIZATION_ID: "920008429" }, { fetchFn: fn });
    await expect(client.getAccessToken()).rejects.toBeInstanceOf(ZohoConfigError);
  });
});

describe("ZohoClient — request shaping (§ 6.2 / § 6.3)", () => {
  it("injects organization_id + Zoho-oauthtoken auth header on GET", async () => {
    const { fn, calls } = makeFetch([
      TOKEN_OK,
      () => boundList("email", { contacts: [{ contact_id: "c1" }] }),
    ]);
    const client = new ZohoClient(ENV, { fetchFn: fn, nowMs: () => 1_000_000 });
    const r = await client.listContactByEmail("a@b.com");
    expect(r).toMatchObject({ ok: true, status: 200 });
    const call = calls[1];
    expect(call.url).toContain("www.zohoapis.com/books/v3/contacts");
    expect(call.url).toContain("organization_id=920008429");
    expect(call.url).toContain("email=a%40b.com");
    expect((call.init?.headers as Record<string, string>).Authorization).toBe(
      "Zoho-oauthtoken tok_ABC",
    );
  });

  it("sets Content-Type + serialized JSON body on POST", async () => {
    const { fn, calls } = makeFetch([
      TOKEN_OK,
      () => jsonResponse(201, { code: 0, invoice: { invoice_id: "inv_1" } }),
    ]);
    const client = new ZohoClient(ENV, { fetchFn: fn, nowMs: () => 1_000_000 });
    const r = await client.createInvoice({ customer_id: "c1", line_items: [] });
    expect(r).toMatchObject({ ok: true, status: 201 });
    const call = calls[1];
    expect(call.init?.method).toBe("POST");
    expect((call.init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(call.init?.body as string)).toEqual({ customer_id: "c1", line_items: [] });
  });

  it("7xxx max-lookup filters on invoice_number_startswith and does NOT rely on server-side sort", async () => {
    const { fn, calls } = makeFetch([
      TOKEN_OK,
      () => boundList("invoice_number", { invoices: [{ invoice_id: "i1", invoice_number: "7001" }] }),
    ]);
    const client = new ZohoClient(ENV, { fetchFn: fn, nowMs: () => 1_000_000 });
    await client.maxInvoiceNumber7xxx();
    const url = calls[1].url;
    expect(url).toContain("invoice_number_startswith=7");
    // sort_column / sort_order are non-filter params: silently droppable AND
    // structurally unassertable. Correctness must not depend on them.
    expect(url).not.toContain("sort_order");
    expect(url).not.toContain("sort_column");
  });
});

describe("ZohoClient — 401 refresh-retry + non-2xx passthrough (§ 6.4 / § 8)", () => {
  it("on 401, force-refreshes the token once and retries the original request", async () => {
    const { fn, calls } = makeFetch([
      TOKEN_OK, // initial mint → tok_ABC
      () => jsonResponse(401, { code: 57, message: "invalid token" }), // GET #1 → 401
      () => jsonResponse(200, { access_token: "tok_NEW", expires_in: 3600 }), // forced re-mint
      () => boundList("email", { contacts: [{ contact_id: "c9" }] }), // GET retry → 200
    ]);
    const client = new ZohoClient(ENV, { fetchFn: fn, nowMs: () => 1_000_000 });
    const r = await client.listContactByEmail("a@b.com");
    expect(r).toMatchObject({ ok: true, status: 200 });
    expect(calls.length).toBe(4);
    // retried GET used the freshly-minted token
    expect((calls[3].init?.headers as Record<string, string>).Authorization).toBe(
      "Zoho-oauthtoken tok_NEW",
    );
  });

  it("on a second 401, surfaces the error result (caller routes to DLQ)", async () => {
    const { fn } = makeFetch([
      TOKEN_OK,
      () => jsonResponse(401, { code: 57 }), // GET #1
      () => jsonResponse(200, { access_token: "tok_NEW", expires_in: 3600 }), // re-mint
      () => jsonResponse(401, { code: 57 }), // GET retry still 401
    ]);
    const client = new ZohoClient(ENV, { fetchFn: fn, nowMs: () => 1_000_000 });
    const r = await client.listContactByEmail("a@b.com");
    expect(r).toMatchObject({ ok: false, status: 401 });
  });

  it("returns 429/5xx as a non-ok result WITHOUT throwing (retry-ladder is the caller's job)", async () => {
    const { fn } = makeFetch([TOKEN_OK, () => jsonResponse(429, { code: 100, message: "rate" })]);
    const client = new ZohoClient(ENV, { fetchFn: fn, nowMs: () => 1_000_000 });
    const r = await client.createInvoice({});
    expect(r).toMatchObject({ ok: false, status: 429 });
    expect((r.body as { code: number }).code).toBe(100);
  });

  it("maps a transport failure (fetch throws) to status 0", async () => {
    const fn = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    // pre-seed instance token so getAccessToken doesn't also throw at mint
    const client = new ZohoClient(ENV, { fetchFn: fn, nowMs: () => 1_000_000 });
    // first fetch (token mint) throws → getAccessToken rejects; guard that path
    await expect(client.get("/invoices")).rejects.toBeTruthy();
  });

  it("maps a transport failure on the REST call (post-auth) to status 0", async () => {
    let call = 0;
    const fn = (async (_url: unknown) => {
      call++;
      if (call === 1) return TOKEN_OK();
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const client = new ZohoClient(ENV, { fetchFn: fn, nowMs: () => 1_000_000 });
    const r = await client.get("/invoices");
    expect(r).toMatchObject({ ok: false, status: 0 });
  });
});
