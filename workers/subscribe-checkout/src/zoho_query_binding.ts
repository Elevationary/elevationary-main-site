// Zoho query-binding assertion layer — CBM output-contract v1.4 § 4.3.1.
//
// WHY THIS EXISTS
// ---------------
// Zoho Books SILENTLY DROPS any query parameter it does not recognise and falls
// back to ORG-WIDE scope. No error, no warning, HTTP 200. Measured against org
// 920008429 (CBM, read-only REST, 2026-07-25):
//
//   cf_stripe_invoice_id=<fabricated>   -> 27 invoices (ALL), search_criteria ABSENT
//   cf_totally_made_up_key=<anything>   -> 27 invoices (ALL), search_criteria ABSENT
//   invoice_numbr_startswith=7  (TYPO)  -> 27 invoices (ALL), search_criteria ABSENT
//   invoice_number_starts_with=7 (TYPO) -> 27 invoices (ALL), search_criteria ABSENT
//
// A typo in a NATIVE parameter is byte-for-byte indistinguishable from a misbound
// custom field. That is why this is a QUERY-SURFACE guard and not a cf_ guard:
// the narrow version leaves the identical defect reachable through ordinary code
// that passes review.
//
// WHY IT MATTERS HERE SPECIFICALLY
// --------------------------------
// The subscription and consulting populations share ONE Zoho org and ONE query
// surface, so any unbound filter degrades to org-wide scope — and org-wide is
// consulting-dominated (27 invoices, zero subscriptions at time of writing).
// Every silent-filter defect therefore surfaces as a subscription<->consulting
// collision, in whatever shape the particular query takes:
//   - idempotency lookup   -> non-empty result -> "already processed" -> 200 to
//                             Stripe, NO WRITE, no retry. Silent revenue loss.
//   - max-number lookup    -> org-wide high number -> subscription series
//                             allocates inside the consulting range.
//   - contact-by-email     -> every contact returned -> subscription invoice
//                             attaches to whichever consulting client sorts first.
//
// THE DISCRIMINATOR
// -----------------
// `search_criteria` is present iff a filter BOUND — in BOTH the match and the
// no-match case. Measured: `invoice_number_startswith=ZZZZNOPE` (bound param,
// garbage VALUE) returns 0 rows WITH search_criteria present. That is the row
// that makes this a guard and not a heuristic: it separates "no match" from
// "not filtered", which is the entire load it bears.
//
// TWO TRAPS THIS MODULE ENCODES (both measured, both would have broken a naive
// implementation of the very rule this module implements):
//   1. `filter_by` BINDS BUT DOES NOT ECHO (filter_by=Status.Paid -> 26 of 27
//      rows, search_criteria ABSENT). Asserting on it routes CORRECT results to
//      the DLQ and pages on healthy traffic. NEVER assert on filter_by; use the
//      echoing form (`status=paid` returns the identical 26 AND echoes).
//   2. `column_name` NORMALISES TO THE BASE COLUMN: `invoice_number_startswith`
//      echoes as `invoice_number`, `date_start` as `date`. Assert the normalised
//      base column, never the parameter you sent.

/**
 * Empirical max length of `reference_number` on customerpayments (Zoho error
 * code 15 above this). The MCP schema advertises 100 — THE SCHEMA IS WRONG.
 * Stripe charge ids run ~27 chars, so this is a tripwire for a future id-format
 * change rather than a live constraint.
 */
export const MAX_REFERENCE_NUMBER_LEN = 50;

/**
 * MEASURED echoing parameters -> the normalised base column Zoho echoes back.
 *
 * Anything absent from this map is UNMEASURED, therefore UNSAFE — build-time
 * verify a new filter shape before pinning it (v1.4 § 4.3.1). `filter_by` is
 * deliberately ABSENT: it binds but does not echo, so it can never be asserted.
 */
export const BOUND_COLUMN = {
  // /invoices — measured
  invoice_number: "invoice_number",
  invoice_number_startswith: "invoice_number",
  invoice_number_contains: "invoice_number",
  status: "status",
  customer_id: "customer_id",
  date: "date",
  date_start: "date",
  search_text: "search_text",
  // /customerpayments — measured
  reference_number: "reference_number",
  // /contacts — measured independently (endpoint parity NOT assumed)
  email: "email",
} as const;

export type MeasuredParam = keyof typeof BOUND_COLUMN;

/**
 * Custom-field filters. The exact `column_name` Zoho echoes for a cf_ filter is
 * NOT KNOWABLE until the fields exist (ESC-141) — it could come back as the
 * cf_ key, as the bare label, or otherwise. v1.4 § 4.3.1 requires asserting
 * against CBM's MEASURED string from the post-provisioning probe, never a
 * prediction.
 *
 * `null` = awaiting that probe. Querying through a null constant FAILS CLOSED
 * (see `cfColumnOrUnavailable`) rather than issuing a filter whose binding
 * cannot be verified.
 */
export const CF_COLUMN: Record<string, string | null> = {
  cf_stripe_invoice_id: null,
  cf_stripe_customer_id: null,
  cf_stripe_subscription_id: null,
};

export type BindingVerdict =
  | { bound: true; column: string }
  | {
      bound: false;
      reason: "criteria_absent" | "column_mismatch";
      expected: string;
      observed: string[];
    };

interface SearchCriterion {
  column_name?: unknown;
}

/**
 * v1.4 § 4.3.1 core assertion. Verifies the response proves the filter BOUND.
 *
 * Never throws — returns a verdict so the caller owns policy (§ 8 retry ladder /
 * § 9 DLQ). Asserts the NORMALISED BASE COLUMN, not the parameter sent.
 */
export function assertBinding(body: unknown, expectedColumn: string): BindingVerdict {
  const criteria = extractCriteria(body);
  if (criteria === null || criteria.length === 0) {
    // Filter was silently dropped -> results are ORG-WIDE, not filtered.
    return { bound: false, reason: "criteria_absent", expected: expectedColumn, observed: [] };
  }
  const observed = criteria
    .map((c) => (typeof c?.column_name === "string" ? c.column_name : null))
    .filter((c): c is string => c !== null);

  if (observed.includes(expectedColumn)) {
    return { bound: true, column: expectedColumn };
  }
  // Something bound, but not the column we asked for — treat as unbound.
  return { bound: false, reason: "column_mismatch", expected: expectedColumn, observed };
}

function extractCriteria(body: unknown): SearchCriterion[] | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = (body as Record<string, unknown>).search_criteria;
  return Array.isArray(raw) ? (raw as SearchCriterion[]) : null;
}

/**
 * Resolve a cf_ key to its MEASURED column name, or report that the probe has
 * not landed yet. Fail-closed by construction: there is no code path that
 * queries a cf_ filter whose binding cannot be asserted.
 */
export function cfColumnOrUnavailable(cfKey: string): { column: string } | { unavailable: string } {
  const measured = CF_COLUMN[cfKey];
  if (typeof measured === "string" && measured.length > 0) return { column: measured };
  return { unavailable: cfKey };
}

/**
 * Highest numeric invoice_number in a set, computed CLIENT-SIDE.
 *
 * WHY CLIENT-SIDE: the server-side form of this lookup depended on
 * `sort_column` / `sort_order` / `per_page`, none of which are filters, so none
 * of which ever appear in `search_criteria` — they are silently droppable AND
 * structurally unassertable. A typo'd `sort_order` defaults to ascending, and
 * `per_page=1` then returns the LOWEST match, so max+1 allocates an ALREADY-USED
 * number while the binding guard passes and reports healthy. Computing the max
 * here means the call trusts only a parameter that echoes.
 */
export function maxInvoiceNumber(invoices: unknown): number | null {
  if (!Array.isArray(invoices)) return null;
  let max: number | null = null;
  for (const inv of invoices) {
    if (typeof inv !== "object" || inv === null) continue;
    const n = (inv as Record<string, unknown>).invoice_number;
    if (typeof n !== "string" && typeof n !== "number") continue;
    const parsed = Number.parseInt(String(n), 10);
    if (!Number.isFinite(parsed)) continue;
    if (max === null || parsed > max) max = parsed;
  }
  return max;
}
