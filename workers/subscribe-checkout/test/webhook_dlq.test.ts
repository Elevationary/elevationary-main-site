import { describe, it, expect } from "vitest";
import {
  dlqObjectKey,
  buildDlqObject,
  pagedMarkerKey,
  shouldPage,
  markPaged,
  buildPageIntent,
  classifyTransformReject,
  classifyOperationalFailure,
  DLQ_PAGE_SUPPRESSION_TTL_SEC,
  PAGE_GATE,
  TELEGRAM_SEND_MESSAGE_URL,
  type DlqKv,
} from "../src/webhook_dlq";
import type { TransformRejectCode } from "../src/stripe_event_transform";

class FakeKv implements DlqKv {
  store = new Map<string, string>();
  puts: { key: string; value: string; expirationTtl?: number }[] = [];
  failGet = false;
  failPut = false;
  async get(key: string): Promise<string | null> {
    if (this.failGet) throw new Error("KV down");
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    if (this.failPut) throw new Error("KV write down");
    this.puts.push({ key, value, expirationTtl: options?.expirationTtl });
    this.store.set(key, value);
  }
}

const AT = "2026-07-31T12:34:56.789Z";

// ---------------------------------------------------------------------------
// §9.1
// ---------------------------------------------------------------------------

describe("§9.1 DLQ object key", () => {
  it("uses the YYYY/MM/DD/event_type.json shape", () => {
    expect(dlqObjectKey("evt_1abc", "invoice.payment_succeeded", AT)).toBe(
      "2026/07/31/evt_1abc_invoice.payment_succeeded.json",
    );
  });

  it("same event on the same day yields the SAME key — retries overwrite", () => {
    const a = dlqObjectKey("evt_1", "invoice.payment_succeeded", "2026-07-31T01:00:00.000Z");
    const b = dlqObjectKey("evt_1", "invoice.payment_succeeded", "2026-07-31T23:59:59.000Z");
    expect(a).toBe(b);
  });

  it("crossing midnight UTC yields a SECOND object for the same event", () => {
    const a = dlqObjectKey("evt_1", "x", "2026-07-31T23:59:59.000Z");
    const b = dlqObjectKey("evt_1", "x", "2026-08-01T00:00:01.000Z");
    expect(a).not.toBe(b);
    expect(a.startsWith("2026/07/31/")).toBe(true);
    expect(b.startsWith("2026/08/01/")).toBe(true);
  });

  it("sanitises path separators out of the id and type — no traversal", () => {
    const key = dlqObjectKey("../../etc/passwd", "a/b", AT);
    expect(key).toBe("2026/07/31/.._.._etc_passwd_a_b.json");
    expect(key.split("/").length).toBe(4); // yyyy/mm/dd/name.json — no extra depth
  });
});

describe("§9.1 DLQ object body", () => {
  it("carries the full Stripe event verbatim plus error + worker metadata", () => {
    const event = { id: "evt_1", type: "invoice.payment_succeeded", data: { deep: true } };
    const obj = buildDlqObject(
      event,
      {
        step: "zoho_create_invoice",
        zoho_status: 503,
        zoho_body: '{"message":"unavailable"}',
        retry_attempts: 4,
        final_error_at: AT,
      },
      { cf_ray: "8abc", colo: "PHX" },
    );
    expect(obj.stripe_event).toBe(event); // verbatim, not a copy or a redaction
    expect(obj.error.retry_attempts).toBe(4);
    expect(obj.worker_metadata).toEqual({
      cf_ray: "8abc",
      colo: "PHX",
      isolate_start_time: null,
    });
  });

  it("absent worker metadata becomes explicit nulls, not missing keys", () => {
    const obj = buildDlqObject({}, {
      step: "s",
      zoho_status: 0,
      zoho_body: "",
      retry_attempts: 0,
      final_error_at: AT,
    });
    expect(obj.worker_metadata).toEqual({
      cf_ray: null,
      colo: null,
      isolate_start_time: null,
    });
  });
});

// ---------------------------------------------------------------------------
// §9.4
// ---------------------------------------------------------------------------

describe("§9.4 page suppression", () => {
  it("first deposit pages", async () => {
    expect(await shouldPage(new FakeKv(), "evt_1")).toEqual({ page: true, reason: "first" });
  });

  it("a repeat inside the window is suppressed", async () => {
    const kv = new FakeKv();
    await markPaged(kv, "evt_1", AT);
    expect(await shouldPage(kv, "evt_1")).toEqual({ page: false, reason: "suppressed_24h" });
  });

  it("marks with a 24h TTL", async () => {
    const kv = new FakeKv();
    await markPaged(kv, "evt_1", AT);
    expect(kv.puts[0].expirationTtl).toBe(DLQ_PAGE_SUPPRESSION_TTL_SEC);
    expect(DLQ_PAGE_SUPPRESSION_TTL_SEC).toBe(86400);
  });

  it("suppression is PER EVENT — a different event still pages", async () => {
    const kv = new FakeKv();
    await markPaged(kv, "evt_1", AT);
    expect((await shouldPage(kv, "evt_2")).page).toBe(true);
  });

  it("FAILS OPEN: unreadable KV pages rather than going silent", async () => {
    const kv = new FakeKv();
    kv.failGet = true;
    expect(await shouldPage(kv, "evt_1")).toEqual({ page: true, reason: "kv_unavailable" });
  });

  it("FAILS OPEN: unbound KV pages", async () => {
    expect(await shouldPage(undefined, "evt_1")).toEqual({
      page: true,
      reason: "kv_unavailable",
    });
  });

  it("a failed mark does not throw — it costs one extra page, not an outage", async () => {
    const kv = new FakeKv();
    kv.failPut = true;
    await expect(markPaged(kv, "evt_1", AT)).resolves.toBe(false);
  });

  it("marker key is namespaced", () => {
    expect(pagedMarkerKey("evt_1")).toBe("dlq-paged-evt_1");
  });
});

// ---------------------------------------------------------------------------
// §9.2
// ---------------------------------------------------------------------------

describe("§9.2 page intent", () => {
  it("renders the spec's message text", () => {
    const intent = buildPageIntent({
      eventType: "invoice.payment_succeeded",
      eventId: "evt_1",
      step: "zoho_create_invoice",
      retryAttempts: 4,
      r2Key: "2026/07/31/evt_1_invoice.payment_succeeded.json",
    });
    expect(intent.agent).toBe("Website");
    expect(intent.message).toBe(
      "DLQ: invoice.payment_succeeded evt_1 — zoho_create_invoice failed after 4 attempts. " +
        "R2 key: 2026/07/31/evt_1_invoice.payment_succeeded.json.",
    );
  });

  it("is explicitly UNWIRED — a built intent is not a delivered page", () => {
    // Guards the silent-DLQ failure: a deposit path that works while its alert
    // path has never been exercised. `transport` makes the gap unmissable, and
    // this test must be updated when the gate clears.
    const intent = buildPageIntent({
      eventType: "x",
      eventId: "evt_1",
      step: "s",
      retryAttempts: 1,
      r2Key: "k",
    });
    expect(intent.transport).toBe("unwired");
  });

  it("the gate is NAMED and CLEARABLE — not a runtime limitation", () => {
    // The correction that matters: the Worker runtime CAN do this via fetch.
    // What blocks it is a secret-placement decision, which is a CEO call.
    expect(PAGE_GATE.blocked_on).toBe("secret_placement_decision");
    expect(PAGE_GATE.decision_owner).toBe("CEO");
    expect(PAGE_GATE.context).toContain("ESC-149");
    expect(PAGE_GATE.needs).toContain("TELEGRAM_BOT_TOKEN");
  });

  it("the wire-in mechanism is recorded so it need not be re-derived", () => {
    expect(TELEGRAM_SEND_MESSAGE_URL("TOKEN123")).toBe(
      "https://api.telegram.org/botTOKEN123/sendMessage",
    );
  });
});

// ---------------------------------------------------------------------------
// §9.3 — the headline
// ---------------------------------------------------------------------------

describe("🔴 finding E — §9.3 gives two 2c reject codes OPPOSITE dispositions", () => {
  it("event_type_unsupported: 200 OK, no DLQ, NO PAGE", () => {
    const d = classifyTransformReject("event_type_unsupported");
    expect(d.httpStatus).toBe(200);
    expect(d.dlq).toBe(false);
    expect(d.page).toBe(false);
    expect(d.category).toBe("unsubscribed_event");
  });

  it("billing_reason_unknown: 5xx, DLQ, PAGE", () => {
    const d = classifyTransformReject("billing_reason_unknown");
    expect(d.httpStatus).toBe(500);
    expect(d.dlq).toBe(true);
    expect(d.page).toBe(true);
    expect(d.category).toBe("revenue_impact");
  });

  it("the two are OPPOSITE on every axis — the merge is what the module prevents", () => {
    const unsub = classifyTransformReject("event_type_unsupported");
    const revenue = classifyTransformReject("billing_reason_unknown");
    expect(unsub.httpStatus).not.toBe(revenue.httpStatus);
    expect(unsub.dlq).not.toBe(revenue.dlq);
    expect(unsub.page).not.toBe(revenue.page);
  });

  it("a uniform 'reject -> page' handler would page on ROUTINE Stripe traffic", () => {
    // charge.refunded, customer.updated etc. all land on event_type_unsupported.
    // Each has a distinct event.id, so §9.4 suppression cannot damp them.
    expect(classifyTransformReject("event_type_unsupported").page).toBe(false);
  });

  it("the six malformed-payload codes DLQ and page (subscribed event, uncaptured revenue)", () => {
    const codes: TransformRejectCode[] = [
      "invoice_malformed",
      "line_items_missing",
      "product_unexpanded",
      "amount_not_integer",
      "charge_reference_missing",
      "charge_reference_too_long",
    ];
    for (const c of codes) {
      const d = classifyTransformReject(c);
      expect(d.dlq).toBe(true);
      expect(d.page).toBe(true);
      expect(d.httpStatus).toBe(500);
      expect(d.rationale).toContain(c);
    }
  });

  it("ALL EIGHT 2c codes are classified — none falls through", () => {
    const codes: TransformRejectCode[] = [
      "event_type_unsupported",
      "billing_reason_unknown",
      "invoice_malformed",
      "line_items_missing",
      "product_unexpanded",
      "amount_not_integer",
      "charge_reference_missing",
      "charge_reference_too_long",
    ];
    expect(codes.length).toBe(8);
    for (const c of codes) {
      const d = classifyTransformReject(c);
      expect(d.rationale.length).toBeGreaterThan(0);
      expect([200, 500]).toContain(d.httpStatus);
    }
  });
});

describe("§9.3 operational rows", () => {
  it("signature rejection does NOT DLQ and does NOT page — no oracle, no amplification", () => {
    const d = classifyOperationalFailure("signature_invalid");
    expect(d.httpStatus).toBe(401);
    expect(d.dlq).toBe(false);
    expect(d.page).toBe(false);
  });

  it("missing env is a config error: DLQ + page", () => {
    const d = classifyOperationalFailure("missing_env");
    expect(d).toMatchObject({ category: "config_error", httpStatus: 500, dlq: true, page: true });
  });

  it("Zoho 4xx is a client error: DLQ + page, not retried", () => {
    expect(classifyOperationalFailure("zoho_4xx").category).toBe("zoho_client_error");
  });

  it("Zoho transient and Zoho 401 are distinct categories", () => {
    expect(classifyOperationalFailure("zoho_transient").category).toBe("zoho_transient");
    expect(classifyOperationalFailure("zoho_401").category).toBe("zoho_auth");
  });

  it("binding_failure lands in the CLIENT-ERROR row, never the transient one", () => {
    // Increment 3 finding C carried forward: a binding failure is permanent.
    const d = classifyOperationalFailure("binding_failure");
    expect(d.category).toBe("zoho_client_error");
    expect(d.category).not.toBe("zoho_transient");
    expect(d.rationale).toContain("permanent");
  });

  it("every operational disposition that DLQs also pages", () => {
    const kinds = [
      "signature_invalid",
      "missing_env",
      "zoho_4xx",
      "zoho_transient",
      "zoho_401",
      "binding_failure",
    ] as const;
    for (const k of kinds) {
      const d = classifyOperationalFailure(k);
      if (d.dlq) expect(d.page).toBe(true);
    }
  });
});
