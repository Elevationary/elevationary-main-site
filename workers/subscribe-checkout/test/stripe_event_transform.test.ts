import { describe, it, expect } from "vitest";
import {
  routeEvent,
  buildInvoicePayload,
  buildPaymentPayload,
  centsToAmount,
  phoenixDate,
  utcDate,
  formatPeriodLabel,
} from "../src/stripe_event_transform";

// --- fixtures ---------------------------------------------------------------

const SEC = (isoUtc: string) => Math.floor(Date.parse(isoUtc) / 1000);

const PERIOD_START = SEC("2026-07-01T00:00:00Z");
const PERIOD_END = SEC("2026-08-01T00:00:00Z");
const CREATED = SEC("2026-07-01T15:00:00Z");

function line(over: Record<string, unknown> = {}) {
  return {
    amount: 4900,
    description: "1 × Individual Access (at $49.00 / month)",
    period: { start: PERIOD_START, end: PERIOD_END },
    price: {
      nickname: "Monthly",
      recurring: { interval: "month", interval_count: 1 },
      product: { id: "prod_abc", name: "Individual Access" },
    },
    ...over,
  };
}

function invoice(over: Record<string, unknown> = {}) {
  const { lines, ...rest } = over as { lines?: unknown };
  return {
    id: "in_1QxTest",
    created: CREATED,
    amount_paid: 4900,
    charge: "ch_3QxYzAbCdEfGhIjKlMnOpQr",
    customer: "cus_QxTest",
    subscription: "sub_QxTest",
    lines: lines ?? { data: [line()] },
    ...rest,
  };
}

function event(type: string, object: Record<string, unknown> = {}) {
  return { id: "evt_1", type, data: { object } };
}

const CTX = { zohoCustomerId: "zoho_cust_1", invoiceNumber: "7001" };

// --- routing (§ 5.1 prelude vs § 5.2-§ 5.5) ---------------------------------

describe("routeEvent", () => {
  it("routes billing_reason=subscription_create to the create branch", () => {
    const r = routeEvent(event("invoice.payment_succeeded", { billing_reason: "subscription_create" }));
    expect(r).toMatchObject({ kind: "billing", branch: "subscription_create", warnings: [] });
  });

  it("routes billing_reason=subscription_cycle to the cycle branch", () => {
    const r = routeEvent(event("invoice.payment_succeeded", { billing_reason: "subscription_cycle" }));
    expect(r).toMatchObject({ kind: "billing", branch: "subscription_cycle" });
  });

  it("routes billing_reason=subscription_update to the update branch", () => {
    const r = routeEvent(event("invoice.payment_succeeded", { billing_reason: "subscription_update" }));
    expect(r).toMatchObject({ kind: "billing", branch: "subscription_update" });
  });

  it("§ 5.1.4 folds subscription_threshold onto the cycle branch WITH a warning", () => {
    const r = routeEvent(event("invoice.payment_succeeded", { billing_reason: "subscription_threshold" }));
    expect(r).toMatchObject({ kind: "billing", branch: "subscription_cycle", billingReason: "subscription_threshold" });
    expect((r as { warnings: string[] }).warnings[0]).toContain("threshold");
  });

  it("§ 5.1.4 folds manual onto the update branch WITH a warning", () => {
    const r = routeEvent(event("invoice.payment_succeeded", { billing_reason: "manual" }));
    expect(r).toMatchObject({ kind: "billing", branch: "subscription_update", billingReason: "manual" });
    expect((r as { warnings: string[] }).warnings[0]).toContain("manual");
  });

  it("REJECTS an unmapped billing_reason rather than defaulting to a money shape", () => {
    const r = routeEvent(event("invoice.payment_succeeded", { billing_reason: "subscription_wibble" }));
    expect(r).toMatchObject({ ok: false, code: "billing_reason_unknown" });
  });

  it("REJECTS a missing billing_reason", () => {
    const r = routeEvent(event("invoice.payment_succeeded", {}));
    expect(r).toMatchObject({ ok: false, code: "billing_reason_unknown" });
  });

  it("§ 5.2 customer.subscription.created is no-write with the lifecycle reason", () => {
    const r = routeEvent(event("customer.subscription.created"));
    expect(r).toMatchObject({
      kind: "no_write",
      status: "logged_no_action",
      detail: { reason: "lifecycle_event_not_billing" },
    });
  });

  it("§ 5.3 customer.subscription.updated is no-write", () => {
    expect(routeEvent(event("customer.subscription.updated"))).toMatchObject({
      kind: "no_write",
      status: "logged_no_action",
    });
  });

  it("§ 5.4 customer.subscription.deleted logs the cancellation, writes nothing", () => {
    expect(routeEvent(event("customer.subscription.deleted"))).toMatchObject({
      kind: "no_write",
      status: "cancellation_logged",
    });
  });

  it("§ 5.5 payment_failed does NOT page on the first attempt", () => {
    expect(routeEvent(event("invoice.payment_failed", { attempt_count: 1 }))).toMatchObject({
      kind: "no_write",
      status: "payment_failure_logged",
      detail: { attempt_count: 1, page: false },
    });
  });

  it("§ 5.5 payment_failed PAGES on the third attempt (final retry)", () => {
    expect(routeEvent(event("invoice.payment_failed", { attempt_count: 3 }))).toMatchObject({
      detail: { attempt_count: 3, page: true },
    });
  });

  it("REJECTS an event type outside the § 4.1 subscribed set", () => {
    expect(routeEvent(event("charge.refunded"))).toMatchObject({ ok: false, code: "event_type_unsupported" });
  });

  it("REJECTS a non-object event without throwing", () => {
    expect(routeEvent("<html>gateway error</html>")).toMatchObject({ ok: false, code: "invoice_malformed" });
    expect(routeEvent(null)).toMatchObject({ ok: false, code: "invoice_malformed" });
  });
});

// --- primitives -------------------------------------------------------------

describe("centsToAmount", () => {
  it("converts integer minor units", () => {
    expect(centsToAmount(4900)).toBe(49);
    expect(centsToAmount(1999)).toBe(19.99);
    expect(centsToAmount(0)).toBe(0);
  });

  it("preserves negative amounts (proration credits)", () => {
    expect(centsToAmount(-1633)).toBe(-16.33);
  });

  it("REJECTS an already-divided float rather than dividing it twice", () => {
    expect(centsToAmount(19.99)).toBeNull();
    expect(centsToAmount("4900")).toBeNull();
    expect(centsToAmount(Number.NaN)).toBeNull();
  });
});

describe("phoenixDate vs utcDate", () => {
  it("diverge across the UTC month boundary — the accounting-month case", () => {
    const t = SEC("2026-08-01T02:00:00Z");
    expect(utcDate(t)).toBe("2026-08-01");
    expect(phoenixDate(t)).toBe("2026-07-31");
  });

  it("agree mid-day", () => {
    expect(phoenixDate(CREATED)).toBe("2026-07-01");
    expect(utcDate(CREATED)).toBe("2026-07-01");
  });

  it("return null on unusable input rather than 'Invalid Date'", () => {
    expect(phoenixDate("nope")).toBeNull();
    expect(utcDate(undefined)).toBeNull();
  });
});

describe("formatPeriodLabel", () => {
  it("month/1 -> YYYY-MM", () => {
    expect(formatPeriodLabel("month", 1, PERIOD_START)).toEqual({ label: "2026-07", warnings: [] });
  });

  it("year -> YYYY", () => {
    expect(formatPeriodLabel("year", 1, PERIOD_START)).toEqual({ label: "2026", warnings: [] });
  });

  it("month/6 -> semi-annual half, both halves", () => {
    expect(formatPeriodLabel("month", 6, SEC("2026-02-01T00:00:00Z")).label).toBe("2026 H1");
    expect(formatPeriodLabel("month", 6, PERIOD_START).label).toBe("2026 H2");
  });

  it("week -> ISO week label", () => {
    expect(formatPeriodLabel("week", 1, SEC("2026-07-15T00:00:00Z")).label).toBe("2026-W29");
  });

  it("day -> YYYY-MM-DD", () => {
    expect(formatPeriodLabel("day", 1, PERIOD_START).label).toBe("2026-07-01");
  });

  it("WARNS and falls back on an unspecified month interval_count — never rejects revenue over a label", () => {
    const r = formatPeriodLabel("month", 3, PERIOD_START);
    expect(r.label).toBe("2026-07");
    expect(r.warnings[0]).toContain("period_label_fallback");
  });

  it("WARNS and falls back on an unrecognised interval", () => {
    const r = formatPeriodLabel("fortnight", 1, PERIOD_START);
    expect(r.label).toBe("2026-07-01");
    expect(r.warnings[0]).toContain("period_label_fallback");
  });
});

// --- invoice payload --------------------------------------------------------

describe("buildInvoicePayload — § 5.1.1 subscription_create", () => {
  it("builds one aggregate line at amount_paid with the composed name", () => {
    const r = buildInvoicePayload(invoice(), "subscription_create", CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.line_items).toHaveLength(1);
    expect(r.payload.line_items[0]).toEqual({
      name: "Individual Access — Monthly — 2026-07",
      description: "Subscription period: 2026-07-01 to 2026-08-01. Stripe invoice: in_1QxTest.",
      rate: 49,
      quantity: 1,
      discount: 0,
      tax_id: "",
    });
    expect(r.warnings).toEqual([]);
  });

  it("sets the § 5.1.1 top-level fields, Phoenix-dated, with all three custom fields", () => {
    const r = buildInvoicePayload(invoice(), "subscription_create", CTX);
    if (!r.ok) throw new Error("expected ok");
    expect(r.payload).toMatchObject({
      customer_id: "zoho_cust_1",
      invoice_number: "7001",
      date: "2026-07-01",
      due_date: "2026-07-01",
      payment_terms: 0,
      payment_terms_label: "Due on Receipt",
    });
    expect(r.payload.custom_fields).toEqual([
      { label: "Stripe Invoice ID", value: "in_1QxTest" },
      { label: "Stripe Subscription ID", value: "sub_QxTest" },
      { label: "Stripe Customer ID", value: "cus_QxTest" },
    ]);
  });

  it("books a late-UTC charge into the Phoenix accounting day", () => {
    const r = buildInvoicePayload(invoice({ created: SEC("2026-08-01T02:00:00Z") }), "subscription_create", CTX);
    if (!r.ok) throw new Error("expected ok");
    expect(r.payload.date).toBe("2026-07-31");
  });

  it("WARNS when more than one Stripe line is collapsed into the aggregate", () => {
    const r = buildInvoicePayload(invoice({ lines: { data: [line(), line()] } }), "subscription_create", CTX);
    if (!r.ok) throw new Error("expected ok");
    expect(r.warnings.some((w) => w.startsWith("line_collapse"))).toBe(true);
  });

  it("WARNS and drops the nickname segment when price.nickname is null", () => {
    const r = buildInvoicePayload(
      invoice({ lines: { data: [line({ price: { ...line().price, nickname: null } })] } }),
      "subscription_create",
      CTX
    );
    if (!r.ok) throw new Error("expected ok");
    expect(r.payload.line_items[0].name).toBe("Individual Access — 2026-07");
    expect(r.warnings.some((w) => w.startsWith("price_nickname_absent"))).toBe(true);
  });

  it("OMITS the subscription custom field rather than writing it empty", () => {
    const r = buildInvoicePayload(invoice({ subscription: null }), "subscription_create", CTX);
    if (!r.ok) throw new Error("expected ok");
    expect(r.payload.custom_fields.map((c) => c.label)).toEqual(["Stripe Invoice ID", "Stripe Customer ID"]);
    expect(r.warnings.some((w) => w.startsWith("subscription_id_absent"))).toBe(true);
  });
});

describe("buildInvoicePayload — § 5.1.2 subscription_cycle", () => {
  it("prefixes notes with the cycle number and appends the renewal sentence", () => {
    const r = buildInvoicePayload(invoice(), "subscription_cycle", { ...CTX, priorInvoiceCount: 2 });
    if (!r.ok) throw new Error("expected ok");
    expect(r.payload.notes).toMatch(/^Subscription renewal for cycle 3\. /);
    expect(r.payload.line_items[0].description).toContain("Renewal of subscription: sub_QxTest.");
  });

  it("reports cycle 1 and WARNS when the prior-invoice count was not supplied", () => {
    const r = buildInvoicePayload(invoice(), "subscription_cycle", CTX);
    if (!r.ok) throw new Error("expected ok");
    expect(r.payload.notes).toMatch(/^Subscription renewal for cycle 1\. /);
    expect(r.warnings.some((w) => w.startsWith("cycle_count_absent"))).toBe(true);
  });
});

describe("buildInvoicePayload — § 5.1.3 subscription_update (proration)", () => {
  const prorated = invoice({
    amount_paid: 3267,
    lines: {
      data: [
        line({ amount: 4900, description: "Remaining time on Functional Bundle" }),
        line({ amount: -1633, description: "Unused time on Individual Access" }),
      ],
    },
  });

  it("passes every Stripe line through 1:1 and PRESERVES the negative credit", () => {
    const r = buildInvoicePayload(prorated, "subscription_update", CTX);
    if (!r.ok) throw new Error("expected ok");
    expect(r.payload.line_items).toHaveLength(2);
    expect(r.payload.line_items.map((l) => l.rate)).toEqual([49, -16.33]);
    expect(r.payload.line_items[1].description).toBe(
      "Unused time on Individual Access Prorated. Stripe invoice: in_1QxTest."
    );
    expect(r.warnings).toEqual([]);
  });

  it("omits the period label from prorated line names (§ 5.1.3 shape)", () => {
    const r = buildInvoicePayload(prorated, "subscription_update", CTX);
    if (!r.ok) throw new Error("expected ok");
    expect(r.payload.line_items[0].name).toBe("Individual Access — Monthly");
  });

  it("WARNS but PROCEEDS when the line sum disagrees with amount_paid", () => {
    const r = buildInvoicePayload({ ...prorated, amount_paid: 9999 }, "subscription_update", CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings.some((w) => w.startsWith("proration_sum_mismatch"))).toBe(true);
    expect(r.payload.line_items).toHaveLength(2);
  });
});

describe("buildInvoicePayload — rejections", () => {
  it("REJECTS an empty line set", () => {
    expect(buildInvoicePayload(invoice({ lines: { data: [] } }), "subscription_create", CTX)).toMatchObject({
      ok: false,
      code: "line_items_missing",
    });
  });

  it("REJECTS an unexpanded product id rather than naming a customer line from it", () => {
    const unexpanded = invoice({ lines: { data: [line({ price: { ...line().price, product: "prod_abc" } })] } });
    expect(buildInvoicePayload(unexpanded, "subscription_create", CTX)).toMatchObject({
      ok: false,
      code: "product_unexpanded",
    });
    expect(buildInvoicePayload(unexpanded, "subscription_update", CTX)).toMatchObject({
      ok: false,
      code: "product_unexpanded",
    });
  });

  it("REJECTS a pre-divided amount", () => {
    expect(buildInvoicePayload(invoice({ amount_paid: 49.0001 }), "subscription_create", CTX)).toMatchObject({
      ok: false,
      code: "amount_not_integer",
    });
  });

  it("REJECTS a missing billing period", () => {
    expect(
      buildInvoicePayload(invoice({ lines: { data: [line({ period: {} })] } }), "subscription_create", CTX)
    ).toMatchObject({ ok: false, code: "invoice_malformed" });
  });

  it("REJECTS a malformed invoice body without throwing", () => {
    expect(buildInvoicePayload("<html>502</html>", "subscription_create", CTX)).toMatchObject({
      ok: false,
      code: "invoice_malformed",
    });
    expect(buildInvoicePayload(invoice({ id: null }), "subscription_create", CTX)).toMatchObject({
      ok: false,
      code: "invoice_malformed",
    });
    expect(buildInvoicePayload(invoice({ created: "yesterday" }), "subscription_create", CTX)).toMatchObject({
      ok: false,
      code: "invoice_malformed",
    });
  });
});

// --- payment payload --------------------------------------------------------

const PCTX = { ...CTX, zohoInvoiceId: "zoho_inv_1" };

describe("buildPaymentPayload", () => {
  it("builds the § 5.1.1 payment record keyed on the charge id", () => {
    const r = buildPaymentPayload(invoice(), PCTX);
    expect(r.ok).toBe(true);
    if (!r.ok || r.skip) throw new Error("expected a payment payload");
    expect(r.payload).toEqual({
      customer_id: "zoho_cust_1",
      invoice_id: "zoho_inv_1",
      amount: 49,
      payment_mode: "Credit Card",
      reference_number: "ch_3QxYzAbCdEfGhIjKlMnOpQr",
      date: "2026-07-01",
      notes: "Auto-collected via Stripe. See reference_number for Stripe charge.",
      custom_fields: [
        { label: "Stripe Charge ID", value: "ch_3QxYzAbCdEfGhIjKlMnOpQr" },
        { label: "Stripe Invoice ID", value: "in_1QxTest" },
      ],
    });
  });

  it("SKIPS the payment on a $0 perfect-proration wash (§ 5.1.3)", () => {
    const r = buildPaymentPayload(invoice({ amount_paid: 0, charge: null }), PCTX);
    expect(r).toMatchObject({ ok: true, skip: true, reason: "zero_amount_no_payment" });
  });

  it("REJECTS a non-zero invoice with no charge — an undedupable payment", () => {
    expect(buildPaymentPayload(invoice({ charge: null }), PCTX)).toMatchObject({
      ok: false,
      code: "charge_reference_missing",
    });
  });

  it("accepts a reference at exactly the 50-char cap", () => {
    const r = buildPaymentPayload(invoice({ charge: "c".repeat(50) }), PCTX);
    expect(r.ok).toBe(true);
  });

  it("REJECTS a reference one char over the cap (Zoho error code 15) before dispatch", () => {
    expect(buildPaymentPayload(invoice({ charge: "c".repeat(51) }), PCTX)).toMatchObject({
      ok: false,
      code: "charge_reference_too_long",
    });
  });

  it("REJECTS a malformed body without throwing", () => {
    expect(buildPaymentPayload(null, PCTX)).toMatchObject({ ok: false, code: "invoice_malformed" });
  });
});
