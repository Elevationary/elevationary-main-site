// Spec § 7 — Two-Layer Idempotency for the D2.1 Stripe webhook receiver.
//
//   Layer 1 (§ 7.1)  KV ingress dedup, keyed on Stripe event.id
//   Layer 2 (§ 7.2)  Zoho check-before-create, keyed on cf_stripe_invoice_id
//   § 7.4 / § 7.5    Best-effort serialized-create mutex (contact / invoice)
//
// ============================================================================
// ⚠ THIS IS **NOT** `src/idempotency.ts`, AND THE TWO MUST NEVER BE MERGED.
// ============================================================================
// `idempotency.ts` is CHECKOUT-PATH ABUSE CONTROL: per-IP rate limiting and
// per-email double-submit lockout, on the `IDEMPOTENCY_KV` binding, with 60s
// TTLs. This module is WEBHOOK EVENT DEDUP, on the SEPARATE `STRIPE_IDEMPOTENCY`
// binding (spec § 11.3, already declared at `types.ts:190`), with a 7-DAY TTL.
//
// Different namespace, different key shape, different TTL, different purpose.
// The only thing they share is the word "idempotency".
//
// WHY A MERGE WOULD BE A REVENUE DEFECT rather than merely untidy: the 60s TTL
// over there is not a design choice, it is Cloudflare KV's `expirationTtl`
// FLOOR (see KV_EXPIRATION_TTL_FLOOR_SEC below). Stripe's webhook retry ladder
// runs for up to THREE DAYS. Webhook dedup state parked behind a 60s
// abuse-window TTL expires long before Stripe stops retrying, so retry #2 reads
// an empty KV, concludes "not yet processed", and CREATES A SECOND ZOHO INVOICE
// FOR MONEY COLLECTED ONCE.
//
// Design posture throughout: KV is an OPTIMISATION, Zoho is the AUTHORITY.
// No KV failure may ever fabricate a "not processed" verdict.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Cloudflare KV rejects any `expirationTtl` below 60 seconds outright:
 *
 *   KV PUT failed: Invalid expiration_ttl of 30. Expiration TTL must be at
 *   least 60.
 *
 * Found the hard way on 2026-06-16 by the checkout path (`idempotency.ts:13`),
 * whose spec (§ 3.7) also asked for 30s. Spec § 7.4 / § 7.5 repeat that same
 * unimplementable 30s for the mutex; see MUTEX_TTL_SEC.
 */
export const KV_EXPIRATION_TTL_FLOOR_SEC = 60;

/**
 * Layer-1 marker TTL: 7 days (§ 7.1).
 *
 * ⚠ DO NOT LOWER THIS TO "MATCH" THE CHECKOUT PATH. Stripe retries a failed
 * webhook delivery for up to 3 DAYS (§ 8.1). The marker MUST outlive that
 * window or a late retry re-creates an invoice that was already written. The
 * 4-day margin also covers replay tools during incident recovery.
 */
export const INGRESS_TTL_SEC = 604800;

/**
 * § 7.4 / § 7.5 mutex TTL. Spec says 30s; KV's floor is 60s, so 30 is
 * unimplementable — see KV_EXPIRATION_TTL_FLOOR_SEC. Held at the floor.
 *
 * CONSEQUENCE, recorded rather than hidden: a crashed isolate holds a contested
 * lock for up to 60s instead of 30s. Acceptable because § 7.4 itself calls this
 * "a probabilistic mitigation — Cloudflare KV is not a strict linearizable
 * lock", backstopped by CBM D1.1 § 2.4's monthly duplicate audit. A lock that
 * cannot be written at all is strictly worse than one held twice as long.
 */
export const MUTEX_TTL_SEC = KV_EXPIRATION_TTL_FLOOR_SEC;

export const INGRESS_KEY_PREFIX = "stripe-idem-";
export const CONTACT_MUTEX_PREFIX = "contact-mutex-";
export const INVOICE_MUTEX_PREFIX = "invoice-mutex-";

// ---------------------------------------------------------------------------
// Injected dependency surfaces — no `Env`, no live client, no secret.
// ---------------------------------------------------------------------------

/** Minimal KV surface. The real `KVNamespace` satisfies it structurally. */
export interface IdempotencyKv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Minimal Zoho surface. The real `ZohoClient` satisfies it structurally. */
export interface InvoiceLookupClient {
  listInvoiceByStripeInvoiceId(
    stripeInvoiceId: string,
  ): Promise<{ ok: boolean; status: number; body: unknown }>;
}

// ---------------------------------------------------------------------------
// Layer 1 — KV ingress marker (§ 7.1)
// ---------------------------------------------------------------------------

export type IngressStatus = "created" | "already_recorded" | "no_action";

export interface IngressMarker {
  zoho_invoice_id: string | null;
  processed_at: string;
  status: IngressStatus;
}

export type IngressRead =
  | { state: "hit"; marker: IngressMarker }
  /** Key genuinely absent — safe to proceed to Layer 2. */
  | { state: "miss" }
  /**
   * KV unreadable, or present-but-unparseable. NOT a miss.
   *
   * The distinction is the point: "miss" licenses a create, "unknown" does not.
   * An unknown degrades to Layer 2, which is authoritative anyway.
   */
  | { state: "unknown"; reason: "kv_unbound" | "kv_error" | "corrupt_marker" };

export function ingressKey(eventId: string): string {
  return INGRESS_KEY_PREFIX + eventId;
}

/**
 * Guarded KV write. Every put in this module goes through here so that no
 * future TTL constant can slip below the floor unnoticed — enforcement by
 * construction rather than by remembering (the mandate that produced
 * `getFiltered`'s required `expectedColumn`).
 */
async function kvPutGuarded(
  kv: IdempotencyKv,
  key: string,
  value: string,
  ttlSec: number,
): Promise<void> {
  if (!Number.isInteger(ttlSec) || ttlSec < KV_EXPIRATION_TTL_FLOOR_SEC) {
    throw new RangeError(
      `expirationTtl ${ttlSec} is below Cloudflare KV's floor of ` +
        `${KV_EXPIRATION_TTL_FLOOR_SEC}s; the PUT would be rejected at runtime`,
    );
  }
  await kv.put(key, value, { expirationTtl: ttlSec });
}

export async function readIngressMarker(
  kv: IdempotencyKv | undefined,
  eventId: string,
): Promise<IngressRead> {
  if (!kv) return { state: "unknown", reason: "kv_unbound" };

  let raw: string | null;
  try {
    raw = await kv.get(ingressKey(eventId));
  } catch {
    // Never downgrade an unreachable KV to "not processed".
    return { state: "unknown", reason: "kv_error" };
  }
  if (raw === null) return { state: "miss" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { state: "unknown", reason: "corrupt_marker" };
  }
  if (!isIngressMarker(parsed)) {
    return { state: "unknown", reason: "corrupt_marker" };
  }
  return { state: "hit", marker: parsed };
}

function isIngressMarker(v: unknown): v is IngressMarker {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  const idOk = o.zoho_invoice_id === null || typeof o.zoho_invoice_id === "string";
  const atOk = typeof o.processed_at === "string";
  const stOk =
    o.status === "created" || o.status === "already_recorded" || o.status === "no_action";
  return idOk && atOk && stOk;
}

/**
 * Best-effort marker write. Returns whether it landed; NEVER throws on KV
 * failure, because by the time this runs the Zoho write already succeeded and
 * failing the request would tell Stripe to retry work that is already done.
 * A lost marker costs one redundant Layer-2 query on the next delivery.
 *
 * A RangeError from the TTL guard is a PROGRAMMING error, not a runtime one, so
 * it deliberately propagates.
 */
export async function writeIngressMarker(
  kv: IdempotencyKv | undefined,
  eventId: string,
  marker: IngressMarker,
): Promise<boolean> {
  if (!kv) return false;
  try {
    await kvPutGuarded(kv, ingressKey(eventId), JSON.stringify(marker), INGRESS_TTL_SEC);
    return true;
  } catch (err) {
    if (err instanceof RangeError) throw err;
    return false;
  }
}

// ---------------------------------------------------------------------------
// Layer 2 — Zoho check-before-create (§ 7.2)
// ---------------------------------------------------------------------------

export type ZohoCheck =
  /** Invoice already exists in Zoho — this event is a duplicate. */
  | { state: "exists"; zohoInvoiceId: string }
  /** Query bound correctly and returned nothing — safe to create. */
  | { state: "absent" }
  /**
   * TRANSIENT failure (5xx / 429 / transport). Caller returns 5xx so Stripe
   * retries. Retrying is the correct response because the condition may clear.
   */
  | { state: "zoho_unavailable"; status: number }
  /**
   * The filter did NOT bind, or its column name has never been measured.
   *
   * ⚠ THIS IS NOT A TRANSIENT FAILURE AND MUST NOT BE RETRIED AS ONE.
   * `getFiltered` surfaces both a Zoho 5xx and a binding failure as `ok:false`,
   * so a caller that checks only `ok` collapses them — and that collapse is a
   * silent revenue defect. A binding failure fails IDENTICALLY on every retry,
   * so returning 5xx makes Stripe retry for 3 days and then give up, dropping
   * the event with no invoice and no alarm. Route to DLQ + page (§ 9).
   *
   * Nor may a binding failure be read as "absent": an unbound cf_ filter
   * returns the ORG-WIDE set, which is consulting-dominated. Treating that as
   * "found" attaches subscription revenue to a consulting client's invoice.
   */
  | { state: "binding_failure"; detail: unknown };

export async function checkZohoForExisting(
  client: InvoiceLookupClient,
  stripeInvoiceId: string,
): Promise<ZohoCheck> {
  let result: { ok: boolean; status: number; body: unknown };
  try {
    result = await client.listInvoiceByStripeInvoiceId(stripeInvoiceId);
  } catch {
    return { state: "zoho_unavailable", status: 0 };
  }

  if (!result.ok) {
    // Binding failures are marked in the body by the client; everything else
    // is transient. Check the marker FIRST — status alone cannot discriminate
    // (both a transport failure and an unmeasured cf_ column report status 0).
    const marker = bindingMarker(result.body);
    if (marker !== null) return { state: "binding_failure", detail: marker };
    return { state: "zoho_unavailable", status: result.status };
  }

  const invoices = extractInvoices(result.body);
  if (invoices === null || invoices.length === 0) return { state: "absent" };

  const id = firstInvoiceId(invoices);
  if (id === null) {
    // Zoho returned rows we cannot identify. Not "absent" — creating here would
    // duplicate whatever those rows are.
    return { state: "binding_failure", detail: { unidentifiable_rows: invoices.length } };
  }
  return { state: "exists", zohoInvoiceId: id };
}

function bindingMarker(body: unknown): unknown | null {
  if (typeof body !== "object" || body === null) return null;
  const o = body as Record<string, unknown>;
  if ("binding_error" in o) return o.binding_error;
  if ("binding_unavailable" in o) return o.binding_unavailable;
  return null;
}

function extractInvoices(body: unknown): unknown[] | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = (body as Record<string, unknown>).invoices;
  return Array.isArray(raw) ? raw : null;
}

function firstInvoiceId(invoices: unknown[]): string | null {
  const first = invoices[0];
  if (typeof first !== "object" || first === null) return null;
  const id = (first as Record<string, unknown>).invoice_id;
  if (typeof id === "string" && id.length > 0) return id;
  if (typeof id === "number") return String(id);
  return null;
}

// ---------------------------------------------------------------------------
// § 7.4 / § 7.5 — best-effort serialized create
// ---------------------------------------------------------------------------

export async function sha256Hex(input: string): Promise<string> {
  // Deliberately NOT imported from `idempotency.ts`. Importing would couple the
  // webhook path to the checkout module this file exists to keep separate — and
  // that module is the one whose constants are wrong for this path. Twelve
  // lines of duplication is the cheaper failure mode.
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function contactMutexKey(email: string): Promise<string> {
  return CONTACT_MUTEX_PREFIX + (await sha256Hex(email.trim().toLowerCase()));
}

export function invoiceMutexKey(stripeInvoiceId: string): string {
  return INVOICE_MUTEX_PREFIX + stripeInvoiceId;
}

/**
 * Read-then-write "lock" over eventually-consistent KV.
 *
 * The name carries the caveat on purpose: this is NOT linearizable and cannot
 * be. Two isolates can both read empty and both acquire. § 7.4 accepts that
 * explicitly and backstops it with CBM's duplicate audit; Layer 2 catches the
 * survivors that matter. Anything that needs a real lock needs a Durable
 * Object, not this.
 */
export async function acquireMutexBestEffort(
  kv: IdempotencyKv | undefined,
  key: string,
  holderId: string,
): Promise<{ acquired: boolean; holder: string | null }> {
  // Unbound KV must not BLOCK the create — Layer 2 is the real guard, and
  // failing closed here would halt all revenue capture on a missing binding.
  if (!kv) return { acquired: true, holder: null };

  try {
    const existing = await kv.get(key);
    if (existing !== null && existing !== holderId) {
      return { acquired: false, holder: existing };
    }
    await kvPutGuarded(kv, key, holderId, MUTEX_TTL_SEC);
    return { acquired: true, holder: holderId };
  } catch (err) {
    if (err instanceof RangeError) throw err;
    // KV unreachable — proceed rather than stall. Same reasoning as unbound.
    return { acquired: true, holder: null };
  }
}

/** Releases only if still held by `holderId`; never throws. */
export async function releaseMutex(
  kv: IdempotencyKv | undefined,
  key: string,
  holderId: string,
): Promise<void> {
  if (!kv) return;
  try {
    const existing = await kv.get(key);
    if (existing !== null && existing !== holderId) return; // someone else's lock
    await kv.delete(key);
  } catch {
    // TTL expiry reclaims it regardless.
  }
}

// ---------------------------------------------------------------------------
// Composition — the single verdict the § 2 route wiring will consume
// ---------------------------------------------------------------------------

export type IdempotencyDisposition =
  /** Already handled. Return 200 to Stripe; do NOT touch Zoho. */
  | { disposition: "short_circuit"; via: "layer1" | "layer2"; zohoInvoiceId: string | null }
  /** No prior record. Proceed to the create path. */
  | { disposition: "proceed" }
  /** Transient. Return 5xx so Stripe retries (§ 7.2). */
  | { disposition: "defer_to_stripe_retry"; reason: "zoho_unavailable"; status: number }
  /** Permanent. DLQ + page (§ 9). Retrying can never succeed. */
  | { disposition: "dead_letter"; reason: "binding_failure"; detail: unknown };

export interface ResolveDeps {
  kv?: IdempotencyKv;
  client: InvoiceLookupClient;
  /** Injected for determinism in tests. */
  nowIso?: () => string;
}

/**
 * Layer 1 → Layer 2, per § 7.3.
 *
 * Layer 1 short-circuits ~99.9% of duplicates with no Zoho call. Layer 2 is
 * consulted on every miss AND on every "unknown", because KV's eventual
 * consistency (~60s) means a miss is not proof of absence.
 */
export async function resolveIdempotency(
  eventId: string,
  stripeInvoiceId: string,
  deps: ResolveDeps,
): Promise<IdempotencyDisposition> {
  const layer1 = await readIngressMarker(deps.kv, eventId);
  if (layer1.state === "hit") {
    return {
      disposition: "short_circuit",
      via: "layer1",
      zohoInvoiceId: layer1.marker.zoho_invoice_id,
    };
  }

  // "miss" and "unknown" both fall through to the authority.
  const layer2 = await checkZohoForExisting(deps.client, stripeInvoiceId);

  switch (layer2.state) {
    case "exists": {
      // § 7.2 Layer-1 self-heal: next retry short-circuits at KV instead of
      // paying for another Zoho round-trip. Best-effort; failure is harmless.
      const nowIso = deps.nowIso ? deps.nowIso() : new Date().toISOString();
      await writeIngressMarker(deps.kv, eventId, {
        zoho_invoice_id: layer2.zohoInvoiceId,
        processed_at: nowIso,
        status: "already_recorded",
      });
      return { disposition: "short_circuit", via: "layer2", zohoInvoiceId: layer2.zohoInvoiceId };
    }
    case "absent":
      return { disposition: "proceed" };
    case "zoho_unavailable":
      return {
        disposition: "defer_to_stripe_retry",
        reason: "zoho_unavailable",
        status: layer2.status,
      };
    case "binding_failure":
      return { disposition: "dead_letter", reason: "binding_failure", detail: layer2.detail };
  }
}
