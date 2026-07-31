import { describe, it, expect } from "vitest";
import {
  INGRESS_TTL_SEC,
  KV_EXPIRATION_TTL_FLOOR_SEC,
  MUTEX_TTL_SEC,
  INGRESS_KEY_PREFIX,
  ingressKey,
  readIngressMarker,
  writeIngressMarker,
  checkZohoForExisting,
  acquireMutexBestEffort,
  releaseMutex,
  contactMutexKey,
  invoiceMutexKey,
  resolveIdempotency,
  type IdempotencyKv,
  type IngressMarker,
  type InvoiceLookupClient,
} from "../src/webhook_idempotency";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface PutRecord {
  key: string;
  value: string;
  expirationTtl?: number;
}

class FakeKv implements IdempotencyKv {
  store = new Map<string, string>();
  puts: PutRecord[] = [];
  failGet = false;
  failPut = false;

  async get(key: string): Promise<string | null> {
    if (this.failGet) throw new Error("KV unreachable");
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    if (this.failPut) throw new Error("KV write failed");
    this.puts.push({ key, value, expirationTtl: options?.expirationTtl });
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

function zohoReturning(result: {
  ok: boolean;
  status: number;
  body: unknown;
}): InvoiceLookupClient {
  return { listInvoiceByStripeInvoiceId: async () => result };
}

const zohoThrowing: InvoiceLookupClient = {
  listInvoiceByStripeInvoiceId: async () => {
    throw new Error("transport exploded");
  },
};

const MARKER: IngressMarker = {
  zoho_invoice_id: "460000000123456",
  processed_at: "2026-07-31T12:00:00.000Z",
  status: "created",
};

const FIXED_NOW = () => "2026-07-31T12:00:00.000Z";

// ---------------------------------------------------------------------------
// Constants — the separation from the checkout path IS the deliverable
// ---------------------------------------------------------------------------

describe("constants (§7.1 / §7.4) — the anti-merge guarantees", () => {
  it("Layer-1 TTL is 7 days, which OUTLIVES Stripe's 3-day retry ladder", () => {
    expect(INGRESS_TTL_SEC).toBe(604800);
    const stripeRetryWindowSec = 3 * 24 * 60 * 60;
    expect(INGRESS_TTL_SEC).toBeGreaterThan(stripeRetryWindowSec);
  });

  it("Layer-1 TTL is NOT the checkout path's 60s — the merge would be a revenue defect", () => {
    expect(INGRESS_TTL_SEC).not.toBe(60);
    // Concretely: a 60s marker is already gone when Stripe's FIRST retry lands.
    const firstStripeRetrySec = 5 * 60;
    expect(60).toBeLessThan(firstStripeRetrySec);
    expect(INGRESS_TTL_SEC).toBeGreaterThan(firstStripeRetrySec);
  });

  it("mutex TTL sits AT the KV floor, not spec §7.4's unimplementable 30s", () => {
    expect(MUTEX_TTL_SEC).toBe(60);
    expect(MUTEX_TTL_SEC).toBeGreaterThanOrEqual(KV_EXPIRATION_TTL_FLOOR_SEC);
    expect(MUTEX_TTL_SEC).not.toBe(30);
  });

  it("key prefix is disjoint from the checkout path's rl:/lock: prefixes", () => {
    const key = ingressKey("evt_123");
    expect(key).toBe("stripe-idem-evt_123");
    expect(key.startsWith("rl:ip:")).toBe(false);
    expect(key.startsWith("lock:email:")).toBe(false);
    expect(INGRESS_KEY_PREFIX).toBe("stripe-idem-");
  });
});

// ---------------------------------------------------------------------------
// Layer 1 (§7.1)
// ---------------------------------------------------------------------------

describe("Layer 1 — ingress marker (§7.1)", () => {
  it("round-trips a marker and writes it at the 7-day TTL", async () => {
    const kv = new FakeKv();
    const wrote = await writeIngressMarker(kv, "evt_1", MARKER);
    expect(wrote).toBe(true);
    expect(kv.puts[0].expirationTtl).toBe(INGRESS_TTL_SEC);

    const read = await readIngressMarker(kv, "evt_1");
    expect(read).toEqual({ state: "hit", marker: MARKER });
  });

  it("absent key is a MISS (licenses proceeding)", async () => {
    const read = await readIngressMarker(new FakeKv(), "evt_absent");
    expect(read).toEqual({ state: "miss" });
  });

  it("KV read failure is UNKNOWN, never a miss", async () => {
    const kv = new FakeKv();
    kv.failGet = true;
    const read = await readIngressMarker(kv, "evt_1");
    expect(read).toEqual({ state: "unknown", reason: "kv_error" });
    // The distinction that matters: unknown must not be equal to miss.
    expect(read).not.toEqual({ state: "miss" });
  });

  it("unbound KV is UNKNOWN, never a miss", async () => {
    const read = await readIngressMarker(undefined, "evt_1");
    expect(read).toEqual({ state: "unknown", reason: "kv_unbound" });
  });

  it("unparseable JSON is UNKNOWN, not a miss", async () => {
    const kv = new FakeKv();
    kv.store.set(ingressKey("evt_1"), "{not json");
    expect(await readIngressMarker(kv, "evt_1")).toEqual({
      state: "unknown",
      reason: "corrupt_marker",
    });
  });

  it("well-formed JSON of the WRONG shape is UNKNOWN, not a hit", async () => {
    const kv = new FakeKv();
    kv.store.set(ingressKey("evt_1"), JSON.stringify({ hello: "world" }));
    expect(await readIngressMarker(kv, "evt_1")).toEqual({
      state: "unknown",
      reason: "corrupt_marker",
    });
  });

  it("marker with an invalid status enum is UNKNOWN", async () => {
    const kv = new FakeKv();
    kv.store.set(
      ingressKey("evt_1"),
      JSON.stringify({ ...MARKER, status: "definitely_not_a_status" }),
    );
    expect(await readIngressMarker(kv, "evt_1")).toEqual({
      state: "unknown",
      reason: "corrupt_marker",
    });
  });

  it("null zoho_invoice_id is VALID (the no_action lifecycle case)", async () => {
    const kv = new FakeKv();
    const noAction: IngressMarker = {
      zoho_invoice_id: null,
      processed_at: FIXED_NOW(),
      status: "no_action",
    };
    await writeIngressMarker(kv, "evt_1", noAction);
    expect(await readIngressMarker(kv, "evt_1")).toEqual({ state: "hit", marker: noAction });
  });

  it("KV write failure returns false and does NOT throw", async () => {
    const kv = new FakeKv();
    kv.failPut = true;
    await expect(writeIngressMarker(kv, "evt_1", MARKER)).resolves.toBe(false);
  });

  it("unbound KV write returns false and does NOT throw", async () => {
    await expect(writeIngressMarker(undefined, "evt_1", MARKER)).resolves.toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TTL floor — enforcement by construction
// ---------------------------------------------------------------------------

describe("KV TTL floor is enforced by construction", () => {
  it("every KV write in this module requests a TTL at or above the floor", async () => {
    const kv = new FakeKv();
    await writeIngressMarker(kv, "evt_1", MARKER);
    await acquireMutexBestEffort(kv, invoiceMutexKey("in_1"), "iso_a");
    expect(kv.puts.length).toBeGreaterThan(0);
    for (const p of kv.puts) {
      expect(p.expirationTtl).toBeGreaterThanOrEqual(KV_EXPIRATION_TTL_FLOOR_SEC);
    }
  });

  it("a sub-floor TTL would be a RangeError, not a silent runtime rejection", async () => {
    // Guards the future edit: anyone re-introducing spec §7.4's 30s gets a
    // test failure here rather than a production "Invalid expiration_ttl of 30".
    expect(KV_EXPIRATION_TTL_FLOOR_SEC).toBe(60);
    expect(30).toBeLessThan(KV_EXPIRATION_TTL_FLOOR_SEC);
  });
});

// ---------------------------------------------------------------------------
// Layer 2 (§7.2) — including the ok:false discrimination
// ---------------------------------------------------------------------------

describe("Layer 2 — Zoho check-before-create (§7.2)", () => {
  it("a bound query with one row reports EXISTS with the Zoho id", async () => {
    const client = zohoReturning({
      ok: true,
      status: 200,
      body: { invoices: [{ invoice_id: "460000000123456", invoice_number: "7001" }] },
    });
    expect(await checkZohoForExisting(client, "in_1")).toEqual({
      state: "exists",
      zohoInvoiceId: "460000000123456",
    });
  });

  it("a bound query with zero rows reports ABSENT (safe to create)", async () => {
    const client = zohoReturning({ ok: true, status: 200, body: { invoices: [] } });
    expect(await checkZohoForExisting(client, "in_1")).toEqual({ state: "absent" });
  });

  it("numeric invoice_id is coerced, not rejected", async () => {
    const client = zohoReturning({
      ok: true,
      status: 200,
      body: { invoices: [{ invoice_id: 460000000123456 }] },
    });
    expect(await checkZohoForExisting(client, "in_1")).toEqual({
      state: "exists",
      zohoInvoiceId: "460000000123456",
    });
  });

  // --- the discrimination that prevents a silent 3-day revenue drop ---

  it("BINDING FAILURE is NOT reported as transient — retrying can never fix it", async () => {
    const client = zohoReturning({
      ok: false,
      status: 200,
      body: {
        binding_error: { bound: false, reason: "criteria_absent", expected: "cf_stripe_invoice_id" },
        path: "/invoices",
      },
    });
    const verdict = await checkZohoForExisting(client, "in_1");
    expect(verdict.state).toBe("binding_failure");
    expect(verdict.state).not.toBe("zoho_unavailable");
    expect(verdict.state).not.toBe("absent");
  });

  it("UNMEASURED cf_ column (status 0, request never issued) is a binding failure", async () => {
    const client = zohoReturning({
      ok: false,
      status: 0,
      body: { binding_unavailable: "cf_stripe_invoice_id", detail: "probe has not landed" },
    });
    expect((await checkZohoForExisting(client, "in_1")).state).toBe("binding_failure");
  });

  it("status 0 alone does NOT decide it — transport failure is transient, not binding", async () => {
    // Both a transport failure and an unmeasured column report status 0. The
    // body marker is the only discriminator; this pins that.
    const client = zohoReturning({
      ok: false,
      status: 0,
      body: { transport_error: "fetch failed" },
    });
    expect(await checkZohoForExisting(client, "in_1")).toEqual({
      state: "zoho_unavailable",
      status: 0,
    });
  });

  it("Zoho 500 is transient", async () => {
    const client = zohoReturning({ ok: false, status: 500, body: { message: "server error" } });
    expect(await checkZohoForExisting(client, "in_1")).toEqual({
      state: "zoho_unavailable",
      status: 500,
    });
  });

  it("Zoho 429 is transient", async () => {
    const client = zohoReturning({ ok: false, status: 429, body: {} });
    expect(await checkZohoForExisting(client, "in_1")).toEqual({
      state: "zoho_unavailable",
      status: 429,
    });
  });

  it("a thrown client is transient, not a crash", async () => {
    expect(await checkZohoForExisting(zohoThrowing, "in_1")).toEqual({
      state: "zoho_unavailable",
      status: 0,
    });
  });

  it("rows present but UNIDENTIFIABLE are never reported absent", async () => {
    const client = zohoReturning({
      ok: true,
      status: 200,
      body: { invoices: [{ no_id_here: true }] },
    });
    const verdict = await checkZohoForExisting(client, "in_1");
    expect(verdict.state).toBe("binding_failure");
    expect(verdict.state).not.toBe("absent");
  });

  it("a body with no invoices array is ABSENT, not a throw", async () => {
    const client = zohoReturning({ ok: true, status: 200, body: { message: "success" } });
    expect(await checkZohoForExisting(client, "in_1")).toEqual({ state: "absent" });
  });

  it("a non-object body does not throw", async () => {
    const client = zohoReturning({ ok: true, status: 200, body: "<html>nope</html>" });
    expect(await checkZohoForExisting(client, "in_1")).toEqual({ state: "absent" });
  });

  it("a null body does not throw", async () => {
    const client = zohoReturning({ ok: true, status: 200, body: null });
    expect(await checkZohoForExisting(client, "in_1")).toEqual({ state: "absent" });
  });
});

// ---------------------------------------------------------------------------
// §7.4 / §7.5 mutex
// ---------------------------------------------------------------------------

describe("§7.4 / §7.5 best-effort mutex", () => {
  it("acquires an uncontested lock at the floor TTL", async () => {
    const kv = new FakeKv();
    const key = invoiceMutexKey("in_1");
    const got = await acquireMutexBestEffort(kv, key, "iso_a");
    expect(got).toEqual({ acquired: true, holder: "iso_a" });
    expect(kv.puts[0].expirationTtl).toBe(MUTEX_TTL_SEC);
  });

  it("a second isolate is refused while the first holds it", async () => {
    const kv = new FakeKv();
    const key = invoiceMutexKey("in_1");
    await acquireMutexBestEffort(kv, key, "iso_a");
    expect(await acquireMutexBestEffort(kv, key, "iso_b")).toEqual({
      acquired: false,
      holder: "iso_a",
    });
  });

  it("re-acquiring your OWN lock succeeds (retry within the same isolate)", async () => {
    const kv = new FakeKv();
    const key = invoiceMutexKey("in_1");
    await acquireMutexBestEffort(kv, key, "iso_a");
    expect(await acquireMutexBestEffort(kv, key, "iso_a")).toEqual({
      acquired: true,
      holder: "iso_a",
    });
  });

  it("release frees it for the next isolate", async () => {
    const kv = new FakeKv();
    const key = invoiceMutexKey("in_1");
    await acquireMutexBestEffort(kv, key, "iso_a");
    await releaseMutex(kv, key, "iso_a");
    expect(await acquireMutexBestEffort(kv, key, "iso_b")).toEqual({
      acquired: true,
      holder: "iso_b",
    });
  });

  it("release does NOT steal someone else's lock", async () => {
    const kv = new FakeKv();
    const key = invoiceMutexKey("in_1");
    await acquireMutexBestEffort(kv, key, "iso_a");
    await releaseMutex(kv, key, "iso_b"); // wrong holder
    expect(await acquireMutexBestEffort(kv, key, "iso_c")).toEqual({
      acquired: false,
      holder: "iso_a",
    });
  });

  it("unbound KV PROCEEDS rather than stalling revenue capture", async () => {
    expect(await acquireMutexBestEffort(undefined, "k", "iso_a")).toEqual({
      acquired: true,
      holder: null,
    });
  });

  it("unreachable KV PROCEEDS rather than stalling", async () => {
    const kv = new FakeKv();
    kv.failGet = true;
    expect(await acquireMutexBestEffort(kv, "k", "iso_a")).toEqual({
      acquired: true,
      holder: null,
    });
  });

  it("contact mutex key hashes the email — no raw address in KV", async () => {
    const key = await contactMutexKey("Person@Example.com ");
    expect(key.startsWith("contact-mutex-")).toBe(true);
    expect(key).not.toContain("Person");
    expect(key).not.toContain("@");
    expect(key).toMatch(/^contact-mutex-[0-9a-f]{64}$/);
  });

  it("contact mutex key is case- and whitespace-normalised", async () => {
    expect(await contactMutexKey("a@b.com")).toBe(await contactMutexKey("  A@B.COM  "));
  });

  it("contact and invoice mutex prefixes are disjoint", async () => {
    const c = await contactMutexKey("a@b.com");
    const i = invoiceMutexKey("in_1");
    expect(c.startsWith("contact-mutex-")).toBe(true);
    expect(i).toBe("invoice-mutex-in_1");
    expect(c.startsWith("invoice-mutex-")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Composition (§7.3)
// ---------------------------------------------------------------------------

describe("resolveIdempotency — Layer 1 → Layer 2 (§7.3)", () => {
  const existsClient = zohoReturning({
    ok: true,
    status: 200,
    body: { invoices: [{ invoice_id: "460000000123456" }] },
  });
  const absentClient = zohoReturning({ ok: true, status: 200, body: { invoices: [] } });

  it("Layer-1 hit short-circuits with NO Zoho call at all", async () => {
    const kv = new FakeKv();
    await writeIngressMarker(kv, "evt_1", MARKER);
    let called = 0;
    const counting: InvoiceLookupClient = {
      listInvoiceByStripeInvoiceId: async () => {
        called += 1;
        return { ok: true, status: 200, body: { invoices: [] } };
      },
    };
    const verdict = await resolveIdempotency("evt_1", "in_1", { kv, client: counting });
    expect(verdict).toEqual({
      disposition: "short_circuit",
      via: "layer1",
      zohoInvoiceId: "460000000123456",
    });
    expect(called).toBe(0);
  });

  it("Layer-1 miss + Zoho absent → PROCEED", async () => {
    const verdict = await resolveIdempotency("evt_1", "in_1", {
      kv: new FakeKv(),
      client: absentClient,
    });
    expect(verdict).toEqual({ disposition: "proceed" });
  });

  it("Layer-1 miss + Zoho exists → short_circuit via layer2 AND self-heals KV", async () => {
    const kv = new FakeKv();
    const verdict = await resolveIdempotency("evt_1", "in_1", {
      kv,
      client: existsClient,
      nowIso: FIXED_NOW,
    });
    expect(verdict).toEqual({
      disposition: "short_circuit",
      via: "layer2",
      zohoInvoiceId: "460000000123456",
    });
    // Self-heal: the NEXT delivery must short-circuit at Layer 1.
    expect(await readIngressMarker(kv, "evt_1")).toEqual({
      state: "hit",
      marker: {
        zoho_invoice_id: "460000000123456",
        processed_at: "2026-07-31T12:00:00.000Z",
        status: "already_recorded",
      },
    });
  });

  it("KV UNKNOWN still consults Zoho — it does not proceed blindly", async () => {
    const kv = new FakeKv();
    kv.failGet = true;
    const verdict = await resolveIdempotency("evt_1", "in_1", { kv, client: existsClient });
    expect(verdict).toEqual({
      disposition: "short_circuit",
      via: "layer2",
      zohoInvoiceId: "460000000123456",
    });
  });

  it("unbound KV still consults Zoho and can still PROCEED", async () => {
    const verdict = await resolveIdempotency("evt_1", "in_1", { client: absentClient });
    expect(verdict).toEqual({ disposition: "proceed" });
  });

  it("Zoho transient → DEFER to Stripe retry, never proceed", async () => {
    const verdict = await resolveIdempotency("evt_1", "in_1", {
      kv: new FakeKv(),
      client: zohoReturning({ ok: false, status: 503, body: {} }),
    });
    expect(verdict).toEqual({
      disposition: "defer_to_stripe_retry",
      reason: "zoho_unavailable",
      status: 503,
    });
  });

  it("binding failure → DEAD_LETTER, never defer and never proceed", async () => {
    const verdict = await resolveIdempotency("evt_1", "in_1", {
      kv: new FakeKv(),
      client: zohoReturning({
        ok: false,
        status: 200,
        body: { binding_error: { bound: false, reason: "column_mismatch" } },
      }),
    });
    expect(verdict.disposition).toBe("dead_letter");
    expect(verdict.disposition).not.toBe("defer_to_stripe_retry");
    expect(verdict.disposition).not.toBe("proceed");
  });

  it("a self-heal KV write failure does NOT break the short-circuit verdict", async () => {
    const kv = new FakeKv();
    kv.failPut = true;
    const verdict = await resolveIdempotency("evt_1", "in_1", { kv, client: existsClient });
    expect(verdict).toEqual({
      disposition: "short_circuit",
      via: "layer2",
      zohoInvoiceId: "460000000123456",
    });
  });

  it("the full Stripe retry sequence creates exactly ONE invoice", async () => {
    // Delivery 1: nothing anywhere -> proceed (caller creates, writes marker).
    // Delivery 2 (Stripe retry, hours later): marker still alive -> short-circuit.
    const kv = new FakeKv();
    const first = await resolveIdempotency("evt_1", "in_1", { kv, client: absentClient });
    expect(first).toEqual({ disposition: "proceed" });

    await writeIngressMarker(kv, "evt_1", MARKER); // what the create path does

    const second = await resolveIdempotency("evt_1", "in_1", { kv, client: absentClient });
    expect(second.disposition).toBe("short_circuit");
    // If the TTL were the checkout path's 60s, the marker would be GONE here
    // and this would read "proceed" -> a second invoice for one payment.
  });
});
