// Zoho Books REST client for the D2.1 webhook receiver's Zoho dispatch path.
//
// Spec: spec_stripe_event_mapping_2026_07_18.md § 6 (Zoho REST Interaction Pattern).
// D-01 (ESC-132, CEO 2026-07-21): direct-REST via the zoho_auth.py OAuth pattern —
// the Worker mints an access-token from the refresh-token and calls Zoho Books
// v3 directly over HTTPS. No intermediary CBM/Vercel envelope (§ 6.5).
//
// Ports ~/.gemini/antigravity/skills/invoicing/scripts/zoho_auth.py to the Worker
// runtime: Web-native `fetch` instead of `requests`; env secrets instead of a
// dotenv file; Workers KV for the cross-isolate access-token cache (§ 6.1 step 3).
//
// Deliberately does NOT throw on non-2xx (except transport failure): it returns a
// structured { ok, status, body } so the dispatch orchestrator (later increment)
// can route 429/5xx into the § 8 retry ladder and permanent 4xx into the § 9 DLQ.
// The ONLY status this client handles internally is 401 — it force-refreshes the
// token once and retries (§ 6.4 / § 8.3), which does not consume the retry budget.

import {
  BOUND_COLUMN,
  MAX_REFERENCE_NUMBER_LEN,
  assertBinding,
  cfColumnOrUnavailable,
  maxInvoiceNumber,
} from "./zoho_query_binding";

const ZOHO_TOKEN_URL = "https://accounts.zoho.com/oauth/v2/token";
const ZOHO_BOOKS_BASE = "https://www.zohoapis.com/books/v3";
// § 6.1 step 3: Zoho access_token TTL is 3600s; cache 55 min so it never expires
// mid-request. 60s safety buffer on read mirrors zoho_auth.py.
const TOKEN_CACHE_TTL_SEC = 3300;
const TOKEN_READ_BUFFER_MS = 60_000;
const KV_TOKEN_KEY = "zoho-access-token";
/** Page size + hard cap for the client-side 7xxx max scan. */
const INVOICE_PAGE_SIZE = 200;
const MAX_INVOICE_PAGES = 50;

function extractInvoices(body: unknown): unknown[] {
  if (typeof body !== "object" || body === null) return [];
  const raw = (body as Record<string, unknown>).invoices;
  return Array.isArray(raw) ? raw : [];
}

function invoiceKey(inv: unknown): string | null {
  if (typeof inv !== "object" || inv === null) return null;
  const rec = inv as Record<string, unknown>;
  const id = rec.invoice_id ?? rec.invoice_number;
  return typeof id === "string" || typeof id === "number" ? String(id) : null;
}

function hasMorePage(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const ctx = (body as Record<string, unknown>).page_context;
  if (typeof ctx !== "object" || ctx === null) return false;
  return (ctx as Record<string, unknown>).has_more_page === true;
}

/** Subset of Env this client needs (spec § 11.2). */
export interface ZohoEnv {
  ZOHO_CLIENT_ID?: string;
  ZOHO_CLIENT_SECRET?: string;
  ZOHO_REFRESH_TOKEN?: string;
  ZOHO_ORGANIZATION_ID?: string;
}

/** Injectable dependencies — real values in production, fakes in tests. */
export interface ZohoClientDeps {
  fetchFn?: typeof fetch;
  nowMs?: () => number;
  /** Cross-isolate access-token cache (spec § 6.1 step 3). Optional: falls back
   *  to the per-instance cache when unbound (skeleton / test). */
  kv?: KVNamespace;
}

/** Structured result — non-2xx does NOT throw (except transport failure). */
export interface ZohoResult {
  ok: boolean; // true iff HTTP 2xx
  status: number; // 0 = transport failure (fetch threw)
  body: unknown; // parsed JSON, or { transport_error } on fetch throw
}

interface TokenCache {
  access_token: string;
  expires_at_ms: number;
}

export class ZohoConfigError extends Error {}

export class ZohoClient {
  private readonly fetchFn: typeof fetch;
  private readonly nowMs: () => number;
  private readonly kv?: KVNamespace;
  private instanceToken: TokenCache | null = null;

  constructor(private readonly env: ZohoEnv, deps: ZohoClientDeps = {}) {
    this.fetchFn = deps.fetchFn ?? fetch;
    this.nowMs = deps.nowMs ?? (() => Date.now());
    this.kv = deps.kv;
  }

  private requireCreds(): { cid: string; csec: string; rt: string } {
    const { ZOHO_CLIENT_ID: cid, ZOHO_CLIENT_SECRET: csec, ZOHO_REFRESH_TOKEN: rt } = this.env;
    if (!cid || !csec || !rt) {
      throw new ZohoConfigError(
        "Missing Zoho credentials (ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN).",
      );
    }
    return { cid, csec, rt };
  }

  private orgId(): string {
    if (!this.env.ZOHO_ORGANIZATION_ID) {
      throw new ZohoConfigError("Missing ZOHO_ORGANIZATION_ID.");
    }
    return this.env.ZOHO_ORGANIZATION_ID;
  }

  /**
   * Return a valid access token. Order (§ 6.1): live instance cache → live KV
   * cache → mint. `force` skips both caches (used by the 401 refresh-retry path).
   */
  async getAccessToken(force = false): Promise<string> {
    const now = this.nowMs();
    if (!force) {
      if (this.instanceToken && now < this.instanceToken.expires_at_ms - TOKEN_READ_BUFFER_MS) {
        return this.instanceToken.access_token;
      }
      if (this.kv) {
        const raw = await this.kv.get(KV_TOKEN_KEY);
        if (raw) {
          try {
            const cached = JSON.parse(raw) as TokenCache;
            if (cached.access_token && now < cached.expires_at_ms - TOKEN_READ_BUFFER_MS) {
              this.instanceToken = cached;
              return cached.access_token;
            }
          } catch {
            /* corrupt cache entry — fall through to mint */
          }
        }
      }
    }
    return this.mintToken();
  }

  private async mintToken(): Promise<string> {
    const { cid, csec, rt } = this.requireCreds();
    const params = new URLSearchParams({
      refresh_token: rt,
      client_id: cid,
      client_secret: csec,
      grant_type: "refresh_token",
    });
    const resp = await this.fetchFn(`${ZOHO_TOKEN_URL}?${params.toString()}`, { method: "POST" });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new ZohoConfigError(`Zoho token refresh failed: ${resp.status} ${text}`);
    }
    const data = (await resp.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) {
      throw new ZohoConfigError("Zoho token response missing access_token.");
    }
    const ttlSec = data.expires_in ?? 3600;
    const token: TokenCache = {
      access_token: data.access_token,
      expires_at_ms: this.nowMs() + ttlSec * 1000,
    };
    this.instanceToken = token;
    if (this.kv) {
      await this.kv.put(KV_TOKEN_KEY, JSON.stringify(token), {
        expirationTtl: TOKEN_CACHE_TTL_SEC,
      });
    }
    return token.access_token;
  }

  /**
   * Core request. Injects org_id + auth header; parses JSON; on 401 force-
   * refreshes once and retries. Never throws on HTTP status — returns a
   * ZohoResult. Transport failures (fetch throws) return { ok:false, status:0 }.
   */
  private async request(
    method: "GET" | "POST" | "PUT",
    path: string,
    opts: { params?: Record<string, string>; body?: unknown } = {},
    isRetry = false,
  ): Promise<ZohoResult> {
    const token = await this.getAccessToken(isRetry);
    const query = new URLSearchParams({ organization_id: this.orgId(), ...(opts.params ?? {}) });
    const url = `${ZOHO_BOOKS_BASE}${path}?${query.toString()}`;
    const headers: Record<string, string> = { Authorization: `Zoho-oauthtoken ${token}` };
    const init: RequestInit = { method, headers };
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }

    let resp: Response;
    try {
      resp = await this.fetchFn(url, init);
    } catch (e) {
      return { ok: false, status: 0, body: { transport_error: String(e) } };
    }

    // § 6.4 / § 8.3: single forced refresh + retry on auth expiry.
    if (resp.status === 401 && !isRetry) {
      return this.request(method, path, opts, true);
    }

    const text = await resp.text().catch(() => "");
    let parsed: unknown = text;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        /* leave as raw text */
      }
    }
    return { ok: resp.ok, status: resp.status, body: parsed };
  }

  /**
   * UNFILTERED GET. Use ONLY for reads with no filter semantics (single-resource
   * fetches by id, etc.). Any read that filters MUST go through `getFiltered` so
   * its binding is asserted — see `getFiltered` and zoho_query_binding.ts.
   */
  get(path: string, params?: Record<string, string>): Promise<ZohoResult> {
    return this.request("GET", path, { params });
  }

  /**
   * FILTERED GET — v1.4 § 4.3.1 enforcement-by-construction.
   *
   * `expectedColumn` is REQUIRED: a new filtered read cannot compile without
   * declaring the normalised base column it expects Zoho to echo. The assertion
   * lives here rather than at each call site, so it cannot be forgotten — which
   * matters because the defect it guards is silent, and a rule an engineer must
   * remember is one forgetful commit from violation.
   *
   * On a bound filter the underlying result passes through untouched. On an
   * unbound one the result is converted to ok:false with a `binding_error`
   * marker so the (later) § 9 DLQ path routes it and pages. NEITHER "non-empty
   * means processed" NOR "create anyway" is a safe fallback: one drops revenue,
   * the other duplicates it.
   *
   * Non-2xx passes through UNCHANGED — a 429/5xx is the retry ladder's business,
   * and asserting binding on an error body would misclassify it.
   */
  async getFiltered(
    path: string,
    params: Record<string, string>,
    expectedColumn: string,
  ): Promise<ZohoResult> {
    const result = await this.request("GET", path, { params });
    if (!result.ok) return result;

    const verdict = assertBinding(result.body, expectedColumn);
    if (verdict.bound) return result;

    return {
      ok: false,
      status: result.status,
      body: {
        binding_error: verdict,
        path,
        params,
        zoho_body: result.body,
      },
    };
  }

  /**
   * Filtered GET through a custom-field key. Fails CLOSED when the field's
   * measured column name has not landed yet (ESC-141 provisioning + CBM probe):
   * no request is issued at all, because a cf_ filter whose binding cannot be
   * asserted is exactly the defect this layer exists to prevent.
   */
  private async getFilteredByCf(
    path: string,
    cfKey: string,
    value: string,
  ): Promise<ZohoResult> {
    const resolved = cfColumnOrUnavailable(cfKey);
    if ("unavailable" in resolved) {
      return {
        ok: false,
        status: 0,
        body: {
          binding_unavailable: resolved.unavailable,
          detail:
            "cf_ column name not yet measured — awaiting ESC-141 provisioning + CBM post-provisioning probe (v1.4 § 4.3.1). Request NOT issued.",
        },
      };
    }
    return this.getFiltered(path, { [cfKey]: value }, resolved.column);
  }
  post(path: string, body: unknown): Promise<ZohoResult> {
    return this.request("POST", path, { body });
  }
  put(path: string, body: unknown): Promise<ZohoResult> {
    return this.request("PUT", path, { body });
  }

  // ==========================================================================
  // § 6.2 endpoint helpers — thin typed wrappers over the verbs above.
  // ==========================================================================

  /** Dedup lookup by the cf_stripe_customer_id custom field (§ 2.1 primary). */
  listContactByStripeCustomerId(stripeCustomerId: string): Promise<ZohoResult> {
    return this.getFilteredByCf("/contacts", "cf_stripe_customer_id", stripeCustomerId);
  }
  /**
   * § 2.1 fallback: match an EXISTING consulting client who subscribes, so no
   * duplicate contact is created. `email` measured as binding+echoing on
   * /contacts (endpoint verified independently, parity NOT assumed).
   */
  listContactByEmail(email: string): Promise<ZohoResult> {
    return this.getFiltered("/contacts", { email }, BOUND_COLUMN.email);
  }
  createContact(contact: unknown): Promise<ZohoResult> {
    return this.post("/contacts", contact);
  }
  updateContact(contactId: string, patch: unknown): Promise<ZohoResult> {
    return this.put(`/contacts/${contactId}`, patch);
  }

  /** Layer-2 idempotency lookup by cf_stripe_invoice_id (§ 7.2). */
  listInvoiceByStripeInvoiceId(stripeInvoiceId: string): Promise<ZohoResult> {
    return this.getFilteredByCf("/invoices", "cf_stripe_invoice_id", stripeInvoiceId);
  }

  /**
   * Highest existing 7xxx-series invoice_number for max+1 numbering
   * (§ 6.2 / CBM § 3.3), computed CLIENT-SIDE over the paged filtered set.
   *
   * The previous form asked Zoho to sort descending and return one row. That
   * depended on `sort_column`/`sort_order`/`per_page` — non-filter parameters
   * that never appear in `search_criteria` and so can be silently dropped with
   * NO detectable signal. A dropped `sort_order` defaults to ascending, making
   * this return the LOWEST 7xxx number while the binding assertion passes; max+1
   * would then allocate an already-used number.
   *
   * Pagination is likewise defended: `page` is a non-filter parameter, so if it
   * were dropped every request would return page 1 forever. The loop therefore
   * stops when a page contributes no NEW invoice ids, independent of what
   * `page_context` claims, and is hard-capped.
   */
  async maxInvoiceNumber7xxx(): Promise<{ ok: boolean; status: number; max: number | null; body: unknown }> {
    const seen = new Map<string, unknown>();
    let lastResult: ZohoResult | null = null;

    for (let page = 1; page <= MAX_INVOICE_PAGES; page++) {
      const result = await this.getFiltered(
        "/invoices",
        { invoice_number_startswith: "7", per_page: String(INVOICE_PAGE_SIZE), page: String(page) },
        BOUND_COLUMN.invoice_number_startswith,
      );
      lastResult = result;
      if (!result.ok) return { ok: false, status: result.status, max: null, body: result.body };

      const invoices = extractInvoices(result.body);
      let added = 0;
      for (const inv of invoices) {
        const id = invoiceKey(inv);
        if (id !== null && !seen.has(id)) {
          seen.set(id, inv);
          added++;
        }
      }
      // No new rows => either genuinely exhausted, or `page` was dropped and we
      // are re-reading page 1. Either way, stop: nothing further is obtainable.
      if (added === 0) break;
      if (!hasMorePage(result.body)) break;
    }

    return {
      ok: true,
      status: lastResult?.status ?? 200,
      max: maxInvoiceNumber([...seen.values()]),
      body: { counted: seen.size },
    };
  }

  listInvoicesBySubscriptionId(stripeSubscriptionId: string): Promise<ZohoResult> {
    return this.getFilteredByCf("/invoices", "cf_stripe_subscription_id", stripeSubscriptionId);
  }
  createInvoice(invoice: unknown): Promise<ZohoResult> {
    return this.post("/invoices", invoice);
  }
  /** Mark a draft invoice as sent (§ 6.2). */
  markInvoiceSent(invoiceId: string): Promise<ZohoResult> {
    return this.post(`/invoices/${invoiceId}/status/sent`, {});
  }

  /**
   * § 4.6 payment dedup by the NATIVE reference_number field.
   *
   * Guarded at MAX_REFERENCE_NUMBER_LEN (50, empirical — Zoho error code 15).
   * The MCP schema advertises 100 and is WRONG. Stripe charge ids run ~27 chars
   * so there is clearance today; this fails LOUD on a future id-format change
   * rather than letting error-15 surface as an opaque 400 mid-dispatch.
   */
  listCustomerPaymentByReference(referenceNumber: string): Promise<ZohoResult> {
    if (referenceNumber.length > MAX_REFERENCE_NUMBER_LEN) {
      return Promise.resolve({
        ok: false,
        status: 0,
        body: {
          reference_number_too_long: referenceNumber.length,
          max: MAX_REFERENCE_NUMBER_LEN,
          detail: "Zoho rejects reference_number over 50 chars (error code 15). Request NOT issued.",
        },
      });
    }
    return this.getFiltered(
      "/customerpayments",
      { reference_number: referenceNumber },
      BOUND_COLUMN.reference_number,
    );
  }
  createCustomerPayment(payment: unknown): Promise<ZohoResult> {
    return this.post("/customerpayments", payment);
  }
}
