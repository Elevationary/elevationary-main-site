import { describe, it, expect } from "vitest";
import {
  BOUND_COLUMN,
  CF_COLUMN,
  MAX_REFERENCE_NUMBER_LEN,
  assertBinding,
  cfColumnOrUnavailable,
  maxInvoiceNumber,
} from "../src/zoho_query_binding.js";
import { ZohoClient, type ZohoEnv } from "../src/zoho_client.js";

// D2.1 Increment 2b — query-binding assertion layer (CBM output-contract v1.4
// § 4.3.1). Every fixture below mirrors a MEASURED Zoho behaviour from CBM's
// read-only probe of org 920008429 on 2026-07-25.

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

describe("assertBinding — the bound/unbound discriminator (§ 4.3.1)", () => {
  it("BOUND: criteria present naming the expected column", () => {
    const body = { search_criteria: [{ column_name: "invoice_number", comparator: "equal" }] };
    expect(assertBinding(body, "invoice_number")).toEqual({ bound: true, column: "invoice_number" });
  });

  it("BOUND on a no-match query — the row that makes this a guard, not a heuristic", () => {
    // MEASURED: invoice_number_startswith=ZZZZNOPE -> 0 rows, criteria PRESENT.
    // A value matching nothing still echoes, so "no match" is distinguishable
    // from "not filtered". Without this, the whole layer would be guesswork.
    const body = {
      invoices: [],
      search_criteria: [{ column_name: "invoice_number", comparator: "equal" }],
    };
    const verdict = assertBinding(body, "invoice_number");
    expect(verdict.bound).toBe(true);
  });

  it("UNBOUND: criteria absent (the silent org-wide fallback)", () => {
    // MEASURED: unknown cf_ key -> all 27 invoices, search_criteria ABSENT.
    const body = { code: 0, invoices: new Array(27).fill({ invoice_id: "x" }) };
    expect(assertBinding(body, "cf_stripe_invoice_id")).toMatchObject({
      bound: false,
      reason: "criteria_absent",
    });
  });

  it("UNBOUND: typo'd NATIVE param is indistinguishable from a misbound cf_ key", () => {
    // MEASURED: invoice_numbr_startswith=7 -> 27 rows, criteria ABSENT.
    // This is why § 4.3.1 is a QUERY-SURFACE guard, not a cf_ guard.
    const body = { code: 0, invoices: new Array(27).fill({ invoice_id: "x" }) };
    expect(assertBinding(body, "invoice_number")).toMatchObject({
      bound: false,
      reason: "criteria_absent",
    });
  });

  it("UNBOUND: empty criteria array counts as absent", () => {
    expect(assertBinding({ search_criteria: [] }, "email")).toMatchObject({
      bound: false,
      reason: "criteria_absent",
    });
  });

  it("UNBOUND: something else bound, but not the column we asked for", () => {
    const body = { search_criteria: [{ column_name: "status" }] };
    expect(assertBinding(body, "invoice_number")).toMatchObject({
      bound: false,
      reason: "column_mismatch",
      observed: ["status"],
    });
  });

  it("tolerates a non-object / raw-text body without throwing", () => {
    expect(assertBinding("<html>gateway error</html>", "email").bound).toBe(false);
    expect(assertBinding(null, "email").bound).toBe(false);
  });
});

describe("BOUND_COLUMN registry — normalisation + the filter_by trap", () => {
  it("normalises modifier params to their BASE column", () => {
    // MEASURED: invoice_number_startswith echoes as invoice_number; date_start
    // as date. Asserting the param you SENT would fail on a perfect binding.
    expect(BOUND_COLUMN.invoice_number_startswith).toBe("invoice_number");
    expect(BOUND_COLUMN.invoice_number_contains).toBe("invoice_number");
    expect(BOUND_COLUMN.date_start).toBe("date");
  });

  it("does NOT contain filter_by — it binds but never echoes", () => {
    // MEASURED: filter_by=Status.Paid -> 26 of 27 rows (filtering!) with
    // criteria ABSENT. Asserting on it would DLQ correct results and page on
    // healthy traffic — the guard becoming the outage it exists to prevent.
    expect("filter_by" in BOUND_COLUMN).toBe(false);
    expect(BOUND_COLUMN.status).toBe("status"); // the echoing form instead
  });
});

describe("cf_ constants — named-but-unbound, fail closed until measured", () => {
  it("all three cf_ keys are awaiting the post-provisioning probe", () => {
    expect(CF_COLUMN.cf_stripe_invoice_id).toBeNull();
    expect(CF_COLUMN.cf_stripe_customer_id).toBeNull();
    expect(CF_COLUMN.cf_stripe_subscription_id).toBeNull();
  });

  it("resolving an unmeasured cf_ key reports unavailable rather than guessing", () => {
    expect(cfColumnOrUnavailable("cf_stripe_invoice_id")).toEqual({
      unavailable: "cf_stripe_invoice_id",
    });
  });

  it("resolves once a measured string lands", () => {
    CF_COLUMN.cf_probe_temp = "cf_probe_temp";
    expect(cfColumnOrUnavailable("cf_probe_temp")).toEqual({ column: "cf_probe_temp" });
    delete CF_COLUMN.cf_probe_temp;
  });
});

describe("ZohoClient.getFiltered — enforcement at the boundary", () => {
  it("passes a BOUND response through untouched", async () => {
    const { fn } = makeFetch([
      TOKEN_OK,
      () =>
        jsonResponse(200, {
          code: 0,
          contacts: [{ contact_id: "c1" }],
          search_criteria: [{ column_name: "email" }],
        }),
    ]);
    const client = new ZohoClient(ENV, { fetchFn: fn, nowMs: () => 1_000_000 });
    const r = await client.listContactByEmail("a@b.com");
    expect(r.ok).toBe(true);
    expect((r.body as { contacts: unknown[] }).contacts).toHaveLength(1);
  });

  it("converts an UNBOUND 200 into a binding_error — the org-wide contact leak", async () => {
    // Without the guard: 9 org-wide contacts returned, handler reads contacts[0]
    // as "the existing customer", and the subscription invoice attaches to
    // whichever CONSULTING client sorts first. A real invoice, wrong company.
    const { fn } = makeFetch([
      TOKEN_OK,
      () => jsonResponse(200, { code: 0, contacts: new Array(9).fill({ contact_id: "wrong" }) }),
    ]);
    const client = new ZohoClient(ENV, { fetchFn: fn, nowMs: () => 1_000_000 });
    const r = await client.listContactByEmail("a@b.com");
    expect(r.ok).toBe(false);
    expect((r.body as { binding_error: { reason: string } }).binding_error.reason).toBe(
      "criteria_absent",
    );
  });

  it("does NOT assert binding on a non-2xx — retry ladder owns those", async () => {
    const { fn } = makeFetch([TOKEN_OK, () => jsonResponse(429, { code: 100, message: "rate" })]);
    const client = new ZohoClient(ENV, { fetchFn: fn, nowMs: () => 1_000_000 });
    const r = await client.listContactByEmail("a@b.com");
    expect(r).toMatchObject({ ok: false, status: 429 });
    expect((r.body as Record<string, unknown>).binding_error).toBeUndefined();
  });

  it("cf_ filtered reads FAIL CLOSED and issue NO request at all", async () => {
    const { fn, calls } = makeFetch([TOKEN_OK]);
    const client = new ZohoClient(ENV, { fetchFn: fn, nowMs: () => 1_000_000 });
    const r = await client.listInvoiceByStripeInvoiceId("in_123");
    expect(r.ok).toBe(false);
    expect((r.body as { binding_unavailable: string }).binding_unavailable).toBe(
      "cf_stripe_invoice_id",
    );
    expect(calls.length).toBe(0); // not even a token mint
  });

  it("all three cf_ helpers fail closed identically", async () => {
    const client = new ZohoClient(ENV, { fetchFn: makeFetch([]).fn, nowMs: () => 1_000_000 });
    for (const r of [
      await client.listContactByStripeCustomerId("cus_1"),
      await client.listInvoiceByStripeInvoiceId("in_1"),
      await client.listInvoicesBySubscriptionId("sub_1"),
    ]) {
      expect(r.ok).toBe(false);
      expect((r.body as Record<string, unknown>).binding_unavailable).toBeDefined();
    }
  });
});

describe("reference_number 50-char guard (§ 4.6)", () => {
  it("MCP schema says 100; the measured cap is 50 (Zoho error code 15)", () => {
    expect(MAX_REFERENCE_NUMBER_LEN).toBe(50);
  });

  it("passes at exactly 50", async () => {
    const { fn } = makeFetch([
      TOKEN_OK,
      () =>
        jsonResponse(200, {
          code: 0,
          customerpayments: [],
          search_criteria: [{ column_name: "reference_number" }],
        }),
    ]);
    const client = new ZohoClient(ENV, { fetchFn: fn, nowMs: () => 1_000_000 });
    const r = await client.listCustomerPaymentByReference("x".repeat(50));
    expect(r.ok).toBe(true);
  });

  it("fails loud at 51 and issues NO request", async () => {
    const { fn, calls } = makeFetch([]);
    const client = new ZohoClient(ENV, { fetchFn: fn, nowMs: () => 1_000_000 });
    const r = await client.listCustomerPaymentByReference("x".repeat(51));
    expect(r.ok).toBe(false);
    expect((r.body as { reference_number_too_long: number }).reference_number_too_long).toBe(51);
    expect(calls.length).toBe(0);
  });

  it("a real Stripe charge id has clearance", async () => {
    expect("ch_3QxYzAbCdEfGhIjK1LmNoPqR".length).toBeLessThan(MAX_REFERENCE_NUMBER_LEN);
  });
});

describe("maxInvoiceNumber — client-side max (removes the unassertable dependency)", () => {
  it("computes the max regardless of returned order", () => {
    // The old form asked Zoho to sort DESC and take 1. A dropped sort_order
    // silently defaults to ASC, returning the LOWEST — max+1 then allocates an
    // ALREADY-USED number while the binding assertion passes and reports healthy.
    const ascending = [
      { invoice_number: "7001" },
      { invoice_number: "7002" },
      { invoice_number: "7010" },
    ];
    expect(maxInvoiceNumber(ascending)).toBe(7010);
    expect(maxInvoiceNumber([...ascending].reverse())).toBe(7010);
  });

  it("returns null on an empty series (first subscription invoice)", () => {
    expect(maxInvoiceNumber([])).toBeNull();
    expect(maxInvoiceNumber(undefined)).toBeNull();
  });

  it("skips malformed rows rather than throwing", () => {
    expect(maxInvoiceNumber([null, { invoice_number: "abc" }, { invoice_number: "7005" }])).toBe(
      7005,
    );
  });
});

describe("maxInvoiceNumber7xxx — paging defended against a dropped page param", () => {
  it("aggregates across pages and returns the true max", async () => {
    const page = (nums: string[], more: boolean) => () =>
      jsonResponse(200, {
        code: 0,
        invoices: nums.map((n) => ({ invoice_id: `i${n}`, invoice_number: n })),
        search_criteria: [{ column_name: "invoice_number" }],
        page_context: { has_more_page: more },
      });
    const { fn } = makeFetch([TOKEN_OK, page(["7001", "7002"], true), page(["7050", "7003"], false)]);
    const client = new ZohoClient(ENV, { fetchFn: fn, nowMs: () => 1_000_000 });
    const r = await client.maxInvoiceNumber7xxx();
    expect(r.ok).toBe(true);
    expect(r.max).toBe(7050);
  });

  it("TERMINATES when `page` is silently dropped and page 1 repeats forever", async () => {
    // `page` is a non-filter param, so a drop is undetectable via search_criteria
    // and has_more_page would keep claiming more. Loop must stop on no-new-ids.
    const samePage = () =>
      jsonResponse(200, {
        code: 0,
        invoices: [{ invoice_id: "i1", invoice_number: "7001" }],
        search_criteria: [{ column_name: "invoice_number" }],
        page_context: { has_more_page: true }, // lies forever
      });
    const { fn, calls } = makeFetch([TOKEN_OK, ...Array(60).fill(samePage)]);
    const client = new ZohoClient(ENV, { fetchFn: fn, nowMs: () => 1_000_000 });
    const r = await client.maxInvoiceNumber7xxx();
    expect(r.ok).toBe(true);
    expect(r.max).toBe(7001);
    expect(calls.length).toBeLessThan(5); // stopped on the 2nd page, not the 50th
  });

  it("propagates an UNBOUND page as a binding_error instead of a bogus max", async () => {
    const { fn } = makeFetch([
      TOKEN_OK,
      () => jsonResponse(200, { code: 0, invoices: new Array(27).fill({ invoice_number: "4003" }) }),
    ]);
    const client = new ZohoClient(ENV, { fetchFn: fn, nowMs: () => 1_000_000 });
    const r = await client.maxInvoiceNumber7xxx();
    expect(r.ok).toBe(false);
    expect(r.max).toBeNull();
    // Without the guard this would have returned 4003 — a CONSULTING invoice
    // number — and the subscription series would allocate 4004.
  });
});
