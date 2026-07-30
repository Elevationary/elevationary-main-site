// Stripe -> Zoho event transformer. Website spec § 5 (per-event mapping),
// CBM output contract v1.4 § 1.1-§ 1.5 (line-item shapes) + § 4.5 (payment).
//
// WHY THIS MODULE IS PURE
// -----------------------
// § 5's flow interleaves computation with I/O: KV dedup (step 1), Zoho contact
// resolve (step 3), Zoho idempotency read (step 4), invoice-number allocation
// (step 5), the two creates (steps 7-8), KV persist (step 9). Only steps 2 and 6
// — and the per-billing_reason payload construction — are computation.
//
// This module is that computation and NOTHING else. It holds no fetch, reads no
// Env, imports no client. Every I/O-derived value arrives as an explicit context
// argument. The consequence that matters: the money-shaping logic is testable
// without a mock, so a defect in it cannot hide behind a stubbed network call.
// The orchestration increment (§ 7 idempotency, § 8/§ 9 DLQ) calls into here.
//
// NOTHING IN HERE THROWS. Every rejection is a returned verdict, because the
// caller owns DLQ/retry policy (§ 8/§ 9) and an exception thrown mid-handler is
// indistinguishable at the Stripe boundary from a Worker crash — which Stripe
// retries, forever, against a payload that will never transform.

import { MAX_REFERENCE_NUMBER_LEN } from "./zoho_query_binding";

// US/Phoenix is UTC-7 ALL YEAR — Arizona does not observe DST. That is why this
// is a constant and not a tz-database lookup, and why it is safe to be one.
const PHOENIX_UTC_OFFSET_SECONDS = -7 * 3600;

/** Zoho's `payment_terms_label` for an already-collected subscription charge. */
const DUE_ON_RECEIPT = "Due on Receipt";

export type TransformRejectCode =
  | "event_type_unsupported"
  | "billing_reason_unknown"
  | "invoice_malformed"
  | "line_items_missing"
  | "product_unexpanded"
  | "amount_not_integer"
  | "charge_reference_missing"
  | "charge_reference_too_long";

export interface TransformReject {
  ok: false;
  code: TransformRejectCode;
  message: string;
}

/**
 * The three money shapes. `subscription_threshold` and `manual` are NOT branches
 * — § 5.1.4 maps them onto `subscription_cycle` and `subscription_update`
 * respectively, with a warning. Keeping them out of this union means no call site
 * can forget to fold them.
 */
export type BillingBranch = "subscription_create" | "subscription_cycle" | "subscription_update";

export type EventRoute =
  | { kind: "billing"; branch: BillingBranch; billingReason: string; warnings: string[] }
  | { kind: "no_write"; status: string; detail: Record<string, unknown>; warnings: string[] }
  | TransformReject;

export interface TransformContext {
  /** Zoho contact id resolved by § 5 step 3 (resolve-or-create). */
  zohoCustomerId: string;
  /** 7xxx series number allocated by § 5 step 5 (max+1, client-side). */
  invoiceNumber: string;
  /**
   * Count of PRIOR Zoho invoices carrying this stripe subscription id, from the
   * § 5.1.2 cycle-number query. cycle_number = this + 1. Only read on the
   * `subscription_cycle` branch.
   */
  priorInvoiceCount?: number;
}

export interface ZohoLineItem {
  name: string;
  description: string;
  rate: number;
  quantity: number;
  discount: number;
  tax_id: string;
}

export interface ZohoCustomField {
  label: string;
  value: string;
}

export interface ZohoInvoicePayload {
  customer_id: string;
  invoice_number: string;
  date: string;
  due_date: string;
  payment_terms: number;
  payment_terms_label: string;
  custom_fields: ZohoCustomField[];
  notes: string;
  line_items: ZohoLineItem[];
}

export interface ZohoPaymentPayload {
  customer_id: string;
  invoice_id: string;
  amount: number;
  payment_mode: string;
  reference_number: string;
  date: string;
  notes: string;
  custom_fields: ZohoCustomField[];
}

export type InvoiceBuild = { ok: true; payload: ZohoInvoicePayload; warnings: string[] } | TransformReject;

export type PaymentBuild =
  | { ok: true; skip: true; reason: string; warnings: string[] }
  | { ok: true; skip: false; payload: ZohoPaymentPayload; warnings: string[] }
  | TransformReject;

// ---------------------------------------------------------------------------
// Primitive conversions
// ---------------------------------------------------------------------------

/**
 * Stripe minor units -> Zoho major units.
 *
 * Rejects a NON-INTEGER input rather than dividing it. Every Stripe amount field
 * is an integer number of cents; a float arriving here means someone already
 * divided upstream, and dividing twice produces a silently 100x-light invoice
 * that still looks like a plausible number. Returns null so the caller rejects.
 */
export function centsToAmount(cents: unknown): number | null {
  if (typeof cents !== "number" || !Number.isFinite(cents) || !Number.isInteger(cents)) return null;
  // Integer / 100 lands on the nearest double to a 2-decimal value, which
  // round-trips exactly through JSON. No toFixed rounding needed or wanted.
  return cents / 100;
}

/** Unix seconds -> YYYY-MM-DD in UTC. Used for PERIOD dates (§ 5.1.1). */
export function utcDate(unixSeconds: unknown): string | null {
  if (typeof unixSeconds !== "number" || !Number.isFinite(unixSeconds)) return null;
  const d = new Date(unixSeconds * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Unix seconds -> YYYY-MM-DD in US/Phoenix. Used for the invoice/payment `date`
 * (§ 5.1.1: "stripe_invoice.created ISO date, US/Phoenix tz").
 *
 * NOT interchangeable with utcDate, and the difference is an accounting one: a
 * charge at 2026-08-01T02:00Z is 2026-07-31 in Phoenix, so using UTC here books
 * a July invoice into August. Kept as two named functions precisely so a future
 * reader cannot collapse them on the assumption they are the same thing.
 */
export function phoenixDate(unixSeconds: unknown): string | null {
  if (typeof unixSeconds !== "number" || !Number.isFinite(unixSeconds)) return null;
  return utcDate(unixSeconds + PHOENIX_UTC_OFFSET_SECONDS);
}

/** ISO-8601 week label, e.g. 2026-W29. */
function isoWeekLabel(unixSeconds: number): string | null {
  const base = new Date(unixSeconds * 1000);
  if (Number.isNaN(base.getTime())) return null;
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  // ISO weeks are Mon-Sun and belong to the year containing their Thursday.
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * § 5.1.1 billing-period label for the line-item name.
 *
 * This is a COSMETIC label, and that is why an unrecognised shape falls back
 * with a warning instead of rejecting. The rule this module applies throughout:
 * reject when the MONEY shape is unknown, warn when only the LABEL is. Dropping
 * a real payment because a catalog interval is unfamiliar is the worse failure.
 */
export function formatPeriodLabel(
  interval: unknown,
  intervalCount: unknown,
  periodStartUnix: number
): { label: string; warnings: string[] } {
  const warnings: string[] = [];
  const count = typeof intervalCount === "number" && Number.isInteger(intervalCount) ? intervalCount : 1;
  const iso = utcDate(periodStartUnix) ?? "";
  const [yyyy, mm] = iso.split("-");

  switch (interval) {
    case "year":
      return { label: yyyy ?? "", warnings };
    case "month": {
      if (count === 1) return { label: `${yyyy}-${mm}`, warnings };
      if (count === 6) {
        const half = Number.parseInt(mm ?? "1", 10) <= 6 ? "H1" : "H2";
        return { label: `${yyyy} ${half}`, warnings };
      }
      warnings.push(
        `period_label_fallback: month interval_count=${count} is unspecified in spec § 5.1.1; used YYYY-MM`
      );
      return { label: `${yyyy}-${mm}`, warnings };
    }
    case "week": {
      const wk = isoWeekLabel(periodStartUnix);
      return { label: wk ?? iso, warnings };
    }
    case "day":
      return { label: iso, warnings };
    default:
      warnings.push(`period_label_fallback: unrecognised interval ${JSON.stringify(interval)}; used period start date`);
      return { label: iso, warnings };
  }
}

// ---------------------------------------------------------------------------
// Event routing (§ 5.1 prelude vs § 5.2-§ 5.5)
// ---------------------------------------------------------------------------

/**
 * Decide what an inbound event means before any payload is built.
 *
 * An UNKNOWN billing_reason rejects rather than defaulting. billing_reason
 * selects the money shape — one aggregate line at amount_paid (create/cycle) vs
 * every Stripe line passed through 1:1 (update/proration). Guessing wrong does
 * not produce an error; it produces a real invoice with the wrong lines on it.
 */
export function routeEvent(event: unknown): EventRoute {
  const ev = asRecord(event);
  if (!ev) return reject("invoice_malformed", "event is not an object");

  const type = ev.type;
  const object = asRecord(asRecord(ev.data)?.object) ?? {};

  switch (type) {
    case "invoice.payment_succeeded": {
      const reason = object.billing_reason;
      switch (reason) {
        case "subscription_create":
        case "subscription_cycle":
        case "subscription_update":
          return { kind: "billing", branch: reason, billingReason: reason, warnings: [] };
        // § 5.1.4 — folded onto an existing shape, never given their own.
        case "subscription_threshold":
          return {
            kind: "billing",
            branch: "subscription_cycle",
            billingReason: reason,
            warnings: ["billing_reason_threshold: treated as subscription_cycle per § 5.1.4; CEO visibility"],
          };
        case "manual":
          return {
            kind: "billing",
            branch: "subscription_update",
            billingReason: reason,
            warnings: ["billing_reason_manual: treated as subscription_update per § 5.1.4; CEO visibility"],
          };
        default:
          return reject(
            "billing_reason_unknown",
            `unmapped billing_reason ${JSON.stringify(reason)} — money shape is not inferable, refusing to guess`
          );
      }
    }

    // § 5.2 — the first charge fires its own payment_succeeded; writing here too
    // would double-count.
    case "customer.subscription.created":
      return {
        kind: "no_write",
        status: "logged_no_action",
        detail: { reason: "lifecycle_event_not_billing" },
        warnings: [],
      };

    // § 5.3 — billing-affecting updates arrive later as payment_succeeded with
    // billing_reason=subscription_update. Metadata pass-through is DEFERRED v1.0.
    case "customer.subscription.updated":
      return { kind: "no_write", status: "logged_no_action", detail: {}, warnings: [] };

    // § 5.4 — cancellation is audit-only; the Zoho contact Notes append is a
    // v1.0 SHOULD and is deferred.
    case "customer.subscription.deleted":
      return { kind: "no_write", status: "cancellation_logged", detail: {}, warnings: [] };

    // § 5.5 — no Zoho write (Stripe has not collected). Page only on the final
    // retry; first and second failures usually self-recover and paging them
    // trains the CEO to ignore the channel.
    case "invoice.payment_failed": {
      const attempts = typeof object.attempt_count === "number" ? object.attempt_count : 0;
      return {
        kind: "no_write",
        status: "payment_failure_logged",
        detail: { attempt_count: attempts, page: attempts >= 3 },
        warnings: [],
      };
    }

    default:
      return reject("event_type_unsupported", `event type ${JSON.stringify(type)} is outside the § 4.1 subscribed set`);
  }
}

// ---------------------------------------------------------------------------
// Invoice payload (§ 5.1.1 / § 5.1.2 / § 5.1.3)
// ---------------------------------------------------------------------------

export function buildInvoicePayload(invoice: unknown, branch: BillingBranch, ctx: TransformContext): InvoiceBuild {
  const inv = asRecord(invoice);
  if (!inv) return reject("invoice_malformed", "invoice is not an object");

  const invoiceId = asString(inv.id);
  if (!invoiceId) return reject("invoice_malformed", "invoice.id missing");

  const created = inv.created;
  const date = phoenixDate(created);
  if (!date) return reject("invoice_malformed", "invoice.created is not a usable unix timestamp");

  const lines = asRecord(inv.lines)?.data;
  if (!Array.isArray(lines) || lines.length === 0) {
    return reject("line_items_missing", "invoice.lines.data is empty — nothing to bill");
  }

  const warnings: string[] = [];
  const built =
    branch === "subscription_update"
      ? buildProratedLines(lines, invoiceId, inv, warnings)
      : buildSingleLine(lines, invoiceId, inv, branch, ctx, warnings);
  if (!built.ok) return built;

  const customFields: ZohoCustomField[] = [{ label: "Stripe Invoice ID", value: invoiceId }];
  const subscriptionId = asString(inv.subscription);
  if (subscriptionId) {
    customFields.push({ label: "Stripe Subscription ID", value: subscriptionId });
  } else {
    // Omit rather than emit a null-valued custom field: a written-but-empty
    // correlation field reads to a future auditor as "checked, none found".
    warnings.push("subscription_id_absent: Stripe Subscription ID custom field omitted rather than written empty");
  }
  const customerId = asString(inv.customer);
  if (customerId) customFields.push({ label: "Stripe Customer ID", value: customerId });

  return {
    ok: true,
    warnings,
    payload: {
      customer_id: ctx.zohoCustomerId,
      invoice_number: ctx.invoiceNumber,
      date,
      due_date: date,
      payment_terms: 0,
      payment_terms_label: DUE_ON_RECEIPT,
      custom_fields: customFields,
      notes: built.notes,
      line_items: built.lineItems,
    },
  };
}

const BASE_NOTES =
  "Auto-generated from Stripe subscription. Payment already collected via Stripe. See custom fields for source correlation.";

type LinesBuild = { ok: true; lineItems: ZohoLineItem[]; notes: string } | TransformReject;

/** § 5.1.1 + § 5.1.2 — ONE aggregate line at `amount_paid`. */
function buildSingleLine(
  lines: unknown[],
  invoiceId: string,
  inv: Record<string, unknown>,
  branch: BillingBranch,
  ctx: TransformContext,
  warnings: string[]
): LinesBuild {
  if (lines.length > 1) {
    // Total still reconciles (the single line carries amount_paid), but the
    // per-line detail Stripe sent is being collapsed — say so rather than let it
    // vanish silently.
    warnings.push(`line_collapse: ${lines.length} Stripe lines collapsed into one aggregate line per § 5.1.1`);
  }

  const line = asRecord(lines[0]);
  if (!line) return reject("invoice_malformed", "invoice.lines.data[0] is not an object");

  const price = asRecord(line.price);
  const productName = expandedProductName(price?.product);
  if (productName === null) {
    return reject(
      "product_unexpanded",
      "lines.data[0].price.product did not expand to an object — refusing to name a customer-facing line from an id"
    );
  }

  const period = asRecord(line.period);
  const periodStart = typeof period?.start === "number" ? period.start : null;
  const periodEnd = typeof period?.end === "number" ? period.end : null;
  if (periodStart === null || periodEnd === null) {
    return reject("invoice_malformed", "lines.data[0].period.start/end missing");
  }

  const recurring = asRecord(price?.recurring);
  const { label, warnings: labelWarnings } = formatPeriodLabel(
    recurring?.interval,
    recurring?.interval_count,
    periodStart
  );
  warnings.push(...labelWarnings);

  const amount = centsToAmount(inv.amount_paid);
  if (amount === null) return reject("amount_not_integer", "invoice.amount_paid is not an integer minor-unit amount");

  const nickname = asString(price?.nickname);
  if (!nickname) {
    warnings.push("price_nickname_absent: line name composed without the nickname segment");
  }
  const name = [productName, nickname, label].filter((s): s is string => Boolean(s)).join(" — ");

  const startIso = utcDate(periodStart) ?? "";
  const endIso = utcDate(periodEnd) ?? "";
  let description = `Subscription period: ${startIso} to ${endIso}. Stripe invoice: ${invoiceId}.`;
  let notes = BASE_NOTES;

  if (branch === "subscription_cycle") {
    // § 5.1.2 — cycle number is best-effort by design; same-subscription races
    // are already prevented upstream by the § 7.1 KV dedup.
    const prior = typeof ctx.priorInvoiceCount === "number" && ctx.priorInvoiceCount >= 0 ? ctx.priorInvoiceCount : 0;
    if (typeof ctx.priorInvoiceCount !== "number") {
      warnings.push("cycle_count_absent: priorInvoiceCount not supplied; cycle number reported as 1");
    }
    const subscriptionId = asString(inv.subscription);
    if (subscriptionId) description += ` Renewal of subscription: ${subscriptionId}.`;
    notes = `Subscription renewal for cycle ${prior + 1}. ${BASE_NOTES}`;
  }

  return {
    ok: true,
    notes,
    lineItems: [{ name, description, rate: amount, quantity: 1, discount: 0, tax_id: "" }],
  };
}

/**
 * § 5.1.3 — proration. Every Stripe line passes through 1:1; nothing is netted
 * or collapsed, and `line.amount` MAY BE NEGATIVE (unused-time credit). Zoho
 * accepts a negative rate.
 */
function buildProratedLines(
  lines: unknown[],
  invoiceId: string,
  inv: Record<string, unknown>,
  warnings: string[]
): LinesBuild {
  const lineItems: ZohoLineItem[] = [];
  let sumCents = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = asRecord(lines[i]);
    if (!line) return reject("invoice_malformed", `invoice.lines.data[${i}] is not an object`);

    const price = asRecord(line.price);
    const productName = expandedProductName(price?.product);
    if (productName === null) {
      return reject("product_unexpanded", `lines.data[${i}].price.product did not expand to an object`);
    }

    const rate = centsToAmount(line.amount);
    if (rate === null) return reject("amount_not_integer", `lines.data[${i}].amount is not an integer minor-unit amount`);
    sumCents += line.amount as number;

    const nickname = asString(price?.nickname);
    const name = [productName, nickname].filter((s): s is string => Boolean(s)).join(" — ");
    const stripeDescription = asString(line.description) ?? "";
    const description = `${stripeDescription}${stripeDescription ? " " : ""}Prorated. Stripe invoice: ${invoiceId}.`;

    lineItems.push({ name, description, rate, quantity: 1, discount: 0, tax_id: "" });
  }

  // § 5.1.3 invariant: WARN AND PROCEED, never reject. Stripe's own consistency
  // is authoritative, and refusing the invoice here would drop captured revenue
  // over a reconciliation discrepancy that a human can settle after the fact.
  const paid = inv.amount_paid;
  if (typeof paid === "number" && Number.isInteger(paid) && paid !== sumCents) {
    warnings.push(`proration_sum_mismatch: lines sum to ${sumCents} minor units, amount_paid is ${paid}; proceeding per § 5.1.3`);
  }

  return { ok: true, lineItems, notes: BASE_NOTES };
}

// ---------------------------------------------------------------------------
// Payment payload (§ 5.1.1 payment record, CBM v1.4 § 4.5)
// ---------------------------------------------------------------------------

export function buildPaymentPayload(
  invoice: unknown,
  ctx: TransformContext & { zohoInvoiceId: string }
): PaymentBuild {
  const inv = asRecord(invoice);
  if (!inv) return reject("invoice_malformed", "invoice is not an object");

  const amount = centsToAmount(inv.amount_paid);
  if (amount === null) return reject("amount_not_integer", "invoice.amount_paid is not an integer minor-unit amount");

  // § 5.1.3 perfect-proration wash. Zoho creates the invoice at total 0 with
  // status=paid; there is no payment to record and forcing one would create a
  // zero-value payment row that reconciles against nothing.
  if (amount === 0) {
    return { ok: true, skip: true, reason: "zero_amount_no_payment", warnings: [] };
  }

  const date = phoenixDate(inv.created);
  if (!date) return reject("invoice_malformed", "invoice.created is not a usable unix timestamp");

  const invoiceId = asString(inv.id);
  if (!invoiceId) return reject("invoice_malformed", "invoice.id missing");

  // reference_number IS the payment dedup key (§ 5.1.1: list_customer_payments
  // by reference_number before create). No charge id means no dedup key, which
  // means a Stripe retry records the payment twice. Fail closed.
  const charge = asString(inv.charge);
  if (!charge) {
    return reject(
      "charge_reference_missing",
      "invoice.charge absent on a non-zero invoice — payment dedup key would be empty, refusing to create an undedupable payment"
    );
  }
  if (charge.length > MAX_REFERENCE_NUMBER_LEN) {
    // Zoho error code 15. Caught here so it surfaces as a named rejection rather
    // than an opaque 400 in the middle of a two-write sequence.
    return reject(
      "charge_reference_too_long",
      `charge id is ${charge.length} chars, Zoho reference_number caps at ${MAX_REFERENCE_NUMBER_LEN}`
    );
  }

  return {
    ok: true,
    skip: false,
    warnings: [],
    payload: {
      customer_id: ctx.zohoCustomerId,
      invoice_id: ctx.zohoInvoiceId,
      amount,
      payment_mode: "Credit Card",
      reference_number: charge,
      date,
      notes: "Auto-collected via Stripe. See reference_number for Stripe charge.",
      custom_fields: [
        { label: "Stripe Charge ID", value: charge },
        { label: "Stripe Invoice ID", value: invoiceId },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Narrowing helpers
// ---------------------------------------------------------------------------

function reject(code: TransformRejectCode, message: string): TransformReject {
  return { ok: false, code, message };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * `price.product` is an id STRING when the § 5 step-2 expand did not land, and
 * an object when it did. Returning null (rather than falling back to the id)
 * forces the caller to reject: a line named "prod_ABC123 — Monthly — 2026-07",
 * or worse "undefined — undefined", goes onto a document a customer reads.
 */
function expandedProductName(product: unknown): string | null {
  const rec = asRecord(product);
  if (!rec) return null;
  return asString(rec.name);
}
