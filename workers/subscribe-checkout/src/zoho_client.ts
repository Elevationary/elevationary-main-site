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

const ZOHO_TOKEN_URL = "https://accounts.zoho.com/oauth/v2/token";
const ZOHO_BOOKS_BASE = "https://www.zohoapis.com/books/v3";
// § 6.1 step 3: Zoho access_token TTL is 3600s; cache 55 min so it never expires
// mid-request. 60s safety buffer on read mirrors zoho_auth.py.
const TOKEN_CACHE_TTL_SEC = 3300;
const TOKEN_READ_BUFFER_MS = 60_000;
const KV_TOKEN_KEY = "zoho-access-token";

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

  get(path: string, params?: Record<string, string>): Promise<ZohoResult> {
    return this.request("GET", path, { params });
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

  /** Dedup lookup by the cf_stripe_customer_id custom field. */
  listContactByStripeCustomerId(stripeCustomerId: string): Promise<ZohoResult> {
    return this.get("/contacts", { cf_stripe_customer_id: stripeCustomerId });
  }
  listContactByEmail(email: string): Promise<ZohoResult> {
    return this.get("/contacts", { email });
  }
  createContact(contact: unknown): Promise<ZohoResult> {
    return this.post("/contacts", contact);
  }
  updateContact(contactId: string, patch: unknown): Promise<ZohoResult> {
    return this.put(`/contacts/${contactId}`, patch);
  }

  /** Layer-2 idempotency lookup by cf_stripe_invoice_id (§ 7.2). */
  listInvoiceByStripeInvoiceId(stripeInvoiceId: string): Promise<ZohoResult> {
    return this.get("/invoices", { cf_stripe_invoice_id: stripeInvoiceId });
  }
  /** Highest existing 7xxx-series invoice_number for max+1 numbering (§ 6.2 / CBM § 3.3). */
  listInvoicesMax7xxx(): Promise<ZohoResult> {
    return this.get("/invoices", {
      invoice_number_startswith: "7",
      sort_column: "invoice_number",
      sort_order: "D",
      per_page: "1",
    });
  }
  listInvoicesBySubscriptionId(stripeSubscriptionId: string): Promise<ZohoResult> {
    return this.get("/invoices", { cf_stripe_subscription_id: stripeSubscriptionId });
  }
  createInvoice(invoice: unknown): Promise<ZohoResult> {
    return this.post("/invoices", invoice);
  }
  /** Mark a draft invoice as sent (§ 6.2). */
  markInvoiceSent(invoiceId: string): Promise<ZohoResult> {
    return this.post(`/invoices/${invoiceId}/status/sent`, {});
  }

  listCustomerPaymentByReference(referenceNumber: string): Promise<ZohoResult> {
    return this.get("/customerpayments", { reference_number: referenceNumber });
  }
  createCustomerPayment(payment: unknown): Promise<ZohoResult> {
    return this.post("/customerpayments", payment);
  }
}
